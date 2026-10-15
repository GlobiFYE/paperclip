# Opt-in CI profiling

Goal: label a PR `profile-ci`, run the complete main PR suite, and open one
Honeycomb waterfall showing the full elapsed timeline. Use that evidence to
decide which CI work to speed up or remove. CI optimizations themselves are a
follow-up, not part of this change.

## Acceptance

| Case | Required behavior | Evidence |
| --- | --- | --- |
| Unlabeled PR | Existing scope and commands; no profile export | Routing and exporter tests |
| Labeled PR, including stacked/release-notes-only | All main PR lanes run | Routing tests and full-run job inventory |
| Completed profile | One trace per run attempt; every job and step uses actual timestamps | Honeycomb waterfall reconciled against GitHub job API |
| Parallel work | Shared wall clock, with waiting and execution distinguishable | Overlapping lanes and root duration checked against GitHub |
| Tests | Vitest and Playwright file/test timings under their job/step; Node test timings where supported | Real reporter smoke runs and hierarchy checks |
| Failure/cancellation/rerun | Preserve completed timing data; mark missing coverage; attempts stay separate | Exporter regression cases |
| Credentials | Trusted exporter owns ingest secret; PR jobs only write timing artifacts | Workflow review and tests |

Scope: the main `PR` workflow and every lane of `pr-trusted.yml`, including
policy, build, typecheck/release-registry, general/serialized test shards,
Runner checks, canary, and browser E2E. Separate release/deploy/live-provider
workflows remain outside this first trace. Rust checks are visible as complete
job/step timings; stable libtest does not provide per-test wall-clock reports.
No sampling inside a selected run.

## State

- Branch: `codex/ci-honeycomb-profiling` in the existing `76aa` worktree.
- Baseline: GitHub run `38671274294`, 48 jobs, 479 seconds from creation to last
  job completion. Raw GitHub evidence is in `/tmp/paperclip-ci-profile-evidence`.
- Honeycomb: existing `paperclip` team / `test` environment. Credential use is
  awaiting the explicit authorization required by automatic approval review.
- Implemented label selection, full-suite override, test timing reporters, trusted
  post-run exporter, direct waterfall link, and missing-data diagnostics.
- Verified: 48-job / 731-span historical reconstruction; 456 workflow/reporter
  checks; real root-config probe with 13 tests and one file span; full Node 24
  typecheck and build. Repository-wide Vitest is being rerun after the final
  reporter-default correction and base update.
- Created and verified the repository `profile-ci` label. Ingest secret and live
  Honeycomb export remain pending credential authorization.
- Delivery: reviewable PR and live Honeycomb evidence. Activation of new trusted
  workflow definitions requires merge to master; do not claim pre-merge evidence
  proves the post-merge label-triggered journey.
