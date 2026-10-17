// Unit tests for the pure harness helpers. Run: bun test (PKST_SCRATCH is set to
// a temp dir by the test script so manifest I/O never touches the real cache).
import { test, expect } from "bun:test";
import {
  newNonce, runDirFor, sshBase, scpBase, freePort,
  writeManifest, readManifest, procAlive, SCRATCH, type Manifest,
} from "../harness/lib.ts";

test("newNonce has the expected shape and is unique", () => {
  const a = newNonce(), b = newNonce();
  expect(a).toMatch(/^r[0-9a-f]{18}$/);
  expect(a).not.toBe(b);
});

test("runDirFor lives under SCRATCH and names the nonce", () => {
  const d = runDirFor("rdeadbeef");
  expect(d.startsWith(SCRATCH)).toBe(true);
  expect(d.endsWith("run-rdeadbeef")).toBe(true);
});

test("sshBase uses lowercase -p and ignores system config", () => {
  const a = sshBase(2222, "/k", "/kh");
  expect(a).toContain("-F"); expect(a).toContain("/dev/null");
  expect(a).toEqual(expect.arrayContaining(["-p", "2222", "-i", "/k"]));
  expect(a).toContain("UserKnownHostsFile=/kh");
  expect(a).not.toContain("-P"); // capital P is scp-only
});

test("scpBase uses capital -P for the port", () => {
  const a = scpBase(2222, "/k", "/kh");
  expect(a).toEqual(expect.arrayContaining(["-P", "2222"]));
  expect(a).not.toContain("-p");
});

test("freePort returns a usable high port", async () => {
  const p = await freePort();
  expect(p).toBeGreaterThan(1024);
  expect(p).toBeLessThan(65536);
});

test("manifest round-trips and missing reads null", () => {
  const m: Manifest = {
    nonce: "rtest" + Date.now().toString(16), qemuPid: 1, hostfwdPort: 2,
    overlayPath: "/o", runDir: "/r", owner: "claude", startedAt: new Date().toISOString(),
  };
  writeManifest(m);
  expect(readManifest(m.nonce)).toEqual(m);
  expect(readManifest("rnot-a-real-nonce")).toBeNull();
});

test("procAlive reflects reality", () => {
  expect(procAlive(process.pid)).toBe(true);
  expect(procAlive(2147480000)).toBe(false); // almost certainly dead
});
