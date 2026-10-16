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

## Real Daytona baseline and next slice

The corrected current Core linux/amd64 runner artifact passes the exact answer,
run/task, native mode and Daytona matchers; cleanup passes. Its traced repetition
on source `ac86e9e7668b` has a 22.878-second active run and 10.233-second queue
while this newly created agent is activated. Whole-case time is 52.788 seconds.
This does not establish a sub-30-second submission-to-answer or Slack result.
The earlier stale local binary failed native provider identity validation and
its failed cleanup grade remains; an independently scoped follow-up confirmed
its nine owned Daytona sandboxes retired. Neither attempt changes PAP.

The traced repetition stages fresh harness launch material for 621 ms, then
immutable runtime context for 615 ms. Both use disjoint session paths. Extract
this responsibility first with serial semantics, then overlap these two steps
only for a sandbox runner that explicitly advertises concurrent sync. Await both
outcomes before returning, retain launch-material error priority, keep CA staging
last, and leave SSH and undeclared runners serial with first-error termination.
Durable restore, artifact checks, ownership, permissions and process launch stay
in the existing orchestrator.

Other defensible boundaries in the oversized executor are durable checkpoint
restore, verified artifact preparation, transport/process supervision and provider
credential lifecycle. They remain outside this bounded latency change. The
launch-asset extraction moves about 120 lines with explicit stage callbacks and
no new shared state or runtime dependency on the executor. Check its serial
behavior before introducing concurrency, then use barriers to verify overlap,
wait-for-all failure handling and unsupported transport behavior. Compare one
matched real-Daytona candidate against the saved baseline; provider variation
must remain separate from the launch phase saving.
