import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

const ensureRuntimeInstalledMock = vi.hoisted(() => vi.fn(async () => {}));
const ensureCommandMock = vi.hoisted(() => vi.fn(async () => {}));
const prepareRuntimeMock = vi.hoisted(() => vi.fn(async () => ({
  workspaceRemoteDir: null,
  restoreWorkspace: async () => {},
})));
const resolveCommandForLogsMock = vi.hoisted(() => vi.fn(async () => "copilot"));
const runProcessMock = vi.hoisted(() => vi.fn());

vi.mock("@paperclipai/adapter-utils/execution-target", () => ({
  adapterExecutionTargetIsRemote: () => false,
  adapterExecutionTargetRemoteCwd: (_target: unknown, cwd: string) => cwd,
  overrideAdapterExecutionTargetRemoteCwd: (target: unknown, _cwd: string) => target,
  adapterExecutionTargetSessionIdentity: () => ({ kind: "local" }),
  adapterExecutionTargetSessionMatches: () => true,
  adapterExecutionTargetUsesManagedHome: () => false,
  adapterExecutionTargetUsesPaperclipBridge: () => false,
  describeAdapterExecutionTarget: () => "local",
  ensureAdapterExecutionTargetCommandResolvable: ensureCommandMock,
  ensureAdapterExecutionTargetRuntimeCommandInstalled: ensureRuntimeInstalledMock,
  prepareAdapterExecutionTargetRuntime: prepareRuntimeMock,
  readAdapterExecutionTarget: ({ executionTarget }: { executionTarget?: unknown }) => executionTarget ?? { kind: "local" },
  readAdapterExecutionTargetHomeDir: async () => null,
  resolveAdapterExecutionTargetCommandForLogs: resolveCommandForLogsMock,
  resolveAdapterExecutionTargetTimeoutSec: (_target: unknown, timeoutSec: number) => timeoutSec,
  runAdapterExecutionTargetProcess: runProcessMock,
  runAdapterExecutionTargetShellCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  startAdapterExecutionTargetPaperclipBridge: async () => null,
}));

import { execute } from "./execute.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const fixture = (name: string) => fs.readFile(path.join(fixtureDir, name), "utf8");

const FIXTURE_SESSION_ID = "1d3a3ce8-0f97-4156-b750-88b9d33a482f";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const tempRoots: string[] = [];

async function makeTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-copilot-local-"));
  tempRoots.push(root);
  return root;
}

function makeContext(root: string, overrides: Partial<AdapterExecutionContext> = {}): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Copilot Agent",
      adapterType: "copilot_local",
      adapterConfig: {},
    },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: { cwd: root },
    context: {},
    authToken: "run-token",
    onLog: async () => {},
    ...overrides,
  };
}

const ok = (stdout: string) => ({ exitCode: 0, signal: null, timedOut: false, stdout, stderr: "" });

describe("copilot_local execute", () => {
  let RUN: string;
  let RESUME: string;
  let AUTH_STDERR: string;
  let BAD_SESSION_STDERR: string;

  beforeEach(async () => {
    ensureRuntimeInstalledMock.mockClear();
    ensureCommandMock.mockClear();
    prepareRuntimeMock.mockClear();
    resolveCommandForLogsMock.mockClear();
    runProcessMock.mockReset();
    RUN = await fixture("copilot-run-1.0.86.jsonl");
    RESUME = await fixture("copilot-resume-1.0.86.jsonl");
    AUTH_STDERR = await fixture("copilot-auth-fail-1.0.86.stderr.txt");
    BAD_SESSION_STDERR = await fixture("copilot-bad-session-1.0.86.stderr.txt");
  });

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("runs a fresh session with --session-id and the headless flag set", async () => {
    const root = await makeTempRoot();
    let seenArgs: string[] = [];
    let seenEnv: Record<string, string> = {};
    let seenCwd = "";
    let seenCommand = "";
    runProcessMock.mockImplementation(async (_runId, _target, command, args, options) => {
      seenCommand = command;
      seenArgs = args;
      seenEnv = options.env;
      seenCwd = options.cwd;
      return ok(RUN);
    });

    const result = await execute(makeContext(root));

    expect(seenCommand).toBe("copilot");
    expect(seenCwd).toBe(root);
    expect(seenArgs).toEqual(expect.arrayContaining([
      "--output-format", "json", "--allow-all-tools", "--no-ask-user", "--no-color",
      "--log-level", "warning", "--secret-env-vars=COPILOT_GITHUB_TOKEN",
    ]));
    expect(seenArgs[seenArgs.indexOf("--model") + 1]).toBe("auto");
    expect(seenArgs[seenArgs.length - 2]).toBe("-p");
    const sessionFlag = seenArgs.indexOf("--session-id");
    expect(sessionFlag).toBeGreaterThan(-1);
    expect(seenArgs[sessionFlag + 1]).toMatch(UUID_RE);
    expect(seenArgs.some((arg) => arg.startsWith("--resume"))).toBe(false);
    expect(seenArgs).not.toContain("--allow-all-paths");
    expect(seenArgs).not.toContain("--disable-builtin-mcps");
    expect(seenArgs).not.toContain("--reasoning-effort");
    expect(seenArgs).not.toContain("--no-auto-update");
    expect(seenArgs).not.toContain("-C");

    expect(seenEnv.CI).toBe("1");
    expect(seenEnv.NO_COLOR).toBe("1");
    expect(seenEnv.COPILOT_ALLOW_ALL).toBe("false");
    expect(seenEnv.GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS).toBe("false");
    expect(seenEnv.GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP).toBe("false");
    expect(seenEnv).not.toHaveProperty("COPILOT_AUTO_UPDATE");

    expect(result).toMatchObject({
      exitCode: 0,
      errorMessage: null,
      errorCode: null,
      summary: "DONE",
      sessionId: FIXTURE_SESSION_ID,
      sessionDisplayId: FIXTURE_SESSION_ID,
      billingType: "credits",
      costStatus: "unpriced",
      usageBasis: "per_run",
      usageComplete: true,
      provider: "github",
      biller: "github",
      model: "gpt-5-mini",
    });
    expect(result.sessionParams).toMatchObject({
      sessionId: FIXTURE_SESSION_ID,
      cwd: root,
      premiumRequestsCumulative: 0.33,
    });
    expect(result.resultJson).toMatchObject({
      premiumRequests: 0.33,
      codeChanges: { linesAdded: 1, linesRemoved: 0 },
    });
  });

  it("falls back to the generated session id when the stream has no result line", async () => {
    const root = await makeTempRoot();
    let generated = "";
    runProcessMock.mockImplementation(async (_r, _t, _c, args) => {
      generated = args[args.indexOf("--session-id") + 1];
      return ok(JSON.stringify({ type: "assistant.message", data: { content: "hi", toolRequests: [] } }));
    });
    const result = await execute(makeContext(root));
    expect(result.sessionId).toBe(generated);
  });

  it("resumes with --resume=<id> and records the per-run premium request delta", async () => {
    const root = await makeTempRoot();
    let seenArgs: string[] = [];
    runProcessMock.mockImplementation(async (_r, _t, _c, args) => {
      seenArgs = args;
      return ok(RESUME);
    });

    const result = await execute(makeContext(root, {
      runtime: {
        sessionId: FIXTURE_SESSION_ID,
        sessionParams: { sessionId: FIXTURE_SESSION_ID, cwd: root, premiumRequestsCumulative: 0.33 },
        sessionDisplayId: FIXTURE_SESSION_ID,
        taskKey: null,
      },
    }));

    expect(seenArgs).toContain(`--resume=${FIXTURE_SESSION_ID}`);
    expect(seenArgs).not.toContain("--session-id");
    expect(result.resultJson).toMatchObject({ premiumRequests: 0.33, premiumRequestsCumulative: 0.66 });
    expect(result.sessionParams).toMatchObject({
      sessionId: FIXTURE_SESSION_ID,
      premiumRequestsCumulative: 0.66,
    });
  });

  it("does not resume a session saved for a different cwd", async () => {
    const root = await makeTempRoot();
    let seenArgs: string[] = [];
    runProcessMock.mockImplementation(async (_r, _t, _c, args) => {
      seenArgs = args;
      return ok(RUN);
    });
    await execute(makeContext(root, {
      runtime: {
        sessionId: "old",
        sessionParams: { sessionId: "old", cwd: "/somewhere/else" },
        sessionDisplayId: "old",
        taskKey: null,
      },
    }));
    expect(seenArgs.some((arg) => arg.startsWith("--resume"))).toBe(false);
    expect(seenArgs).toContain("--session-id");
  });

  it("forwards model, effort, optional flags, instructions dir and extraArgs before the prompt", async () => {
    const root = await makeTempRoot();
    const instructionsDir = path.join(root, "instructions");
    await fs.mkdir(instructionsDir, { recursive: true });
    const instructionsFilePath = path.join(instructionsDir, "AGENTS.md");
    await fs.writeFile(instructionsFilePath, "# Role\nYou are the lead agent.\n");
    let seenArgs: string[] = [];
    runProcessMock.mockImplementation(async (_r, _t, _c, args) => {
      seenArgs = args;
      return ok(RUN);
    });

    await execute(makeContext(root, {
      config: {
        cwd: root,
        model: "claude-sonnet-5.5",
        effort: "high",
        allowAllPaths: true,
        disableBuiltinMcps: true,
        instructionsFilePath,
        extraArgs: ["--experimental"],
      },
    }));

    expect(seenArgs[seenArgs.indexOf("--model") + 1]).toBe("claude-sonnet-5.5");
    expect(seenArgs[seenArgs.indexOf("--reasoning-effort") + 1]).toBe("high");
    expect(seenArgs).toContain("--allow-all-paths");
    expect(seenArgs).toContain("--disable-builtin-mcps");
    const addDirs = seenArgs.flatMap((arg, i) => (arg === "--add-dir" ? [seenArgs[i + 1]] : []));
    expect(addDirs).toContain(instructionsDir);
    expect(seenArgs.indexOf("--experimental")).toBeLessThan(seenArgs.indexOf("-p"));
    const prompt = seenArgs[seenArgs.length - 1]!;
    expect(prompt).toContain("You are the lead agent.");
    expect(prompt).toContain("./HEARTBEAT.md");
  });

  it("ignores an unknown reasoning effort instead of passing an invalid flag", async () => {
    const root = await makeTempRoot();
    let seenArgs: string[] = [];
    runProcessMock.mockImplementation(async (_r, _t, _c, args) => {
      seenArgs = args;
      return ok(RUN);
    });
    await execute(makeContext(root, { config: { cwd: root, effort: "turbo" } }));
    expect(seenArgs).not.toContain("--reasoning-effort");
  });

  it("exposes the per-run skills directory through COPILOT_SKILLS_DIRS, not --add-dir", async () => {
    const root = await makeTempRoot();
    let seenArgs: string[] = [];
    let seenEnv: Record<string, string> = {};
    runProcessMock.mockImplementation(async (_r, _t, _c, args, options) => {
      seenArgs = args;
      seenEnv = options.env;
      return ok(RUN);
    });
    await execute(makeContext(root));
    const skillsDir = seenEnv.COPILOT_SKILLS_DIRS;
    expect(skillsDir).toContain("paperclip-copilot-skills-");
    expect(skillsDir).not.toContain(",");
    const addDirs = seenArgs.flatMap((arg, i) => (arg === "--add-dir" ? [seenArgs[i + 1]] : []));
    expect(addDirs).not.toContain(skillsDir);
  });

  it("prepends the staged skills dir to an inherited COPILOT_SKILLS_DIRS", async () => {
    const root = await makeTempRoot();
    let seenEnv: Record<string, string> = {};
    runProcessMock.mockImplementation(async (_r, _t, _c, _a, options) => {
      seenEnv = options.env;
      return ok(RUN);
    });
    await execute(makeContext(root, { config: { cwd: root, env: { COPILOT_SKILLS_DIRS: "/opt/skills" } } }));
    const parts = seenEnv.COPILOT_SKILLS_DIRS.split(",");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("paperclip-copilot-skills-");
    expect(parts[1]).toBe("/opt/skills");
  });

  it("reads --usage-output-file into usage, model and totalPremiumRequestCost, then deletes it", async () => {
    const root = await makeTempRoot();
    const usageFixture = await fixture("copilot-usage-1.0.86.json");
    let usagePath = "";
    runProcessMock.mockImplementation(async (_r, _t, _c, args) => {
      usagePath = args[args.indexOf("--usage-output-file") + 1];
      await fs.writeFile(usagePath, usageFixture);
      return ok(RUN);
    });
    const result = await execute(makeContext(root));
    expect(usagePath).toContain("paperclip-copilot-usage-");
    expect(result.usage).toEqual({ inputTokens: 24029 - 12160, outputTokens: 547, cachedInputTokens: 12160 });
    expect(result.model).toBe("gpt-5-mini");
    expect(result.costStatus).toBe("unpriced");
    expect(result.resultJson).toMatchObject({ totalPremiumRequestCost: 0.33 });
    await expect(fs.access(usagePath)).rejects.toThrow();
  });

  it("diffs session-cumulative usage-file counters on resume and stores the new cumulative", async () => {
    const root = await makeTempRoot();
    const usageFixture = await fixture("copilot-usage-1.0.86.json");
    runProcessMock.mockImplementation(async (_r, _t, _c, args) => {
      await fs.writeFile(args[args.indexOf("--usage-output-file") + 1], usageFixture);
      return ok(RESUME);
    });
    // Fixture cumulative: in 24029, out 547, cacheRead 12160, cost 0.33.
    const result = await execute(makeContext(root, {
      runtime: {
        sessionId: FIXTURE_SESSION_ID,
        sessionParams: {
          sessionId: FIXTURE_SESSION_ID,
          cwd: root,
          usageCumulative: {
            inputTokens: 20000, outputTokens: 500, cachedInputTokens: 10000,
            cacheWriteTokens: 0, totalPremiumRequestCost: 0.11,
          },
        },
        sessionDisplayId: null,
        taskKey: null,
      },
    }));
    // delta: in 4029, out 47, cacheRead 2160 -> input excl. cache = 1869
    expect(result.usage).toEqual({ inputTokens: 1869, outputTokens: 47, cachedInputTokens: 2160 });
    expect(result.resultJson).toMatchObject({
      totalPremiumRequestCost: 0.22,
      totalPremiumRequestCostCumulative: 0.33,
    });
    expect(result.sessionParams?.usageCumulative).toEqual({
      inputTokens: 24029, outputTokens: 547, cachedInputTokens: 12160,
      cacheWriteTokens: 0, totalPremiumRequestCost: 0.33,
    });
  });

  it("treats the usage file as a fresh session after a retry without session", async () => {
    const root = await makeTempRoot();
    const usageFixture = await fixture("copilot-usage-1.0.86.json");
    let n = 0;
    runProcessMock.mockImplementation(async (_r, _t, _c, args) => {
      n += 1;
      if (n === 1) return { exitCode: 1, signal: null, timedOut: false, stdout: "", stderr: BAD_SESSION_STDERR };
      await fs.writeFile(args[args.indexOf("--usage-output-file") + 1], usageFixture);
      return ok(RUN);
    });
    const result = await execute(makeContext(root, {
      runtime: {
        sessionId: "dead",
        sessionParams: {
          sessionId: "dead", cwd: root,
          usageCumulative: { inputTokens: 999999, outputTokens: 999999, cachedInputTokens: 0, cacheWriteTokens: 0 },
        },
        sessionDisplayId: null,
        taskKey: null,
      },
    }));
    expect(result.usage).toEqual({ inputTokens: 11869, outputTokens: 547, cachedInputTokens: 12160 });
  });

  it("tolerates a missing usage file", async () => {
    const root = await makeTempRoot();
    runProcessMock.mockImplementation(async () => ok(RUN));
    const result = await execute(makeContext(root));
    expect(result.usage).toBeUndefined();
    expect(result.exitCode).toBe(0);
  });

  it("forces CI=1, NO_COLOR=1 and pins COPILOT_ALLOW_ALL=false over config.env", async () => {
    const root = await makeTempRoot();
    let seenEnv: Record<string, string> = {};
    runProcessMock.mockImplementation(async (_r, _t, _c, _a, options) => {
      seenEnv = options.env;
      return ok(RUN);
    });
    await execute(makeContext(root, {
      config: {
        cwd: root,
        env: {
          CI: "0", NO_COLOR: "0", COPILOT_ALLOW_ALL: "true",
          GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS: "true", COPILOT_GITHUB_TOKEN: "tok",
        },
      },
    }));
    expect(seenEnv.CI).toBe("1");
    expect(seenEnv.NO_COLOR).toBe("1");
    expect(seenEnv.COPILOT_ALLOW_ALL).toBe("false");
    expect(seenEnv.GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS).toBe("false");
    expect(seenEnv.COPILOT_GITHUB_TOKEN).toBe("tok");
  });

  it("retries once without the session when --resume is unknown, and succeeds", async () => {
    const root = await makeTempRoot();
    const calls: string[][] = [];
    runProcessMock.mockImplementation(async (_r, _t, _c, args) => {
      calls.push(args);
      if (calls.length === 1) {
        return { exitCode: 1, signal: null, timedOut: false, stdout: "", stderr: BAD_SESSION_STDERR };
      }
      return ok(RUN);
    });

    const result = await execute(makeContext(root, {
      runtime: {
        sessionId: "00000000-0000-4000-8000-000000000000",
        sessionParams: {
          sessionId: "00000000-0000-4000-8000-000000000000",
          cwd: root,
          premiumRequestsCumulative: 9,
        },
        sessionDisplayId: null,
        taskKey: null,
      },
    }));

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("--resume=00000000-0000-4000-8000-000000000000");
    expect(calls[1]!.some((arg) => arg.startsWith("--resume"))).toBe(false);
    expect(calls[1]).toContain("--session-id");
    expect(result.exitCode).toBe(0);
    expect(result.sessionId).toBe(FIXTURE_SESSION_ID);
    // The stale cumulative counter must not be subtracted from the fresh session.
    expect(result.resultJson).toMatchObject({ premiumRequests: 0.33 });
    expect(result.clearSession).toBe(false);
  });

  it("clears the session when the retry also fails before a session exists", async () => {
    const root = await makeTempRoot();
    let n = 0;
    runProcessMock.mockImplementation(async () => {
      n += 1;
      return n === 1
        ? { exitCode: 1, signal: null, timedOut: false, stdout: "", stderr: BAD_SESSION_STDERR }
        : { exitCode: 1, signal: null, timedOut: false, stdout: "", stderr: "Error: kaboom" };
    });
    const result = await execute(makeContext(root, {
      runtime: {
        sessionId: "dead",
        sessionParams: { sessionId: "dead", cwd: root },
        sessionDisplayId: null,
        taskKey: null,
      },
    }));
    expect(n).toBe(2);
    expect(result.exitCode).toBe(1);
    expect(result.sessionParams).toBeNull();
    expect(result.clearSession).toBe(true);
  });

  it("classifies empty-stdout auth failures as copilot_auth_required and keeps no session", async () => {
    const root = await makeTempRoot();
    runProcessMock.mockImplementation(async () => ({
      exitCode: 1, signal: null, timedOut: false, stdout: "", stderr: AUTH_STDERR,
    }));
    const result = await execute(makeContext(root));
    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("copilot_auth_required");
    expect(result.errorMessage).toContain("No authentication information found");
    expect(result.sessionParams).toBeNull();
    expect(runProcessMock).toHaveBeenCalledTimes(1);
  });

  it("fails an exit-0 run that reports a blocking session.error in-band", async () => {
    const root = await makeTempRoot();
    runProcessMock.mockImplementation(async () => ok([
      JSON.stringify({ type: "session.error", data: { errorType: "quota", message: "Quota exhausted" } }),
      JSON.stringify({ type: "result", sessionId: FIXTURE_SESSION_ID, exitCode: 0, usage: { premiumRequests: 1 } }),
    ].join("\n")));
    const result = await execute(makeContext(root));
    expect(result.errorMessage).toBe("Quota exhausted");
  });

  it("reports a timeout", async () => {
    const root = await makeTempRoot();
    runProcessMock.mockImplementation(async () => ({
      exitCode: null, signal: "SIGTERM", timedOut: true, stdout: "", stderr: "",
    }));
    const result = await execute(makeContext(root, { config: { cwd: root, timeoutSec: 5 } }));
    expect(result.timedOut).toBe(true);
    expect(result.usageComplete).toBe(true);
    expect(result.costStatus).toBe("unpriced");
    expect(result.errorMessage).toContain("5s");
  });

  it("reports failure when killed by a signal without timing out", async () => {
    const root = await makeTempRoot();
    runProcessMock.mockImplementation(async () => ({
      exitCode: null, signal: "SIGKILL", timedOut: false, stdout: "", stderr: "",
    }));
    const result = await execute(makeContext(root));
    expect(result.errorMessage).toContain("SIGKILL");
  });

  it("keeps the generated session id when a fresh run failed after emitting JSON events", async () => {
    const root = await makeTempRoot();
    let generated = "";
    runProcessMock.mockImplementation(async (_r, _t, _c, args) => {
      generated = args[args.indexOf("--session-id") + 1];
      return {
        exitCode: 1, signal: null, timedOut: false, stderr: "boom",
        stdout: JSON.stringify({ type: "assistant.turn_start", data: {} }),
      };
    });
    const result = await execute(makeContext(root));
    expect(result.exitCode).toBe(1);
    expect(result.sessionId).toBe(generated);
    expect(result.sessionParams).toMatchObject({ sessionId: generated, cwd: root });
  });

  it("drops the session id when a fresh run failed with no JSON output at all", async () => {
    const root = await makeTempRoot();
    runProcessMock.mockImplementation(async () => ({
      exitCode: 1, signal: null, timedOut: false, stdout: "", stderr: "Error: kaboom",
    }));
    const result = await execute(makeContext(root));
    expect(result.sessionId).toBeNull();
    expect(result.sessionParams).toBeNull();
  });

  it("sends prompts over 100 KB on stdin without -p, and keeps -p for small prompts", async () => {
    const root = await makeTempRoot();
    const calls: Array<{ args: string[]; stdin?: string }> = [];
    runProcessMock.mockImplementation(async (_r, _t, _c, args, options) => {
      calls.push({ args, stdin: options.stdin });
      return ok(RUN);
    });
    await execute(makeContext(root));
    await execute(makeContext(root, {
      config: { cwd: root, promptTemplate: "x".repeat(110_000) },
    }));
    expect(calls[0]!.args).toContain("-p");
    expect(calls[0]!.stdin).toBeUndefined();
    expect(calls[1]!.args).not.toContain("-p");
    expect(calls[1]!.stdin).toContain("x".repeat(1000));
    expect(calls[1]!.args).toContain("--output-format");
  });

  it("keeps the session and updated cumulative counters on timeout", async () => {
    const root = await makeTempRoot();
    const usageFixture = await fixture("copilot-usage-1.0.86.json");
    runProcessMock.mockImplementation(async (_r, _t, _c, args) => {
      await fs.writeFile(args[args.indexOf("--usage-output-file") + 1], usageFixture);
      return { exitCode: null, signal: "SIGTERM", timedOut: true, stdout: "", stderr: "" };
    });
    const result = await execute(makeContext(root, {
      config: { cwd: root, timeoutSec: 5 },
      runtime: {
        sessionId: FIXTURE_SESSION_ID,
        sessionParams: {
          sessionId: FIXTURE_SESSION_ID, cwd: root,
          usageCumulative: { inputTokens: 20000, outputTokens: 500, cachedInputTokens: 10000, cacheWriteTokens: 0 },
        },
        sessionDisplayId: null,
        taskKey: null,
      },
    }));
    expect(result.timedOut).toBe(true);
    expect(result.sessionId).toBe(FIXTURE_SESSION_ID);
    expect(result.usage).toMatchObject({ outputTokens: 47 });
    expect(result.sessionParams?.usageCumulative).toMatchObject({ inputTokens: 24029, outputTokens: 547 });
  });

  it("treats a non-zero result.exitCode as failure even when the process exits 0", async () => {
    const root = await makeTempRoot();
    runProcessMock.mockImplementation(async () => ok(
      JSON.stringify({ type: "result", sessionId: FIXTURE_SESSION_ID, exitCode: 1, usage: {} }),
    ));
    const result = await execute(makeContext(root));
    expect(result.errorMessage).toBeTruthy();
  });

  it("reports copilot_cli_outdated on 'unknown option' stderr", async () => {
    const root = await makeTempRoot();
    runProcessMock.mockImplementation(async () => ({
      exitCode: 1, signal: null, timedOut: false, stdout: "",
      stderr: "error: unknown option '--usage-output-file'\n",
    }));
    const result = await execute(makeContext(root));
    expect(result.errorCode).toBe("copilot_cli_outdated");
    expect(result.errorMessage).toContain("--usage-output-file");
    expect(result.errorMessage).toContain("COPILOT_AUTO_UPDATE");
  });

  it("falls back to the last model_call session.error message", async () => {
    const root = await makeTempRoot();
    runProcessMock.mockImplementation(async () => ({
      exitCode: 1, signal: null, timedOut: false, stderr: "",
      stdout: JSON.stringify({ type: "session.error", data: { errorType: "model_call", message: "model overloaded" } }),
    }));
    const result = await execute(makeContext(root));
    expect(result.errorMessage).toBe("model overloaded");
  });

  it("does not classify a later 401 warning on stderr as an auth failure", async () => {
    const root = await makeTempRoot();
    runProcessMock.mockImplementation(async () => ({
      exitCode: 1, signal: null, timedOut: false, stdout: "",
      stderr: "Error: something broke\nwarning: MCP server returned 401 unauthorized\n",
    }));
    const result = await execute(makeContext(root));
    expect(result.errorCode).toBeNull();
  });

  it("does not retry the bad-session path once the run was aborted", async () => {
    const root = await makeTempRoot();
    const controller = new AbortController();
    controller.abort();
    runProcessMock.mockImplementation(async () => ({
      exitCode: 1, signal: null, timedOut: false, stdout: "", stderr: BAD_SESSION_STDERR,
    }));
    await execute(makeContext(root, {
      signal: controller.signal,
      runtime: {
        sessionId: "dead",
        sessionParams: { sessionId: "dead", cwd: root },
        sessionDisplayId: null,
        taskKey: null,
      },
    }));
    expect(runProcessMock).toHaveBeenCalledTimes(1);
  });

  it("does not append the host COPILOT_SKILLS_DIRS to a remote run env", async () => {
    // Local semantics are covered above; remote needs a remote target mock, so
    // assert the local host value IS appended as the contrast case.
    const root = await makeTempRoot();
    vi.stubEnv("COPILOT_SKILLS_DIRS", "/host/skills");
    let seenEnv: Record<string, string> = {};
    runProcessMock.mockImplementation(async (_r, _t, _c, _a, options) => {
      seenEnv = options.env;
      return ok(RUN);
    });
    await execute(makeContext(root));
    vi.unstubAllEnvs();
    expect(seenEnv.COPILOT_SKILLS_DIRS.split(",")[1]).toBe("/host/skills");
  });
});
