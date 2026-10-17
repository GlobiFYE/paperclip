// Shared harness primitives. bun/TypeScript. No secrets here.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export const SCRATCH =
  process.env.PKST_SCRATCH ?? join(homedir(), ".cache", "paperclip-kow-smoketest");
export const BASE_IMG = join(SCRATCH, "base", "noble-cloudimg-amd64.img");
export const RUNS_DIR = join(SCRATCH, "runs");

export interface Manifest {
  nonce: string;
  qemuPid: number;
  hostfwdPort: number;
  overlayPath: string;
  runDir: string;
  owner: string;
  startedAt: string; // ISO
}

export function newNonce(): string {
  // url-safe, no shell/regex metachars; distinct from any secret.
  return "r" + randomBytes(9).toString("hex");
}

export function runDirFor(nonce: string): string {
  return join(SCRATCH, `run-${nonce}`);
}

export function ensureDirs() {
  for (const d of [SCRATCH, join(SCRATCH, "base"), RUNS_DIR]) mkdirSync(d, { recursive: true });
}

// Probe a free loopback TCP port by binding :0 and reading it back.
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      if (addr && typeof addr === "object") {
        const p = addr.port;
        s.close(() => resolve(p));
      } else {
        s.close(() => reject(new Error("no port")));
      }
    });
  });
}

// ssh/scp into the guest. -F /dev/null is mandatory (host ssh_config.d is broken).
export function sshBase(port: number, keyPath: string, knownHosts: string): string[] {
  return [
    "-F", "/dev/null",
    "-i", keyPath,
    "-p", String(port),
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", `UserKnownHostsFile=${knownHosts}`,
    "-o", "ConnectTimeout=5",
    "-o", "LogLevel=ERROR",
  ];
}

// scp shares ssh's options but takes -P (capital) for the port, not -p.
export function scpBase(port: number, keyPath: string, knownHosts: string): string[] {
  return [
    "-F", "/dev/null",
    "-i", keyPath,
    "-P", String(port),
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", `UserKnownHostsFile=${knownHosts}`,
    "-o", "LogLevel=ERROR",
  ];
}

export interface SshResult { code: number; stdout: string; stderr: string; }

export function ssh(
  port: number, keyPath: string, knownHosts: string, user: string, cmd: string,
): SshResult {
  const r = spawnSync("ssh", [...sshBase(port, keyPath, knownHosts), `${user}@127.0.0.1`, cmd], {
    encoding: "utf8", timeout: 120_000,
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function scp(
  port: number, keyPath: string, knownHosts: string, local: string, remote: string,
): SshResult {
  const r = spawnSync(
    "scp",
    [...scpBase(port, keyPath, knownHosts), local, `tester@127.0.0.1:${remote}`],
    { encoding: "utf8", timeout: 120_000 },
  );
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export async function waitForSsh(
  port: number, keyPath: string, knownHosts: string, timeoutMs = 180_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = ssh(port, keyPath, knownHosts, "tester", "true");
    if (r.code === 0) return true;
    await new Promise((res) => setTimeout(res, 5000));
  }
  return false;
}

export function writeManifest(m: Manifest) {
  ensureDirs();
  writeFileSync(join(RUNS_DIR, `${m.nonce}.json`), JSON.stringify(m, null, 2), { mode: 0o664 });
}

export function readManifest(nonce: string): Manifest | null {
  const p = join(RUNS_DIR, `${nonce}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as Manifest;
}

export function procAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
