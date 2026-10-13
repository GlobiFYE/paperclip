import { agents, heartbeatRuns, type Db } from "@paperclipai/db";
import { and, count, eq, sql } from "drizzle-orm";
import { resolveEffectiveAgentCapacity } from "../domain/policy.js";

/** Must run on the SAME transaction that changes a queued run to running.
 * The nonblocking transaction-scoped lock serializes capacity checks across
 * controllers. It is released by COMMIT/ROLLBACK, never by a wall-clock TTL.
 * Returning false leaves the run queued for the existing lifecycle recovery.
 */
export async function checkAgentCapacityWithinClaimTransaction(tx: Db, input: {
  companyId: string;
  agentId: string;
  schedulerEnabled: boolean;
  allowParallelExecution: boolean;
  configuredMaxConcurrentRuns: number;
}): Promise<boolean> {
  if (!input.schedulerEnabled) return true;
  const [agent] = await tx.select({ id: agents.id }).from(agents).where(and(
    eq(agents.id, input.agentId), eq(agents.companyId, input.companyId),
  )).limit(1);
  if (!agent) return false;
  // A nonblocking attempt avoids a lock-order cycle with native issue/wake
  // locks. The loser makes no state mutation and remains in the durable queue.
  const result = await tx.execute(sql`
    select pg_try_advisory_xact_lock(hashtextextended(
      ${`paperclip.agent-scheduler.capacity.v1:${input.companyId}:${input.agentId}`}, 0
    )) as acquired
  `);
  if (result[0]?.acquired !== true) return false;
  const [row] = await tx.select({ total: count() }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.agentId, input.agentId),
    eq(heartbeatRuns.status, "running"),
  ));
  const runningRunCount = Number(row?.total ?? 0);
  return runningRunCount < resolveEffectiveAgentCapacity({ ...input, runningRunCount });
}
