import type { UsageSummary } from "@paperclipai/adapter-utils";
import { asString, parseJson, parseObject } from "@paperclipai/adapter-utils/server-utils";

export interface ParsedCopilotToolCall {
  id: string | null;
  name: string;
  arguments: unknown;
}

export interface ParsedCopilotToolResult {
  toolCallId: string | null;
  toolName: string | null;
  success: boolean;
  content: string;
}

export interface CopilotCodeChanges {
  linesAdded: number;
  linesRemoved: number;
  filesModified: string[];
}

export interface ParsedCopilotJsonl {
  /** Session id from the trailing `result` line (null when the stream has none). */
  sessionId: string | null;
  summary: string;
  toolCalls: ParsedCopilotToolCall[];
  toolResults: ParsedCopilotToolResult[];
  /** Model reported by the last assistant.message, when present. */
  model: string | null;
  /** Human-readable failure reported in-band (session.error / blocking warning). */
  errorMessage: string | null;
  errorType: string | null;
  /** True when the stream itself reports the run failed (not counting exit code). */
  failed: boolean;
  /** Exit code echoed by the `result` line, when present. */
  resultExitCode: number | null;
  /**
   * CUMULATIVE premium requests for the whole session (not just this run).
   * Use {@link computePremiumRequestsDelta} to derive the per-run amount.
   */
  premiumRequestsCumulative: number | null;
  codeChanges: CopilotCodeChanges | null;
  totalApiDurationMs: number | null;
  /** Number of JSON event lines seen; 0 means the CLI died before emitting anything. */
  eventCount: number;
  /** Last session.error of type model_call, kept as a fallback failure message. */
  modelCallErrorMessage: string | null;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/** Warning types that make Copilot refuse to continue; they fail the run. */
const FATAL_WARNING_TYPES = new Set(["policy_blocked", "compaction_static_context_blocked"]);

export function readCopilotWarningType(data: Record<string, unknown>): string {
  return (
    asString(data.warningType, "").trim() ||
    asString(data.type, "").trim() ||
    asString(data.code, "").trim()
  );
}

/**
 * Per-run premium requests from the session-cumulative counter.
 * `previous` is the cumulative value stored in sessionParams by the prior run.
 * A counter that went DOWN means the session was replaced, so the new value
 * is already per-run.
 */
export function computePremiumRequestsDelta(
  current: number | null,
  previous: number | null,
): number | null {
  if (current === null) return null;
  if (previous === null || previous < 0 || current < previous) return roundPremium(current);
  return roundPremium(current - previous);
}

function roundPremium(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Build the run summary: the last non-ephemeral assistant.message that has
 * content and requested no tools is the board-facing wrap-up. Intermediate
 * "I'll create the file" messages (which carry toolRequests) are skipped
 * unless nothing better exists.
 */
export function buildCopilotRunSummary(
  messages: Array<{ content: string; hasToolRequests: boolean }>,
): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    const text = message.content.trim();
    if (text && !message.hasToolRequests) return text;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = messages[i]!.content.trim();
    if (text) return text;
  }
  return "";
}

/**
 * Parse `copilot -p ... --output-format json` stdout (JSONL, verified on
 * copilot 1.0.86). Lines that are not JSON are skipped. Ephemeral events
 * (deltas, mcp status, ...) are ignored.
 *
 * Failures such as missing auth or an unknown --resume id produce EMPTY
 * stdout and a message on stderr, so callers must also classify stderr with
 * {@link detectCopilotAuthRequired} / {@link isCopilotSessionUnrecoverableError}.
 */
export function parseCopilotJsonl(stdout: string): ParsedCopilotJsonl {
  let sessionId: string | null = null;
  let errorMessage: string | null = null;
  let errorType: string | null = null;
  let failed = false;
  let resultExitCode: number | null = null;
  let premiumRequests: number | null = null;
  let checkpointPremiumRequests: number | null = null;
  let codeChanges: CopilotCodeChanges | null = null;
  let totalApiDurationMs: number | null = null;
  let model: string | null = null;
  const messages: Array<{ content: string; hasToolRequests: boolean }> = [];
  const toolCalls: ParsedCopilotToolCall[] = [];
  const toolResults: ParsedCopilotToolResult[] = [];
  let eventCount = 0;
  let modelCallErrorMessage: string | null = null;
  const toolNamesById = new Map<string, string>();

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const event = parseJson(line);
    if (!event) continue;
    eventCount += 1;

    const type = asString(event.type, "").trim();
    if (type === "result") {
      sessionId = asString(event.sessionId, "").trim() || sessionId;
      resultExitCode = toFiniteNumber(event.exitCode);
      const usage = parseObject(event.usage);
      premiumRequests = toFiniteNumber(usage.premiumRequests) ?? premiumRequests;
      totalApiDurationMs = toFiniteNumber(usage.totalApiDurationMs);
      if (typeof usage.codeChanges === "object" && usage.codeChanges !== null) {
        const changes = parseObject(usage.codeChanges);
        codeChanges = {
          linesAdded: toFiniteNumber(changes.linesAdded) ?? 0,
          linesRemoved: toFiniteNumber(changes.linesRemoved) ?? 0,
          filesModified: Array.isArray(changes.filesModified)
            ? changes.filesModified.filter((value): value is string => typeof value === "string")
            : [],
        };
      }
      continue;
    }

    if (event.ephemeral === true) continue;
    const data = parseObject(event.data);

    switch (type) {
      case "assistant.message": {
        const requests = Array.isArray(data.toolRequests) ? data.toolRequests : [];
        messages.push({
          content: asString(data.content, ""),
          hasToolRequests: requests.length > 0,
        });
        model = asString(data.model, "").trim() || model;
        break;
      }
      case "tool.execution_start": {
        const name = asString(data.toolName, "").trim();
        if (!name) break;
        const id = asString(data.toolCallId, "").trim() || null;
        if (id) toolNamesById.set(id, name);
        toolCalls.push({ id, name, arguments: data.arguments ?? {} });
        break;
      }
      case "tool.execution_complete": {
        const id = asString(data.toolCallId, "").trim() || null;
        const result = parseObject(data.result);
        const errorObj = parseObject(data.error);
        const content =
          stringifyContent(result.content) || asString(errorObj.message, "") || "";
        toolResults.push({
          toolCallId: id,
          toolName: id ? (toolNamesById.get(id) ?? null) : null,
          success: data.success !== false,
          content,
        });
        break;
      }
      case "session.usage_checkpoint": {
        checkpointPremiumRequests =
          toFiniteNumber(data.totalPremiumRequests) ?? checkpointPremiumRequests;
        break;
      }
      case "session.error": {
        const kind = asString(data.errorType, "").trim();
        // model_call errors are per-request failures Copilot retries itself.
        if (kind === "model_call") {
          modelCallErrorMessage = asString(data.message, "").trim() || modelCallErrorMessage;
          break;
        }
        failed = true;
        errorType = kind || errorType;
        errorMessage =
          asString(data.message, "").trim() || kind || "Copilot reported a session error";
        break;
      }
      case "session.warning": {
        const kind = readCopilotWarningType(data);
        if (!FATAL_WARNING_TYPES.has(kind)) break;
        failed = true;
        errorType = kind;
        errorMessage = asString(data.message, "").trim() || kind;
        break;
      }
      default:
        break;
    }
  }

  return {
    sessionId,
    summary: buildCopilotRunSummary(messages),
    toolCalls,
    toolResults,
    model,
    errorMessage,
    errorType,
    failed,
    resultExitCode,
    premiumRequestsCumulative: premiumRequests ?? checkpointPremiumRequests,
    codeChanges,
    totalApiDurationMs,
    eventCount,
    modelCallErrorMessage,
  };
}

export interface CopilotRuntimeEvent {
  eventType: string;
  message?: string;
  payload?: Record<string, unknown>;
}

/**
 * Map a single stdout line to live runtime events for `onEvent`
 * (`currentToolName` / `lastAssistantSnippet`). Only complete, non-ephemeral
 * assistant messages and tool starts are forwarded; token-level
 * `assistant.message_delta` events are deliberately skipped because a single
 * delta is a useless one-token snippet and would flood the activity stream.
 */
export function extractCopilotRuntimeEvents(line: string): CopilotRuntimeEvent[] {
  const event = parseJson(line);
  if (!event || event.ephemeral === true) return [];
  const type = asString(event.type, "").trim();
  const data = parseObject(event.data);
  if (type === "assistant.message") {
    const content = asString(data.content, "").trim();
    return content ? [{ eventType: "assistant", message: content, payload: { content } }] : [];
  }
  if (type === "tool.execution_start") {
    const name = asString(data.toolName, "").trim();
    return name ? [{ eventType: "tool_call", payload: { toolName: name } }] : [];
  }
  return [];
}

function normalizedLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Copilot rejects an unknown --resume id on stderr with empty stdout. */
const SESSION_UNRECOVERABLE_RE =
  /No\s+session,\s+task,\s+or\s+name\s+matched|session\s+(?:\S+\s+)?not\s+found|cannot\s+resume|failed\s+to\s+resume/i;

export function isCopilotSessionUnrecoverableError(stdout: string, stderr: string): boolean {
  // Stdout is model/tool content, so only structured errors are trusted there.
  const parsed = parseCopilotJsonl(stdout);
  const haystack = [stderr, parsed.errorMessage ?? ""].join("\n");
  return normalizedLines(haystack).some((line) => SESSION_UNRECOVERABLE_RE.test(line));
}

export function isCopilotTransientNetworkError(stdout: string, stderr: string): boolean {
  const parsed = parseCopilotJsonl(stdout);
  return /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch\s+failed|socket\s+hang\s+up/i.test(
    [stderr, parsed.errorMessage ?? ""].join("\n"),
  );
}

export function describeCopilotFailure(input: {
  errorMessage?: string | null;
  stderr?: string;
}): string | null {
  const detail =
    (typeof input.errorMessage === "string" ? input.errorMessage.trim() : "") ||
    normalizedLines(input.stderr ?? "")[0] ||
    "";
  if (!detail) return null;
  const clean = detail.replace(/\s+/g, " ").trim();
  const max = 240;
  return `Copilot run failed: ${clean.length > max ? `${clean.slice(0, max - 1)}…` : clean}`;
}

/**
 * Auth failure patterns. The first group is the literal stderr Copilot 1.0.86
 * prints; the second mirrors the runner's copilot-profile classifier.
 */
const COPILOT_AUTH_REQUIRED_RE =
  /No\s+authentication\s+information\s+found|authentication\s+required|\bunauthorized\b|invalid\s+(?:github\s+)?token|not\s+(?:logged|signed)\s+in|copilot_github_token.*(?:missing|required|not\s+configured)|(?:missing|no)\s+(?:copilot\s+|github\s+)?(?:credential|token|authentication)|\bcopilot\s+login\b/i;

/**
 * Only stderr and structured session.error messages are inspected: the
 * regexes would otherwise match arbitrary assistant output ("unauthorized"
 * in a code review, for example) and misclassify a healthy run.
 */
export function detectCopilotAuthRequired(input: {
  stdout: string;
  stderr: string;
}): { requiresAuth: boolean } {
  const parsed = parseCopilotJsonl(input.stdout);
  // Only "Error:" lines and the first line count: a later MCP "401" warning
  // must not turn a healthy run into an auth failure.
  const stderrLines = normalizedLines(input.stderr);
  const candidates = stderrLines.filter((line, index) => index === 0 || /^Error:/i.test(line));
  if (parsed.failed && parsed.errorMessage) candidates.push(parsed.errorMessage);
  for (const line of input.stdout ? normalizedLines(input.stdout) : []) {
    const event = parseJson(line);
    if (!event || asString(event.type, "") !== "session.error") continue;
    const data = parseObject(event.data);
    const remediation = asString(data.remediation, "").trim();
    if (remediation === "sign_in" || data.statusCode === 401) {
      return { requiresAuth: true };
    }
  }
  return { requiresAuth: candidates.some((line) => COPILOT_AUTH_REQUIRED_RE.test(line)) };
}

/** Raw SESSION-cumulative counters as written by `--usage-output-file`. */
export interface CopilotUsageCumulative {
  /** Copilot's inputTokens, which includes cache reads. */
  inputTokens: number;
  outputTokens: number;
  /** Copilot's cacheReadTokens. */
  cachedInputTokens: number;
  cacheWriteTokens: number;
  totalPremiumRequestCost: number | null;
}

export interface CopilotUsageReport {
  /** Raw cumulative values (null when the file had no token metrics). */
  cumulative: CopilotUsageCumulative | null;
  totalPremiumRequestCost: number | null;
  currentModel: string | null;
}

/**
 * Parse the file written by `--usage-output-file`. Verified: with --resume the
 * counters are cumulative for the whole session, so callers must diff them
 * with {@link computeCopilotUsageDelta}. Returns null for missing/invalid content.
 */
export function parseCopilotUsageReport(text: string): CopilotUsageReport | null {
  if (!text.trim()) return null;
  const root = parseJson(text);
  if (!root) return null;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let sawUsage = false;
  for (const metric of Object.values(parseObject(root.modelMetrics))) {
    const usage = parseObject(parseObject(metric).usage);
    const inTok = toFiniteNumber(usage.inputTokens);
    const outTok = toFiniteNumber(usage.outputTokens);
    if (inTok === null && outTok === null) continue;
    sawUsage = true;
    input += inTok ?? 0;
    output += outTok ?? 0;
    cacheRead += toFiniteNumber(usage.cacheReadTokens) ?? 0;
    cacheWrite += toFiniteNumber(usage.cacheWriteTokens) ?? 0;
  }
  const cost = toFiniteNumber(root.totalPremiumRequestCost);
  return {
    cumulative: sawUsage
      ? {
          inputTokens: input,
          outputTokens: output,
          cachedInputTokens: cacheRead,
          cacheWriteTokens: cacheWrite,
          totalPremiumRequestCost: cost,
        }
      : null,
    totalPremiumRequestCost: cost,
    currentModel: asString(root.currentModel, "").trim() || null,
  };
}

/** Read the stored cumulative counters from sessionParams.usageCumulative. */
export function readCopilotUsageCumulative(value: unknown): CopilotUsageCumulative | null {
  const rec = parseObject(value);
  const inputTokens = toFiniteNumber(rec.inputTokens);
  const outputTokens = toFiniteNumber(rec.outputTokens);
  if (inputTokens === null || outputTokens === null) return null;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: toFiniteNumber(rec.cachedInputTokens) ?? 0,
    cacheWriteTokens: toFiniteNumber(rec.cacheWriteTokens) ?? 0,
    totalPremiumRequestCost: toFiniteNumber(rec.totalPremiumRequestCost),
  };
}

/**
 * Per-run usage = current raw cumulative - previous raw cumulative (each
 * clamped at 0; previous absent = fresh session = 0). Copilot's inputTokens
 * includes cache reads, so the cache-read delta is subtracted from the input
 * delta afterwards to match UsageSummary (input excludes cache reads).
 */
export function computeCopilotUsageDelta(
  current: CopilotUsageCumulative,
  previous: CopilotUsageCumulative | null,
): { usage: UsageSummary; totalPremiumRequestCost: number | null } {
  // A counter that went DOWN means the session was reset: the current value
  // is already the per-run amount.
  const d = (cur: number, prev: number | undefined) =>
    prev === undefined || cur < prev ? cur : cur - prev;
  const input = d(current.inputTokens, previous?.inputTokens);
  const output = d(current.outputTokens, previous?.outputTokens);
  const cacheRead = d(current.cachedInputTokens, previous?.cachedInputTokens);
  const cacheWrite = d(current.cacheWriteTokens, previous?.cacheWriteTokens);
  const cost =
    current.totalPremiumRequestCost === null
      ? null
      : roundPremium(d(current.totalPremiumRequestCost, previous?.totalPremiumRequestCost ?? undefined));
  return {
    usage: {
      inputTokens: Math.max(0, input - cacheRead),
      outputTokens: output,
      cachedInputTokens: cacheRead,
      ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
    },
    totalPremiumRequestCost: cost,
  };
}

/**
 * `error: unknown option '--x'` means the CLI is older than the flags we pass,
 * typically because COPILOT_AUTO_UPDATE=false or --no-auto-update pinned the
 * stale bundled build.
 */
export function detectCopilotOutdatedCli(stderr: string): { flag: string | null } | null {
  const match = stderr.match(/error:\s*unknown option\s+'?([^'\s]+)'?/i);
  return match ? { flag: match[1] ?? null } : null;
}
