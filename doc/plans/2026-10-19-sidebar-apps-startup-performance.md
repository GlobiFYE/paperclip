# Sidebar and Apps startup performance

Outcome: one tested, reviewable PR and running isolated local preview. Preserve
sidebar accuracy, account isolation, loading layout and recovery. No merge or staging deployment.

Baseline: `0ed760ce9a`; branch: `codex/sidebar-apps-startup-performance`.
Worktree: `/Users/dotta/.codex/worktrees/9f9c/paperclip`.

## Acceptance

| Path | Required evidence |
| --- | --- |
| Five saved recent tasks | One summary batch per refresh; no passive detail/workspace/Git work |
| Empty, legacy and cross-tab history | Migration, monotonic versions, bounded order and no write loop |
| Missing/private/foreign tasks | Real database authorization; successful omission prunes only requested IDs |
| Failed reads and account changes | Retain snapshots on failure; isolate requests and response application |
| Rename/archive/pause/restart | Existing actions work and persisted results survive reload |
| Startup/socket recovery | Independent gates overlap; initial auth/health duplication removed; catch-up retained |
| Apps | Same loading layout; five cold and five in-app production-build samples per revision |

## State

- Dependencies installed in this worktree; baseline UI source retained in `/tmp/paperclip-apps-perf-20261019/ui`.
- Summary contract and bounded server projection in progress.
- Next: finish baseline instance and measurements; implement client and startup changes.
- Required before handoff: focused tests, browser acceptance, maps/token checks,
  repository typecheck/test/build, PR template, review and latest-head checks.

Route splitting remains owned by the separate issue-page performance effort.
