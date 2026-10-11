import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalize(record: Record<string, unknown>): Record<string, unknown> | null {
  const sessionId =
    readNonEmptyString(record.sessionId) ??
    readNonEmptyString(record.session_id) ??
    readNonEmptyString(record.sessionID);
  if (!sessionId) return null;
  const cwd =
    readNonEmptyString(record.cwd) ??
    readNonEmptyString(record.workdir) ??
    readNonEmptyString(record.folder);
  const workspaceId = readNonEmptyString(record.workspaceId) ?? readNonEmptyString(record.workspace_id);
  const repoUrl = readNonEmptyString(record.repoUrl) ?? readNonEmptyString(record.repo_url);
  const repoRef = readNonEmptyString(record.repoRef) ?? readNonEmptyString(record.repo_ref);
  const remoteExecution = readRecord(record.remoteExecution);
  const premiumRequestsCumulative = readFiniteNumber(record.premiumRequestsCumulative);
  const usageCumulative = readRecord(record.usageCumulative);
  return {
    sessionId,
    ...(cwd ? { cwd } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(repoUrl ? { repoUrl } : {}),
    ...(repoRef ? { repoRef } : {}),
    ...(remoteExecution ? { remoteExecution } : {}),
    ...(premiumRequestsCumulative !== null ? { premiumRequestsCumulative } : {}),
    ...(usageCumulative ? { usageCumulative } : {}),
  };
}

/**
 * sessionParams shape: { sessionId, cwd, workspaceId, repoUrl, repoRef,
 * remoteExecution, premiumRequestsCumulative, usageCumulative }.
 * `usageCumulative` holds the raw session-cumulative token counters from
 * `--usage-output-file` ({inputTokens, outputTokens, cachedInputTokens,
 * cacheWriteTokens, totalPremiumRequestCost}). `premiumRequestsCumulative`
 * is the session-cumulative premium request counter reported by Copilot at
 * the end of the previous run; the next run subtracts it to get its own delta.
 */
export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown) {
    const record = readRecord(raw);
    return record ? normalize(record) : null;
  },
  serialize(params: Record<string, unknown> | null) {
    return params ? normalize(params) : null;
  },
  getDisplayId(params: Record<string, unknown> | null) {
    if (!params) return null;
    return (
      readNonEmptyString(params.sessionId) ??
      readNonEmptyString(params.session_id) ??
      readNonEmptyString(params.sessionID) ??
      null
    );
  },
};

export { execute } from "./execute.js";
export { listCopilotSkills, syncCopilotSkills } from "./skills.js";
export { testEnvironment } from "./test.js";
export {
  parseCopilotJsonl,
  computePremiumRequestsDelta,
  extractCopilotRuntimeEvents,
  isCopilotSessionUnrecoverableError,
  isCopilotTransientNetworkError,
  describeCopilotFailure,
  detectCopilotAuthRequired,
} from "./parse.js";
export type {
  ParsedCopilotJsonl,
  ParsedCopilotToolCall,
  ParsedCopilotToolResult,
  CopilotCodeChanges,
  CopilotRuntimeEvent,
} from "./parse.js";
