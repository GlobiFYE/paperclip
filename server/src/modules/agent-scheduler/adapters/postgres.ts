import { agentWakeupRequests } from "@paperclipai/db";
import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";
import { AGENT_SCHEDULER_ENQUEUE_REASON } from "../domain/policy.js";
import type { AgentSchedulerDb, AgentSchedulerWriter, RunnableWakeRow } from "../application/ports.js";

const AGENT_RUNNABLE_STATUS = "agent_runnable";

function toRunnableRow(row: typeof agentWakeupRequests.$inferSelect): RunnableWakeRow {
  return {
    id: row.id,
    companyId: row.companyId,
    agentId: row.agentId,
    source: row.source,
    triggerDetail: row.triggerDetail,
    reason: row.reason,
    payload: row.payload ?? null,
    requestedByActorType: row.requestedByActorType,
    requestedByActorId: row.requestedByActorId,
    idempotencyKey: row.idempotencyKey,
    requestedAt: row.requestedAt,
  };
}

export function createPostgresAgentSchedulerAdapter(db: AgentSchedulerDb): AgentSchedulerWriter {
  return {
    async listRunnableWakes(agentId, limit) {
      const rows = await db
        .select()
        .from(agentWakeupRequests)
        .where(
          and(
            eq(agentWakeupRequests.agentId, agentId),
            eq(agentWakeupRequests.status, AGENT_RUNNABLE_STATUS),
            isNull(agentWakeupRequests.runId),
          ),
        )
        .orderBy(asc(agentWakeupRequests.requestedAt))
        .limit(limit);
      return rows.map(toRunnableRow);
    },

    async countRunnableWakes(agentId) {
      const [row] = await db
        .select({ total: count() })
        .from(agentWakeupRequests)
        .where(
          and(
            eq(agentWakeupRequests.agentId, agentId),
            eq(agentWakeupRequests.status, AGENT_RUNNABLE_STATUS),
            isNull(agentWakeupRequests.runId),
          ),
        );
      return Number(row?.total ?? 0);
    },

    async parkWakeAsRunnable(input) {
      const updated = await db
        .update(agentWakeupRequests)
        .set({
          status: AGENT_RUNNABLE_STATUS,
          reason: input.enqueueReason,
          payload: sql`coalesce(${agentWakeupRequests.payload}, '{}'::jsonb) || ${JSON.stringify({
            _agentScheduler: input.schedulerMeta,
          })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentWakeupRequests.id, input.wakeRequestId),
            eq(agentWakeupRequests.companyId, input.companyId),
            eq(agentWakeupRequests.agentId, input.agentId),
            isNull(agentWakeupRequests.runId),
          ),
        )
        .returning({ id: agentWakeupRequests.id });
      return updated.length > 0;
    },

    async tryClaimRunnableWake(wakeId) {
      const updated = await db
        .update(agentWakeupRequests)
        .set({
          reason: "agent.scheduler.materializing",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentWakeupRequests.id, wakeId),
            eq(agentWakeupRequests.status, AGENT_RUNNABLE_STATUS),
            isNull(agentWakeupRequests.runId),
            or(
              isNull(agentWakeupRequests.reason),
              eq(agentWakeupRequests.reason, AGENT_SCHEDULER_ENQUEUE_REASON),
            ),
          ),
        )
        .returning({ id: agentWakeupRequests.id });
      return updated.length > 0;
    },

    async releaseClaimedRunnableWake(input) {
      await db
        .update(agentWakeupRequests)
        .set({
          status: AGENT_RUNNABLE_STATUS,
          reason: input.enqueueReason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentWakeupRequests.id, input.wakeId),
            eq(agentWakeupRequests.companyId, input.companyId),
            eq(agentWakeupRequests.agentId, input.agentId),
            eq(agentWakeupRequests.reason, "agent.scheduler.materializing"),
            isNull(agentWakeupRequests.runId),
          ),
        );
    },

    async materializeRunnableWake(input) {
      const updated = await db
        .update(agentWakeupRequests)
        .set({
          status: "queued",
          reason: input.dequeueReason,
          runId: input.runId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentWakeupRequests.id, input.wake.id),
            eq(agentWakeupRequests.status, AGENT_RUNNABLE_STATUS),
            isNull(agentWakeupRequests.runId),
          ),
        )
        .returning({ id: agentWakeupRequests.id });
      return updated.length > 0;
    },
  };
}

export { AGENT_RUNNABLE_STATUS };
