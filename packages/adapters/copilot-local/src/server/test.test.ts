import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ensureDirectoryMock = vi.hoisted(() => vi.fn(async () => {}));
const ensureCommandMock = vi.hoisted(() => vi.fn(async () => {}));
const maybeInstallMock = vi.hoisted(() => vi.fn(async () => null));
const runProcessMock = vi.hoisted(() => vi.fn());

vi.mock("@paperclipai/adapter-utils/execution-target", () => ({
  describeAdapterExecutionTarget: () => "local",
  ensureAdapterExecutionTargetCommandResolvable: ensureCommandMock,
  ensureAdapterExecutionTargetDirectory: ensureDirectoryMock,
  maybeRunSandboxInstallCommand: maybeInstallMock,
  resolveAdapterExecutionTargetCwd: (_target: unknown, configuredCwd: string, fallbackCwd: string) =>
    configuredCwd || fallbackCwd,
  runAdapterExecutionTargetProcess: runProcessMock,
}));

import { copilotConfigHasLoggedInUser, stripJsonComments, testEnvironment } from "./test.js";

const OK_STDOUT = [
  JSON.stringify({ type: "assistant.message", data: { content: "OK", toolRequests: [] } }),
  JSON.stringify({ type: "result", sessionId: "s1", exitCode: 0, usage: { premiumRequests: 0.33 } }),
].join("\n");

const versionResult = { exitCode: 0, signal: null, timedOut: false, stdout: "GitHub Copilot CLI 1.0.86.\n", stderr: "" };

function codes(result: { checks: Array<{ code: string }> }) {
  return result.checks.map((check) => check.code);
}

describe("JSONC helpers", () => {
  it("strips line and block comments but keeps string contents", () => {
    const text = '// User settings\n{\n  "url": "https://x.test/a//b", /* c */\n  "lastLoggedInUser": {"login": "octo"} // trailing\n}';
    expect(JSON.parse(stripJsonComments(text))).toEqual({
      url: "https://x.test/a//b",
      lastLoggedInUser: { login: "octo" },
    });
  });

  it("detects lastLoggedInUser in a commented config", () => {
    expect(copilotConfigHasLoggedInUser('// comment\n{"lastLoggedInUser":{"host":"https://github.com","login":"octo"}}')).toBe(true);
    expect(copilotConfigHasLoggedInUser('{"lastLoggedInUser":"octo"}')).toBe(true);
    expect(copilotConfigHasLoggedInUser('{"other":1}')).toBe(false);
    expect(copilotConfigHasLoggedInUser("not json")).toBe(false);
  });
});

describe("copilot_local testEnvironment", () => {
  let tmpHome: string;

  beforeEach(async () => {
    ensureDirectoryMock.mockClear();
    ensureCommandMock.mockClear();
    maybeInstallMock.mockClear();
    runProcessMock.mockReset();
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-env-test-"));
    // Deterministic auth detection regardless of the host's real login.
    vi.stubEnv("COPILOT_GITHUB_TOKEN", "");
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("COPILOT_HOME", tmpHome);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it("reports a healthy host: version, env-var auth, hello probe", async () => {
    runProcessMock
      .mockResolvedValueOnce(versionResult)
      .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: OK_STDOUT, stderr: "" });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "copilot_local",
      config: { command: "copilot", cwd: "/tmp/project", env: { COPILOT_GITHUB_TOKEN: "tok" } },
    });

    expect(result.status).toBe("pass");
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "copilot_cwd_valid",
        "copilot_command_resolvable",
        "copilot_version_detected",
        "copilot_auth_detected",
        "copilot_hello_probe_passed",
      ]),
    );
    const version = result.checks.find((c) => c.code === "copilot_version_detected");
    expect(version?.message).toContain("1.0.86");

    expect(runProcessMock).toHaveBeenNthCalledWith(
      1, expect.any(String), null, "copilot", ["--version"],
      expect.objectContaining({ env: expect.objectContaining({ CI: "1" }) }),
    );
    const probeArgs = runProcessMock.mock.calls[1]![3] as string[];
    expect(probeArgs.slice(0, 2)).toEqual(["-p", "Reply with OK"]);
    expect(probeArgs).toEqual(expect.arrayContaining([
      "--output-format", "json", "--allow-all-tools", "--no-ask-user", "--no-color", "--log-level", "warning",
    ]));
    expect(probeArgs[probeArgs.indexOf("--model") + 1]).toBe("auto");
    const probeEnv = (runProcessMock.mock.calls[1]![4] as { env: Record<string, string> }).env;
    expect(probeEnv.CI).toBe("1");
    expect(probeEnv.NO_COLOR).toBe("1");
    expect(probeEnv.COPILOT_ALLOW_ALL).toBe("false");
    expect(probeEnv.GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS).toBe("false");
    expect(probeArgs).toContain("--secret-env-vars=COPILOT_GITHUB_TOKEN");
  });

  it("applies effort, allowAllPaths and disableBuiltinMcps to the hello probe", async () => {
    runProcessMock
      .mockResolvedValueOnce(versionResult)
      .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: OK_STDOUT, stderr: "" });
    await testEnvironment({
      companyId: "company-1",
      adapterType: "copilot_local",
      config: { cwd: "/tmp/project", effort: "high", allowAllPaths: true, disableBuiltinMcps: true, env: { GH_TOKEN: "t" } },
    });
    const probeArgs = runProcessMock.mock.calls[1]![3] as string[];
    expect(probeArgs[probeArgs.indexOf("--reasoning-effort") + 1]).toBe("high");
    expect(probeArgs).toContain("--allow-all-paths");
    expect(probeArgs).toContain("--disable-builtin-mcps");
  });

  it("passes the configured model to the hello probe", async () => {
    runProcessMock
      .mockResolvedValueOnce(versionResult)
      .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: OK_STDOUT, stderr: "" });
    await testEnvironment({
      companyId: "company-1",
      adapterType: "copilot_local",
      config: { cwd: "/tmp/project", model: "gpt-5.4", env: { GH_TOKEN: "tok" } },
    });
    const probeArgs = runProcessMock.mock.calls[1]![3] as string[];
    expect(probeArgs[probeArgs.indexOf("--model") + 1]).toBe("gpt-5.4");
  });

  it.each(["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"])("detects %s in the server env", async (key) => {
    vi.stubEnv(key, "tok");
    runProcessMock
      .mockResolvedValueOnce(versionResult)
      .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: OK_STDOUT, stderr: "" });
    const result = await testEnvironment({
      companyId: "company-1", adapterType: "copilot_local", config: { cwd: "/tmp/project" },
    });
    const auth = result.checks.find((c) => c.code === "copilot_auth_detected");
    expect(auth?.detail).toContain(key);
  });

  it("detects a stored login from a JSONC config.json under COPILOT_HOME", async () => {
    await fs.writeFile(
      path.join(tmpHome, "config.json"),
      '// User settings belong in settings.json.\n{\n  "lastLoggedInUser": { "host": "https://github.com", "login": "octo" }\n}\n',
    );
    runProcessMock
      .mockResolvedValueOnce(versionResult)
      .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: OK_STDOUT, stderr: "" });
    const result = await testEnvironment({
      companyId: "company-1", adapterType: "copilot_local", config: { cwd: "/tmp/project" },
    });
    expect(codes(result)).toContain("copilot_auth_detected");
    expect(codes(result)).not.toContain("copilot_auth_missing");
  });

  it("warns when no auth material exists and maps a stderr auth failure to hello_probe_auth_required", async () => {
    runProcessMock
      .mockResolvedValueOnce(versionResult)
      .mockResolvedValueOnce({
        exitCode: 1, signal: null, timedOut: false, stdout: "",
        stderr: "Error: No authentication information found.\n\nCopilot can be authenticated...",
      });
    const result = await testEnvironment({
      companyId: "company-1", adapterType: "copilot_local", config: { cwd: "/tmp/project" },
    });
    expect(result.status).toBe("warn");
    expect(codes(result)).toEqual(expect.arrayContaining(["copilot_auth_missing", "copilot_hello_probe_auth_required"]));
    expect(codes(result).some((code) => code.endsWith("_hello_probe_auth_required"))).toBe(true);
  });

  it("fails the probe with copilot_hello_probe_failed on an unrelated error", async () => {
    runProcessMock
      .mockResolvedValueOnce(versionResult)
      .mockResolvedValueOnce({ exitCode: 1, signal: null, timedOut: false, stdout: "", stderr: "Error: kaboom" });
    const result = await testEnvironment({
      companyId: "company-1", adapterType: "copilot_local",
      config: { cwd: "/tmp/project", env: { COPILOT_GITHUB_TOKEN: "tok" } },
    });
    expect(result.status).toBe("fail");
    expect(codes(result)).toContain("copilot_hello_probe_failed");
  });

  it("warns when the probe exits 0 without an assistant message", async () => {
    runProcessMock
      .mockResolvedValueOnce(versionResult)
      .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: "", stderr: "" });
    const result = await testEnvironment({
      companyId: "company-1", adapterType: "copilot_local",
      config: { cwd: "/tmp/project", env: { COPILOT_GITHUB_TOKEN: "tok" } },
    });
    expect(codes(result)).toContain("copilot_hello_probe_unexpected_output");
  });

  it("skips probes and errors when the command cannot be resolved", async () => {
    ensureCommandMock.mockRejectedValueOnce(new Error("copilot: not found"));
    const result = await testEnvironment({
      companyId: "company-1", adapterType: "copilot_local", config: { cwd: "/tmp/project" },
    });
    expect(result.status).toBe("fail");
    expect(codes(result)).toContain("copilot_command_unresolvable");
    expect(runProcessMock).not.toHaveBeenCalled();
  });
});
