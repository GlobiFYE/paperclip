import {
  AGENT_SCHEDULER_DEQUEUE_REASON,
  AGENT_SCHEDULER_ENQUEUE_REASON,
  decideAgentRunMaterialization,
  resolveEffectiveAgentCapacity,
  type AgentSchedulerCapacityFacts,
} from "../domain/policy.js";
import type {
  AgentSchedulerEnqueueActivity,
  AgentSchedulerHost,
  AgentSchedulerWriter,
  RunnableWakeRow,
} from "./ports.js";

export type AgentSchedulerAdmissionInput = AgentSchedulerCapacityFacts & {
  companyId: string;
  agentId: string;
  wakeRequestId: string;
  issueId: string | null;
  /** When true, enqueue activity is returned for logging after the host transaction commits. */
  deferEnqueueActivity?: boolean;
};

export function createEvaluateAgentSchedulerAdmission(deps: {
  host: AgentSchedulerHost;
  writer: AgentSchedulerWriter;
}) {
  return async function evaluateAgentSchedulerAdmission(
    input: AgentSchedulerAdmissionInput,
  ): Promise<
    | { action: "materialize" }
    | {
        action: "park";
        queueDepth: number;
        deferredEnqueueActivity?: AgentSchedulerEnqueueActivity;
      }
  > {
    const decision = decideAgentRunMaterialization(input);
    if (decision.kind === "materialize") {
      return { action: "materialize" };
    }

    const parkedCount = await deps.writer.countRunnableWakes(input.agentId);
    const queueDepth = parkedCount + 1;
    const parked = await deps.writer.parkWakeAsRunnable({
      wakeRequestId: input.wakeRequestId,
      companyId: input.companyId,
      agentId: input.agentId,
      enqueueReason: AGENT_SCHEDULER_ENQUEUE_REASON,
      schedulerMeta: {
        parkedAt: new Date().toISOString(),
        triggerReason: decision.reason,
        effectiveCapacity: decision.effectiveCapacity,
        runningRunCount: input.runningRunCount,
        queueDepth,
      },
    });
    if (!parked) {
      return { action: "materialize" };
    }
    const enqueueActivity: AgentSchedulerEnqueueActivity = {
      companyId: input.companyId,
      agentId: input.agentId,
      wakeRequestId: input.wakeRequestId,
      issueId: input.issueId,
      reason: decision.reason,
      queueDepth,
      effectiveCapacity: decision.effectiveCapacity,
    };
    if (input.deferEnqueueActivity) {
      return { action: "park", queueDepth, deferredEnqueueActivity: enqueueActivity };
    }
    await deps.host.appendSchedulerEvent({
      ...enqueueActivity,
      kind: "enqueue",
    });
    return { action: "park", queueDepth };
  };
}

export type MaterializeRunnableWakeInput = {
  schedulerEnabled: boolean;
  allowParallelExecution: boolean;
  configuredMaxConcurrentRuns: number;
  agentId: string;
  companyId: string;
  createRunForWake: (wake: RunnableWakeRow) => Promise<string | null>;
};

export function createPromoteAgentRunnableWork(deps: {
  host: AgentSchedulerHost;
  writer: AgentSchedulerWriter;
}) {
  return async function promoteAgentRunnableWork(
    input: MaterializeRunnableWakeInput,
  ): Promise<{ promoted: number; runIds: string[] }> {
    if (!input.schedulerEnabled) {
      return { promoted: 0, runIds: [] };
    }

    const runningRunCount = await deps.host.countRunningRunsForAgent(input.agentId);
    const effectiveCapacity = resolveEffectiveAgentCapacity({
      schedulerEnabled: input.schedulerEnabled,
      allowParallelExecution: input.allowParallelExecution,
      configuredMaxConcurrentRuns: input.configuredMaxConcurrentRuns,
      runningRunCount,
    });
    const availableSlots = Math.max(0, effectiveCapacity - runningRunCount);
    if (availableSlots <= 0) {
      return { promoted: 0, runIds: [] };
    }

    await deps.writer.recoverStaleMaterializingClaims(input.agentId);

    const runIds: string[] = [];
    let promoted = 0;
    let slotsRemaining = availableSlots;
    const skippedWakeIds = new Set<string>();

    while (slotsRemaining > 0) {
      const candidates = await deps.writer.listRunnableWakes(input.agentId, 50);
      const wake = candidates.find((row) => !skippedWakeIds.has(row.id));
      if (!wake) break;
      const claimed = await deps.writer.tryClaimRunnableWake(wake.id);
      if (!claimed) {
        skippedWakeIds.add(wake.id);
        continue;
      }
      let runId: string | null;
      try {
        runId = await input.createRunForWake(wake);
      } catch {
        await deps.writer.releaseClaimedRunnableWake({
          wakeId: wake.id,
          companyId: wake.companyId,
          agentId: wake.agentId,
          enqueueReason: AGENT_SCHEDULER_ENQUEUE_REASON,
        });
        skippedWakeIds.add(wake.id);
        continue;
      }
      if (!runId) {
        await deps.writer.releaseClaimedRunnableWake({
          wakeId: wake.id,
          companyId: wake.companyId,
          agentId: wake.agentId,
          enqueueReason: AGENT_SCHEDULER_ENQUEUE_REASON,
        });
        skippedWakeIds.add(wake.id);
        continue;
      }
      const linked = await deps.writer.materializeRunnableWake({
        wake,
        runId,
        dequeueReason: AGENT_SCHEDULER_DEQUEUE_REASON,
      });
      if (!linked) {
        await deps.writer.releaseClaimedRunnableWake({
          wakeId: wake.id,
          companyId: wake.companyId,
          agentId: wake.agentId,
          enqueueReason: AGENT_SCHEDULER_ENQUEUE_REASON,
        });
        skippedWakeIds.add(wake.id);
        continue;
      }
      promoted += 1;
      runIds.push(runId);
      slotsRemaining -= 1;
      skippedWakeIds.delete(wake.id);
      const remainingRunnable = await deps.writer.countRunnableWakes(input.agentId);
      const queueDepth = Math.max(0, remainingRunnable);
      await deps.host.appendSchedulerEvent({
        companyId: input.companyId,
        agentId: input.agentId,
        wakeRequestId: wake.id,
        issueId: readIssueId(wake.payload),
        kind: "dequeue",
        reason: AGENT_SCHEDULER_DEQUEUE_REASON,
        queueDepth,
        effectiveCapacity,
      });
    }

    return { promoted, runIds };
  };
}

function readIssueId(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const issueId = payload.issueId;
  return typeof issueId === "string" && issueId.length > 0 ? issueId : null;
}

export function readAgentParallelExecutionAllowed(runtimeConfig: unknown): boolean {
  const root = runtimeConfig && typeof runtimeConfig === "object"
    ? runtimeConfig as Record<string, unknown>
    : {};
  const heartbeat = root.heartbeat && typeof root.heartbeat === "object"
    ? root.heartbeat as Record<string, unknown>
    : {};
  return heartbeat.allowParallelExecution === true;
}
