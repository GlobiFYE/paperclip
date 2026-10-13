import type { Db } from "@paperclipai/db";
import { persistActivity } from "../../services/activity-log.js";
import { createPostgresAgentSchedulerAdapter } from "./adapters/postgres.js";
import type {
  AgentSchedulerEnqueueActivity,
  AgentSchedulerHost,
  AgentSchedulerWriter,
} from "./application/ports.js";
import { bindSchedulerHostToTransaction } from "./application/transaction-host.js";
import {
  createEvaluateAgentSchedulerAdmission,
  createPromoteAgentRunnableWork,
  readAgentParallelExecutionAllowed,
} from "./application/use-cases.js";

export {
  AGENT_SCHEDULER_DEQUEUE_REASON,
  AGENT_SCHEDULER_ENQUEUE_REASON,
  decideAgentRunMaterialization,
  resolveEffectiveAgentCapacity,
} from "./domain/policy.js";
export { readAgentParallelExecutionAllowed } from "./application/use-cases.js";
export { AGENT_RUNNABLE_STATUS } from "./adapters/postgres.js";

export type AgentSchedulerDeps = {
  adapter?: AgentSchedulerWriter;
};

export function createAgentScheduler(db: Db, host: AgentSchedulerHost, deps: AgentSchedulerDeps = {}) {
  const writer = deps.adapter ?? createPostgresAgentSchedulerAdapter(db);
  const evaluateAdmissionForDb = (conn: Db) => {
    const admissionHost = conn === db ? host : bindSchedulerHostToTransaction(
      host,
      conn,
      async (tx, input) => {
        // Atomic with park/enqueue: no second connection can wait on our agent
        // FOR UPDATE lock. Persist only; never publish an uncommitted event.
        await persistActivity(tx, {
          companyId: input.companyId,
          actorType: "system",
          actorId: "agent-scheduler",
          agentId: input.agentId,
          action: "agent.scheduler",
          entityType: "agent",
          entityId: input.agentId,
          details: {
            wakeRequestId: input.wakeRequestId,
            issueId: input.issueId,
            kind: input.kind,
            reason: input.reason,
            queueDepth: input.queueDepth,
            effectiveCapacity: input.effectiveCapacity,
          },
        });
      },
    );
    return createEvaluateAgentSchedulerAdmission({
      host: admissionHost,
      writer: deps.adapter ?? createPostgresAgentSchedulerAdapter(conn),
    });
  };
  return {
    evaluateAdmission: evaluateAdmissionForDb(db),
    evaluateAdmissionForDb,
    promoteRunnableWork: createPromoteAgentRunnableWork({ host, writer }),
    recordSchedulerEnqueueActivity: async (input: AgentSchedulerEnqueueActivity) =>
      host.appendSchedulerEvent({ ...input, kind: "enqueue" }),
    readAgentParallelExecutionAllowed,
  };
}

export type AgentScheduler = ReturnType<typeof createAgentScheduler>;

export { listAgentSchedulerResumeCandidates } from "./adapters/resume.js";
export { checkAgentCapacityWithinClaimTransaction } from "./adapters/dispatch-capacity.js";
