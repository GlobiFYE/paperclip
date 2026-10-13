import { agentWakeupRequests, companies } from "@paperclipai/db";
import { and, asc, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { AgentSchedulerDb } from "../application/ports.js";
import { AGENT_SCHEDULER_ENQUEUE_REASON, AGENT_SCHEDULER_MATERIALIZING_REASON } from "../domain/policy.js";
import { AGENT_RUNNABLE_STATUS } from "./postgres.js";

/** Existing lifecycle/startup recovery discovers durable ready work even when
 * no queued heartbeat run exists and per-agent timer heartbeats are disabled.
 */
export async function listAgentSchedulerResumeCandidates(db: AgentSchedulerDb, cutoff?: Date | null) {
  const roots = sql`(select count(*) from heartbeat_runs r
    where r.wakeup_request_id = ${agentWakeupRequests.id}
      and r.company_id = ${agentWakeupRequests.companyId}
      and r.agent_id = ${agentWakeupRequests.agentId}
      and r.retry_of_run_id is null)`;
  return db.select({ agentId: agentWakeupRequests.agentId }).from(agentWakeupRequests)
    .innerJoin(companies, eq(companies.id, agentWakeupRequests.companyId))
    .where(and(
      eq(companies.status, "active"),
      eq(agentWakeupRequests.status, AGENT_RUNNABLE_STATUS),
      isNull(agentWakeupRequests.runId),
      cutoff ? gte(agentWakeupRequests.requestedAt, cutoff) : undefined,
      or(
        and(or(isNull(agentWakeupRequests.reason), eq(agentWakeupRequests.reason, AGENT_SCHEDULER_ENQUEUE_REASON)),
          sql`${roots} <= 1`),
        and(eq(agentWakeupRequests.reason, AGENT_SCHEDULER_MATERIALIZING_REASON), sql`${roots} = 1`),
      ),
    )).groupBy(agentWakeupRequests.agentId).orderBy(asc(agentWakeupRequests.agentId));
}
