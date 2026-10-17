// Test agent (runs in-guest as user `agent`, wrapped by `kow run`). Node, no deps.
// Sends the PLACEHOLDER to the bound upstream; kow swaps it on egress. The agent
// must only ever hold the placeholder. Writes verdict + its own env snapshot to a
// result file, then BLOCKS on a barrier file so its pid/memory/sockets stay live
// while the harness samples them (sweep-2 H1). Barrier wait is bounded and always
// released on every exit path.
//
// Env:
//   AG_URL         e.g. https://vault-echo.test:8443/echo
//   AG_METHOD      POST (default) | GET
//   AG_PLACEHOLDER the placeholder token the agent knows (NEVER the real secret)
//   AG_NONCE       per-run nonce
//   AG_RESULT      result file path (agent-owned)
//   AG_BARRIER     barrier file path; agent blocks until it DISAPPEARS (or timeout)
//   AG_BARRIER_TIMEOUT_MS  default 120000
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const URL_ = process.env.AG_URL;
const METHOD = (process.env.AG_METHOD ?? "POST").toUpperCase();
const PLACEHOLDER = process.env.AG_PLACEHOLDER ?? "";
const NONCE = process.env.AG_NONCE ?? "";
const RESULT = process.env.AG_RESULT ?? "/tmp/agent-result.json";
const BARRIER = process.env.AG_BARRIER ?? "";
const BARRIER_TIMEOUT = parseInt(process.env.AG_BARRIER_TIMEOUT_MS ?? "120000", 10);

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const out = {
    nonce: NONCE, url: URL_, method: METHOD,
    sent_authorization: `Bearer ${PLACEHOLDER}`, // what the agent constructed (placeholder)
    env_snapshot: { ...process.env },            // A2a: must contain only the placeholder
    proc_self_environ_len: 0,
    verdict: null, error: null,
  };
  try {
    out.proc_self_environ_len = readFileSync("/proc/self/environ").length;
  } catch {}

  // Node 18's global fetch ignores HTTPS_PROXY; use curl, which honors the proxy
  // + CA that `kow run` exports. curl reads HTTPS_PROXY from env automatically.
  const ca = process.env.SSL_CERT_FILE ?? process.env.NODE_EXTRA_CA_CERTS ?? "";
  const args = [
    "-sS", "--max-time", "20", "--cacert", ca,
    "-X", METHOD,
    "-H", `authorization: Bearer ${PLACEHOLDER}`,
    "-H", `x-run-nonce: ${NONCE}`,
  ];
  if (METHOD !== "GET") args.push("-H", "content-type: application/json", "--data", JSON.stringify({ nonce: NONCE }));
  args.push(URL_);
  try {
    const body = execFileSync("curl", args, { encoding: "utf8" });
    out.verdict = JSON.parse(body); // opaque verdict; never the raw secret
  } catch (e) {
    out.error = String(e && e.stderr ? e.stderr : (e && e.message ? e.message : e));
  }

  writeFileSync(RESULT, JSON.stringify(out, null, 2));
  process.stdout.write(`agent wrote result for nonce=${NONCE}\n`);

  // Hold the process live for sampling; release when the barrier file is removed.
  if (BARRIER) {
    const deadline = Date.now() + BARRIER_TIMEOUT;
    while (existsSync(BARRIER) && Date.now() < deadline) {
      await sleep(500);
    }
  }
}

main().catch((e) => { process.stderr.write(`agent fatal: ${e}\n`); process.exit(1); });
