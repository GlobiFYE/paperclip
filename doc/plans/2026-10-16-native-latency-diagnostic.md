# Native latency diagnostic — 2026-10-16

Status: one explicit local-controller/real-Daytona experiment is prepared.
No staging setting or production code changes are part of this branch.

Use the existing Product E2E basic-response journey and its independent exact
answer, run state, task state, runtime and environment checks. The new manual
suite selects only native Codex `gpt-6.1-sol`, a warm session with a five-minute
idle timeout, and the existing reusable Daytona fixture. It stays out of `--all`
and the ordinary `runner-codex` selector. It uses a 1,000-cent agent hard stop,
one expected run, the original deadlines, and no automatic retry.

The staging comparison uses subscription authentication. This experiment uses
an API key. A fresh local database and fixture instructions do not reproduce
staging company data, Slack admission or Slack delivery. Separate controller
setup and provider timing. Do not report the result as exact staging or release
qualification. Keep the selected image and executable digests in the evidence.

Credential-free discovery and the harness typecheck pass. The first typecheck
failed on an unknown fixture payload type; the final typecheck corrects that
cast without changing production types. The initial full support invocation
failed seven cases: two catalog totals changed, one existing Pi version
expectation differs from its source, and four installed-startup cases correctly
reject pnpm's injected `NODE_PATH`. The affected catalog totals are updated.
Direct Node invocation of the catalog, diagnostic, installed-startup and fixture
checks passes 63 cases. The existing Pi version mismatch remains unchanged.
No paid or live result is claimed by these checks.

The local preparation-overlap candidate remains on a separate local branch.
It is not part of this timing baseline.
