import { agentWakeupRequests, heartbeatRuns } from "@paperclipai/db";
import { and, asc, count, eq, exists, isNull, notExists, or, sql } from "drizzle-orm";
import type { AgentSchedulerDb, AgentSchedulerWriter, RunnableWakeRow } from "../application/ports.js";
import {
  AGENT_SCHEDULER_DEQUEUE_REASON,
  AGENT_SCHEDULER_ENQUEUE_REASON,
  AGENT_SCHEDULER_MATERIALIZING_REASON,
} from "../domain/policy.js";

const AGENT_RUNNABLE_STATUS = "agent_runnable";

function toRunnableRow(row: typeof agentWakeupRequests.$inferSelect): RunnableWakeRow {
  return {
    id: row.id, companyId: row.companyId, agentId: row.agentId,
    source: row.source, triggerDetail: row.triggerDetail, reason: row.reason,
    payload: row.payload ?? null, requestedByActorType: row.requestedByActorType,
    requestedByActorId: row.requestedByActorId, idempotencyKey: row.idempotencyKey,
    requestedAt: row.requestedAt,
  };
}

export function createPostgresAgentSchedulerAdapter(db: AgentSchedulerDb): AgentSchedulerWriter {
  // Use the persisted foreign key, company and agent. Payload markers and
  // elapsed time are not proof that a previous INSERT did not commit.
  const rootsForWake = () => db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.wakeupRequestId, agentWakeupRequests.id),
    eq(heartbeatRuns.companyId, agentWakeupRequests.companyId),
    eq(heartbeatRuns.agentId, agentWakeupRequests.agentId),
    isNull(heartbeatRuns.retryOfRunId),
  ));
  const unclaimed = () => or(isNull(agentWakeupRequests.reason),
    eq(agentWakeupRequests.reason, AGENT_SCHEDULER_ENQUEUE_REASON));

  return {
    async listRunnableWakes(agentId, limit) {
      const rows = await db.select().from(agentWakeupRequests).where(and(
        eq(agentWakeupRequests.agentId, agentId),
        eq(agentWakeupRequests.status, AGENT_RUNNABLE_STATUS),
        isNull(agentWakeupRequests.runId), unclaimed(), notExists(rootsForWake()),
      )).orderBy(asc(agentWakeupRequests.requestedAt)).limit(limit);
      // Filter BEFORE LIMIT: 50 held intents must not starve a later ready wake.
      return rows.map(toRunnableRow);
    },
    async countRunnableWakes(agentId) {
      const [row] = await db.select({ total: count() }).from(agentWakeupRequests).where(and(
        eq(agentWakeupRequests.agentId, agentId),
        eq(agentWakeupRequests.status, AGENT_RUNNABLE_STATUS), isNull(agentWakeupRequests.runId),
      ));
      return Number(row?.total ?? 0);
    },
    async parkWakeAsRunnable(input) {
      const updated = await db.update(agentWakeupRequests).set({
        status: AGENT_RUNNABLE_STATUS, reason: input.enqueueReason,
        payload: sql`coalesce(${agentWakeupRequests.payload}, '{}'::jsonb) || ${JSON.stringify({
          _agentScheduler: input.schedulerMeta,
        })}::jsonb`, updatedAt: new Date(),
      }).where(and(
        eq(agentWakeupRequests.id, input.wakeRequestId),
        eq(agentWakeupRequests.companyId, input.companyId),
        eq(agentWakeupRequests.agentId, input.agentId),
        isNull(agentWakeupRequests.runId),
      )).returning({ id: agentWakeupRequests.id });
      return updated.length > 0;
    },
    async tryClaimRunnableWake(wakeId) {
      const updated = await db.update(agentWakeupRequests).set({
        reason: AGENT_SCHEDULER_MATERIALIZING_REASON,
        claimedAt: new Date(), updatedAt: new Date(),
      }).where(and(
        eq(agentWakeupRequests.id, wakeId),
        eq(agentWakeupRequests.status, AGENT_RUNNABLE_STATUS),
        isNull(agentWakeupRequests.runId), unclaimed(), notExists(rootsForWake()),
      )).returning({ id: agentWakeupRequests.id });
      // No TTL alternative: a live creator can take arbitrarily long.
      return updated.length > 0;
    },
    async recoverStaleMaterializingClaims(agentId) {
      // One statement/snapshot selects exactly ONE persisted original run and
      // restores the link. Never create another run or release an unknown intent.
      // Multiple historical roots are left intact for explicit reconciliation.
      const rootWhere = sql`
        r.wakeup_request_id = ${agentWakeupRequests.id}
        and r.company_id = ${agentWakeupRequests.companyId}
        and r.agent_id = ${agentWakeupRequests.agentId}
        and r.retry_of_run_id is null`;
      const updated = await db.update(agentWakeupRequests).set({
        runId: sql`(select r.id from heartbeat_runs r where ${rootWhere})`,
        status: sql`(select case
          when r.status = 'succeeded' then 'completed'
          when r.status = 'cancelled' then 'cancelled'
          when r.status in ('failed', 'timed_out') then 'failed'
          when r.status = 'running' then 'claimed'
          else 'queued' end from heartbeat_runs r where ${rootWhere})`,
        reason: AGENT_SCHEDULER_DEQUEUE_REASON,
        claimedAt: sql`(select r.started_at from heartbeat_runs r where ${rootWhere})`,
        finishedAt: sql`(select r.finished_at from heartbeat_runs r where ${rootWhere})`,
        updatedAt: new Date(),
      }).where(and(
        eq(agentWakeupRequests.agentId, agentId),
        eq(agentWakeupRequests.status, AGENT_RUNNABLE_STATUS),
        isNull(agentWakeupRequests.runId),
        or(unclaimed(), eq(agentWakeupRequests.reason, AGENT_SCHEDULER_MATERIALIZING_REASON)),
        sql`(select count(*) from heartbeat_runs r where ${rootWhere}) = 1`,
      )).returning({ id: agentWakeupRequests.id });
      return updated.length;
    },
    async releaseClaimedRunnableWake(input) {
      await db.update(agentWakeupRequests).set({
        status: AGENT_RUNNABLE_STATUS, reason: input.enqueueReason,
        claimedAt: null, updatedAt: new Date(),
      }).where(and(
        eq(agentWakeupRequests.id, input.wakeId),
        eq(agentWakeupRequests.companyId, input.companyId),
        eq(agentWakeupRequests.agentId, input.agentId),
        eq(agentWakeupRequests.reason, AGENT_SCHEDULER_MATERIALIZING_REASON),
        isNull(agentWakeupRequests.runId), notExists(rootsForWake()),
      ));
    },
    async materializeRunnableWake(input) {
      const matchingRun = db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
        eq(heartbeatRuns.id, input.runId),
        eq(heartbeatRuns.wakeupRequestId, input.wake.id),
        eq(heartbeatRuns.companyId, input.wake.companyId),
        eq(heartbeatRuns.agentId, input.wake.agentId),
        isNull(heartbeatRuns.retryOfRunId),
      ));
      const updated = await db.update(agentWakeupRequests).set({
        status: 'queued', reason: input.dequeueReason, runId: input.runId,
        claimedAt: null, updatedAt: new Date(),
      }).where(and(
        eq(agentWakeupRequests.id, input.wake.id),
        eq(agentWakeupRequests.companyId, input.wake.companyId),
        eq(agentWakeupRequests.agentId, input.wake.agentId),
        eq(agentWakeupRequests.status, AGENT_RUNNABLE_STATUS),
        eq(agentWakeupRequests.reason, AGENT_SCHEDULER_MATERIALIZING_REASON),
        isNull(agentWakeupRequests.runId), exists(matchingRun),
      )).returning({ id: agentWakeupRequests.id });
      if (updated.length > 0) return true;
      // Another reconciliation may have linked the SAME run. Do not overwrite
      // its claimed/completed/cancelled status, and never accept a different run.
      const [alreadyLinked] = await db.select({ id: agentWakeupRequests.id }).from(agentWakeupRequests).where(and(
        eq(agentWakeupRequests.id, input.wake.id),
        eq(agentWakeupRequests.companyId, input.wake.companyId),
        eq(agentWakeupRequests.agentId, input.wake.agentId),
        eq(agentWakeupRequests.runId, input.runId), exists(matchingRun),
      )).limit(1);
      return Boolean(alreadyLinked);
    },
  };
}

export { AGENT_RUNNABLE_STATUS };
