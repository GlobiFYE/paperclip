import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { issueDeliverables, issues, type Db } from "@paperclipai/db";
import { buildDeliverableSummaryPrompt, deliverableCompletionKey, deliverableCompletionKeySql, deliverableSourceFingerprint, readDeliverableSources, type DeliverableSource } from "./deliverable-source.js";

export const DELIVERABLE_SUMMARY_DEFAULT_MODEL = "gemini-3.5-flash-lite";
// One initial attempt plus three retries: 5 minutes, 30 minutes, then 2 hours.
export const DELIVERABLE_SUMMARY_MAX_ATTEMPTS = 4;
export const DELIVERABLE_SUMMARY_RETRY_DELAYS_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
export const DELIVERABLE_SUMMARY_CHECK_BATCH = 10;
const REPAIR_LIMIT_ERROR = "Evidence repair limit reached";
export const DELIVERABLE_SUMMARY_SWEEP_INTERVAL_MS = 60_000;
export const DELIVERABLE_SUMMARY_SWEEP_BATCH = 5;
export const DELIVERABLE_SUMMARY_SETTLE_MS = 180_000;
export const DELIVERABLE_SUMMARY_LEASE_MS = 120_000;
export const DELIVERABLE_SUMMARY_MAX_REGENERATIONS = 2;

type DeliverableSummaryModelConfig = {
  model: string;
  baseUrl: string;
  apiKey: string;
  keySource: "env" | "env_file" | null;
  revision: string;
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
  return { model, baseUrl, apiKey, keySource, revision: process.env.PAPERCLIP_DELIVERABLE_SUMMARY_CONFIG_VERSION?.trim() ?? "" };
}

/** Exactly one HTTP attempt. Retries go through the durable claim and rate gate. */
export async function callDeliverableSummaryModel(prompt: string, config: DeliverableSummaryModelConfig) {
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(config.model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 400 } }),
      redirect: "error", signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error("provider failure"); }
    const payload = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = payload.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("").trim();
    if (!text || text.includes(config.apiKey)) throw new Error("invalid response");
    return text.slice(0, 3000);
  } catch {
    // Neither provider bodies nor thrown errors are safe to persist or log.
    throw new Error("Summary provider unavailable");
  }
}

type Row = typeof issueDeliverables.$inferSelect;

export function deliverableSummaryConfigFingerprint(config: DeliverableSummaryModelConfig) {
  // Detect credential rotation without storing or returning the credential itself.
  return createHash("sha256").update(JSON.stringify([config.model, config.baseUrl, config.apiKey, config.revision])).digest("hex");
}

export function deliverableGenerationState(row: Row | null, source: DeliverableSource) {
  if (!row) return "pending" as const;
  const changed = row.sourceFingerprint !== deliverableSourceFingerprint(source);
  if (changed && row.completionKey !== deliverableCompletionKey(source)) return row.summary ? "stale" as const : "pending" as const;
  if (row.generationStatus === "generated" && changed) {
    return row.regenerationCount < DELIVERABLE_SUMMARY_MAX_REGENERATIONS ? "stale" as const : "failed_final" as const;
  }
  // Compatibility with the original draft's persisted failures.
  if ((row.generationStatus as string) === "failed") return "retry_scheduled" as const;
  return row.generationStatus;
}

export type DeliverableSummaryResult = {
  issueId: string;
  outcome: "generated" | "skipped" | "failed";
  attempted?: boolean;
  reason?: "missing_credentials" | "rate_limited";
};

export async function generateIssueDeliverableSummary(
  db: Db, companyId: string, issueId: string, resolvedConfig?: DeliverableSummaryModelConfig,
): Promise<DeliverableSummaryResult> {
  const skipped: DeliverableSummaryResult = { issueId, outcome: "skipped" };
  const config = resolvedConfig ?? await resolveDeliverableSummaryModelConfig();
  if (!config) return { ...skipped, reason: "missing_credentials" };
  const configFingerprint = deliverableSummaryConfigFingerprint(config);
  const claim = await db.transaction(async tx => {
    // Serialize global admission across workers without holding a lock during HTTP.
    await tx.execute(sql`select pg_advisory_xact_lock(1930294)`);
    const source = (await readDeliverableSources(tx, companyId, [issueId])).get(issueId);
    const now = new Date();
    if (!source || source.issue.status !== "done" || source.issue.hiddenAt
      || (source.issue.completedAt ?? source.issue.updatedAt).getTime() > now.getTime() - DELIVERABLE_SUMMARY_SETTLE_MS) return null;
    await tx.insert(issueDeliverables).values({ companyId, issueId }).onConflictDoNothing();
    const [row] = await tx.select().from(issueDeliverables).where(and(eq(issueDeliverables.companyId, companyId), eq(issueDeliverables.issueId, issueId))).for("update");
    if (!row) return null;
    if (row.generationStatus === "generating" && row.claimedAt && row.claimedAt.getTime() > now.getTime() - DELIVERABLE_SUMMARY_LEASE_MS) return null;
    const newCompletion = row.completionKey !== deliverableCompletionKey(source)
      && row.sourceFingerprint !== deliverableSourceFingerprint(source);
    const state = deliverableGenerationState(row, source);
    if (!newCompletion && row.completionKey !== deliverableCompletionKey(source)) {
      // A redundant done PATCH changed the timestamp, not the summarized evidence.
      await tx.update(issueDeliverables).set({ completionKey: deliverableCompletionKey(source) }).where(eq(issueDeliverables.id, row.id));
    }
    if (state === "generated") {
      await tx.update(issueDeliverables).set({ checkedAt: now }).where(eq(issueDeliverables.id, row.id));
      return null;
    }
    const configChanged = row.configFingerprint !== configFingerprint;
    const recoverFailure = row.generationStatus === "failed_final" && row.generationError !== REPAIR_LIMIT_ERROR
      && configChanged;
    if (state === "failed_final" && !recoverFailure) {
      if (row.generationStatus === "generated") {
        await tx.update(issueDeliverables).set({ generationStatus: "failed_final", generationError: REPAIR_LIMIT_ERROR, nextAttemptAt: null, checkedAt: now, updatedAt: now })
          .where(eq(issueDeliverables.id, row.id));
      }
      return null;
    }
    if (!newCompletion && !recoverFailure && !configChanged && row.nextAttemptAt && row.nextAttemptAt > now) return null;
    const repair = !newCompletion && state === "stale" && row.generationStatus === "generated";
    const attempts = newCompletion || repair || recoverFailure || configChanged ? 0 : row.generationAttempts;
    if (attempts >= DELIVERABLE_SUMMARY_MAX_ATTEMPTS) {
      await tx.update(issueDeliverables).set({ generationStatus: "failed_final", claimToken: null, claimedAt: null,
        nextAttemptAt: null, checkedAt: now, updatedAt: now }).where(eq(issueDeliverables.id, row.id));
      return null;
    }
    const [rate] = await tx.select({ count: sql<number>`(select count(*)::int from issue_deliverables d,
      jsonb_array_elements_text(d.attempt_times) t where t.value::timestamptz > ${now.toISOString()}::timestamptz - interval '1 minute')` }).from(issueDeliverables).limit(1);
    if ((rate?.count ?? 0) >= DELIVERABLE_SUMMARY_SWEEP_BATCH) return "rate_limited" as const;
    const token = randomUUID();
    const [claimed] = await tx.update(issueDeliverables).set({
      checkedAt: now, generationStatus: "generating", generationAttempts: attempts + 1,
      regenerationCount: row.regenerationCount + (repair ? 1 : 0),
      completionKey: deliverableCompletionKey(source), configFingerprint,
      sourceFingerprint: deliverableSourceFingerprint(source),
      summary: row.summary,
      summaryFromTaskDetails: row.summary ? row.summaryFromTaskDetails : source.comments.length === 0,
      claimedAt: now, claimToken: token, nextAttemptAt: null, updatedAt: now,
      attemptTimes: [...row.attemptTimes.filter(t => new Date(t).getTime() > now.getTime() - 60_000), now.toISOString()],
    }).where(eq(issueDeliverables.id, row.id)).returning();
    return { row: claimed, source, token };
  });
  if (claim === "rate_limited") return { ...skipped, reason: "rate_limited" };
  if (!claim) return skipped;
  try {
    const summary = await callDeliverableSummaryModel(buildDeliverableSummaryPrompt(claim.source), config);
    return await db.transaction(async tx => {
      const current = (await readDeliverableSources(tx, companyId, [issueId])).get(issueId);
      if (!current) return { ...skipped, attempted: true };
      const changed = current.issue.status !== "done" || deliverableSourceFingerprint(current) !== claim.row.sourceFingerprint;
      const repairCount = claim.row.regenerationCount + (changed ? 1 : 0);
      const [written] = await tx.update(issueDeliverables).set(changed ? {
        generationStatus: repairCount > DELIVERABLE_SUMMARY_MAX_REGENERATIONS ? "failed_final" : "stale",
        generationError: repairCount > DELIVERABLE_SUMMARY_MAX_REGENERATIONS ? REPAIR_LIMIT_ERROR : null,
        regenerationCount: Math.min(repairCount, DELIVERABLE_SUMMARY_MAX_REGENERATIONS),
        generationAttempts: 0, claimToken: null, claimedAt: null, updatedAt: new Date(),
      } : {
        summary, summaryFromTaskDetails: claim.source.comments.length === 0, generationStatus: "generated", generatedAt: new Date(), summaryModel: config.model,
        generationError: null, claimToken: null, claimedAt: null, updatedAt: new Date(),
      }).where(and(eq(issueDeliverables.id, claim.row.id), eq(issueDeliverables.claimToken, claim.token))).returning();
      return { issueId, outcome: written && !changed ? "generated" : "skipped", attempted: true } as DeliverableSummaryResult;
    });
  } catch {
    const final = claim.row.generationAttempts >= DELIVERABLE_SUMMARY_MAX_ATTEMPTS;
    const delay = DELIVERABLE_SUMMARY_RETRY_DELAYS_MS[Math.min(claim.row.generationAttempts - 1, DELIVERABLE_SUMMARY_RETRY_DELAYS_MS.length - 1)];
    await db.update(issueDeliverables).set({
      generationStatus: final ? "failed_final" : "retry_scheduled",
      generationError: "Summary unavailable; check provider configuration.",
      nextAttemptAt: final ? null : new Date(Date.now() + delay),
      claimToken: null, claimedAt: null, updatedAt: new Date(),
    }).where(and(eq(issueDeliverables.id, claim.row.id), eq(issueDeliverables.claimToken, claim.token)));
    return { issueId, outcome: "failed", attempted: true };
  }
}

const sweeping = new WeakSet<Db>();
export async function processPendingDeliverableSummaries(db: Db, options: { limit?: number } = {}) {
  const result = { candidates: 0, generated: 0, failed: 0, skipped: 0 };
  if (sweeping.has(db)) return result;
  sweeping.add(db);
  try {
    const config = await resolveDeliverableSummaryModelConfig();
    if (!config) return result;
    const configFingerprint = deliverableSummaryConfigFingerprint(config);
    // Prioritize new completions and due work over background evidence checks.
    // Timestamp probes avoid loading evidence for unchanged completed history.
    const newCompletion = sql`(${issueDeliverables.id} is null
      or ${issueDeliverables.completionKey} is distinct from ${deliverableCompletionKeySql})`;
    const evidenceChanged = sql`(${issueDeliverables.checkedAt} is null
      or ${issues.updatedAt} > ${issueDeliverables.checkedAt}
      or exists (select 1 from issue_comments ec where ec.issue_id = "issues"."id"
        and ec.company_id = "issues"."company_id" and ec.updated_at > ${issueDeliverables.checkedAt})
      or exists (select 1 from issue_work_products ep where ep.issue_id = "issues"."id"
        and ep.company_id = "issues"."company_id" and ep.updated_at > ${issueDeliverables.checkedAt})
      or exists (select 1 from issue_attachments ea where ea.issue_id = "issues"."id"
        and ea.company_id = "issues"."company_id" and ea.updated_at > ${issueDeliverables.checkedAt}))`;
    const candidates = await db.select({ issueId: issues.id, companyId: issues.companyId }).from(issues)
      .leftJoin(issueDeliverables, eq(issueDeliverables.issueId, issues.id))
      .where(and(eq(issues.status, "done"), isNull(issues.hiddenAt),
        sql`coalesce(${issues.completedAt}, ${issues.updatedAt}) <= now() - interval '3 minutes'`,
        sql`(${newCompletion}
          or (${issueDeliverables.generationStatus} = 'generated'
            and (${evidenceChanged} or ${issueDeliverables.checkedAt} <= now() - interval '24 hours'))
          or (${issueDeliverables.generationStatus} = 'generating'
            and (${issueDeliverables.claimedAt} is null or ${issueDeliverables.claimedAt} <= now() - interval '2 minutes'))
          or (${issueDeliverables.generationStatus} in ('pending', 'stale', 'retry_scheduled', 'failed')
            and (${issueDeliverables.nextAttemptAt} is null or ${issueDeliverables.nextAttemptAt} <= now()
              or ${issueDeliverables.configFingerprint} is distinct from ${configFingerprint}))
          or (${issueDeliverables.generationStatus} = 'failed_final'
            and ${issueDeliverables.generationError} is distinct from ${REPAIR_LIMIT_ERROR}
            and ${issueDeliverables.configFingerprint} is distinct from ${configFingerprint}))`))
      .orderBy(sql`case when ${newCompletion} then 0
        when ${issueDeliverables.generationStatus} <> 'generated' then 1
        when ${evidenceChanged} then 2 else 3 end`,
        sql`${issueDeliverables.checkedAt} asc nulls first`, asc(issues.id)).limit(DELIVERABLE_SUMMARY_CHECK_BATCH);
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 5);
    let attempted = 0;
    for (const candidate of candidates) {
      if (attempted >= limit) break;
      result.candidates++;
      const outcome = await generateIssueDeliverableSummary(db, candidate.companyId, candidate.issueId, config);
      result[outcome.outcome]++;
      if (outcome.reason === "rate_limited") break;
      if (outcome.attempted) attempted++;
    }
    return result;
  } finally { sweeping.delete(db); }
}
