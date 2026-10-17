# Scheduler creation-intent safety

Baseline: `fca0153f2dd32094743bfd7366f40966effd8fe7`.

## Defect and correction

The previous five-minute materialization lease could expire while its creator was still waiting on a database response. A second promoter could then create a second run for the same wake. A callback can also reject after its INSERT commits, for example during publication. Releasing the claim on that exception is unsafe.

This follow-up treats `agent.scheduler.materializing` as a durable creation intent, not a lease that time alone can revoke. It never reauthorizes creation solely because a deadline elapsed. A callback exception, failed link, or rejected link response retains the intent and emits a sanitized `agent.scheduler` blocked event. A confirmed null/no-write callback can release the intent only while no persisted original run exists.

Reconciliation uses the authoritative `heartbeat_runs.wakeup_request_id`, company, agent, and `retry_of_run_id IS NULL`. Exactly one persisted original run restores the wake link and reflects that run's status. Zero or multiple original runs do not authorize another INSERT. Late completion accepts an already restored link only when it points to the same run. Recovery runs before the capacity check, so a running agent does not prevent link repair. Eligible wakes are filtered before LIMIT to avoid starvation behind held intents.

The preceding transaction-bound admission audit repair remains unchanged. No schema migration, heartbeat-file rewrite, or production deployment is included.

## Safety versus liveness

This is a conservative duplicate-creation mitigation, NOT an atomic create-and-link transaction and NOT a claim of exactly-once execution. A crash before any run becomes observable leaves a held intent. It requires an authorized native/operator reconciliation with evidence that its creator has stopped; elapsed time is not such evidence. Historical multiple-run ambiguity is also held, not erased.

Do not deploy old TTL-reclaiming code concurrently with this version: an old promoter can still clear a new durable intent. Disable the experimental scheduler and quiesce existing promoters during a coordinated rollout. Do not reset unknown intents or replay side effects as part of rollback.

A future full-liveness implementation should bind creation and linking to a retry-safe transaction/unique creation identity at their owner, with real process-loss tests. This patch does not claim that larger change is complete.

## Verification actually executed

Node 22.16.0 with its native TypeScript transform and a strict Node assertion adapter executed the committed use-case and transaction-host test files: **24 tests passed, 0 failed** (21 use-case tests plus 3 transaction-host tests). This was not the Vitest runner and was not a TypeScript typecheck. No production credentials, network services, or database were used.

A separate red/green race replay used the exact baseline and patched sources and in-memory writers. With the first creator still pending after 600,000 simulated milliseconds, the baseline called creation twice; the patched implementation called it once. Other cases cover a committed INSERT followed by rejection, uncertain link responses, same-run reconciliation, agent isolation, historical ambiguity, and 50 held intents preceding ready work.

The PostgreSQL adapter was inspected against the repository schema but **not executed against PostgreSQL**. The in-memory suite is not proof of SQL, locking, crash recovery, or production behavior.

## Remaining release gates

- Run canonical Vitest, full typecheck/build, and real PostgreSQL integration tests.
- Validate row-lock admission, transaction commit/rollback, committed-INSERT response loss, status-preserving link recovery, and query performance.
- Independently review this exact commit, resolve upstream conflicts and metadata checks, and satisfy the repository review gate.
- Preserve production deployment and security authorization boundaries.

Rollback: revert this code commit in the branch. No database migration is required. Keep uncertain creation intents held until reviewed; reverting to TTL reclamation without reconciliation can reintroduce duplicates.
