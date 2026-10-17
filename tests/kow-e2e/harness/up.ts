// `up`: boot a throwaway KVM guest as `claude`, SSH-ready. Encodes the proven
// recipe (docs/BOOT-RECIPE.md). No root, user-mode slirp, loopback hostfwd.
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  SCRATCH, BASE_IMG, newNonce, runDirFor, ensureDirs, freePort,
  waitForSsh, writeManifest, type Manifest,
} from "./lib.ts";

export interface GuestCtx {
  nonce: string; runDir: string; port: number; keyPath: string;
  knownHosts: string; overlay: string; consoleLog: string; qemuPid: number;
}

function sh(cmd: string, args: string[], opts: Record<string, unknown> = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if ((r.status ?? -1) !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
  return r.stdout ?? "";
}

export async function up(): Promise<GuestCtx> {
  if (!existsSync(BASE_IMG)) throw new Error(`base image missing: ${BASE_IMG}`);
  ensureDirs();
  const nonce = newNonce();
  const runDir = runDirFor(nonce);
  mkdirSync(runDir, { recursive: true });
  const keyPath = join(runDir, "id");
  const knownHosts = join(runDir, "known_hosts");
  const overlay = join(runDir, "overlay.qcow2");
  const seed = join(runDir, "seed.iso");
  const consoleLog = join(runDir, "console.log");
  const port = await freePort();

  // throwaway ssh key
  sh("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", keyPath, "-q"]);
  const pub = readFileSync(`${keyPath}.pub`, "utf8").trim();

  // cloud-init: admin control user `tester`; dead-man shutdown backstop (re-armed in provision)
  writeFileSync(join(runDir, "user-data"), `#cloud-config
ssh_pwauth: false
users:
  - name: tester
    ssh_authorized_keys:
      - ${pub}
    sudo: 'ALL=(ALL) NOPASSWD:ALL'
    shell: /bin/bash
    lock_passwd: false
runcmd:
  - [ bash, -c, "echo $(date -u +%s) > /run/boot-marker" ]
  - [ bash, -c, "shutdown +30 'pkst dead-man' || true" ]
`);
  writeFileSync(join(runDir, "meta-data"),
    `instance-id: pkst-${nonce}\nlocal-hostname: pkst\n`);
  sh("cloud-localds", [seed, join(runDir, "user-data"), join(runDir, "meta-data")]);
  sh("qemu-img", ["create", "-f", "qcow2", "-F", "qcow2", "-b", BASE_IMG, overlay]);
  // Grow the overlay so cloud-init growpart expands root to fit node + mitmproxy
  // (the base cloud image root is ~2 GB and overflows otherwise).
  sh("qemu-img", ["resize", overlay, "20G"]);

  // Detached boot: the task harness kills a plain background qemu; setsid orphans it.
  const bootSh = join(runDir, "boot.sh");
  writeFileSync(bootSh, `#!/bin/bash
cd "${runDir}"
setsid qemu-system-x86_64 -accel kvm -machine q35 -cpu host -m 2048 -smp 2 \\
  -display none -serial file:"${consoleLog}" -monitor none \\
  -drive file="${overlay}",if=virtio \\
  -drive file="${seed}",if=virtio,format=raw \\
  -netdev user,id=n0,hostfwd=tcp:127.0.0.1:${port}-:22 \\
  -device virtio-net-pci,netdev=n0 </dev/null >/dev/null 2>&1 &
echo $! > "${join(runDir, "qemu.pid")}"
`, { mode: 0o755 });
  spawnSync("bash", [bootSh], { encoding: "utf8" });
  // small settle so the pid file lands
  await new Promise((r) => setTimeout(r, 1500));
  const qemuPid = parseInt(readFileSync(join(runDir, "qemu.pid"), "utf8").trim(), 10);

  const manifest: Manifest = {
    nonce, qemuPid, hostfwdPort: port, overlayPath: overlay, runDir,
    owner: process.env.USER ?? "claude", startedAt: new Date().toISOString(),
  };
  writeManifest(manifest);

  const ok = await waitForSsh(port, keyPath, knownHosts);
  if (!ok) throw new Error(`guest ${nonce} never became SSH-ready (see ${consoleLog})`);

  return { nonce, runDir, port, keyPath, knownHosts, overlay, consoleLog, qemuPid };
}

if (import.meta.main) {
  up().then((c) => {
    console.log(JSON.stringify(
      { ok: true, nonce: c.nonce, port: c.port, runDir: c.runDir, qemuPid: c.qemuPid }, null, 2));
  }).catch((e) => { console.error("up failed:", e.message); process.exit(1); });
}
