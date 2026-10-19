# Task budgets that include descendant work

Status: implementation in progress. Branch: `codex/task-descendant-budgets`.
Original baseline: `72ff3a9f27e581a27acb49771e8658bbb0bbaa47`.
Implementation rebased onto master `0ed760ce9a9fd1babd74a29f68c2352ccebc340a`.

## Outcome and acceptance

Implement optional lifetime dollar and token budgets on Paperclip tasks. Every
task cap pays for the task and delegated descendants. Deliver a reviewable PR
with accounting, authorization, actual execution gates, task UI, tools, CLI,
migration evidence, and an isolated acceptance journey. Qualify Codex and Claude
legacy/native paths individually; identify simulated dollar reports separately.

| Decision | Required behavior |
| --- | --- |
| Assignment | Optional own caps; descendants inherit all ancestor limits. |
| Allocation | Shared funds without reservations. Two $15 children may coexist beneath a $20 parent. |
| Metrics | Independent billed cents and canonical total tokens. Either cap stops work. |
| Window | Lifetime, including retries, continuation, reopening, and archived work. |
| Authority | Board controls outer funding; delegating task owners allocate within enclosing funding. |
| Unknown usage | Unsupported capped execution is denied; missing expected receipts block further work. |
| Moves | Past charges stay with original ancestors. Board-only moves change future funding after execution settles. |
| Runtime support | Codex and Claude first, with support established per metric and billing mode. |
| Precision | Enforce observed usage; in-flight work and delayed reports can overshoot. |

Company, agent, project, assignment, governance, and manual-pause gates remain
independently authoritative. Provider quotas/context windows/session-goal budgets
are separate concepts. No cap reserves money or authorizes spending up to it.

| Acceptance dimension | Evidence required |
| --- | --- |
| Fresh data | Create funded root/children through real APIs/UI; policies commit before wakes. |
| Existing data | Indexed resumable attribution initialization; visible legacy provenance. |
| Persistence | Reload/restart preserves charges, gates, incidents, and effects. |
| Downstream execution | Checkout, dispatch, continuation, retry, recovery, and resume honor every ancestor. |
| Repair | Raising the correct metric resumes only eligible interrupted work. |
| Removal/moves | Historical charges survive deletion and do not move with reparenting. |

## Source map and known traps

- `server/src/services/budgets.ts`: policies, summaries, incidents, pause/resume,
  `getInvocationBlock`. Replace implicit project/company fallthrough with explicit
  issue handling. Task checks must happen even without a project.
- `server/src/services/costs.ts`: `createEvent` and `issueTreeSummary`. The latter
  follows current parentage and filters hidden/harness tasks: it is not a budget ledger.
- `server/src/services/heartbeat.ts`: `claimQueuedRun`, `updateRuntimeState`,
  `resolveLedgerScopeForRun`, usage normalization, cancellation/wake helpers.
  Final usage currently follows some dependency-wake reconciliation: close that race.
- `server/src/services/issues.ts`: create/createChild/update/checkout/remove.
- `server/src/services/native-runtime/paperclip-runner-tool-authority.ts`:
  `#createTask` already has mutation receipts and post-commit wakes.
- `server/src/services/project-tools.ts`: legacy create_task forwarding.
- `server/src/services/native-runtime/native-session-executor.ts`:
  `normalizeNativeUsage`, `nativeUsageCostUsd`, final adapter result. Missing
  counters must not silently become authoritative zero; wire billing provenance.
- `server/src/modules/run-dispatch/adapters/postgres.ts`: retry admission gate.
- `packages/paperclip-runner/src/protocol-actions/create-task.ts`: canonical tool
  contract; regenerate derived contracts instead of hand-editing generated files.
- `ui/src/pages/IssueDetail.tsx`, `ui/src/components/NewIssueDialog.tsx`,
  `BudgetPolicyCard`, `BudgetIncidentCard`, and approval payloads: shared UI entrypoints.

## Public contracts

Extend `BudgetScopeType` with `issue` and `BudgetMetric` with `total_tokens`.
Issue policies support billed_cents/total_tokens with lifetime windows. Existing
scopes retain their supported metric/window combinations. Never write a token
amount into legacy budgetMonthlyCents fields.

Creation accepts `budget?: { maxCostCents?: number; maxTokens?: number }` through
REST task/child creation, create_task, legacy forwarding, CLI, and task dialog.
Caps are positive safe integers; omitted means inherited. Strip this object from
the issue insert, create policies in the same transaction, and include caps in
creation fingerprints. A changed budget under the same idempotency key conflicts.

Add `GET /api/issues/:id/budget` and `PATCH /api/issues/:id/budget`. PATCH accepts:

```ts
interface TaskBudgetPatchInput {
  maxCostCents?: number | null;
  maxTokens?: number | null;
  expectedRevisions: { billed_cents?: number; total_tokens?: number };
}
```

Require an expected revision for each modified metric, zero for no existing
policy. Apply both changes atomically. Stale revisions return 409 with no partial
write; unchanged values do not increment revisions. Null explicitly removes an
own cap; zero is invalid. Task policies default to warning 80%, hard stop and
notification enabled; the initial task UI has no advanced switches.

GET returns identity, own policies/revisions, ancestor policies, direct and
descendant charged usage, per-policy and effective remaining allowances,
accounting completeness/incomplete run IDs, all blockers and one deterministic
primary blocker, and server-computed editing permissions. Null remaining means
unbounded, or unknown alongside an incomplete-accounting blocker; zero means
exhausted. Never display unknown usage as zero used. The generic policy endpoint
must delegate issue writes to the same service and cannot bypass revisions/auth.

Stable gate codes: task_budget_exhausted, task_budget_usage_unavailable,
task_budget_metering_unsupported, task_budget_accounting_initializing. Include
limiting task, metric, policy/revision, observed/limit amounts, and useful copy.
Use explicit errors for stale revisions, insufficient headroom, self-increase,
funding-boundary changes, and unsettled execution.

## Persistence

- Widen policy amount and incident limit/observed fields to bigint with safe
  JavaScript-number validation. Add policy revision starting at 1 and actual
  agent/run mutation attribution. Increment revision only on effective changes.
- Incidents store policyRevision. Issue uniqueness is policy/revision/window/
  threshold regardless of dismissal; preserve legacy scope behavior. Keep paused
  must not emit a new identical incident on the next receipt.
- cost_events adds nullable totalTokens and unique nullable usageReceiptId.
  Preserve existing billed-cost and component-token semantics. Null tokens mean unknown.
- task_budget_accounting_state: company, initialization state, fixed cutover,
  keyset backfill cursor, completion timestamp.
- task_budget_run_contexts: company, immutable source run/task/project identities,
  optional live run FK, billing context, per-run cumulative amounts, independent
  metric completeness, normalization metadata, timestamps. Source identities
  and accounting survive live-run/task deletion.
- task_budget_run_ancestors: context, company, ancestor task identity, depth;
  depth zero is executing task; unique context/ancestor.
- task_budget_usage_receipts: context, stable key, source ordering, normalized
  cumulative amounts, finality, provenance, fingerprint; unique context/key.
- cost_event_task_scopes: company, event, charged ancestor identity, depth,
  provenance; unique event/ancestor. Index company/ancestor/event.
- task_budget_effects: durable stop/resume actions, scope, cause and policy
  revision, dedupe key, payload, bounded lease/attempt state, completion time.

Enforce company ownership and composite constraints where supported. Historical
task IDs have no cascading issue deletion. Company deletion clears its records.
Index run ancestry by company/ancestor/context and pending effects for bounded
claims. Derive totals from indexed attribution joins; batch ancestor reads, and
do not add a second mutable aggregate projection before profiling requires it.

### Initialization

Set one company cutover, capture all new contexts/events immediately, then
backfill older attributable events in indexed (created_at,id) keyset batches.
Use hierarchy available at initialization with provenance legacy_current_hierarchy.
Only normalize historical tokens from evidence establishing the provider's
semantics. Do not invent missing historical data or claim old moves/deletions
can be reconstructed. Preserve the provenance in reads.

Uncapped execution continues during initialization. First cap activation waits;
parent changes and deletion return retryable initialization conflicts so ancestry
is stable. New event attribution and backfill are idempotent. Avoid unbounded
updates, repeated whole-table scans, OFFSET cursors, and long provider I/O transactions.

## Accounting

Canonical total tokens include input and output, counting cached input/reasoning
once. Codex input may already include cached tokens. Claude separates uncached
input/cache writes/cache reads/output. Reasoning included in output is not
additive. Provider-internal subagents already in aggregate receipts are not
separately charged. Context occupancy is not lifetime usage.

Convert provider semantics near adapters/runner normalizers. Authoritative billed
USD becomes cents; known subscription-included usage is zero billed dollars.
Estimated model prices are not billed receipts. Missing and known zero differ.
Native billing classification must be explicit rather than guessed from OAuth.

Shared ingestion contract:

```ts
recordTaskRunUsage({ companyId, runId, receiptKey, sourceSequence,
  cumulativeBilledCents, cumulativeTotalTokens, isFinal, provenance })
```

Amounts are nullable cumulative totals for the Paperclip run. Capture provider
session baseline before execution and subtract it. Preserve offsets across
verified resets/attempts. Capped execution requires explicit usage-basis semantics,
not the legacy heuristic that counts a decrease as another complete run.

Under the budget transaction lock: load owned context; dedupe key/fingerprint;
reject conflicting replay; ignore stale samples; validate normalized totals;
compute positive deltas; insert receipt and new ledger usage; attribute once to
each captured ancestor; update cumulative/completeness state; evaluate policies;
persist incidents and effects; commit before publishing/cancelling. Normalize
cumulative cents before calculating delta, avoiding independent fragment rounding.
Streaming 100k then 140k then repeated final 140k charges 100k,40k,0.

Current-master integration: `run-cost-accounting.ts` remains the sole financial
writer for managed provider receipts. Persist normalized `totalTokens` alongside
the existing exact billed-cost event. Then settle the captured task context and
attribute the same event to its immutable ancestors. Never insert a second cost
event for task enforcement. The cumulative sample API above is a trusted internal
path for unmanaged sources; reject it once canonical run accounting owns the run.
Runtime aggregate counters retain the canonical accounting implementation.

Track each metric as pending, complete, or incomplete. Pending active execution
is allowed; incomplete means the reporting boundary passed without valid final
accounting. Keep known charges and gate relevant enclosing caps. Increasing a
number does not repair unknown accounting. Repair uses authoritative receipt
collection or explicit board removal of the cap. Proven no-provider-dispatch
may settle at zero; interrupted unknown execution may not. Agent cost reports
cannot impersonate runtime receipts or mark completeness; reject managed-run
duplicates and preserve separately attributable supplemental costs.

## Transactions and authority

Use the existing company `FOR NO KEY UPDATE` accounting lock for task budget policies,
ancestry/deletion, admission/context capture, usage accounting, and gate changes.
Acquire it before participating issue/run/policy row locks; audit native mutation
receipts for inverse order. Never hold it across provider calls, HTTP, waiting,
realtime publication, or cancellation; persist effects for those operations.

Agent delegation resolves source run/task/ancestry server-side and applies
existing assignment permissions. Reject alternate/omitted parentage that loses
funding. Conversation handoffs retain existing root-task semantics; interpreting
a user message does not itself grant outer-funding authority. Budget allocation
and funding-boundary changes require a verifiable run identity for agents.

Managers must currently own a strict ancestor, have ordinary delegation
permissions, have enclosing funding for that metric, be invokable under current
gates, and have sufficiently complete accounting. They cannot increase their own
cap. Agents cannot remove caps in v1; board does that.

For each metric:

```text
targetHeadroom = max(0, proposedTargetLimit - targetObservedUsage)
ancestorHeadroom = min(ancestorLimit - ancestorObservedUsage)
require targetHeadroom <= ancestorHeadroom
```

Do not subtract sibling allocations. Example: parent $20 used $8 leaves $12;
child used $3 may receive a total cap of $15, giving $12 additional headroom.

Validate revisions, mutate requested metrics, reevaluate gates, resolve
superseded incidents, enqueue effects, and audit in one transaction. An agent's
permitted reallocation does not become a board approval; cancel an unnecessary
pending board request with correct system attribution instead. Stale incident
revisions cannot overwrite later allocations.

Board-only funding-boundary moves require same-company cycle-free ancestry and
no active/queued/settling/unresolved-accounting execution in the moved subtree.
Return 409 while unsettled, without silently cancelling. Keep past attribution,
reevaluate new constraints, and capture new ancestry for future execution.
Deletion retains past charges, deactivates own policies and resolves pending
attention atomically. Missing historical scopes render as deleted tasks.

## Execution gates and effects

Extend getInvocationBlock to include initialization, all own/ancestor caps,
incomplete accounting, and selected-runtime support, independently of projects.
Ancestry resolution enforces company, detects cycles, and fails on exceeded
depth rather than granting truncated authority. Audit direct checkout, wake,
queued claim, pre-provider dispatch, native turn/continuation, retries, recovery,
automatic repair, task-associated plugin/browser work, resume and reassignment.

Runtime support contract:

```ts
interface TaskBudgetMeteringSupport {
  billedCents: "reported" | "included_zero" | "unsupported";
  totalTokens: "reported" | "unsupported";
  reportingBoundary: "incremental" | "turn_end" | "run_end";
}
```

Absent declaration is unsupported for caps. Qualify runtime, metric and billing
mode independently. Other adapters continue uncapped but cannot escape inherited
caps. Adding a cap while execution runs reevaluates runtime support and usage,
persists necessary gates, and requests cancellation where unenforceable.

Before dependent/continuation work becomes runnable: persist final receipt or
incomplete result, update gates, commit, release accounting barriers, then
reconcile wakes. A done task's missing receipt may still block parent spending.

Stop: durable gate first, deduped effect, cancel matching pending wakes and active
runs through existing cancellation; never pause an entire agent or mark work
done/cancelled. Preserve sessions/artifacts/status/manual holds. Report failure
or unconfirmed provider termination. Active run matching uses captured ancestry;
queued matching uses authoritative current task ancestry.

Resume: recheck every other cap, accounting and manual/governance gate; resume
only unfinished budget-interrupted work. Exclude backlog/done/cancelled/manual
pauses. Dedupe wakes by original stop/task across repeated repairs. Revalidate stale effects so an old stop does
not cancel newly admitted later-funded execution. Lease recovery survives restart.

## UI, tools and CLI

Add one shared task-budget component by the actual task cost summary. Show own
caps, direct and historically charged descendant usage, effective remaining,
limiting ancestor links, incomplete/unsupported states, and permitted actions.
The ledger may differ from today's structural tree after moves; label clearly
as charged to this task and delegated work. Creation has an optional Budget
disclosure with dollar/token fields; blank inherits, no lifetime/monthly picker.

Make policy/incident/approval components metric-aware, including integer tokens
and no dollar signs for token incidents. Audit/Budgets includes tasks and links.
Budget stop repair is funding/accounting repair, never a generic resume bypass.
Use existing tokens/components; cover desktop/narrow/loading/stale/error states.

Update canonical create_task, dispatchers, mocks/examples, generated contracts,
native and legacy forwarding, task context and returned child funding summaries.
Expose budget reads/updates through normal API tools. Add CLI read/update commands.
Instructions explain shared funds, limits not spending targets, either-metric
stops, requesting funding rather than self-increase, and missing-usage repair.

## Test matrix

Use actual database tests for transaction, uniqueness, ancestry and races.

| Scenario | Assertion |
| --- | --- |
| Nested descendants | Every captured ancestor charged exactly once. |
| Shared siblings | $15+$15 caps allowed under $20; shared spending stops at root. |
| Independent metrics | Either metric stops with the other still available. |
| Inherited/projectless | No own cap and no project cannot bypass ancestors. |
| Hidden/archived/reopened | Historical spend remains included. |
| Authority | Manager headroom enforced; self-increase/removal/cross-company/escape denied. |
| Atomic creation/replay | Policies commit before wake; failure rolls task back; changed retry caps conflict. |
| Duplicate/conflicting/stale usage | No double charge or overwritten ledger. |
| Simultaneous thresholds | One incident/approval/effect per revision/threshold. |
| Repeated funding | New revision alerts again; stale approvals cannot overwrite it. |
| Token normalization | Codex/Claude cached and reasoning tokens counted once; provider children not duplicated. |
| Subscription/unpriced | Known zero cost with nonzero tokens; missing remains unknown. |
| Missing/cancelled/bootstrap usage | Known usage retained; incomplete holds; proven no dispatch zero. |
| Session reuse/reset | Exclude prior runs and handle verified reset offsets. |
| Finalization | No dependent wake before final accounting/gating. |
| Moves/deletion | Old charges stay; new runs use new ancestry; active move 409; no refunds. |
| Restart/effects | Stops/resumes/completeness durable and idempotent. |
| Other holds | Raising one cap does not bypass manual/ancestor/company/project/agent gates. |
| Runtime compatibility | Unsupported caps denied; uncapped existing behavior continues. |
| UI | Token formatting, inheritance, stale edits and repair actions. |

Deterministic fixture:

```text
Root $20 / 500k tokens
  Child A $15 / 300k
    Grandchild A1
  Child B $15 / 300k

Root direct: $2 / 50k
A direct: $3 / 75k
A1: $4 / 100k
B: $5 / 125k

Expected Root $14 / 350k; A $7 / 175k; B $5 / 125k.
Another B 150k reaches Root 500k while B is still below 300k.
Block identifies root tokens. Replay changes nothing. Raising root dollars does
not resume; raising root tokens resumes eligible interrupted work under all gates.
```

## Implementation and verification order

1. Contracts/schema/backfill: fresh install and upgrade proof.
2. Canonical metering/receipts/immutable attribution: replay and missing-data proof.
3. Policy/authority/revisions/incidents/mutation guards: DB race proof.
4. Admission/checkout/continuation/recovery/cancellation/effects/finalization order.
5. Delegation, CLI, shared UI, approval formatting, generated contracts.
6. Isolated app acceptance and Codex/Claude legacy/native qualification. Record
   live vs simulated evidence, source revision/configuration, and precise gaps.

Keep controls unavailable until enforcement is wired. Use focused tests while
iterating. Run migration checks, generated semantic-contract checks,
`pnpm check:token-gates`, `pnpm -r typecheck`, `pnpm test:run`, and `pnpm build`
before PR handoff. Generate migrations with the DB tool, not hand-edited snapshots.
Update budget/API/runtime docs with shared allocation, token meaning, authority,
historical attribution, repair, qualified configurations and reporting delay.

## Execution record

- 2026-10-19: Existing worktree confirmed clean at planned baseline; implementation
  branch created. First useful experiment: real-DB nested ledger and shared-cap
  test, followed by the smallest runtime accounting path. No implementation or
  live qualification claimed yet.
- Implemented: shared API/CLI/tool contracts, revisioned policies/incidents, immutable
  run ancestry, deduplicated receipts, resumable legacy attribution, stop/resume
  outbox, budget admission/checkout/delegation guards, task creation and Properties UI.
- Verified at the original baseline: 15 task-budget/metering database tests;
  37 existing budget/cost/accounting regression cases; 63 parser cases; UI format
  and validation cases. A 501-event migration test exposed microsecond cursor
  truncation; the corrected cursor now stays in PostgreSQL and passes.
- Isolated acceptance: `/tmp/paperclip-task-budget-test-drive`, test company only,
  http://127.0.0.1:3104. Task creation persisted $20/500k caps atomically; Properties
  editing persisted $25/600k after reload. Screenshots and sanitized accounting
  evidence are in `/tmp/task-budget-evidence` (local, not committed).
- Live subscription receipts verified for Codex ACP (20,608 tokens), Claude CLI
  (27,129), and Claude ACP (21,251). Each exceeded a one-token task cap and held
  subsequent work. Billed cost is included-zero, not a dollar-estimate claim.
  Initial missing-token accounting correctly failed closed and led to a Codex
  ACP normalization regression test. Native attempts failed before provider work
  because the Runner binary is not yet built; they are not qualification passes.
- Current delivery gate: rebase onto current master (the supplied checkout was
  October 5), regenerate the migration/contracts against that source, then rerun
  affected checks and live/native acceptance. Broader runtime tests have one
  unrelated Gemini resume timeout still to classify. No PR opened yet.

- Current-master implementation uses the canonical durable provider receipt ledger,
  exact fractional cents, and company accounting row lock. Generated migration
  0355 widens task-safe limits and adds lineage, receipt attribution, initialization
  and durable effects; the generator pruned the sixth snapshot as required.
- Current focused qualification: 21 accounting/metering cases pass, including
  canonical receipt dedupe, fractional-cent threshold crossing, terminal missing
  usage, authority, branch moves, revision conflicts, repair and privacy. The UI
  CAS regression also passes: polling cannot replace the revision captured at Edit.
- All six real local paths now passed: Codex CLI/ACP/native and Claude CLI/ACP/native.
  Each produced persisted tokens and exhausted a one-token task cap. Native Codex
  dollar caps remain unsupported because the canonical runtime does not classify
  its billed cost; native Claude requires explicit supported billing credentials.
  These were subscription qualification runs, not proof of metered API billing.
- A native manager used its real create_task tool to create a backlog child assigned
  to another worker with a 1,000-token own cap under a 500,000-token parent. The child
  and cap persisted together. Browser Properties edits survived reload: raising
  dollars retained the token hold, and raising tokens cleared it.
- Current broad evidence: full workspace typecheck and build passed. Full test:run
  remains in progress. Final source checks and remote review are still required.
- Preserved failures: old-baseline native attempts had no built binary; a later
  ambient Claude native attempt could not access login credentials. Explicit local
  encrypted credential configuration allowed qualification. The first shared-root
  six-lane attempt correctly held siblings on missing usage; final qualification
  used independent roots. Cold fixture imports timed out until the fixture loaded
  the same lifecycle assembly before timed cases and supplied its explicit empty
  receipt index instead of scanning the developer spool. Two cutover comparisons
  lost PostgreSQL microseconds; both now compare timestamps inside PostgreSQL.
  An older broad adapter run had a Gemini resume timeout; it is not claimed fixed
  by this feature. Current broad tests must classify their own failures.
