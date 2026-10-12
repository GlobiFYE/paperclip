# Advisory report — final findings R-001–R-006

Implemented the six requested findings in this checkout only. Other prior
implementation changes remain intact. No commit, push, publication, deployment,
live-checkout/data edit, or test-home mutation occurred. This report is advisory;
independent host review and PostgreSQL proof remain necessary.

The supplied frozen plan hash was reverified:
`406feaab825de0496983e088866280a4a06304c67ff216e78324b89a28b26514`.

## Changes this round

- **R-001:** The route rejects task-bridge keys and requires an allowed
  `company_scope:read` decision before listing deliverables. Route tests cover
  denied low-trust agents, task-bridge keys, and an authorized board read.
- **R-002:** Candidate ordering puts new completions first, due work second,
  changed generated evidence third, and routine rechecks last. Timestamp probes
  avoid reloading unchanged issue/comment/product/attachment evidence every five
  minutes; a daily safety recheck also catches deletions without timestamp updates.
  A rate rejection leaves `checkedAt` untouched. Existing ten-candidate and
  five-HTTP-attempt limits remain. Added SQL/admission tests and a real-PostgreSQL
  regression with twelve older generated rows ahead of a due retry and late comment.
- **R-003:** Enabled nonterminal cards, including scheduled retries, poll every
  30 seconds. Disabled summaries poll every five minutes to discover credential
  recovery. Fake-timer tests cover recovery and pending/retry → generating →
  generated; terminal enabled cards stop polling. Both runbooks now agree.
- **R-004:** Completion attribution reads the actor of the latest recorded
  non-done → done transition, falling back to the assignee when no such record is
  available. Redundant done updates without a previous non-done status do not
  replace the actor. Verification excludes that actor, the current assignee, and
  historical agent assignees. Actor names are resolved through existing scoped
  lookups. Added agent/user/fallback/exclusion tests and PostgreSQL history coverage.
- **R-005:** Exported response schemas preserve `nextAttemptAt` and
  `summariesEnabled`; round-trip tests cover null and scheduled retry timestamps.
- **R-006:** Removed unused `completionVersion` from the application schema and
  fixtures. Since the host already ran migration 0295, that SQL and its snapshot
  were preserved. Generated forward migration **0297_easy_imperial_guard.sql**
  drops only `completion_version`; its snapshot and journal match the schema.
  No migration was applied here. Existing homes upgrade through normal migrations;
  no earlier snapshot was removed. The runbooks document this compatibility choice.

Files edited for these findings: `server/src/routes/companies.ts`,
`server/src/services/{deliverable-source,deliverable-summary,deliverables}.ts`,
`server/src/services/{deliverable-routes,deliverable-source,deliverable-summary,deliverables,deliverables.database}.test.ts`,
`packages/shared/src/{types,validators}/deliverable.ts`,
`packages/db/src/schema/issue_deliverables.ts`, migration 0297, its snapshot and
`meta/_journal.json`, `ui/src/pages/Deliverables{,.test}.tsx`,
`TEST-INSTANCE.md`, `DEPLOY-DELIVERABLES.md`, and this report.

## Agreed proof and results

Node **24.14.0**. The pinned pnpm download was already established as blocked in
this sandbox; selected the installed pnpm **10.10.0** on PATH and temporarily
added `manage-package-manager-versions=false` to `.npmrc` for nested scripts.
`.npmrc` was restored exactly afterward. The agreed command was then run:

```sh
export NVM_DIR=~/.nvm; . $NVM_DIR/nvm.sh; nvm use 24; pnpm -r typecheck
```

```text
Scope: 35 of 36 workspace projects
packages/shared typecheck: Done
packages/db typecheck: > tsx src/check-migration-numbering.ts && tsx src/check-migration-safety.ts
packages/db typecheck: Error: listen EPERM: operation not permitted .../tsx-501/68639.pipe
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @paperclipai/db@0.3.1 typecheck
Exit status 1
```

This is a sandbox IPC denial before the DB TypeScript compiler, not a passing
recursive typecheck. No approval escalation was requested or attempted.

Targeted commands used cached pnpm with
`npm_config_manage_package_manager_versions=false`:

```sh
pnpm --filter @paperclipai/server exec vitest run src/services/deliverable
# 5 test files passed, 1 skipped; 49 tests passed, 3 PostgreSQL tests skipped.
pnpm --filter ./ui exec vitest run src/api/deliverables src/components/Sidebar src/pages/Deliverables src/components/deliverables src/lib/company-routes
# 15 files passed; 202 tests passed before adding the extra timed-retry case.
pnpm --filter ./ui exec vitest run src/pages/Deliverables src/components/deliverables
# Final page tests: 1 file passed; 19 tests passed, including the new timed-retry case.
pnpm --filter @paperclipai/db exec vitest run src/migration-snapshot-drift.test.ts
# 1 file passed; 1 test passed.
```

Direct server/UI typechecks passed; shared typechecking passed in the recursive
run and DB compilation passed before generating 0297. Migration numbering and
safety passed using `node --import ./packages/db/node_modules/tsx/dist/loader.mjs`
to avoid the tsx CLI's IPC listener. `node scripts/check-token-gates.mjs` reported
all four gates clean. `git diff --check` passed. Existing Vite config-loader and
experimental SQLite warnings remain.

The full build/test suite was not rerun for this narrow round; previous-round
build results are historical below. The three real-PostgreSQL tests cannot run
in this sandbox and require the host. No live Gemini call, copied-instance
startup, migration of an existing home, or screenshot capture was performed here.
The host's earlier 3300 instance and screenshot evidence is not claimed as an
independent proof of this final patch. No product deviation is proposed; polling
follows the latest explicit host disposition. Cached pnpm and IPC-free checks
are disclosed tooling fallbacks, not substitutes for the blocked agreed proof.

## Complete current uncommitted file list

```text
 M packages/db/src/migrations/meta/_journal.json
 M packages/db/src/schema/issue_deliverables.ts
 M packages/shared/src/types/deliverable.ts
 M packages/shared/src/validators/deliverable.ts
 M scripts/link-cli-externals.mjs
 M server/src/__tests__/server-startup-feedback-export.test.ts
 M server/src/app.ts
 M server/src/index.ts
 M server/src/routes/agents.ts
 M server/src/routes/companies.ts
 M server/src/services/deliverable-summary.ts
 M server/src/services/deliverables.ts
 M server/src/services/plugin-host-services.ts
 M server/src/services/work-products.ts
 M ui/src/App.tsx
 M ui/src/api/deliverables.test.ts
 M ui/src/api/deliverables.ts
 M ui/src/components/Sidebar.test.tsx
 M ui/src/components/deliverables/DeliverableCard.tsx
 M ui/src/context/LiveUpdatesProvider.tsx
 M ui/src/lib/company-routes.test.ts
 M ui/src/lib/company-routes.ts
 M ui/src/pages/Deliverables.tsx
?? DELIVERABLES-REPORT.md
?? DEPLOY-DELIVERABLES.md
?? TEST-INSTANCE.md
?? packages/db/src/migrations/0295_thankful_gravity.sql
?? packages/db/src/migrations/0296_special_zuras.sql
?? packages/db/src/migrations/0297_easy_imperial_guard.sql
?? packages/db/src/migrations/meta/0295_snapshot.json
?? packages/db/src/migrations/meta/0296_snapshot.json
?? packages/db/src/migrations/meta/0297_snapshot.json
?? server/scripts/deliverables-test-instance.ts
?? server/src/services/deliverable-routes.test.ts
?? server/src/services/deliverable-source.test.ts
?? server/src/services/deliverable-source.ts
?? server/src/services/deliverable-startup.test.ts
?? server/src/services/deliverable-summary.test.ts
?? server/src/services/deliverables.database.test.ts
?? server/src/services/deliverables.test.ts
?? ui/src/pages/Deliverables.test.tsx
```

---

## Historical reports (superseded where the final findings above differ)

The following records describe earlier revisions and their proofs. In particular,
older statements about disabled/retry polling, migration counts, and test counts
are historical and do not describe the final patch.

# Advisory report — small final host-test fix

Only the two requested fixes and their UI regression were changed this round:

- `server/scripts/deliverables-test-instance.ts`: the no-run assertion checks
  `err.cause.message`, falling back to `err.message`, so Drizzle wrapping does not
  hide the PostgreSQL quarantine exception. Unrelated failures still fail proof.
- `ui/src/components/deliverables/DeliverableCard.tsx`: missing verifier renders
  exactly `Not yet verified`; a named verifier still renders `Verified by NAME`.
- `ui/src/pages/Deliverables.test.tsx`: tests both footer cases.
- `DELIVERABLES-REPORT.md`: this advisory update. Earlier implementation changes
  were left intact; their complete file list and historical proof follow below.

The frozen plan hash was verified again as
`406feaab825de0496983e088866280a4a06304c67ff216e78324b89a28b26514`.

## Requested proof — passed

Used the already installed pnpm 10.10.0 to avoid the previously established
network block fetching pinned pnpm 9.15.4. No repository configuration changed:

```sh
export PATH=/Users/clawd/Library/pnpm/.tools/pnpm/10.10.0/bin:$PATH
export npm_config_manage_package_manager_versions=false
export NVM_DIR=~/.nvm; . $NVM_DIR/nvm.sh; nvm use 24; pnpm --filter ./ui exec vitest run src/pages/Deliverables src/components/deliverables
```

```text
Now using node v24.14.0 (npm v11.9.0)
Test Files  1 passed (1)
     Tests  18 passed (18)
```

Exit 0. The existing Vite config-loader warning remains. The actual assertion
predicate was extracted from the helper and exercised without importing or
running its restore workflow: wrapped PostgreSQL error, plain error, unrelated
error and null all behaved correctly (4 checks passed). Token gates and
`git diff --check` passed.

## Boundaries and host evidence

No denied action occurred this round. The cached-pnpm selection above is the
only tooling deviation; there is no product deviation. No commit, push,
publication, live-checkout/data modification or operational runbook execution
occurred. The destructive/operational restore helper was not run by the builder.

Host-supplied evidence reports a quarantined instance on port 3300 with 30 cards,
`summariesEnabled: true`, summaries generating at the rate limit, and screenshots
under `A/evidence/`. This is attributed to the host and was not independently
reproduced here. The host should rerun the corrected helper to complete its
no-run assertion proof. This report remains advisory for independent review.

---

# Advisory implementation report — final fix round 2

Frozen plan SHA256 verified:
`406feaab825de0496983e088866280a4a06304c67ff216e78324b89a28b26514`.
All edits remain in this checkout, uncommitted. No commit, push, publication,
live-checkout/data edit, launchd change, deployment or Tailscale change occurred.
This report is advisory for the independent reviewer.

## Final findings

| Finding | Final implementation and regression evidence |
| --- | --- |
| R5-001 | Removed automatic 24-hour requeue from state reporting, claim logic and candidate SQL. Four exhausted attempts remain `failed_final`, with no nextAttemptAt. Config fingerprint changes or a new completion can recover. Both 403 and 503 tests advance 30 days without another request, then recover through an explicit config revision. |
| R5-002 | Added response-level `summariesEnabled`, using the same credential resolver as the worker without exposing credentials. The API client preserves the flag; any disabled loaded page stops polling. Fake-timer tests verify ten minutes with no refetch. Added nextAttemptAt to cards so retry polling waits for the scheduled deadline instead of refetching every 30 seconds during long backoff. |
| R5-003 | Stored text is never cleared or hidden on completion-key change. Unchanged evidence ignores redundant done timestamps and normalizes the saved completion key without a model request. Fingerprints include the latest recorded done → non-done activity event, allowing actual reopen/re-completion to change evidence even when task text is unchanged. GET reports stale old text before regeneration; the card keeps its updating label through generating/retry states. Tests cover unchanged done, genuine reopen, settling and a slow provider. Core issue PATCH code is unchanged. |
| R5-004 | Added `PAPERCLIP_ONLY_DELIVERABLE_SWEEP=1` and enabled it in TEST-INSTANCE.md. Gates app timers/startup jobs, server-entry-point sweeps, plugin log flushing and route-construction trace cleanup. The real createApp test proves exactly one interval (the summary sweep), no background DB queries, and summary ticks. The entry-point test verifies no timers/startup deliveries even with heartbeat/backups configured on. Normal startup tests also pass. |
| R5-005 | Negations are checked per sentence/clause; temporal words no longer reject affirmative past-tense verification. Both supplied examples pass. A separately bounded selection checks up to 24 verification candidates beyond the twelve recent summary comments. Verification-only candidates do not change model input/fingerprints. |
| R5-006 | Custom From/Through dates select the filtered-empty message and show Custom in the range control, with no incorrect All time selection. Tests cover either bound. |
| R5-007 | Deploy, code rollback and database restore all use bounded health waits (60 attempts, two-second request timeout and pauses). Restore explicitly moves the failed data directory to a timestamped path before copying the backup into the absent destination. Shell blocks pass syntax validation; none was executed. |

Previous accepted fixes remain: qualified correlated SQL, company-scoped listing,
settling, atomic leased claims, global five-attempt rate admission, bounded
candidate/evidence scans and repairs, stale GET, runtime reconciliation, routing,
filters, pagination and fallback rendering. No model call occurs on GET.

The earlier proposed deviations concerning redundant done updates and remaining
maintenance sweeps are superseded by the final host dispositions and these fixes.
No new product deviation is proposed. The fingerprint change may cause a bounded
refresh of summaries created by an earlier build; existing stored text remains
visible. The separate evidence-repair cap is not reset by provider configuration.

## Required proof

The exact command was run with Node **24.14.0**:

```sh
export NVM_DIR=~/.nvm; . $NVM_DIR/nvm.sh; nvm use 24; pnpm -r typecheck
```

Exit **1**, before typechecking, because the pinned package manager could not be
obtained/verified through the restricted network:

```text
[ERROR] Refusing to run pnpm@9.15.4: its npm registry signature could not be verified
(@pnpm/exe@9.15.4: fetch failed; @pnpm/macos-arm64@9.15.4: fetch failed; pnpm@9.15.4: fetch failed).
```

A second run selected cached pnpm 10.10.0 on PATH and temporarily disabled version
switching in `.npmrc`. It began checking 35 workspace projects, then exited **1**:

```text
packages/db typecheck: > tsx src/check-migration-numbering.ts && tsx src/check-migration-safety.ts
packages/db typecheck: Error: listen EPERM: operation not permitted .../tsx-501/34448.pipe
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @paperclipai/db@0.3.1 typecheck
Exit status 1
```

`.npmrc` was restored byte-for-byte. **The required recursive proof has not passed
in this sandbox.** No package-manager policy or dependency change remains.

## Successful checks

Exact commands, after selecting Node 24:

```sh
npm_config_manage_package_manager_versions=false /Users/clawd/Library/pnpm/.tools/pnpm/10.10.0/bin/pnpm --filter @paperclipai/server exec vitest run src/services/deliverable src/__tests__/server-startup-feedback-export.test.ts
# Test Files 5 passed | 1 skipped (6)
# Tests      62 passed | 2 skipped (64)

npm_config_manage_package_manager_versions=false /Users/clawd/Library/pnpm/.tools/pnpm/10.10.0/bin/pnpm --filter ./ui exec vitest run src/api/deliverables src/components/Sidebar src/pages/Deliverables src/lib/company-routes
# Test Files 15 passed (15)
# Tests      200 passed (200)

npm_config_manage_package_manager_versions=false /Users/clawd/Library/pnpm/.tools/pnpm/10.10.0/bin/pnpm --filter @paperclipai/db exec vitest run src/migration-snapshot-drift.test.ts
# Test Files 1 passed (1); Tests 1 passed (1)

node node_modules/typescript/bin/tsc --noEmit -p server/tsconfig.json
node ui/node_modules/typescript/bin/tsc -b ui/tsconfig.json

npm_config_manage_package_manager_versions=false /Users/clawd/Library/pnpm/.tools/pnpm/10.10.0/bin/pnpm check:token-gates
# All four gates CLEAN; All gates clean; cliplab character in sync

git diff --check
```

Shared typechecking also passed within the recursive run before its DB failure.
The PostgreSQL capability probe skips the real DB suite in this sandbox. Those
two host tests cover SQL/claims/stale reads/reopen history and microsecond cursor
pagination. Local emitted-SQL tests run, but do not replace real PostgreSQL proof.
The server-startup suite emits listener-count and experimental SQLite warnings;
UI tests emit the existing Vite config-loader warning.

## Build, migration and runbooks

Using the same cached-pnpm environment, UI and CLI builds passed:

```sh
pnpm --filter @paperclipai/ui build
pnpm --filter paperclipai build
node scripts/link-cli-externals.mjs
node --conditions=pantheon-dist cli/dist/index.js --version
# link-cli-externals: linked=0 already-present=14 unresolved=0
# 0.3.1
```

Server compilation/build-stamp also passed:

```sh
node node_modules/typescript/bin/tsc -p server/tsconfig.json
node server/scripts/write-build-stamp.mjs
```

`cli/dist/index.js`, `server/dist/index.js` and `ui/dist/index.html` exist. UI build
warnings concern existing large chunks and mixed static/dynamic imports. The full
recursive build and full repository test suite were blocked in the preceding
round by the same tsx IPC denial at preflight; they are not claimed passing.

No migration was needed for this final fix round. Prior additive migrations
0295/0296, their generated snapshots, original 0294 and earlier snapshots remain
unchanged. Snapshot/schema drift validation passed again. No snapshot was removed.
The host restore helper was previously typechecked; it was not executed here.

TEST-INSTANCE.md retains database quarantine and run-admission guards in addition
to the new sweep-only switch. DEPLOY-DELIVERABLES.md contains host-only deployment,
backup, health verification and rollback commands. Every shell block in both
runbooks passed `sh -n` without executing the operational commands.

## Blocked actions and deviations

- Pinned-pnpm network resolution was blocked; cached pnpm 10.10.0 is the disclosed
  tooling fallback. Temporary `.npmrc` edits were restored.
- Sandbox denied tsx IPC socket creation; embedded PostgreSQL is unavailable to
  the test capability probe. No approval escalation was requested.
- Copied-DB startup, real Gemini summaries, no-agent-run quarantine proof and
  desktop/390px screenshots remain host-only. None is claimed here.
- No live data, live checkout, outside-worktree test home or external service was
  modified. No operational runbook command was executed.
- There are no remaining self-approved product deviations from the final host
  dispositions. The complete recursive typecheck/build and real DB/runtime proof
  remain outstanding environment-dependent acceptance checks.

## Files changed (complete uncommitted change set)

- `packages/db/src/migrations/meta/_journal.json`
- `packages/db/src/schema/issue_deliverables.ts`
- `packages/shared/src/types/deliverable.ts`
- `packages/shared/src/validators/deliverable.ts`
- `scripts/link-cli-externals.mjs`
- `server/src/__tests__/server-startup-feedback-export.test.ts`
- `server/src/app.ts`
- `server/src/index.ts`
- `server/src/routes/agents.ts`
- `server/src/services/deliverable-summary.ts`
- `server/src/services/deliverables.ts`
- `server/src/services/plugin-host-services.ts`
- `server/src/services/work-products.ts`
- `ui/src/App.tsx`
- `ui/src/api/deliverables.test.ts`
- `ui/src/api/deliverables.ts`
- `ui/src/components/Sidebar.test.tsx`
- `ui/src/components/deliverables/DeliverableCard.tsx`
- `ui/src/context/LiveUpdatesProvider.tsx`
- `ui/src/lib/company-routes.test.ts`
- `ui/src/lib/company-routes.ts`
- `ui/src/pages/Deliverables.tsx`
- `DELIVERABLES-REPORT.md`
- `DEPLOY-DELIVERABLES.md`
- `TEST-INSTANCE.md`
- `packages/db/src/migrations/0295_thankful_gravity.sql`
- `packages/db/src/migrations/0296_special_zuras.sql`
- `packages/db/src/migrations/meta/0295_snapshot.json`
- `packages/db/src/migrations/meta/0296_snapshot.json`
- `server/scripts/deliverables-test-instance.ts`
- `server/src/services/deliverable-source.test.ts`
- `server/src/services/deliverable-source.ts`
- `server/src/services/deliverable-startup.test.ts`
- `server/src/services/deliverable-summary.test.ts`
- `server/src/services/deliverables.database.test.ts`
- `server/src/services/deliverables.test.ts`
- `ui/src/pages/Deliverables.test.tsx`

Generated build output is ignored by git. Current logs are in
`/tmp/deliverables-round2-*.log`; essential results are reproduced above.
