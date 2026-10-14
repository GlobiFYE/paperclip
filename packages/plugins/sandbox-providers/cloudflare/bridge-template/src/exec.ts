import type { Sandbox as CloudflareSandbox } from "@cloudflare/sandbox";
import { shellQuote } from "./helpers.js";
import { isTimeoutError } from "./sandboxes.js";
import { cleanupTimedOutExecution, resolveExecutionTarget, type SessionStrategy } from "./sessions.js";

export interface BridgeExecuteParams {
  sandbox: CloudflareSandbox;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string | null;
  timeoutMs?: number;
  sessionStrategy: SessionStrategy;
  sessionId?: string;
  onOutput?: (stream: "stdout" | "stderr", data: string) => void | Promise<void>;
}

/**
 * Where the wrapped command's output is captured inside the sandbox.
 *
 * The Cloudflare sandbox container-server labels exec stdout/stderr through a
 * bash `read` loop, and bash strings are C strings: every NUL byte is silently
 * dropped before the output reaches the Worker. Paperclip frames several
 * machine-consumed probes with NUL delimiters (the execution-target Git
 * context probe, the managed-launcher PATH probe), so a lossy stdout makes
 * every sandbox run fail during setup with
 * "Could not read execution-target Git context".
 *
 * The bridge therefore redirects the command's stdout/stderr into temp files
 * and reads them back through the file API with base64 encoding, which is a
 * byte-exact path. Live streaming (when requested) still forwards stdout
 * through the labeled pipe for log purposes only; the returned result always
 * comes from the captured files.
 */
export interface OutputCapture {
  stdoutFile: string;
  stderrFile: string;
  exitCodeFile: string;
  /** Also forward stdout live through the exec pipe (streaming mode). */
  teeStdout: boolean;
}

function isValidShellEnvKey(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function randomToken(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (typeof uuid === "string" && uuid.length > 0) return uuid.replace(/[^a-zA-Z0-9-]/g, "");
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function buildLoginShellScript(input: {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdinFile?: string | null;
  capture?: OutputCapture | null;
}): string {
  const env = input.env ?? {};
  for (const key of Object.keys(env)) {
    if (!isValidShellEnvKey(key)) {
      throw new Error(`Invalid sandbox environment variable key: ${key}`);
    }
  }

  const envArgs = Object.entries(env)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => `${key}=${shellQuote(value)}`);
  const commandParts = [shellQuote(input.command), ...input.args.map(shellQuote)].join(" ");
  const stdinRedirect = input.stdinFile ? ` < ${shellQuote(input.stdinFile)}` : "";
  // Source the common login profiles before exec so the command runs with the
  // interactive-shell PATH. The wrapper sources no `nvm.sh`; the sandbox image
  // supplies node on the PATH.
  const lines = [
    'if [ -f /etc/profile ]; then . /etc/profile >/dev/null 2>&1 || true; fi',
    'if [ -f "$HOME/.profile" ]; then . "$HOME/.profile" >/dev/null 2>&1 || true; fi',
    'if [ -f "$HOME/.bash_profile" ]; then . "$HOME/.bash_profile" >/dev/null 2>&1 || true; elif [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc" >/dev/null 2>&1 || true; fi',
    'if [ -f "$HOME/.zprofile" ]; then . "$HOME/.zprofile" >/dev/null 2>&1 || true; fi',
  ];
  if (input.cwd) {
    // A container restart (sleep, crash, redeploy) wipes the sandbox disk but
    // keeps the Durable Object, so a later command can target a lease whose
    // workspace directory no longer exists. Paperclip's cleanup sweeps then
    // retry `rm -rf` forever, keeping the container awake. Recreate the cwd so
    // such commands complete; lost-lease detection uses the sentinel file, not
    // the directory's existence.
    lines.push(`mkdir -p ${shellQuote(input.cwd)}`);
    lines.push(`cd ${shellQuote(input.cwd)}`);
  }
  const execLine = envArgs.length > 0
    ? `exec env ${envArgs.join(" ")} ${commandParts}${stdinRedirect}`
    : `exec ${commandParts}${stdinRedirect}`;

  const capture = input.capture;
  if (!capture) {
    lines.push(execLine);
    return lines.join(" && ");
  }

  const out = shellQuote(capture.stdoutFile);
  const err = shellQuote(capture.stderrFile);
  const rc = shellQuote(capture.exitCodeFile);
  if (capture.teeStdout) {
    // POSIX-sh pipeline: the subshell's exit status is persisted to a file
    // (a pipeline's status would otherwise be tee's), stdout is tee'd so the
    // live stream still sees it, and stderr is replayed after completion so
    // log forwarding keeps it too. The returned result comes from the files.
    // The whole thing is one `{ ...; }` group so an earlier `&&` failure
    // (for example `cd` into a missing workspace) short-circuits it entirely
    // instead of running `cat`/`exit` against files that were never written.
    lines.push(
      `{ ( ( ${execLine} ) 2>${err}; echo $? >${rc} ) | tee ${out}; ` +
        `cat ${err} >&2; exit "$(cat ${rc})"; }`,
    );
  } else {
    lines.push(`( ${execLine} ) >${out} 2>${err}`);
  }
  return lines.join(" && ");
}

function coerceExecuteResult(result: {
  success?: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
}) {
  return {
    exitCode:
      typeof result.exitCode === "number" || result.exitCode === null
        ? result.exitCode
        : result.success === false
          ? 1
          : 0,
    signal: null,
    timedOut: false,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Read a captured output file byte-exactly. Returns `null` when the file is
 * unavailable (for example the wrapper failed before the redirect was set up),
 * so the caller can fall back to the exec pipe's (lossy) output.
 */
async function readCapturedOutput(
  sandbox: CloudflareSandbox,
  path: string,
  sessionId: string | undefined,
): Promise<string | null> {
  try {
    const result = await sandbox.readFile(path, {
      encoding: "base64",
      ...(sessionId ? { sessionId } : {}),
    });
    if (!result || typeof result.content !== "string") return null;
    if (result.encoding === "base64") return decodeBase64Utf8(result.content);
    return result.content;
  } catch {
    return null;
  }
}

export async function executeInSandbox(params: BridgeExecuteParams) {
  // The @cloudflare/sandbox SDK's exec() takes a single command string and a
  // narrow option set ({ cwd, env, timeout, ... }) — it does not accept `args`
  // or `stdin`. We compose the full shell command ourselves and stage stdin
  // through a temp file in the sandbox when the caller provides one.
  const stdinPayload = typeof params.stdin === "string" && params.stdin.length > 0
    ? params.stdin
    : null;
  const token = randomToken();
  const stdinFile = stdinPayload ? `/tmp/.paperclip-bridge-stdin-${token}` : null;
  const streaming = typeof params.onOutput === "function";
  const capture: OutputCapture = {
    stdoutFile: `/tmp/.paperclip-bridge-out-${token}`,
    stderrFile: `/tmp/.paperclip-bridge-err-${token}`,
    exitCodeFile: `/tmp/.paperclip-bridge-rc-${token}`,
    teeStdout: streaming,
  };
  const fileSessionId = params.sessionStrategy === "named"
    ? (params.sessionId?.trim() || undefined)
    : undefined;

  if (stdinFile && stdinPayload) {
    await params.sandbox.writeFile(stdinFile, stdinPayload, { encoding: "utf8" });
  }

  try {
    const target = await resolveExecutionTarget(params.sandbox, {
      sessionStrategy: params.sessionStrategy,
      sessionId: params.sessionId,
      cwd: params.cwd,
      env: params.env,
      timeoutMs: params.timeoutMs,
    });
    const script = buildLoginShellScript({
      command: params.command,
      args: params.args ?? [],
      cwd: params.cwd,
      env: params.env,
      stdinFile,
      capture,
    });
    const fullCommand = `sh -lc ${shellQuote(script)}`;
    const result = await target.exec(fullCommand, {
      cwd: "/",
      timeout: params.timeoutMs,
      ...(streaming
        ? {
            stream: true,
            onOutput: params.onOutput,
          }
        : {}),
    });
    const coerced = coerceExecuteResult(result);
    const [stdout, stderr] = await Promise.all([
      readCapturedOutput(params.sandbox, capture.stdoutFile, fileSessionId),
      readCapturedOutput(params.sandbox, capture.stderrFile, fileSessionId),
    ]);
    return {
      ...coerced,
      stdout: stdout ?? coerced.stdout,
      stderr: stderr ?? coerced.stderr,
    };
  } catch (error) {
    if (isTimeoutError(error)) {
      // Best-effort: the capture files may hold partial output.
      const [stdout, stderr] = await Promise.all([
        readCapturedOutput(params.sandbox, capture.stdoutFile, fileSessionId),
        readCapturedOutput(params.sandbox, capture.stderrFile, fileSessionId),
      ]);
      await cleanupTimedOutExecution(params.sandbox, {
        sessionStrategy: params.sessionStrategy,
        sessionId: params.sessionId,
      });
      return {
        exitCode: null,
        signal: null,
        timedOut: true,
        stdout: stdout ?? (typeof (error as { stdout?: unknown }).stdout === "string" ? (error as { stdout: string }).stdout : ""),
        stderr: `${stderr ?? ""}${error instanceof Error ? error.message : String(error)}\n`,
      };
    }
    throw error;
  } finally {
    const cleanup = [capture.stdoutFile, capture.stderrFile, capture.exitCodeFile];
    if (stdinFile) cleanup.push(stdinFile);
    await Promise.all(
      cleanup.map((file) =>
        Promise.resolve()
          .then(() => params.sandbox.deleteFile?.(file, fileSessionId))
          .catch(() => undefined),
      ),
    );
  }
}
