import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCopilotStdoutLine } from "./parse-stdout.js";

const ts = "2026-10-11T00:00:00.000Z";
const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "__fixtures__");

describe("parseCopilotStdoutLine", () => {
  it("renders assistant.message content", () => {
    const line = JSON.stringify({ type: "assistant.message", data: { content: "DONE", toolRequests: [] } });
    expect(parseCopilotStdoutLine(line, ts)).toEqual([{ kind: "assistant", ts, text: "DONE" }]);
  });

  it("drops user.message (it echoes the large prompt)", () => {
    const line = JSON.stringify({ type: "user.message", data: { content: "hi there" } });
    expect(parseCopilotStdoutLine(line, ts)).toEqual([]);
  });

  it("renders tool start and complete", () => {
    const start = JSON.stringify({
      type: "tool.execution_start",
      data: { toolCallId: "c1", toolName: "create", arguments: { path: "/a" } },
    });
    const done = JSON.stringify({
      type: "tool.execution_complete",
      data: { toolCallId: "c1", success: true, result: { content: "Created" } },
    });
    expect(parseCopilotStdoutLine(start, ts)).toEqual([
      { kind: "tool_call", ts, name: "create", input: { path: "/a" }, toolUseId: "c1" },
    ]);
    expect(parseCopilotStdoutLine(done, ts)).toEqual([
      { kind: "tool_result", ts, toolUseId: "c1", content: "Created", isError: false },
    ]);
  });

  it("flags failed tool results", () => {
    const done = JSON.stringify({
      type: "tool.execution_complete",
      data: { toolCallId: "c2", success: false, error: { message: "denied" } },
    });
    expect(parseCopilotStdoutLine(done, ts)).toEqual([
      { kind: "tool_result", ts, toolUseId: "c2", content: "denied", isError: true },
    ]);
  });

  it("renders session.error and session.warning", () => {
    expect(parseCopilotStdoutLine(
      JSON.stringify({ type: "session.error", data: { errorType: "x", message: "bad" } }), ts,
    )).toEqual([{ kind: "stderr", ts, text: "bad" }]);
    expect(parseCopilotStdoutLine(
      JSON.stringify({ type: "session.warning", data: { warningType: "policy_blocked", message: "nope" } }), ts,
    )).toEqual([{ kind: "system", ts, text: "warning: nope" }]);
  });

  it("renders the result line as a compact summary", () => {
    const line = JSON.stringify({
      type: "result", sessionId: "s", exitCode: 0,
      usage: { premiumRequests: 0.33, codeChanges: { linesAdded: 1, linesRemoved: 0, filesModified: ["a"] } },
    });
    const [entry] = parseCopilotStdoutLine(line, ts);
    expect(entry).toMatchObject({ kind: "system" });
    expect((entry as { text: string }).text).toContain("0.33 premium requests");
    expect((entry as { text: string }).text).toContain("+1/-0 lines in 1 file");
  });

  it("marks a non-zero result as an error", () => {
    const [entry] = parseCopilotStdoutLine(JSON.stringify({ type: "result", exitCode: 1, usage: {} }), ts);
    expect(entry).toMatchObject({ kind: "stderr" });
    expect((entry as { text: string }).text).toContain("exit code 1");
  });

  it("emits thinking from reasoningText before the assistant text (real fixture line)", () => {
    const lines = fs
      .readFileSync(path.join(fixtureDir, "copilot-run-1.0.86.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.includes('"reasoningText":"'));
    expect(lines.length).toBeGreaterThan(0);
    const entries = parseCopilotStdoutLine(lines[0], ts);
    expect(entries.map((e) => e.kind)).toEqual(["thinking", "assistant"]);
    expect((entries[0] as { text: string }).text).toContain("Creating the hello.txt file");
  });

  it("emits no thinking entry for empty reasoningText, and ignores reasoning events", () => {
    expect(parseCopilotStdoutLine(
      JSON.stringify({ type: "assistant.message", data: { content: "x", reasoningText: "  " } }), ts,
    )).toEqual([{ kind: "assistant", ts, text: "x" }]);
    expect(parseCopilotStdoutLine(
      JSON.stringify({ type: "assistant.reasoning", data: { content: "thinking" } }), ts,
    )).toEqual([]);
    expect(parseCopilotStdoutLine(
      JSON.stringify({ type: "assistant.reasoning_delta", ephemeral: true, data: { deltaContent: "t" } }), ts,
    )).toEqual([]);
  });

  it("drops ephemeral events and unrelated bookkeeping", () => {
    for (const event of [
      { type: "assistant.message_delta", ephemeral: true, data: { deltaContent: "x" } },
      { type: "session.mcp_server_status_changed", ephemeral: true, data: {} },
      { type: "session.usage_checkpoint", data: { totalPremiumRequests: 1 } },
      { type: "assistant.turn_start", data: {} },
    ]) {
      expect(parseCopilotStdoutLine(JSON.stringify(event), ts)).toEqual([]);
    }
  });

  it("passes non-JSON lines through as stdout", () => {
    expect(parseCopilotStdoutLine("plain output", ts)).toEqual([{ kind: "stdout", ts, text: "plain output" }]);
  });

  it("turns the real run fixture into a sane transcript", () => {
    const lines = fs.readFileSync(path.join(fixtureDir, "copilot-run-1.0.86.jsonl"), "utf8").split("\n").filter(Boolean);
    const kinds = lines.flatMap((line) => parseCopilotStdoutLine(line, ts)).map((entry) => entry.kind);
    expect(kinds).not.toContain("user");
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("tool_result");
    expect(kinds).toContain("assistant");
    expect(kinds[kinds.length - 1]).toBe("system");
    expect(kinds).not.toContain("stdout");
  });
});
