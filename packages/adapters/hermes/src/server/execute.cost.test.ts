import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@paperclipai/adapter-utils/server-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@paperclipai/adapter-utils/server-utils")>();
  return {
    ...actual,
    runChildProcess: vi.fn(),
  };
});

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => ""),
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  access: vi.fn(async () => undefined),
  readdir: vi.fn(async () => []),
  stat: vi.fn(async () => ({ isFile: () => true, isDirectory: () => false })),
}));

import { execute } from "./execute.js";
import * as serverUtils from "@paperclipai/adapter-utils/server-utils";

const SESSION_ID = "20261016_101500_a1b2c3";

const EXIT_SUMMARY_EN = [
  "",
  "Resume this session with:",
  `  hermes --resume ${SESSION_ID} -p worker`,
  "",
  `Session:        ${SESSION_ID}`,
  "Duration:       2m 5s",
  "Messages:       12 (1 user, 9 tool calls)",
  "",
].join("\n");

const EXIT_SUMMARY_DE = [
  "",
  "Diese Sitzung fortsetzen mit:",
  `  hermes --resume ${SESSION_ID} -p worker`,
  "",
  `Sitzung:        ${SESSION_ID}`,
  "Dauer:          2m 5s",
  "Nachrichten:    12 (1 Benutzer, 9 Tool-Aufrufe)",
  "",
].join("\n");

const AGENT_PROSE = [
  "Query: Budget note: the planner spent 24000c of 1500c this month.",
  "",
  "Verification finished.",
  "Cost: 240 emit+overlay runs, all green.",
  "Total cost: $29",
  "tokens: 500 in, 200 out per frame",
  "",
].join("\n");

async function runWithOutput(stdout: string, stderr = "") {
  vi.mocked(serverUtils.runChildProcess).mockResolvedValueOnce({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout,
    stderr,
    pid: null,
    startedAt: null,
  });
  return execute({
    runId: "test-run-cost",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Hermes",
      adapterType: "hermes_local",
      adapterConfig: {},
    },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: { command: "/usr/bin/hermes", timeoutSec: 60, graceSec: 5 },
    context: { issueId: "issue-1", wakeReason: "manual", paperclipWake: null },
    onLog: vi.fn(async () => undefined),
    onMeta: vi.fn(async () => undefined),
  } as any);
}

describe("hermes-local adapter cost and usage parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not book cost or usage from the prompt echo or the agent answer", async () => {
    const result = await runWithOutput(AGENT_PROSE + EXIT_SUMMARY_EN);

    expect(result.costUsd).toBeUndefined();
    expect(result.usage).toBeUndefined();
    expect(result.resultJson).toMatchObject({ cost_usd: null, usage: null });
  });

  it("does not book cost from a session title in the exit summary", async () => {
    const summaryWithTitle = [
      "",
      "Resume this session with:",
      `  hermes --resume ${SESSION_ID}`,
      '  hermes -c "Q3 cost 2026 review"',
      "",
      `Session:        ${SESSION_ID}`,
      "Title:          Q3 cost 2026 review",
      "Duration:       41s",
      "Messages:       3 (1 user, 1 tool calls)",
      "",
    ].join("\n");

    const result = await runWithOutput("Done.\n" + summaryWithTitle);

    expect(result.costUsd).toBeUndefined();
  });

  it("does not book cost from a quiet run that prints the session id on stderr", async () => {
    const result = await runWithOutput(AGENT_PROSE, `\nsession_id: ${SESSION_ID}\n`);

    expect(result.costUsd).toBeUndefined();
    expect(result.usage).toBeUndefined();
  });

  it("ignores a resume command that the agent quotes before the real exit summary", async () => {
    const quoted = "To continue, run:\n  hermes --resume 20250101_000000_ffffff\nCost: 99\n";

    const result = await runWithOutput(quoted + EXIT_SUMMARY_EN);

    expect(result.costUsd).toBeUndefined();
  });

  it.each([
    ["English", EXIT_SUMMARY_EN],
    ["German", EXIT_SUMMARY_DE],
  ])("reads cost and usage lines that follow the %s exit summary", async (_locale, summary) => {
    const trailerLines = "Tokens: 1200 input, 340 output\nCost: $0.42\n";

    const result = await runWithOutput(AGENT_PROSE + summary + trailerLines);

    expect(result.costUsd).toBe(0.42);
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 340 });
  });
});
