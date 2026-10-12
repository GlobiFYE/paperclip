import pc from "picocolors";
import { summarizeCopilotResult } from "../ui/parse-stdout.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
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

export function printCopilotStreamEvent(raw: string, _debug: boolean): void {
  const line = raw.trim();
  if (!line) return;

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = asRecord(JSON.parse(line));
  } catch {
    parsed = null;
  }
  if (!parsed) {
    console.log(line);
    return;
  }

  const type = asString(parsed.type).trim();

  if (type === "result") {
    const exitCode = typeof parsed.exitCode === "number" ? parsed.exitCode : 0;
    const summary = summarizeCopilotResult(parsed);
    const sessionId = asString(parsed.sessionId).trim();
    const text = `result: ${summary}${sessionId ? ` (session ${sessionId})` : ""}`;
    console.log(exitCode === 0 ? pc.blue(text) : pc.red(`${text} [exit ${exitCode}]`));
    return;
  }

  // Token deltas, MCP status, model-call markers, ... are noise on a terminal.
  if (parsed.ephemeral === true && !_debug) return;
  if (parsed.ephemeral === true) {
    console.log(pc.gray(line));
    return;
  }

  const data = asRecord(parsed.data) ?? {};

  switch (type) {
    case "user.message": {
      const text = asString(data.content).trim();
      if (text) console.log(pc.cyan(`user: ${text}`));
      return;
    }
    case "assistant.message": {
      const reasoning = asString(data.reasoningText).trim();
      if (reasoning) console.log(pc.gray(`thinking: ${reasoning}`));
      const text = asString(data.content).trim();
      if (text) console.log(pc.green(`assistant: ${text}`));
      return;
    }
    case "tool.execution_start": {
      const name = asString(data.toolName, "tool").trim() || "tool";
      console.log(pc.yellow(`tool_call: ${name}`));
      if (data.arguments !== undefined) console.log(pc.gray(stringifyUnknown(data.arguments)));
      return;
    }
    case "tool.execution_complete": {
      const failed = data.success === false;
      console.log((failed ? pc.red : pc.cyan)(failed ? "tool_result (failed)" : "tool_result"));
      const result = asRecord(data.result);
      const error = asRecord(data.error);
      const content = stringifyUnknown(result?.content) || asString(error?.message);
      if (content) console.log((failed ? pc.red : pc.gray)(content));
      return;
    }
    case "session.error": {
      const text = asString(data.message).trim() || asString(data.errorType).trim() || "Copilot error";
      console.log(pc.red(`error: ${text}`));
      return;
    }
    case "session.warning": {
      const text = asString(data.message).trim();
      if (text) console.log(pc.yellow(`warning: ${text}`));
      return;
    }
    default:
      if (_debug) console.log(pc.gray(line));
  }
}
