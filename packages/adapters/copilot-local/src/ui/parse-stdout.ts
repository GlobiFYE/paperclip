import type { TranscriptEntry } from "@paperclipai/adapter-utils";

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatPremiumRequests(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Compact one-line description of the trailing `result` line. */
export function summarizeCopilotResult(parsed: Record<string, unknown>): string {
  const usage = asRecord(parsed.usage) ?? {};
  const parts: string[] = [];
  const premium = asNumber(usage.premiumRequests);
  if (premium !== null) parts.push(`${formatPremiumRequests(premium)} premium requests (session total)`);
  const changes = asRecord(usage.codeChanges);
  if (changes) {
    const added = asNumber(changes.linesAdded) ?? 0;
    const removed = asNumber(changes.linesRemoved) ?? 0;
    const files = Array.isArray(changes.filesModified) ? changes.filesModified.length : 0;
    parts.push(`+${added}/-${removed} lines in ${files} file${files === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(", ") : "Copilot run finished";
}

/**
 * Map one `copilot -p ... --output-format json` stdout line to transcript
 * entries. Ephemeral events (token deltas, MCP status, model call markers)
 * are dropped; the complete `assistant.message` carries the final text. Tool
 * requests inside assistant.message are not rendered because the matching
 * tool.execution_start event produces the tool_call entry. user.message is
 * dropped because it echoes the (very large) prompt.
 */
export function parseCopilotStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const parsed = asRecord(safeJsonParse(line));
  if (!parsed) {
    return [{ kind: "stdout", ts, text: line }];
  }

  const type = asString(parsed.type).trim();

  if (type === "result") {
    // A `result` TranscriptEntry would render zero tokens/cost, which Copilot
    // does not report in-stream, so show the compact summary as a system line.
    const exitCode = asNumber(parsed.exitCode) ?? 0;
    const text = `result: ${summarizeCopilotResult(parsed)}`;
    return exitCode === 0
      ? [{ kind: "system", ts, text }]
      : [{ kind: "stderr", ts, text: `${text} (exit code ${exitCode})` }];
  }

  if (parsed.ephemeral === true) return [];
  const data = asRecord(parsed.data) ?? {};

  switch (type) {
    case "assistant.message": {
      const text = asString(data.content).trim();
      return text ? [{ kind: "assistant", ts, text }] : [];
    }
    case "assistant.reasoning": {
      const text = asString(data.content).trim();
      return text ? [{ kind: "thinking", ts, text }] : [];
    }
    case "tool.execution_start": {
      const name = asString(data.toolName, "tool").trim() || "tool";
      return [{
        kind: "tool_call",
        ts,
        name,
        input: data.arguments ?? {},
        toolUseId: asString(data.toolCallId).trim() || undefined,
      }];
    }
    case "tool.execution_complete": {
      const result = asRecord(data.result);
      const error = asRecord(data.error);
      const content =
        stringifyUnknown(result?.content) ||
        asString(error?.message) ||
        "";
      return [{
        kind: "tool_result",
        ts,
        toolUseId: asString(data.toolCallId).trim() || "tool_result",
        content,
        isError: data.success === false,
      }];
    }
    case "session.error": {
      const text = asString(data.message).trim() || asString(data.errorType).trim() || "Copilot error";
      return [{ kind: "stderr", ts, text }];
    }
    case "session.warning": {
      const text = asString(data.message).trim();
      return text ? [{ kind: "system", ts, text: `warning: ${text}` }] : [];
    }
    default:
      return [];
  }
}
