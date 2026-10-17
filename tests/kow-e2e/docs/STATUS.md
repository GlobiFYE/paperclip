# Status — Paperclip+kow smoke test (2026-10-08)

## Done
- ADR-0006 (substrate decision), LIFEOS/DOCUMENTATION/adr/.
- SPEC v4 — 3 adversarial design sweeps + all fixes:
  sweep1 Oracle/codex C1-C10; sweep2 Max H1-H3/M1-M5/L1-L4; sweep3 Anvil
  (cross-vendor, kow-source-verified) H-A/M-A..E/L-A..D. docs/REVIEW-LOG.md.
- Substrate PROVEN end-to-end: boot recipe docs/BOOT-RECIPE.md.
- harness/lib.ts + harness/up.ts — LIVE-VERIFIED (boots guest, SSH-ready ~10-30s).
- Base image cached in $SCRATCH/base.

## Remaining (implementation)
1. harness/provision.ts — 3 users (upstream/kowd/agent), install kow + Paperplip
   + python, in-guest `static`-backend fixture generator (umask 077), kowd log
   redirect, mock upstream (+wrong-CA variant for A8), agent script with barrier.
2. harness/run.ts — kow run -- agent; capture live evidence (ss -tnp, environ, maps).
3. harness/assert.ts — A0-A8 + §4b sensitivity gate (planted positives FIRST).
4. nftables egress ruleset (§5) + down.ts reaper (owner-scoped).
5. Live iterate to green in the guest.
6. Post-implementation: 3 more Oracle/cross-vendor sweeps + fixes.

## Known constraints
- Oracle/codex cross-vendor degraded this session (host MITM breaks codex WS on
  long streams; OpenAI metered out of credits). Used Max + Anvil. A true
  skill-path cross-vendor sweep still owed before PR (SPEC §11).
- Forge gated out of EXECUTE for same codex-transport reason; building directly.

## 2026-10-17 — CORE SECURITY SLICE GREEN (live in VM)
Proven end-to-end in a booted guest (nonce r8634…):
- agent sent placeholder `pkPLACEHOLDER…`; kow audit `inject_decision decision=allowed secret_name=TEST_API_KEY host=vault-echo.test` (A3 mechanism works);
- mock received the REAL fixture `Bearer dfOhx…`, token_sha256_12=3590f8fb8905 == fixture.fp (A1 ✓);
- agent verdict authorized=true,is_placeholder=false; agent env holds only the placeholder (A2a visual ✓).
Harness pieces working: lib.ts, up.ts (20G overlay resize), provision.ts, guest/{provision,start,run-agent}.sh, mock-upstream.mjs, agent.mjs (curl client — Node18 fetch ignores HTTPS_PROXY).
kow config facts locked: needs `audit:{path}`; static backend = bindings.yaml + 0600 static-secrets.yaml; tls_termination: all; proxy `python -m kow --set kow_config= --set confdir= --set ssl_verify_upstream_trusted_ca=`.
Gotchas: service users can't read /home/tester → .mjs installed to world-readable /opt/pkst/assets; noble `nodejs npm` apt conflict (install nodejs only); cloud image root ~2G → resize overlay to 20G for growpart.

## Remaining
- assert.ts: formalize A0-A8 + §4b sensitivity gate (planted positives first).
- A5 negative controls (wrong host / GET / wrong path); A7 agent-cannot-read-at-rest; A8 wrong-CA.
- §5 nftables egress + ss -tnp socket evidence; down.ts owner-scoped reaper.
- Layer Paperclip process-adapter for A4 (install pnpm/npm separately).
- 3 post-implementation Oracle/cross-vendor sweeps + fixes.
