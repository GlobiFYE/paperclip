// Core security smoke test: boots a guest, provisions kow+mock+agent, runs the
// bound agent through `kow run`, and asserts the three load-bearing properties
// LIVE. This is the automated form of the 2026-10-17 manual proof.
//
//   A1  swap-on-the-wire: the mock received the REAL fixture (fingerprint match)
//   A2a no-leak: the real fixture value appears in NO agent-visible channel
//   A3  audit: exactly one allowed inject_decision for TEST_API_KEY/vault-echo.test
//
// Run: bun tests/smoke-core.ts   (slow: boots a VM, installs kow; ~5-6 min)
import { provision } from "../harness/provision.ts";
import { ssh, readManifest, procAlive } from "../harness/lib.ts";

function assert(cond: boolean, label: string, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!cond) process.exitCode = 1;
  return cond;
}

const RUNROOT = "/opt/pkst";

async function main() {
  const ctx = await provision();
  const sx = (cmd: string) => ssh(ctx.port, ctx.keyPath, ctx.knownHosts, "tester", cmd);
  try {
    // run the bound agent
    sx(`bash ~/pkst-assets/run-agent.sh ${ctx.nonce} '${ctx.placeholder}' ${RUNROOT} POST https://vault-echo.test:8443/echo smoke >/dev/null 2>&1`);

    // --- A1: mock received the real fixture (compare token fingerprint to fixture.fp) ---
    const fixtureFp = sx(`cat ${RUNROOT}/pub/fixture.fp`).stdout.trim();
    const recv = sx(`sudo cat ${RUNROOT}/upstream/received.log 2>/dev/null | grep ${ctx.nonce} | tail -1`).stdout.trim();
    const recvFp = (() => { try { return JSON.parse(recv).token_sha256_12; } catch { return ""; } })();
    assert(recvFp !== "" && recvFp === fixtureFp, "A1 swap-on-the-wire", `recvFp=${recvFp} fixtureFp=${fixtureFp}`);

    // --- A2a: the REAL fixture never reaches any agent-visible channel ---
    // Read the real value in-guest as root (host never holds it); grep agent result + environ.
    const real = sx(`sudo awk '/TEST_API_KEY:/{print $2}' ${RUNROOT}/kowd/static-secrets.yaml`).stdout.trim();
    const leakHits = sx(
      `sudo grep -Fc "${real}" ${RUNROOT}/agent/result-smoke.json 2>/dev/null; ` +
      `AGPID=$(cat ${RUNROOT}/agent/agent-smoke.pid 2>/dev/null); ` +
      `sudo grep -Fac "${real}" /proc/$AGPID/environ 2>/dev/null || true`,
    ).stdout.split("\n").map((n) => parseInt(n, 10) || 0).reduce((a, b) => a + b, 0);
    assert(real.length >= 32, "A0 fixture hygiene (>=32 chars)", `len=${real.length}`);
    assert(leakHits === 0, "A2a no-leak to agent channels", `hits=${leakHits}`);

    // --- A3: exactly one allowed inject_decision for the bound secret/host ---
    const n = parseInt(sx(
      `sudo grep -c '"type": *"inject_decision".*"decision": *"allowed".*"secret_name": *"TEST_API_KEY".*vault-echo.test' ${RUNROOT}/kowd/audit.jsonl 2>/dev/null || echo 0`,
    ).stdout.trim(), 10);
    assert(n === 1, "A3 exactly one allowed inject_decision", `count=${n}`);

    // release the agent barrier so it can exit
    sx(`sudo rm -f ${RUNROOT}/agent/barrier-smoke`);
  } finally {
    // teardown: kill the guest by recorded PID (never by port)
    const m = readManifest(ctx.nonce);
    if (m && procAlive(m.qemuPid)) { try { process.kill(m.qemuPid, "SIGKILL"); } catch {} }
    console.log(`teardown: guest ${ctx.nonce} killed`);
  }
}

main().catch((e) => { console.error("smoke-core fatal:", e.message); process.exit(1); });
