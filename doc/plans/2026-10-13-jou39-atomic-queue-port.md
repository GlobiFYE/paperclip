# JOU-39: upstream queue port and atomic materialization

## Status and exact scope

Implementation merges upstream `4b958ecbd8f33a7782fe6f29ec825f80f636b833` into the existing scheduler branch whose parent is `fba5575c06407c650e3d6dce5c6e4e7af94de883`. The upstream refactor is preserved: `server/src/services/heartbeat.ts` stays byte-identical to that upstream revision. Scheduler integration now lives in `server/src/services/heartbeat/queue.ts`.

This is a tested source change, not a production deployment, independent approval, or full-server typecheck/build PASS. The feature flag remains disabled by default. Journey's custom `paperclip:agy` runtime must never be replaced by the official upstream image.

## Findings addressed

1. **Healthy work stranded after uncertain creation.** The former promotion path spent its last slot on a failed callback and had no queued run to trigger recovery. New construction takes the wake row lock, creates the run and links it on one PostgreSQL transaction. Failed transactions roll all three changes back. A lost COMMIT response leaves either the committed link/queued run or no INSERT; the same wake is never replayed within that pass. Other ready wakes progress immediately. Legacy ambiguous intents remain held and are not re-authorized by elapsed time.
2. **First-page starvation.** Excluded/no-write wake IDs are filtered in SQL before LIMIT. Fifty rejected/no-write candidates no longer hide the next healthy wake. Order is stable by requested time and ID.
3. **Recovery discovery.** Existing `resumeQueuedRuns` discovers ready agent-runnable work in active companies even when there are no queued runs and per-agent timer heartbeats are disabled. No new polling loop, agent heartbeat, or LLM invocation was added. Post-commit park also attempts native dispatch once, closing a run-finished-before-park-commit race.
4. **Cross-controller capacity.** Queued-to-running transactions acquire a nonblocking transaction-scoped per-company/agent advisory lock and check running capacity on the same connection. The lock is released by COMMIT/ROLLBACK, not by the process-local start-lock timeout. Normal, queued-comment and native-review claim paths preserve their existing gates. Explicit parallel capacity remains opt-in.
5. **Transaction-bound park audit.** Park and enqueue audit use the exact caller transaction, including the existing agent FOR UPDATE lock. A PostgreSQL negative control proves that using another connection waits on that FK lock; the fixed transaction path commits with two concurrent agents.

## Preserved native semantics

- Creation callbacks are strictly database-only and must use the supplied transaction. No provider invocation or live publication occurs before COMMIT. The adapter rejects a null result after INSERT, a mismatched returned ID, or more than one created root.
- Specialized durable receipts, explicit continuations, retries and adopted comment batches retain their existing atomic admission paths rather than losing identity/session/retry metadata to a generic parked payload. Actual dispatch still obeys effective capacity.
- New parked work retains the native responsible user, session/continuation context and diagnostic metadata. Historical payloads lacking a valid responsible user fail safely instead of inventing an identity.
- Exactly one historical persisted root may be reattached. Zero/ambiguous historical results remain held; never run the old TTL-reclaim implementation concurrently.
- Paused companies, execution cutoffs, company/agent scope, issue locks, native review identity, budget and execution gates are preserved.

## Executed validation

Public source was extracted into an ephemeral non-root container, without production `DATABASE_URL`, `PAPERCLIP_API_KEY`, production volumes or Docker socket. Container limits: 1 CPU, up to 2 GiB RAM. PostgreSQL test clusters were created by the repository's own loopback-only helper and removed by test teardown/container disposal.

- Baseline existing scheduler tests: **29/29 PASS**.
- Two added regression tests before the fix: **29 PASS / 2 FAIL** (uncertain failure followed by healthy work; 50 no-write candidates before the 51st ready wake).
- Final targeted suites: **62/62 PASS, zero skipped**: 23 application cases, 25 real PostgreSQL adapter/capacity cases, 3 transaction-host cases, 5 policy cases, 5 full-heartbeat lifecycle cases and 1 existing start-lock regression.
- Full-heartbeat tests substitute only the external model adapter and telemetry; database admission, queueing, claim, finalization and promotion are real. The simulated executor records its own fixture task outcome/comment, preventing unrelated missing-state/comment repair runs. This is not a real-provider production canary.
- Physical PostgreSQL coverage includes simultaneous claimers, transaction rollback before/after INSERT, an actual trigger rejecting linkage, lost response after real COMMIT, termination of the test's own PostgreSQL backend before/after INSERT, safe historical reconciliation, company isolation, paused-company/cutoff discovery, and the audit-lock negative control.
- `git diff --check` passed for changed code.

Command executed in the isolated source checkout:

```sh
vitest run src/__tests__/heartbeat-agent-runnable-scheduler.test.ts \
  src/modules/agent-scheduler/ \
  src/__tests__/heartbeat-start-lock.test.ts \
  --config .jou39-test.config.ts --maxWorkers=1
```

The ephemeral test config extends `server/vitest.config.ts` and maps 83 workspace exports to the exact candidate source; external dependencies are reused from the existing runtime image. Node **24.21.0**, Vitest **4.1.11**, TypeScript **7.0.2**, embedded PostgreSQL **18.1.0-beta.16**. The upstream manifest pins Vitest 5.0.3: the local run must not be misrepresented as an all-dependencies lockfile-matched CI result. Missing AI-provider libraries were installed in a separate disposable directory from the exact source lockfile, with `--frozen-lockfile --ignore-scripts`; their closure is approximately 46 MiB. No source lockfile was changed for local testing.

Final tested source archive SHA-256 before adding this report: `7598e9e1466f4470e641df5db8c48feb0d7b7d299aa3887cdb2db9661f39d35e` (verify against the evidence manifest; source archive metadata is separate from Git commit identity).

The broader source typecheck was attempted with a 2 GiB container limit and was killed (`exit -9`) before diagnostics. **It did not pass.** Do not repeat a resource-constrained heavy build on the production VPS. `.github/workflows/journey-scheduler-validation.yml` provides a read-only, secret-free fork lane using the exact workspace lockfile, repository tests, complete server typecheck and build. It does not deploy or grant approval.

## Remaining release gates

1. Exact-lockfile remote CI tests, full server typecheck and build must pass on the published SHA; investigate baseline/upstream failures rather than hiding them.
2. Thermo must independently review the published changes and evidence. This report is written by the implementation operator and is not independent approval. Preserve the finite review cap and the separate material merge/rollout gate.
3. Reconcile the candidate with the Journey custom runtime recipe/adapter and overlays, current production schema and PostgreSQL 16; local embedded PostgreSQL 18 tests do not replace that compatibility canary.
4. Confirm fresh backup, rollback image and adequate build capacity. VPS heavy builds retain the existing 15 GiB free-space floor.
5. After authorized custom-runtime rollout, exercise real two-Issue serial execution, failure/recovery and provider evidence; measure duplicate roots, maximum simultaneous active runs and queue advancement. Do not declare production success from these isolated tests.

## Rollback and uncertain legacy work

Keep the feature flag off until the controlled canary. Retain the previous custom image and database backup before rollout. Turning the flag off returns new work to the legacy path but does not automatically drain existing agent-runnable rows. Diagnose/retain historical ambiguous intents; do not release them by age or replay external work. Restore the previous compatible custom image only according to the installation runbook. No schema migration is introduced by this change.
