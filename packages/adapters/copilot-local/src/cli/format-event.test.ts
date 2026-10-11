import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printCopilotStreamEvent } from "./format-event.js";

describe("printCopilotStreamEvent", () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const strip = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");
  const out = () => logs.map(strip);

  it("prints assistant text", () => {
    printCopilotStreamEvent(JSON.stringify({ type: "assistant.message", data: { content: "DONE" } }), false);
    expect(out()).toEqual(["assistant: DONE"]);
  });

  it("prints tool starts with arguments and completions with content", () => {
    printCopilotStreamEvent(JSON.stringify({
      type: "tool.execution_start", data: { toolName: "bash", arguments: { command: "ls" } },
    }), false);
    printCopilotStreamEvent(JSON.stringify({
      type: "tool.execution_complete", data: { success: true, result: { content: "a.txt" } },
    }), false);
    expect(out()).toEqual(["tool_call: bash", JSON.stringify({ command: "ls" }, null, 2), "tool_result", "a.txt"]);
  });

  it("prints errors and failed tool results", () => {
    printCopilotStreamEvent(JSON.stringify({ type: "session.error", data: { message: "bad" } }), false);
    printCopilotStreamEvent(JSON.stringify({
      type: "tool.execution_complete", data: { success: false, error: { message: "denied" } },
    }), false);
    expect(out()).toEqual(["error: bad", "tool_result (failed)", "denied"]);
  });

  it("prints the result line with usage and session", () => {
    printCopilotStreamEvent(JSON.stringify({
      type: "result", sessionId: "abc", exitCode: 0,
      usage: { premiumRequests: 0.33, codeChanges: { linesAdded: 2, linesRemoved: 1, filesModified: ["a", "b"] } },
    }), false);
    expect(out()[0]).toBe("result: 0.33 premium requests (session total), +2/-1 lines in 2 files (session abc)");
  });

  it("hides ephemeral events unless debugging", () => {
    const line = JSON.stringify({ type: "assistant.message_delta", ephemeral: true, data: { deltaContent: "x" } });
    printCopilotStreamEvent(line, false);
    expect(logs).toEqual([]);
    printCopilotStreamEvent(line, true);
    expect(logs).toHaveLength(1);
  });

  it("passes through non-JSON lines", () => {
    printCopilotStreamEvent("raw text", false);
    expect(out()).toEqual(["raw text"]);
  });
});
