import { describe, expect, it, vi } from "vitest";

vi.mock("@cloudflare/sandbox", () => ({
  getSandbox: vi.fn(),
}));

import { buildLoginShellScript, executeInSandbox } from "./exec.js";

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

/** Minimal sandbox double: readFile serves whatever the test seeds per path. */
function fakeSandbox(options: {
  exec: ReturnType<typeof vi.fn>;
  files?: Record<string, string>;
  onSandbox?: boolean;
}) {
  const files = options.files ?? {};
  const readFile = vi.fn(async (path: string) => {
    if (!(path in files)) throw new Error(`ENOENT: ${path}`);
    return { success: true, path, content: b64(files[path]!), encoding: "base64", timestamp: "" };
  });
  const writeFile = vi.fn().mockResolvedValue(undefined);
  const deleteFile = vi.fn().mockResolvedValue(undefined);
  const sandbox = options.onSandbox
    ? { exec: options.exec, getSession: vi.fn(), readFile, writeFile, deleteFile }
    : { getSession: vi.fn().mockResolvedValue({ exec: options.exec }), readFile, writeFile, deleteFile };
  return { sandbox, readFile, writeFile, deleteFile };
}

function capturePaths(commandArg: string) {
  const out = commandArg.match(/\/tmp\/\.paperclip-bridge-out-[a-zA-Z0-9-]+/)?.[0];
  const err = commandArg.match(/\/tmp\/\.paperclip-bridge-err-[a-zA-Z0-9-]+/)?.[0];
  const rc = commandArg.match(/\/tmp\/\.paperclip-bridge-rc-[a-zA-Z0-9-]+/)?.[0];
  return { out, err, rc };
}

describe("bridge exec", () => {
  it("invokes target.exec with a single shell command string and no args option", async () => {
    const exec = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: "claude 1.0.0\n",
      stderr: "",
    });
    const { sandbox } = fakeSandbox({ exec });

    await executeInSandbox({
      sandbox: sandbox as never,
      command: "claude",
      args: ["--version"],
      cwd: "/workspace/paperclip",
      env: { PAPERCLIP_TEST_FLAG: "1" },
      sessionStrategy: "named",
      sessionId: "paperclip",
      timeoutMs: 12_345,
    });

    expect(exec).toHaveBeenCalledTimes(1);
    const [commandArg, optionsArg] = exec.mock.calls[0] ?? [];
    expect(typeof commandArg).toBe("string");
    expect(commandArg).toMatch(/^sh -lc /);
    expect(optionsArg).toEqual({ cwd: "/", timeout: 12_345 });
    expect(optionsArg).not.toHaveProperty("args");
    expect(optionsArg).not.toHaveProperty("stdin");
    expect(commandArg).toContain('. /etc/profile');
    // The wrapper sources no `nvm.sh`; the sandbox image supplies node on PATH.
    expect(commandArg).not.toContain("nvm.sh");
    expect(commandArg).not.toContain("NVM_DIR");
    expect(commandArg).toContain("cd ");
    expect(commandArg).toContain("/workspace/paperclip");
    expect(commandArg).toContain("PAPERCLIP_TEST_FLAG");
    expect(commandArg).toContain("claude");
    expect(commandArg).toContain("--version");
    // Non-streaming: plain file redirects, no tee pipeline.
    expect(commandArg).toContain("/tmp/.paperclip-bridge-out-");
    expect(commandArg).toContain("/tmp/.paperclip-bridge-err-");
    expect(commandArg).not.toContain("tee ");
  });

  it("returns byte-exact stdout/stderr from the captured files (NUL bytes preserved)", async () => {
    // What Paperclip's Git-context probe emits, and what the exec pipe
    // delivers after bash `read` has stripped every NUL.
    const framed = "\0PAPERCLIP_GIT_CONTEXT_V1\0K\0V\0\0PAPERCLIP_GIT_CONTEXT_END\0";
    const lossy = framed.replaceAll("\0", "");
    const files: Record<string, string> = {};
    const exec = vi.fn().mockImplementation(async (commandArg: string) => {
      const { out, err } = capturePaths(commandArg);
      files[out!] = framed;
      files[err!] = "warn: héllo ✓\n";
      return { exitCode: 7, stdout: lossy, stderr: "" };
    });
    const readFile = vi.fn(async (path: string, options?: { encoding?: string; sessionId?: string }) => {
      expect(options?.encoding).toBe("base64");
      expect(options?.sessionId).toBe("paperclip");
      return { success: true, path, content: b64(files[path] ?? ""), encoding: "base64", timestamp: "" };
    });
    const deleteFile = vi.fn().mockResolvedValue(undefined);
    const sandbox = { getSession: vi.fn().mockResolvedValue({ exec }), readFile, writeFile: vi.fn(), deleteFile };

    const result = await executeInSandbox({
      sandbox: sandbox as never,
      command: "sh",
      args: ["-c", "probe"],
      sessionStrategy: "named",
      sessionId: "paperclip",
      timeoutMs: 5_000,
    });

    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toBe(framed);
    expect(result.stdout.split("\0PAPERCLIP_GIT_CONTEXT_V1\0")[1]?.split("\0PAPERCLIP_GIT_CONTEXT_END\0")[0]).toBe("K\0V\0");
    expect(result.stderr).toBe("warn: héllo ✓\n");
    // Capture files are cleaned up with the session binding. Non-streaming
    // mode has no exit-code file in the command, but cleanup still covers it.
    const { out, err } = capturePaths(exec.mock.calls[0]?.[0] as string);
    expect(out).toBeTruthy();
    expect(err).toBeTruthy();
    for (const file of [out, err]) expect(deleteFile).toHaveBeenCalledWith(file, "paperclip");
    const deleted = deleteFile.mock.calls.map((call) => String(call[0]));
    expect(deleted.some((path) => path.startsWith("/tmp/.paperclip-bridge-rc-"))).toBe(true);
    expect(deleteFile.mock.calls.every((call) => call[1] === "paperclip")).toBe(true);
  });

  it("falls back to the exec pipe output when the capture files are unavailable", async () => {
    const exec = vi.fn().mockResolvedValue({ exitCode: 1, stdout: "sh: cd: no such dir\n", stderr: "boom\n" });
    const { sandbox } = fakeSandbox({ exec, files: {} });

    const result = await executeInSandbox({
      sandbox: sandbox as never,
      command: "pwd",
      cwd: "/missing",
      sessionStrategy: "named",
      sessionId: "paperclip",
      timeoutMs: 5_000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("sh: cd: no such dir\n");
    expect(result.stderr).toBe("boom\n");
  });

  it("requests streaming callbacks when bridge output forwarding is enabled", async () => {
    const files: Record<string, string> = {};
    const exec = vi.fn().mockImplementation(async (commandArg: string, options) => {
      const { out, err } = capturePaths(commandArg);
      files[out!] = "hello\n";
      files[err!] = "";
      await options?.onOutput?.("stdout", "hello\n");
      return { exitCode: 0, stdout: "hello\n", stderr: "" };
    });
    const readFile = vi.fn(async (path: string) => ({ success: true, path, content: b64(files[path] ?? ""), encoding: "base64", timestamp: "" }));
    const sandbox = { getSession: vi.fn().mockResolvedValue({ exec }), readFile, writeFile: vi.fn(), deleteFile: vi.fn() };
    const onOutput = vi.fn();

    const result = await executeInSandbox({
      sandbox: sandbox as never,
      command: "echo",
      args: ["hello"],
      sessionStrategy: "named",
      sessionId: "paperclip",
      timeoutMs: 5_000,
      onOutput,
    });

    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0]?.[1]).toMatchObject({
      cwd: "/",
      timeout: 5_000,
      stream: true,
      onOutput: expect.any(Function),
    });
    expect(onOutput).toHaveBeenCalledWith("stdout", "hello\n");
    // Streaming mode tees stdout live but still returns the captured file.
    const commandArg = exec.mock.calls[0]?.[0] as string;
    expect(commandArg).toContain("| tee ");
    expect(commandArg).toContain("/tmp/.paperclip-bridge-rc-");
    expect(result.stdout).toBe("hello\n");
  });

  it("stages stdin through a sandbox temp file and redirects from it", async () => {
    const exec = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    // sessionStrategy: "default" routes through the sandbox itself (no
    // getSession wrapper), so exec must live directly on the sandbox.
    const { sandbox, writeFile, deleteFile } = fakeSandbox({ exec, onSandbox: true });

    await executeInSandbox({
      sandbox: sandbox as never,
      command: "cat",
      args: [],
      sessionStrategy: "default",
      timeoutMs: 5_000,
      stdin: "payload-bytes",
    });

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [stdinPath, stdinPayload] = writeFile.mock.calls[0] ?? [];
    expect(typeof stdinPath).toBe("string");
    expect(stdinPath).toMatch(/^\/tmp\/\.paperclip-bridge-stdin-/);
    expect(stdinPayload).toBe("payload-bytes");

    const commandArg = exec.mock.calls[0]?.[0];
    expect(commandArg).toContain(stdinPath);
    expect(commandArg).toMatch(/<\s*['"]/);

    // Default strategy: file ops are not pinned to a named session.
    expect(deleteFile).toHaveBeenCalledWith(stdinPath, undefined);
  });

  it("does not write a stdin file or redirect when stdin is empty", async () => {
    const exec = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const { sandbox, writeFile, deleteFile } = fakeSandbox({ exec });

    await executeInSandbox({
      sandbox: sandbox as never,
      command: "pwd",
      sessionStrategy: "named",
      sessionId: "paperclip",
      timeoutMs: 5_000,
      stdin: null,
    });

    expect(writeFile).not.toHaveBeenCalled();
    const stdinDeletes = deleteFile.mock.calls.filter((call) => String(call[0]).includes("bridge-stdin"));
    expect(stdinDeletes).toHaveLength(0);
    const commandArg = exec.mock.calls[0]?.[0] as string;
    expect(commandArg).not.toMatch(/<\s*['"]/);
  });

  it("rejects invalid environment variable keys in the login-shell wrapper", () => {
    expect(() => buildLoginShellScript({
      command: "pwd",
      args: [],
      env: { "bad-key": "1" },
    })).toThrow("Invalid sandbox environment variable key: bad-key");
  });

  it("groups the streaming capture so a failed cd short-circuits it", () => {
    const script = buildLoginShellScript({
      command: "pwd",
      args: [],
      cwd: "/missing",
      capture: { stdoutFile: "/tmp/o", stderrFile: "/tmp/e", exitCodeFile: "/tmp/r", teeStdout: true },
    });
    // `mkdir -p … && cd '/missing' && { ... ; }` — the group is the last `&&` operand.
    expect(script).toContain("mkdir -p '/missing' && cd '/missing' && {");
    expect(script).toMatch(/cd '\/missing' && \{ \( \( exec 'pwd' \) 2>'\/tmp\/e'; echo \$\? >'\/tmp\/r' \) \| tee '\/tmp\/o'; cat '\/tmp\/e' >&2; exit "\$\(cat '\/tmp\/r'\)"; \}$/);
  });

  it("keeps the plain exec line when no capture is requested", () => {
    const script = buildLoginShellScript({ command: "pwd", args: [], cwd: "/w" });
    expect(script.endsWith("exec 'pwd'")).toBe(true);
    expect(script).not.toContain("/tmp/.paperclip-bridge-");
  });
});
