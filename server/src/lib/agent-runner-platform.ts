import { execFile } from "node:child_process";
import { paperclipRunnerSupportsPlatform } from "@paperclipai/shared";

type LocalRunnerTarget = {
  driver: "local";
  platform: NodeJS.Platform;
  architecture: string;
  libc?: "glibc" | "unknown";
  glibcVersion?: string;
};

async function detectLocalRunnerTarget(): Promise<LocalRunnerTarget> {
  const target: LocalRunnerTarget = {
    driver: "local", platform: process.platform, architecture: process.arch,
  };
  if (target.platform !== "linux") return target;
  target.libc = "unknown";
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile("getconf", ["GNU_LIBC_VERSION"], {
        encoding: "utf8", timeout: 1_000, killSignal: "SIGKILL", maxBuffer: 1_024,
      }, (error, output) => error ? reject(error) : resolve(output));
    });
    const version = /^glibc\s+(\d+\.\d+(?:\.\d+)?)$/.exec(stdout.trim())?.[1];
    if (version) {
      target.libc = "glibc";
      target.glibcVersion = version;
    }
  } catch {
    // An unavailable or unidentified libc must not select a GNU/Linux binary.
  }
  return target;
}

// Platform facts cannot change in this process. Resolve them before callers can
// serve requests, without blocking the event loop or generating a full report.
const localTarget = await detectLocalRunnerTarget();

export function localAgentRunnerTarget(): LocalRunnerTarget {
  return { ...localTarget };
}

export function localPaperclipRunnerSupported(): boolean {
  const target = localAgentRunnerTarget();
  return paperclipRunnerSupportsPlatform("codex_local", target.platform, target.architecture, target.libc, target.glibcVersion);
}
