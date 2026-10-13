# Decisions: Confirm all

Implemented against frozen Plan G on 2026-10-12. The button uses the current
filtered active desk, including rows below the incremental rendering window.
Snoozed, dismissed, archived and aging shelves are excluded. Full approvals and
issue interactions are loaded before planning, with one interaction request per
issue and at most four concurrent reads. A failed read makes that item ineligible.

The dialog freezes the planner's actions and individually required items when it
opens. Every write re-reads the full record and compares its fingerprint. Writes
are sequential, failures do not stop later items, and the final counts stay on the
Decisions page. Existing endpoints do not accept an expected record version, so
the read/write race cannot be eliminated by this UI change.

## Eligibility and deviations from the requested scope

- Only pending `hire_agent` approvals qualify among approvals.
- `DecisionOption.style = "default"` is presentation, not a recommended answer.
  Ordinary decision options have no recommendation/default-answer flag and stay
  individual. The decision question format is unchanged.
- Recovered `ask_user_questions.payload.questionSet` does preserve explicit
  `options[].recommended` flags. Every stored question must match that canonical
  presentation and have a recommendation. A single choice requires exactly one
  flag; multiple choices use the explicitly flagged set. These question schemas
  have no min/max selection fields. Free-text answers, missing recommendations,
  mismatched presentations and ambiguous single choices are excluded. Legacy
  questions without `questionSet` stay individual. Answers must also fit the
  existing respond endpoint's limit of 20 questions.
- **Confirmation target allowlist: `owner_decision`.** The host follow-up
  designates `request_confirmation` with
  `target: { type: "custom", key: "owner_decision" }` as simple owner yes/no
  input. Pending records with this target qualify only when the server's
  raw-payload classification also permits bulk confirmation.
  The preview shows the prompt and accept label (or "Confirm"); execution uses
  `issuesApi.acceptInteraction`, the same endpoint as the single-item control,
  and requires an `accepted` response. This key is an agent-supplied convention,
  not a server-enforced classification of the question's meaning. Per the R3
  host disposition, the company skill now instructs agents to use exactly this
  target for owner yes/no questions. This is host-provided operational context;
  the company skill is not a creator in this checkout. Eligibility explicitly
  requires `target.type === "custom"`, and the regression validates an owner
  payload with the shared creation schema. Existing governed/review exclusions
  still apply even when an agent supplies the owner key.
- Checkbox confirmations remain individual, including ones with the owner key:
  the host follow-up authorizes only the plain confirmation kind. Unknown keys,
  untargeted cards and all document/review targets remain excluded. Untargeted
  cards can carry merge consent and are not a safe substitute.

## Confirmation creator audit

All source paths are relative to this checkout. Searches covered both literal
confirmation kinds and the dynamic interaction creation entry points in
`server/src`. Read, resolution, publication, continuation and hydration sites do
not establish additional safe creation subtypes.

| Creator or consumer | Target key / payload | Disposition |
| --- | --- | --- |
| `services/tool-gateway.ts`, tool-action creation | `tool-action:<id>`; `toolAction` | Governed tool execution; excluded |
| `services/tool-gateway.ts`, user authorization creation/reopening | `connection:<uid>:user:<id>` | Connection authorization; excluded even without enrichment |
| `services/tool-access.ts`, OAuth interaction creation/reopening | `connection:<uid>:user:<id>` | Connection authorization; excluded |
| `services/secret-proposals.ts`, secret-binding creation | `secretProposal` (no target required) | Governed secret binding; excluded |
| `services/native-runtime/status-decision-committer.ts`, `bind_reviewer` | `native_completion_review` | Completion review verdict; excluded |
| `services/native-runtime/native-session-executor.ts`, provider plan synchronization | `issue_document` / `plan` | Plan review; excluded |
| `services/native-runtime/paperclip-runner-tool-authority.ts`, `request_human_input` | Caller-supplied target, or inferred `issue_document` / `plan`; supports both confirmation kinds | Only plain `custom` / `owner_decision` eligible |
| `routes/issues.ts`, POST interactions | Caller-supplied target or none; both confirmation kinds | Only plain `custom` / `owner_decision` eligible |
| `services/plugin-host-services.ts`, `createInteraction` | Plugin-supplied interaction | Same full-record validation and owner target requirement |
| `services/issue-thread-interactions.ts`, `create` | Validates/inserts generic inputs above; both confirmation kinds | Preserves custom target keys; no additional safe subtype |
| `services/issue-review-policy.ts`, `isIssueReviewVerdictInteraction`; `services/issue-thread-interactions.ts`, `assertRequestConfirmationResolutionAllowedUnderLock` | Target-independent review binding on `in_review`: explicit interaction ID, legacy requester match, or unattributed confirmation | Both confirmation kinds governed for every `in_review` parent |
| `routes/issues.ts`, review transition `reviewInteractionId` and `resolvePendingReviewInteractionRestriction` | Agents/users can bind their pending non-tool confirmation, including an owner target, as a review verdict | Parent status gate excludes this even with the `anyone` review policy |

Other governed uses reinforce why generic cards cannot be allowlisted:
`services/issue-thread-interactions.ts` recognizes merge consent from confirmation
prose/PR references, including cards without a target. `services/change-consent-gate.ts`
consumes confirmations for `agent:<id>:instructions`, `agent:<id>:profile`,
`skill:<id>`, `skills:import:<source>`, `skills:scan-projects` and their legacy
`reflection-coach:*` aliases. These are mutation consent, not simple yes/no input.
The onboarding and agent-conversation instructions also create revision-bound
`plan` reviews through the generic APIs.

The server now computes `bulkEligibility: { ownerDecision, governed, unknownKeys }`
in `hydrateInteraction`, from the raw stored payload before the normal read
schema strips unknown keys. `governed` detects `toolAction`, `secretProposal`,
`connectionAuthorization` and `effectiveResolverPolicySource = governed_action`.
Strict checks detect unknown top-level and custom-target keys, including future
review-verdict markers. The client requires `ownerDecision === true`,
`governed === false`, and `unknownKeys === false` for owner confirmations;
question cards also require the raw-row `governed === false` classification.
Provider-consent questions with IDs starting `connection-provider:` are governed
even without a payload marker or with an explicitly recommended answer.
Both confirmation kinds require parent status `todo`, `in_progress` or `blocked`
and work mode `standard` or `ask`; every other combination, including missing
context, is governed. Plan-document confirmations are governed in every mode
because acceptance can request plan continuation. Checkbox confirmations remain
excluded by the existing kind allowlist even in the permitted parent states.
Missing/incomplete classification from older servers fails closed. Its own
strict schemas are defense in depth only: they cannot inspect metadata already
stripped by the API. Unknown target keys and untargeted confirmations are excluded.
Native completion reviews use `target.key = native_completion_review`, and plan
reviews use `target.type = issue_document`; neither passes the owner allowlist.

## Host follow-up: custom target persistence

No server creation change is needed. `packages/shared/src/validators/issue.ts` defines
`requestConfirmationCustomTargetSchema.key` as a nonempty string, not an enum.
The REST creation route (`POST /api/issues/:id/interactions` in
`server/src/routes/issues.ts`) validates with `createIssueThreadInteractionSchema`
and passes the payload to the interaction service. In
`server/src/services/issue-thread-interactions.ts`, `create` parses the input,
validates current revisions only for `issue_document` targets, and inserts
`payload: data.payload`. `hydrateInteraction` parses the same schema on reads.
Thus `owner_decision` is accepted, stored and returned unchanged.

The native runner's `request_human_input` path also preserves a supplied custom
target. It infers a planning target only when no target was supplied, and adds
revision/issue fields only to `issue_document` targets. Neither path rewrites
`custom` / `owner_decision`. The UI regression checks the shared creation schema
with this payload as well as eligibility, exclusions and acceptance submission.
The persistence conclusion is based on source inspection; no live database
write was performed for this follow-up.

## Question controls and verification

Single-choice questions and decisions use native radio inputs. Multi-choice
questions retain checkboxes, and free-text choices retain their text inputs.
Explicit recovered recommendation flags are labeled “Recommended”; no flag is
inferred from an option's position or wording. Decisions require “Confirm choice”
after selection; destructive choices retain their separate typed confirmation.

Focused verification files:

- `ui/src/lib/bulk-confirm.test.ts`
- `ui/src/components/BulkConfirm.test.tsx` (Testing Library via existing `storybook/test`)
- `ui/src/components/DecisionCard.test.tsx`
- `ui/src/components/DecisionResolver.test.tsx`
- `ui/src/components/IssueThreadInteractionCard.test.tsx`
- `ui/src/pages/WhatNeedsMe.test.tsx`
- `ui/src/pages/WhatNeedsMe.bulk-confirm.test.tsx` (real page and bulk control;
  filters, hidden shelves and unchanged feed refresh)
- `ui/src/components/task-chat/TaskChatInteractionCard.test.tsx`

No new dependencies or database migrations are required. R4 adds read-only
server metadata and its shared TypeScript contract; creation schemas and
authorization on the submission endpoints are unchanged.

Build 1 verification: all seven focused suites passed (141 tests), the
UI typecheck passed, and `pnpm check:token-gates` passed. These used Node 24.14.0
and cached pnpm 10.10.0 with a temporary user configuration disabling automatic
package-manager switching; no repository configuration was changed. The exact
requested `pnpm -r typecheck` was attempted first but could not fetch/verify the
pinned pnpm 9.15.4. The cached-manager retry reached the database migration check
and stopped at a sandbox-denied `tsx` IPC socket (`listen EPERM`). Workspace-wide
typecheck is therefore **not proven**. A browser layout check at 390 px was not
run; keyboard radio selection, modal cancellation/focus restoration and the
scrollable token-based dialog are covered by the implementation and DOM tests.

Host follow-up verification (2026-10-12):

- The agreed command, `pnpm --filter ./ui exec vitest run src/components/BulkConfirm src/pages`,
  passed: **135 files, 1,547 tests**. After the last test refinements,
  `pnpm --filter ./ui exec vitest run src/lib/bulk-confirm.test.ts src/components/BulkConfirm.test.tsx`
  passed: **2 files, 52 tests**.
- `pnpm --filter ./ui typecheck`, `pnpm check:token-gates` and
  `git diff --check` passed.
- Node was **24.14.0**. The unchanged requested proof/typecheck commands were
  attempted first; the installed launcher refused pnpm 9.15.4 after registry
  fetch/signature verification failed. A cached-manager version-switch attempt
  also hit a sandbox-denied installation directory. Successful checks used
  cached **pnpm 10.10.0**, with `manage-package-manager-versions=false` in a
  temporary user config outside the repository.
- The cached-manager `pnpm -r typecheck` retry stopped at
  `packages/db`'s migration check: `tsx` could not listen on its IPC socket
  (`EPERM`). This local attempt did not prove full workspace typecheck. The R3
  host disposition subsequently reports that `pnpm -r typecheck` passed in the
  host environment; that result is host-reported, not independently rerun here.
- No production server/schema code, question recommendation logic, dependencies
  or company skills changed. No commit, push, publication, live database test,
  full build or browser viewport check was performed.

## R3 review fixes

- Human requesters use the existing company user directory and label-map helper.
  Entries with neither a name nor an email are omitted so the bulk dialog falls
  back to "a teammate", never a raw or shortened user ID. The current user is
  labeled "You".
- Individual-answer links close the dialog, expand/select the corresponding
  Decisions row, extend the incremental rendering window if needed, and focus
  and scroll to it. They do not change routes or reload the page. Links are
  disabled while submissions run.
- Hydration omits the volatile feed timestamp. R5 further caches individual
  approval/issue reads by version and preserves visible placeholder data while
  the desk query updates (see below). Known unsupported
  approval/interaction metadata avoids needless reads; metadata never establishes
  eligibility, and missing metadata still triggers full hydration.
- Unmount (including a company switch) aborts the run. The sequential executor
  checks cancellation before each item and again after its revalidation read,
  before writing. An already-submitted request may finish; later items are not
  submitted. Aborted components receive no state updates. The final cache update
  marks data stale without initiating refetches, so an in-flight write's result
  is reflected on the next visit.
- Page-level regression coverage now verifies filter-dependent counts and
  snoozed/dismissed/aging exclusions; it also proves that changing only the feed
  timestamp does not rehydrate the desk.

R3 final proof (2026-10-12):

```text
pnpm --filter ./ui exec vitest run src/components/BulkConfirm src/lib/bulk-confirm src/pages
Test Files  137 passed (137)
     Tests  1601 passed (1601)
  Duration  33.14s
```

The UI typecheck, token gates and whitespace check also passed. The proof used
Node 24.14.0 and cached pnpm 10.10.0 with the previously described temporary user
configuration; repository package-manager settings were unchanged. Existing
jsdom unimplemented-browser-API notices and the Vite config-loader warning were
non-failing. No new denied actions occurred in this round. Full typecheck was
not repeated after the host reported its pass; no build or real-browser viewport
check was run. No commit, push or publication was performed.

## R4 review fixes

- The raw-payload eligibility calculation lives in
  `server/src/services/interaction-bulk-eligibility.ts` and is invoked before
  parsing on every interaction hydration, including `listForIssue`. The flags
  cannot be supplied through creation input. Server tests exercise the actual
  hydration function, proving that excluded keys disappear from the returned
  payload while the exclusion survives in `bulkEligibility`. UI tests also
  pass fixtures through the real shared read schema before checking eligibility.
- Each dialog entry with supporting material has a native, keyboard-accessible
  collapsed details section. It renders confirmation `detailsMarkdown`, question
  context/help text, and all option descriptions using the existing MarkdownBody.
  These details are part of the frozen snapshot.
- Interaction hydration and submission revalidation receive the current user.
  An addressed-user mismatch, a creator excluded by `not_creator`, unknown
  resolver policy, or unknown identity for an identity-dependent restriction
  makes an item individual. Human overrides of agent addressees remain allowed,
  matching the server. User identity is also part of the hydration cache key.
  Server authorization remains final and may still reject a changed policy.
- Decision radios now use their wrapping labels for accessible names, preserving
  descriptions, effect summaries and stale badges.
- A missing record in an otherwise successful hydration response contributes to
  `unavailableIds`. Known ineligible records do not. Individual-answer and
  unavailable-item notices distinguish singular from plural.

Additional R4 test file: `server/src/__tests__/interaction-bulk-eligibility.test.ts`.

R4 final verification (2026-10-12):

```text
pnpm --filter ./ui exec vitest run src/components/BulkConfirm src/lib/bulk-confirm src/pages
Test Files  137 passed (137)
     Tests  1615 passed (1615)
  Duration  35.46s

pnpm --filter ./server exec vitest run src/__tests__/interaction-bulk-eligibility.test.ts
Test Files  1 passed (1)
     Tests  15 passed (15)

pnpm --filter ./ui exec vitest run src/components/DecisionCard.test.tsx src/components/DecisionResolver.test.tsx
Test Files  2 passed (2)
     Tests  18 passed (18)
```

UI and shared package typechecks, server `tsc --noEmit`, token gates and
`git diff --check` passed. The workspace-wide `pnpm -r typecheck` was attempted
again because R4 changes the server/shared contract. It stopped at the database
migration check's sandbox-denied `tsx` IPC socket (`listen EPERM`), so the prior
host pass is not claimed as proof for this revised tree. The host should rerun
the full check. Checks used Node 24.14.0 and cached pnpm 10.10.0 with the same
temporary user configuration described above. No build, live database or
real-browser viewport check was performed; server tests exercise real hydration
in memory. No commit, push or publication was performed.

## R5 final review fixes

- Approval reads are cached by company, current user, approval ID and update
  time; interaction reads by company, current user, issue ID and the maximum
  update time of its visible items. The existing four-read concurrency bound
  remains. Generic attention invalidation, focus refreshes, filters and
  optimistic hides reuse unchanged records. These record caches live outside
  the attention invalidation prefix. Updated versions cause fresh reads.
- The desk query keeps previous data while rechecking, filtered against current
  visible IDs so hidden items cannot remain in the count. The existing button
  stays mounted when at least two eligible visible items remain, and is disabled
  during rechecks. Each submission still performs an uncached read and compares
  the frozen fingerprint; completion invalidates the snapshot's record caches
  before attention refresh, leaving unrelated caches intact.
- Question eligibility now requires server `bulkEligibility.governed === false`.
  Tests cover actual server hydration of raw question rows carrying each governed
  marker and client validation after the shared read schema strips those markers.
  Missing server classification fails closed. Unknown-key classification remains
  confirmation-specific; recommendation and resolver checks still apply to questions.
- A first-class free-text option no longer autofocuses its textarea when selected
  by radio arrow keys. Arrows continue through the group, and Tab reaches the
  textarea. The card regression exercises both. Its existing connection-setup
  test now isolates the child setup flow and waits for its asynchronous rendering,
  fixing an unrelated stale test mock exposed by running the full card suite.
- The real page regression verifies filter and optimistic-dismiss transitions
  preserve the same button element without additional unchanged approval reads.
  A hydration test verifies per-issue reuse and that only a changed issue rereads.

R5 verification (2026-10-12):

```text
pnpm --filter ./ui exec vitest run src/components/BulkConfirm src/lib/bulk-confirm src/pages
Test Files  137 passed (137)
     Tests  1622 passed (1622)
  Duration  28.42s

pnpm --filter ./ui exec vitest run src/components/IssueThreadInteractionCard.test.tsx
Test Files  1 passed (1)
     Tests  69 passed (69)

pnpm --filter ./server exec vitest run src/__tests__/interaction-bulk-eligibility.test.ts
Test Files  1 passed (1)
     Tests  18 passed (18)
```

UI typecheck, token gates and `git diff --check` passed. The host explicitly owns
the full `pnpm -r typecheck` and existing server interaction service/route suites
after this round; their results are pending, not claimed as local passes. A
390 px browser check was attempted, but installed Chrome aborted during launch
(`SIGABRT`; Playwright cleanup also reported `kill EPERM`), so no viewport result
is available. A host browser check remains required before merging. No full
build or live database check was run for these focused fixes.

Checks used Node 24.14.0 and cached pnpm 10.10.0 with the temporary user config
described above, without repository package-manager changes. The agreed proof
emitted only non-failing Vite/jsdom browser-API notices. No functional deviation
from the R5 dispositions was needed. No commit, push or publication occurred.

Files changed in R5 (earlier uncommitted R3/R4 changes remain in this checkout):

- `ui/src/components/BulkConfirm.tsx`
- `ui/src/components/BulkConfirm.test.tsx`
- `ui/src/components/IssueThreadInteractionCard.tsx`
- `ui/src/components/IssueThreadInteractionCard.test.tsx`
- `ui/src/fixtures/bulkConfirmFixtures.ts`
- `ui/src/lib/bulk-confirm-api.ts`
- `ui/src/lib/bulk-confirm.ts`
- `ui/src/lib/bulk-confirm.test.ts`
- `ui/src/pages/WhatNeedsMe.bulk-confirm.test.tsx`
- `server/src/__tests__/interaction-bulk-eligibility.test.ts`
- `doc/design/CONFIRM-ALL.md`

## R6 final review fixes

- `connection-intents.ts` consumes saved human answers to `connection-provider:<service>`
  questions in `providerSelections`, `selectedProvider` and `requestWithContext`.
  These answers authorize an external provider route. The raw-row classifier now
  marks any `ask_user_questions` payload containing that prefix as governed,
  checking both `questions` and `questionSet.questions` before parsing. Client
  recommendation planning independently rejects the prefix in either representation,
  including when an older server incorrectly reports `governed: false`.
- The question-consumer audit searched `server/src` for question ID lookups,
  question results, consent and authorization. No additional consent-specific
  question ID was found. Chat forms, native question bridges, response delivery
  and execution continuation transport generic answers; onboarding and native
  attention questions do not establish another consent-specific ID. Existing
  confirmation consent gates remain covered by the previous creator audit.
- Server regressions hydrate a provider question built by the shared question
  creator with a matching recommended `questionSet`, and cover raw IDs in either
  representation. UI regressions parse that same shape with the shared read schema
  and exclude it with either value of the server governed flag. Normal recommended
  questions remain eligible.
- Post-run invalidation now includes `["issues", "approvals"]`. Regressions cover
  normal completion and `refetchType: "none"` after an aborted run.

R6 agreed proof (2026-10-12):

```text
pnpm --filter ./ui exec vitest run src/components/BulkConfirm src/lib/bulk-confirm
Test Files  2 passed (2)
     Tests  82 passed (82)
  Duration  4.70s

pnpm --filter ./server exec vitest run src/__tests__/interaction-bulk-eligibility.test.ts
Test Files  1 passed (1)
     Tests  21 passed (21)
```

UI typecheck, server `tsc --noEmit` and token gates passed. The host reports full
`pnpm -r typecheck` exit 0 and 99 server interaction tests passed on the R5 tree,
and will repeat those checks after R6. That prior result is host-reported and does
not prove this revised tree. The previously documented local IPC restriction and
Chrome launch failure remain unresolved; no new 390 px result is claimed. A host
check of both the Decisions page and Confirm dialog at 390 px remains required.

The requested existing server suites were also attempted locally:
`issue-thread-interactions-service`, `issue-thread-interaction-routes`,
`attention-service` and `secret-proposals-routes` (all under `server/src/__tests__`).
The command exited 1: **1 file failed, 3 skipped; 84 tests failed, 141 skipped**.
The route suite could not open Supertest's HTTP listener: `listen EPERM:
operation not permitted 0.0.0.0` at `setup-supertest.ts:46`. These are blocked
checks, not a passing regression run. The other three suites skipped because
their embedded-Postgres support probe returned unsupported. Host execution with permitted sockets and
the test database remains necessary; no permission escalation was attempted.

This round changes seven files: `server/src/services/interaction-bulk-eligibility.ts`,
`server/src/__tests__/interaction-bulk-eligibility.test.ts`,
`ui/src/lib/bulk-confirm.ts`, `ui/src/lib/bulk-confirm.test.ts`,
`ui/src/components/BulkConfirm.tsx`, `ui/src/components/BulkConfirm.test.tsx`,
and this document. Earlier uncommitted changes remain. Checks use Node 24.14.0
and the previously documented cached pnpm 10.10.0 workaround. No functional
deviation, commit, push or publication occurred. No full build was run.

## R7 review fixes and accepted-plan consumer audit

`server/src/services/heartbeat.ts` has two key-agnostic consumers of accepted
confirmations on planning issues. The `acceptedPlanContinuation` condition in
task instruction rendering can emit "Implement the accepted plan on this issue".
The `acceptedPlanContinuationWake` condition can invoke
`resolveAcceptedPlanWakeRoutingDecision`, force a fresh session, or suppress a
continuation. Neither condition requires a plan target; therefore even an
`owner_decision` confirmation on a planning issue must remain individual.
Additionally, `server/src/routes/issues.ts` uses a document target with key `plan`
to emit `workspaceRefreshReason: accepted_plan_confirmation`, another input to
those heartbeat paths. These consumers supplement the earlier creator audit.

- `listForIssue` now selects the parent issue's `workMode` with its status and
  passes it through hydration to the raw-row eligibility classifier.
  `request_confirmation` records are marked `governed: true` for planning mode,
  missing/unknown parent mode, or an `issue_document` / `plan` target. Other
  hydration entry points without parent context conservatively mark confirmations
  governed; the bulk planner uses `listForIssue`, which supplies current context.
  Existing client checks reject these records without a new API field.
- Submission revalidation uses an uncached `listInteractions` read, so a later
  switch into planning mode yields a changed/skipped item with no acceptance
  request. The server regression exercises the actual `listForIssue` method with
  a mocked database projection and a mode change; hydration tests cover planning,
  missing/unknown mode, known non-planning modes, and plan-document targets.
  UI tests cover individual display and the skipped submission. The existing
  non-atomic read/write race remains; no heartbeat or acceptance semantics changed.
- The individual-answer notice and list render only when at least one visible
  item is excluded. The all-eligible dialog regression checks both are absent.

R7 verification (2026-10-12):

```text
pnpm --filter ./ui exec vitest run src/components/BulkConfirm src/lib/bulk-confirm
Test Files  2 passed (2)
     Tests  84 passed (84)
  Duration  4.30s

pnpm --filter ./server exec vitest run src/__tests__/interaction-bulk-eligibility.test.ts src/services/issue-thread-interactions.test.ts
Test Files  2 passed (2)
     Tests  43 passed (43)
```

The proof files are `ui/src/components/BulkConfirm.test.tsx` and
`ui/src/lib/bulk-confirm.test.ts`. UI typecheck, server `tsc --noEmit`, token gates
and `git diff --check` passed. The server check caught three direct `map`
callbacks needing explicit row forwarding after hydration gained the optional
work-mode argument; those were fixed and both the server typecheck and focused
server tests passed on rerun. Checks use Node 24.14.0 and the previously
documented cached pnpm 10.10.0 workaround. Full workspace typecheck, database/HTTP
server suites, full build and the 390 px browser check were not repeated locally;
their prior environment limitations and host verification status above still
apply. No new denied actions or functional deviations occurred. No commit, push
or publication was performed.

R7 changes seven files: `server/src/services/interaction-bulk-eligibility.ts`,
`server/src/services/issue-thread-interactions.ts`,
`server/src/__tests__/interaction-bulk-eligibility.test.ts`,
`ui/src/components/BulkConfirm.tsx`, `ui/src/components/BulkConfirm.test.tsx`,
`ui/src/lib/bulk-confirm.test.ts`, and this document. Earlier uncommitted changes
remain in the checkout.

## R8 review-verdict parent restrictions

The host disposition narrows confirmation eligibility to parent status `todo`,
`in_progress` or `blocked` combined with work mode `standard` or `ask`. The raw
server classifier now marks both `request_confirmation` and
`request_checkbox_confirmation` governed outside those combinations. This
supersedes R7's allowance of `skill_test` and its work-mode-only check. Missing
or unknown parent status/mode also fails closed. Existing governed markers,
provider-consent and plan-target exclusions remain in force.

`listForIssue` now passes both selected parent fields through `hydrateInteraction`;
no additional query or API field is needed. The client already excludes any
server-governed record. Its uncached read before submission sees a parent moving
into `in_review` and skips that confirmation without submitting an acceptance.
The existing read/write race remains because the submission endpoint has no
record-version precondition.

The consumer audit table now includes explicit `reviewInteractionId` binding,
legacy requester matching and unattributed review confirmations. Server tests
exercise the real `isIssueReviewVerdictInteraction` with mocked persisted
transition rows for agent/user explicit and legacy bindings, then verify owner
confirmation hydration is governed under an `in_review` parent. Additional tests
cover every declared issue status, missing/unknown context, both confirmation
kinds, and `listForIssue` re-reading a parent status change. The UI revalidation
regression verifies that changed review status produces a skip with no acceptance.

R8 verification (2026-10-12):

```text
pnpm --filter ./ui exec vitest run src/components/BulkConfirm src/lib/bulk-confirm
Test Files  2 passed (2)
     Tests  85 passed (85)
  Duration  5.25s

pnpm --filter ./server exec vitest run src/__tests__/interaction-bulk-eligibility.test.ts src/services/issue-thread-interactions.test.ts
Test Files  2 passed (2)
     Tests  52 passed (52)
```

UI typecheck, server `tsc --noEmit` and `git diff --check` passed. No new denied/blocked actions
occurred. Full workspace typecheck, database/HTTP suites, full build and the
390 px browser check were not repeated; the earlier documented environment
limitations and outstanding host checks remain. Checks use Node 24.14.0 and
cached pnpm 10.10.0 with the same temporary user configuration. No functional
deviation from the R8 disposition, commit, push or publication occurred.

R8 changes five files: `server/src/services/interaction-bulk-eligibility.ts`,
`server/src/services/issue-thread-interactions.ts`,
`server/src/__tests__/interaction-bulk-eligibility.test.ts`,
`ui/src/lib/bulk-confirm.test.ts`, and this document. Earlier uncommitted changes
remain in the checkout.

## Plan I: simple Decisions tabs and Hiring

The Decisions page now offers Hiring, Yes / No, Questions, Needs a closer look,
and All. Tab counts use the active desk (the same dismissal and aging boundary
as G), and `?tab=` preserves the selected view. Without a saved tab, the first
nonempty Hiring, Yes / No, or Questions category opens after hydration; otherwise
Needs a closer look opens. Decision deep links retain the All resolver.

Full-record loading, individual classification (`classifyDecision`), and G's bulk
planner are separate. The shared loader also reads standalone decisions. Only
plain options with no effects, inputs, destructive style, unknown fields, special
metadata, or target snapshots use the question flow. Unknown or unavailable
records keep their full resolver. Governed interactions and requests above the
existing 20-answer endpoint limit also keep their full controls.

Hiring and Yes / No reuse G's frozen snapshot dialog, restricted to their own
category. The Hiring page shares the Hiring-tab rows and dialog. No uses the
existing reject interaction endpoint; `rejectRequiresReason` opens a required
one-line reason field. No server endpoint or response limit changes are needed.

Questions are answered one interaction at a time. Single-choice clicks submit
immediately for single-question interactions. Multi-question requests keep a
local draft and submit the complete response only on the final question. Custom
answers open a focused text field; multi-select uses Done. Skip leaves the whole
interaction unanswered, Back revisits unfinished drafts, and leaving the page
or tab discards those drafts as disclosed on the card. Number shortcuts choose
options; S skips; arrows browse draft questions and pending interactions. Errors
stay on the current card. The card moves focus and announces its new content,
with token-based motion honoring reduced-motion settings.

The existing company-prefixed Hiring route, unprefixed redirect and sidebar
badge are retained. Recently hired defaults to 30 days with 7/30/90-day filters,
includes only active/idle/running/paused/error agents, and excludes agents linked
to rejected hire approvals. Rows wrap at narrow widths and show names instead of
internal IDs.


### Plan I inspection 1 fixes

The plain-choice allowlist accepts `signedSpec`, the opaque server signature
included in `outcome()` alongside every decisions-table field and `executions`.
The response fixture now includes that field; unknown execution fields still
keep decisions in the full resolver. Consuming a decision deep link writes
`tab=all` in the same URL update that removes `decisionId`, preserving the
expanded resolver while individual-record hydration finishes. Generic auto-expand
defers to a pending deep link, so it cannot replace the requested card.

Question progress counts only unanswered requests. Reaching the end after
skipping shows the unanswered count and a prompt to go back; “All caught up”
is reserved for an empty unanswered queue. Submission errors restore card focus,
and checkbox focus permits the number, skip and arrow shortcuts while text
inputs retain normal typing. Recommended badges and ordering require matching
question IDs, prompts, option IDs and labels, as in the full interaction card.
