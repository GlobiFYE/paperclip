import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeCopilotUsageDelta,
  computePremiumRequestsDelta,
  detectCopilotOutdatedCli,
  describeCopilotFailure,
  detectCopilotAuthRequired,
  extractCopilotRuntimeEvents,
  isCopilotSessionUnrecoverableError,
  isCopilotTransientNetworkError,
  parseCopilotJsonl,
} from "./parse.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const fixture = (name: string) => fs.readFileSync(path.join(fixtureDir, name), "utf8");

const RUN = fixture("copilot-run-1.0.86.jsonl");
const RESUME = fixture("copilot-resume-1.0.86.jsonl");
const AUTH_STDERR = fixture("copilot-auth-fail-1.0.86.stderr.txt");
const BAD_SESSION_STDERR = fixture("copilot-bad-session-1.0.86.stderr.txt");

describe("parseCopilotJsonl", () => {
  it("extracts summary, tool calls, session id and usage from a real tool-call run", () => {
    const parsed = parseCopilotJsonl(RUN);
    expect(parsed.summary).toBe("DONE");
    expect(parsed.sessionId).toBe("1d3a3ce8-0f97-4156-b750-88b9d33a482f");
    expect(parsed.model).toBe("gpt-5-mini");
    expect(parsed.failed).toBe(false);
    expect(parsed.errorMessage).toBeNull();
    expect(parsed.resultExitCode).toBe(0);
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0]).toMatchObject({
      id: "call_CRD9KQJGmHT9e44u88h9KTKa",
      name: "create",
      arguments: { file_text: "hi" },
    });
    expect(parsed.toolResults).toHaveLength(1);
    expect(parsed.toolResults[0]).toMatchObject({
      toolCallId: "call_CRD9KQJGmHT9e44u88h9KTKa",
      toolName: "create",
      success: true,
    });
    expect(parsed.toolResults[0]!.content).toContain("Created file");
    expect(parsed.premiumRequestsCumulative).toBe(0.33);
    expect(parsed.codeChanges).toMatchObject({ linesAdded: 1, linesRemoved: 0 });
    expect(parsed.codeChanges?.filesModified).toHaveLength(1);
  });

  it("does not use an intermediate tool-requesting message as the summary", () => {
    const parsed = parseCopilotJsonl(RUN);
    expect(parsed.summary).not.toContain("Creating");
  });

  it("reports the cumulative premium counter for a resumed session", () => {
    const parsed = parseCopilotJsonl(RESUME);
    expect(parsed.sessionId).toBe("1d3a3ce8-0f97-4156-b750-88b9d33a482f");
    expect(parsed.premiumRequestsCumulative).toBe(0.66);
    expect(parsed.summary.toLowerCase()).toContain("hello.txt");
    expect(parsed.toolCalls).toHaveLength(0);
    // 0.66 cumulative - 0.33 stored by the previous run = 0.33 for this run.
    expect(computePremiumRequestsDelta(parsed.premiumRequestsCumulative, 0.33)).toBe(0.33);
  });

  it("falls back to the usage checkpoint when the result line is missing", () => {
    const stdout = JSON.stringify({
      type: "session.usage_checkpoint",
      data: { totalPremiumRequests: 1.5 },
    });
    expect(parseCopilotJsonl(stdout).premiumRequestsCumulative).toBe(1.5);
  });

  it("skips non-JSON lines and ephemeral events", () => {
    const stdout = [
      "not json at all",
      JSON.stringify({ type: "assistant.message", ephemeral: true, data: { content: "ghost", toolRequests: [] } }),
      JSON.stringify({ type: "assistant.message", data: { content: "real", toolRequests: [] } }),
    ].join("\n");
    expect(parseCopilotJsonl(stdout).summary).toBe("real");
  });

  it("returns an empty parse for empty stdout (auth / bad-session failures)", () => {
    const parsed = parseCopilotJsonl("");
    expect(parsed).toMatchObject({
      sessionId: null,
      summary: "",
      failed: false,
      errorMessage: null,
      premiumRequestsCumulative: null,
    });
  });

  it("marks session.error with a non-model_call type as failed", () => {
    const stdout = JSON.stringify({
      type: "session.error",
      data: { errorType: "authentication", message: "Boom" },
    });
    const parsed = parseCopilotJsonl(stdout);
    expect(parsed.failed).toBe(true);
    expect(parsed.errorMessage).toBe("Boom");
    expect(parsed.errorType).toBe("authentication");
  });

  it("ignores session.error of type model_call", () => {
    const stdout = JSON.stringify({
      type: "session.error",
      data: { errorType: "model_call", message: "transient" },
    });
    expect(parseCopilotJsonl(stdout).failed).toBe(false);
  });

  it.each(["policy_blocked", "compaction_static_context_blocked"])(
    "marks session.warning %s as failed",
    (warningType) => {
      const stdout = JSON.stringify({
        type: "session.warning",
        data: { warningType, message: "blocked by policy" },
      });
      const parsed = parseCopilotJsonl(stdout);
      expect(parsed.failed).toBe(true);
      expect(parsed.errorType).toBe(warningType);
    },
  );

  it("does not fail on benign warnings", () => {
    const stdout = JSON.stringify({
      type: "session.warning",
      data: { warningType: "something_else", message: "fyi" },
    });
    expect(parseCopilotJsonl(stdout).failed).toBe(false);
  });
});

describe("computeCopilotUsageDelta", () => {
  const cum = (inputTokens: number, outputTokens: number, cachedInputTokens: number) => ({
    inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens: 0, totalPremiumRequestCost: null,
  });
  it("uses the current value when a counter went down (session reset)", () => {
    expect(computeCopilotUsageDelta(cum(100, 10, 40), cum(500, 50, 400)).usage).toEqual({
      inputTokens: 60, outputTokens: 10, cachedInputTokens: 40,
    });
  });
  it("subtracts the previous cumulative otherwise", () => {
    expect(computeCopilotUsageDelta(cum(1000, 30, 400), cum(600, 10, 100)).usage).toEqual({
      inputTokens: 100, outputTokens: 20, cachedInputTokens: 300,
    });
  });
});

describe("computePremiumRequestsDelta", () => {
  it("returns the full value without a previous counter", () => {
    expect(computePremiumRequestsDelta(0.33, null)).toBe(0.33);
  });
  it("subtracts the previous cumulative value", () => {
    expect(computePremiumRequestsDelta(0.66, 0.33)).toBe(0.33);
  });
  it("treats a decreased counter as a new session", () => {
    expect(computePremiumRequestsDelta(0.1, 5)).toBe(0.1);
  });
  it("is null when the CLI reported nothing", () => {
    expect(computePremiumRequestsDelta(null, 1)).toBeNull();
  });
});

describe("stderr classification", () => {
  it("detects auth failure from stderr with empty stdout", () => {
    expect(detectCopilotAuthRequired({ stdout: "", stderr: AUTH_STDERR }).requiresAuth).toBe(true);
  });

  it("detects auth failure from session.error remediation", () => {
    const stdout = JSON.stringify({
      type: "session.error",
      data: { errorType: "authentication", message: "x", remediation: "sign_in" },
    });
    expect(detectCopilotAuthRequired({ stdout, stderr: "" }).requiresAuth).toBe(true);
  });

  it("does not treat assistant output as an auth failure", () => {
    const stdout = JSON.stringify({
      type: "assistant.message",
      data: { content: "The endpoint returns unauthorized when the token is invalid token", toolRequests: [] },
    });
    expect(detectCopilotAuthRequired({ stdout, stderr: "" }).requiresAuth).toBe(false);
  });

  it("detects an unrecoverable --resume session from stderr", () => {
    expect(isCopilotSessionUnrecoverableError("", BAD_SESSION_STDERR)).toBe(true);
    expect(isCopilotSessionUnrecoverableError("", AUTH_STDERR)).toBe(false);
  });

  it("ignores 401 mentions on non-first, non-Error stderr lines", () => {
    expect(detectCopilotAuthRequired({
      stdout: "", stderr: "Error: broke\nmcp: 401 unauthorized from server",
    }).requiresAuth).toBe(false);
    expect(detectCopilotAuthRequired({
      stdout: "", stderr: "starting\nError: 401 Unauthorized",
    }).requiresAuth).toBe(true);
  });

  it("detects an outdated CLI", () => {
    expect(detectCopilotOutdatedCli("error: unknown option '--usage-output-file'")).toEqual({ flag: "--usage-output-file" });
    expect(detectCopilotOutdatedCli("all good")).toBeNull();
  });

  it("detects transient network errors", () => {
    expect(isCopilotTransientNetworkError("", "Error: getaddrinfo ENOTFOUND api.github.com")).toBe(true);
    expect(isCopilotTransientNetworkError("", BAD_SESSION_STDERR)).toBe(false);
  });

  it("describes failures using the first stderr line", () => {
    expect(describeCopilotFailure({ stderr: AUTH_STDERR })).toBe(
      "Copilot run failed: Error: No authentication information found.",
    );
    expect(describeCopilotFailure({})).toBeNull();
  });
});

describe("extractCopilotRuntimeEvents", () => {
  it("forwards assistant messages and tool starts", () => {
    const message = JSON.stringify({ type: "assistant.message", data: { content: "hello", toolRequests: [] } });
    const tool = JSON.stringify({ type: "tool.execution_start", data: { toolName: "bash" } });
    expect(extractCopilotRuntimeEvents(message)).toEqual([
      { eventType: "assistant", message: "hello", payload: { content: "hello" } },
    ]);
    expect(extractCopilotRuntimeEvents(tool)).toEqual([
      { eventType: "tool_call", payload: { toolName: "bash" } },
    ]);
  });

  it("ignores ephemeral deltas and garbage", () => {
    const delta = JSON.stringify({ type: "assistant.message_delta", ephemeral: true, data: { deltaContent: "h" } });
    expect(extractCopilotRuntimeEvents(delta)).toEqual([]);
    expect(extractCopilotRuntimeEvents("nope")).toEqual([]);
  });
});
