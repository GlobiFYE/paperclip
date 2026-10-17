# JOU-39: transaction-bound admission audit and test contract repair

Baseline: `de7f31cf1173ebce3656e8693cce92b746d54c81`, PR paperclipai/paperclip#15600.

## Repair

`heartbeat.ts` already passes its transaction to `evaluateAdmissionForDb(tx)`. The composition root previously reused the root host there, whose `logActivity(db)` insert could wait on the transaction's `FOR UPDATE` agent lock through the activity foreign key.

Admission now binds both the writer and activity persistence to the same connection. It uses native `persistActivity(tx, ...)`, preserving redaction and responsibility resolution. The audit row commits or rolls back with the parked wake. It does not publish an uncommitted live event. Root-connection admission and dequeue retain the existing host/publication behavior. This repair does not require rewriting the >1 MB `heartbeat.ts` file. A byte-identical heartbeat blob is therefore not, by itself, evidence that this repair is missing: inspect the composition root and transaction-host binding.

Trade-off: the transactional enqueue audit is durable but does not emit an immediate `activity.logged` live notification. A future post-commit publication path must collect the returned publication at the transaction owner, not use a detached promise, timer, or second connection inside the transaction.

The in-memory test writer now implements `recoverStaleMaterializingClaims`, tracks claim times with an injected clock, restores the enqueue reason on release, and scopes reads/recovery to the requested agent. Regressions cover null and throwing creation callbacks, lease boundaries, stale recovery, agent isolation, deferred activity, and the transaction-bound host.

## Verification performed

The exact baseline policy, use-case source, and original test file were reconstructed and verified against Git blob hashes. An isolated Node 22 test harness (not Vitest) reproduced the original three promotion failures (4/7 passed). After repair, 16 test cases executed with a strict Node assertion adapter passed. Three additional composition-root checks passed with explicit connection/persistence spies, including transaction identity and propagation of audit-write failure.

No production credentials, database, server or VPS were used by those tests. This is scoped unit/composition evidence, not a PostgreSQL integration run or full CI signoff.

## Remaining gates

- Execute the canonical Vitest suite: `pnpm exec vitest run server/src/modules/agent-scheduler/`.
- Verify real PostgreSQL enqueue/park under the agent row lock, commit/rollback behavior and claim recovery after process loss.
- Full server typecheck/build, current upstream conflict resolution and CI review remain separate gates.
- Re-review the new SHA before merge or rollout. Preserve the existing human approval for material rollout.

Rollback: revert this commit on the PR branch. No database migration or production image change is part of this repair.
