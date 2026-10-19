# Sidebar and Apps startup performance

Outcome: one tested, reviewable PR and an isolated local preview. Preserve
sidebar accuracy, account isolation, loading layout and recovery. No merge or
staging deployment. PR: https://github.com/paperclipai/paperclip/pull/16851

## Implementation

- The five-ID summary route applies existing company/task authorization, omits
  unavailable IDs and uses a dedicated projection with no detail/workspace
  enrichment. The bound applies before deduplication. Responses are private/no-store.
- Recent history uses one account-scoped query. Successful omissions apply only
  to the requested IDs. Revisiting a cached omission requires a fresh response;
  fetch completion remains observable when React Query shares the data object.
  Full-detail cache updates require positive access confirmation and never
  activate detail queries. Failures preserve snapshots and query errors.
- Access checks overlap shell settings; the protected subtree waits for both.
  Only the first healthy socket opening exempts exact session/health keys.
  Domain catch-up and recovery remain active. Queued/status lifecycle events and
  pause/restart refresh summaries; progress/run-log events do not. Inbox archive
  preserves recent history.

Initial checkout: clean at `0ed760ce9a`. Branch:
`codex/sidebar-apps-startup-performance`. Route-splitting PR
[#16849](https://github.com/paperclipai/paperclip/pull/16849) landed during this
work. The branch was rebased onto `9179d8dcc3`; the primary comparison includes
that same route splitting on both sides. Tested application source:
`0833da6927f5563c9a48d179e2b1bf0fd99f711d`. Later evidence-only edits do not
change the application.

## Evidence

The [sample record](2026-10-19-sidebar-apps-startup-evidence.json) contains every
primary sample, endpoint counts, prior trials, source revisions, environment and
browser-journey assertions. Earlier noisy trials remain visible.

Primary comparison: production UI at `9179d8dcc3` versus `0833da6927`, sharing
the same final API and persistent synthetic fixture. The full-detail handler is
unchanged. Five cold and five in-app samples per revision alternate in the same
Chromium build. Profile: 1440x1000, 50ms latency, 9Mbps down, 1.5Mbps up, 4x CPU;
service workers blocked. Cold contexts disable browser cache. In-app timing
starts after dashboard recent-task refresh and two seconds of settling.
Usability requires the existing connector list and search controls; no
`networkidle` wait is used. Own builds/tests finished before this comparison.

| Median | Baseline | Candidate |
| --- | ---: | ---: |
| Cold Apps usable | 3904ms | 3994ms |
| In-app Apps usable | 1031ms | 1017ms |
| Sidebar refresh complete after navigation | 3363ms | 3325ms |
| Recent-task request span | 280ms | 256ms |
| Recent-task requests, cold | 5 full details | 1 summary; 0 details |
| Recent-task decoded body bytes | 45,441 | 1,159 |
| Recent-task encoded body bytes | 5,714 | 373 |
| All API requests, cold | 35 | 31 |
| Cold long-task time | 2130ms | 2226ms |
| Cold scripting time | 2.231s | 2.318s |
| In-app long-task time | 578ms | 589ms |
| In-app scripting time | 0.732s | 0.769s |

Encoded bytes fell 93.5%; decoded bytes fell 97.4%; request span fell 8.6%.
Cold readiness rose 90ms (2.3%); in-app readiness fell 15ms (1.4%). Sample ranges
overlap; candidate cold loads were faster in three of five pairs. These results
establish smaller task refreshes, not an overall Apps speedup. Modestly higher
CPU measurements remain visible above. Warm navigation reuses fresh sidebar
data without a refresh. Each candidate cold load made one session and one
health request. Focused socket tests also prove the initial exemption/recovery.

The real browser journey passed: five recent tasks; connector search and
permissions; task navigation and return; rename; inbox archive; pause/restart of
an unassigned disposable task; reload persistence; delayed summary responses.
Sidebar-row and connector-list rectangles were identical before/after releasing
held responses. No agent run was started.

## Verification and limits

- Passed after rebase: 85 focused UI/access/layout tests, 12 embedded PostgreSQL
  summary-route tests, 23 OpenAPI tests, full typecheck/build, token gates, maps
  and diff checks.
- Earlier `pnpm test:run` reported five failures in the existing 1347-case chat
  integration file; four reached 15-second timeouts. All ten matched cases passed
  on an unchanged isolated rerun. The already-failed broad run was then stopped.
  A complete green local `pnpm test:run` is **not** claimed. Latest-head CI status
  belongs in the PR handoff; focused passes do not replace it.
- Review regressions cover cached revisits, repeated omissions, in-app scripting
  scope and preparing both paired-build asset sets. Review/check status is on the PR.
- The asset preparer canonicalizes paths and skips copying onto itself. A real
  filesystem probe reproduced `ERR_FS_CP_EINVAL` without the guard, then executed
  the actual preparation block with `ui/dist` as candidate/server. It preserved
  candidate files and prepared the complete baseline asset union.
- Setup failures are retained in local logs: an initial build had concurrent
  writers; a compiled workspace server needs the TS loader for source exports;
  an archived UI needs tracked announcement assets. Successful builds use one
  writer per output directory. A browser observation URL typo was corrected
  before the complete passing journey.
- Both builds show the existing local implicit-board Assistant Connection status
  error. Connector search/navigation and the synthetic connector remain usable.
- This is local verification, not a staging deployment or proof of historical
  staging latency. Disk cleanup, workspace caching, route-splitting ownership,
  dependencies, migrations, telemetry and merging remain outside this PR.

## Preview and reproduction

Running preview: http://127.0.0.1:3214/APP/apps

Production UI and compiled server source: `0833da6927`, with the TS loader for
workspace dependency exports. Configuration/evidence:
`/tmp/paperclip-apps-perf-20261019/`; disposable database port 55489. Fixture:
one synthetic company, five tasks, a disabled draft connector and a paused agent
with heartbeat disabled. Only this task's own preview/test processes were stopped.
Native PostgreSQL package symlinks were restored with its install hook.

Archive `ui/` and `announcements/` at the baseline revision, link the same installed
dependencies, and build from that UI directory with `PAPERCLIP_BUILD_COMMIT` set
to its full SHA. Save the two production builds in separate directories, then run:

```sh
PAPERCLIP_APPS_BENCH_BASELINE_DIST=/path/to/baseline-dist \
PAPERCLIP_APPS_BENCH_CANDIDATE_DIST=/path/to/candidate-dist \
PAPERCLIP_APPS_BENCH_SERVER_DIST=/path/to/server-checkout/ui/dist \
node scripts/benchmark-apps-startup.mjs comparison http://127.0.0.1:3214/ /tmp/apps-comparison
```

The harness rejects non-loopback targets, creates/reuses synthetic fixtures,
prepares both hashed asset sets in the static server directory, swaps only the
production HTML document and measures real asset/API traffic. It writes JSON
and screenshots. Do not run a build that clears server assets during it.
