# paperclip-kow-smoketest

An end-to-end smoke test that proves **[keys-on-the-wire (kow)](https://github.com/inflightsec/keys-on-the-wire)
brokers a credential for an AI agent without the agent ever seeing the raw key** —
demonstrated live inside a disposable KVM guest, with Paperclip's `process`-adapter
agent shape.

## What it proves

An unprivileged `agent` user, wrapped by `kow run`, sends a **placeholder** to a
bound upstream. kow swaps in the real secret on the egress leg only. The test
asserts, from real evidence captured in the guest:

- **A1 — swap on the wire:** the mock upstream receives the real fixture (sha256
  fingerprint matches the stored secret).
- **A2a — no leak:** the real fixture value appears in no channel the agent can
  observe (its env, argv, result file).
- **A3 — audit:** kow logs exactly one allowed `inject_decision` for the bound
  secret and host.

Full acceptance criteria (A0–A8, negative controls, at-rest-read, wrong-CA,
egress hermeticity) and their adversarial-review history are in `SPEC.md`.

## Substrate

Root-free `qemu`/KVM guest run as an unprivileged user (via a world-accessible
`/dev/kvm`), user-mode networking, SSH over a loopback forward. Three isolated
in-guest users — `upstream`, `kowd`, `agent` — enforce that the agent cannot
read the secret at rest. Teardown is a single process kill; nothing persists.

## Run

```
bun test                 # pure-logic unit tests (fast)
bun tests/smoke-core.ts  # full boot + provision + live A1/A2a/A3 (~5-6 min)
```

The base cloud image is cached under `$PKST_SCRATCH`
(`~/.cache/paperclip-kow-smoketest` by default); large artifacts never enter git.

## Layout

- `harness/` — `lib.ts`, `up.ts` (boot), `provision.ts` (install + configure).
- `guest/` — `provision.sh`, `start.sh`, `run-agent.sh`, `lib.sh`, the mock
  upstream and agent programs, kow `static`-backend config generation.
- `tests/` — `lib.test.ts` (unit), `smoke-core.ts` (live core assertions).
- `SPEC.md`, `docs/` — spec, boot recipe, review log, status.
