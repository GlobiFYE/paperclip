import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, asc, desc, eq, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  issueComments,
  issueDeliverables,
  issueWorkProducts,
  issues,
  type Db,
} from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

/**
 * Deliverable summary generation (TOP-193).
 *
 * When an issue moves to done, a cheap model (Gemini Flash-Lite by default)
 * writes one plain-English "what was done" summary, which is stored on the
 * issue's deliverable row and written exactly once. The Deliverables page
 * renders the stored text and never calls a model on load.
 *
 * Credentials: the operator's existing Gemini access. `GEMINI_API_KEY` from
 * the process environment, or from the operator env file
 * (`~/.hermes/profiles/<profile>/.env` by default, matching how the local
 * Hermes profiles store provider keys). The key is never logged or returned.
 */

export const DELIVERABLE_SUMMARY_DEFAULT_MODEL = "gemini-3.1-flash-lite";
export const DELIVERABLE_SUMMARY_MAX_ATTEMPTS = 3;
export const DELIVERABLE_SUMMARY_MAX_TEXT_CHARS = 1_500;
export const DELIVERABLE_SUMMARY_MODEL_TIMEOUT_MS = 45_000;
/** How often the server sweeps for completed issues missing a summary. */
export const DELIVERABLE_SUMMARY_SWEEP_INTERVAL_MS = 60_000;
/** Max summaries generated per sweep tick, so the sweep stays cheap. */
export const DELIVERABLE_SUMMARY_SWEEP_BATCH = 5;

type DeliverableSummaryModelConfig = {
  model: string;
  baseUrl: string;
  apiKey: string;
  keySource: "env" | "env_file" | null;
};

function readEnvFileValue(raw: string, key: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    if (trimmed.slice(0, eqIndex).trim() !== key) continue;
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    return value.length > 0 ? value : null;
  }
  return null;
}

export function deliverableSummaryEnvFileDefault(): string {
  return path.join(os.homedir(), ".hermes", "profiles", "pc-gemini", ".env");
}

export async function resolveDeliverableSummaryModelConfig(): Promise<DeliverableSummaryModelConfig | null> {
  const model =
    process.env.PAPERCLIP_DELIVERABLE_SUMMARY_MODEL?.trim() ||
    DELIVERABLE_SUMMARY_DEFAULT_MODEL;
  const baseUrl =
    process.env.PAPERCLIP_DELIVERABLE_SUMMARY_BASE_URL?.trim() ||
    "https://generativelanguage.googleapis.com/v1beta";
  let apiKey = process.env.GEMINI_API_KEY?.trim() || null;
  let keySource: DeliverableSummaryModelConfig["keySource"] = apiKey
    ? "env"
    : null;
  if (!apiKey) {
    const envFile =
      process.env.PAPERCLIP_DELIVERABLE_SUMMARY_ENV_FILE?.trim() ||
      deliverableSummaryEnvFileDefault();
    try {
      const raw = await fs.readFile(envFile, "utf8");
      apiKey = readEnvFileValue(raw, "GEMINI_API_KEY");
      if (apiKey) keySource = "env_file";
    } catch {
      // Missing operator env file simply disables generation; see failure path.
    }
  }
  if (!apiKey) return null;
  return { model, baseUrl, apiKey, keySource };
}

function truncateForPrompt(value: string, max = DELIVERABLE_SUMMARY_MAX_TEXT_CHARS): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export type DeliverableSummaryContext = {
  identifier: string | null;
  title: string;
  description: string | null;
  finalComment: string | null;
  products: { title: string; target: string | null }[];
};

/**
 * Prompt for the cheap model. The owner's design rules: 2-4 plain-English
 * sentences, no jargon, covering what was done, where the result is, and how
 * to open it.
 */
export function buildDeliverableSummaryPrompt(context: DeliverableSummaryContext): string {
  const lines: string[] = [
    "You write plain-English summaries of finished work for a non-technical owner.",
    "Write 2 to 4 short sentences. No jargon, no internal task identifiers, no bullet points, no preamble.",
    "Cover three things: what was done, where the result lives (name the file path, page, screenshot, or commit), and how to open it.",
    "Reply with only the summary text.",
    "",
    `Finished task: ${context.title.trim()}`,
  ];
  if (context.description) {
    lines.push("", "Task background:", truncateForPrompt(context.description));
  }
  if (context.finalComment) {
    lines.push("", "Final note from whoever did the work:", truncateForPrompt(context.finalComment));
  }
  if (context.products.length > 0) {
    lines.push("", "Outputs produced:");
    for (const product of context.products) {
      lines.push(`- ${product.title.trim()}${product.target ? ` — ${product.target.trim()}` : ""}`);
    }
  }
  return lines.join("\n");
}

export async function callDeliverableSummaryModel(
  prompt: string,
  config: DeliverableSummaryModelConfig,
): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(config.model)}:generateContent`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 400 },
  });
  let lastError = "unknown error";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.apiKey,
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(DELIVERABLE_SUMMARY_MODEL_TIMEOUT_MS),
      });
      if (!response.ok) {
        // Status only; response bodies may echo request details.
        lastError = `model request failed with HTTP ${response.status}`;
        await response.body?.cancel();
        if (response.status >= 500) {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          continue;
        }
        throw new Error(lastError);
      }
      const payload = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim();
      if (!text) throw new Error("model returned an empty summary");
      return text;
    } catch (err) {
      lastError =
        err instanceof Error && err.message
          ? err.message.slice(0, 300)
          : "model request failed";
      if (attempt === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  throw new Error(lastError);
}

export async function readDeliverableSummaryContext(
  db: Db,
  companyId: string,
  issueId: string,
): Promise<{ issue: typeof issues.$inferSelect; context: DeliverableSummaryContext } | null> {
  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)));
  if (!issue) return null;
  const [finalCommentRow] = await db
    .select({ body: issueComments.body })
    .from(issueComments)
    .where(
      and(
        eq(issueComments.companyId, companyId),
        eq(issueComments.issueId, issueId),
        isNull(issueComments.deletedAt),
      ),
    )
    .orderBy(desc(issueComments.createdAt))
    .limit(1);
  const productRows = await db
    .select({
      title: issueWorkProducts.title,
      url: issueWorkProducts.url,
      externalId: issueWorkProducts.externalId,
      metadata: issueWorkProducts.metadata,
    })
    .from(issueWorkProducts)
    .where(and(eq(issueWorkProducts.companyId, companyId), eq(issueWorkProducts.issueId, issueId)))
    .orderBy(desc(issueWorkProducts.isPrimary), desc(issueWorkProducts.createdAt))
    .limit(6);
  return {
    issue,
    context: {
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      finalComment: finalCommentRow?.body ?? null,
      products: productRows.map((row) => {
        const metadata = (row.metadata ?? {}) as {
          openPath?: unknown;
          resourceRef?: { path?: unknown };
        };
        const target =
          (typeof row.url === "string" && row.url) ||
          (typeof metadata.openPath === "string" && metadata.openPath) ||
          (typeof metadata.resourceRef?.path === "string" && metadata.resourceRef.path) ||
          (typeof row.externalId === "string" && row.externalId) ||
          null;
        return { title: row.title, target: target as string | null };
      }),
    },
  };
}

export type DeliverableSummaryResult = {
  issueId: string;
  outcome: "generated" | "skipped" | "failed";
  error?: string;
};

/**
 * Generate and store the plain-English summary for a completed issue.
 * Write-once: once a summary is stored, later calls are no-ops.
 */
export async function generateIssueDeliverableSummary(
  db: Db,
  companyId: string,
  issueId: string,
): Promise<DeliverableSummaryResult> {
  const existing = await db
    .select()
    .from(issueDeliverables)
    .where(eq(issueDeliverables.issueId, issueId))
    .then((rows) => rows[0] ?? null);
  if (existing && existing.generationStatus === "generated") {
    return { issueId, outcome: "skipped" };
  }
  if (
    existing &&
    existing.generationStatus === "failed" &&
    existing.generationAttempts >= DELIVERABLE_SUMMARY_MAX_ATTEMPTS
  ) {
    return { issueId, outcome: "skipped" };
  }
  const read = await readDeliverableSummaryContext(db, companyId, issueId);
  if (!read) return { issueId, outcome: "skipped" };
  if (read.issue.status !== "done") return { issueId, outcome: "skipped" };

  const config = await resolveDeliverableSummaryModelConfig();
  const attempts = (existing?.generationAttempts ?? 0) + 1;
  if (!config) {
    await upsertDeliverableRow(db, companyId, issueId, {
      generationStatus: "failed",
      generationAttempts: attempts,
      generationError: "No cheap-model credentials available (GEMINI_API_KEY)",
      summary: existing?.summary ?? null,
      summaryModel: existing?.summaryModel ?? null,
    });
    return { issueId, outcome: "failed", error: "missing credentials" };
  }

  try {
    const summary = await callDeliverableSummaryModel(
      buildDeliverableSummaryPrompt(read.context),
      config,
    );
    // Write once: never overwrite a generated summary, even after a race.
    const written = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(issueDeliverables)
        .where(eq(issueDeliverables.issueId, issueId))
        .for("update");
      if (row?.generationStatus === "generated") return false;
      const patch = {
        summary,
        generationStatus: "generated" as const,
        generationAttempts: attempts,
        generationError: null,
        summaryModel: config.model,
        generatedAt: new Date(),
        updatedAt: new Date(),
      };
      if (row) {
        await tx.update(issueDeliverables).set(patch).where(eq(issueDeliverables.id, row.id));
      } else {
        await tx.insert(issueDeliverables).values({ companyId, issueId, ...patch });
      }
      return true;
    });
    return written
      ? { issueId, outcome: "generated" }
      : { issueId, outcome: "skipped" };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : "generation failed";
    await upsertDeliverableRow(db, companyId, issueId, {
      generationStatus: "failed",
      generationAttempts: attempts,
      generationError: message,
      summary: existing?.summary ?? null,
      summaryModel: existing?.summaryModel ?? null,
    });
    logger.warn({ issueId, err }, "deliverable summary generation failed");
    return { issueId, outcome: "failed", error: message };
  }
}

async function upsertDeliverableRow(
  db: Db,
  companyId: string,
  issueId: string,
  patch: {
    summary: string | null;
    generationStatus: "pending" | "generated" | "failed";
    generationAttempts: number;
    generationError: string | null;
    summaryModel: string | null;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(issueDeliverables)
      .where(eq(issueDeliverables.issueId, issueId))
      .for("update");
    if (row?.generationStatus === "generated") return;
    if (row) {
      await tx
        .update(issueDeliverables)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(issueDeliverables.id, row.id));
    } else {
      await tx.insert(issueDeliverables).values({ companyId, issueId, ...patch });
    }
  });
}

export type DeliverableSweepResult = {
  candidates: number;
  generated: number;
  failed: number;
  skipped: number;
};

/**
 * Sweeper: backfill summaries for completed issues that do not have one yet,
 * and retry failures below the attempt cap. This is the single write path for
 * "the summary is written when an issue moves to done", so every status
 * transition route is covered without per-route hooks.
 */
export async function processPendingDeliverableSummaries(
  db: Db,
  options: { limit?: number } = {},
): Promise<DeliverableSweepResult> {
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 25);
  const missingOrRetry: SQL | undefined = or(
    sql`${issueDeliverables.id} is null`,
    and(
      sql`${issueDeliverables.generationStatus} != 'generated'`,
      sql`${issueDeliverables.generationAttempts} < ${DELIVERABLE_SUMMARY_MAX_ATTEMPTS}`,
    ),
  );
  const candidates = await db
    .select({ issueId: issues.id, companyId: issues.companyId })
    .from(issues)
    .leftJoin(issueDeliverables, eq(issueDeliverables.issueId, issues.id))
    .where(
      and(
        eq(issues.status, "done"),
        isNull(issues.hiddenAt),
        isNotNull(issues.completedAt),
        missingOrRetry,
      ),
    )
    .orderBy(asc(issues.completedAt), asc(issues.id))
    .limit(limit);

  const result: DeliverableSweepResult = {
    candidates: candidates.length,
    generated: 0,
    failed: 0,
    skipped: 0,
  };
  for (const candidate of candidates) {
    const outcome = await generateIssueDeliverableSummary(
      db,
      candidate.companyId,
      candidate.issueId,
    );
    if (outcome.outcome === "generated") result.generated += 1;
    else if (outcome.outcome === "failed") result.failed += 1;
    else result.skipped += 1;
  }
  return result;
}
