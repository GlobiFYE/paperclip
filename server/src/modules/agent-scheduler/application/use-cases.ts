import {
  AGENT_SCHEDULER_DEQUEUE_REASON,
  AGENT_SCHEDULER_ENQUEUE_REASON,
  decideAgentRunMaterialization,
  resolveEffectiveAgentCapacity,
  type AgentSchedulerCapacityFacts,
} from "../domain/policy.js";
import type {
  AgentSchedulerDb,
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
  /** INSERT through tx only. No provider calls or publication before commit. */
  createRunForWake: (wake: RunnableWakeRow, tx: AgentSchedulerDb) => Promise<string | null>;
  requestedAtOrAfter?: Date;
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

    await deps.writer.recoverStaleMaterializingClaims(input.agentId);
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

    const runIds: string[] = [];
    let promoted = 0;
    let slotsRemaining = availableSlots;
    const skippedWakeIds = new Set<string>();

    while (slotsRemaining > 0) {
      const candidates = await deps.writer.listRunnableWakes(input.agentId, 50, {
        excludeWakeIds: [...skippedWakeIds],
        requestedAtOrAfter: input.requestedAtOrAfter,
      });
      const wake = candidates[0];
      if (!wake) break;
      // Exclude failures and confirmed no-write returns before the next SQL
      // LIMIT. One bad wake must not strand unrelated healthy assignments.
      skippedWakeIds.add(wake.id);
      let runId: string | null;
      try {
        runId = await deps.writer.createAndLinkRunnableWake({
          wake,
          createRun: input.createRunForWake,
          dequeueReason: AGENT_SCHEDULER_DEQUEUE_REASON,
        });
      } catch {
        // Never replay a failed transaction or manually release an uncertain
        // creation. Its atomic link is the receipt: commit => linked/queued;
        // rollback => ready; an in-flight transaction retains its row lock.
        // Dispatch, not run construction, enforces active-run capacity. Other
        // ready wakes may therefore progress without recreating this intent.
        await deps.host.appendSchedulerEvent({
          companyId: wake.companyId,
          agentId: wake.agentId,
          wakeRequestId: wake.id,
          issueId: readIssueId(wake.payload),
          kind: "blocked",
          reason: "materialization_outcome_uncertain",
          queueDepth: await deps.writer.countRunnableWakes(input.agentId),
          effectiveCapacity,
        });
        continue;
      }
      if (!runId) continue;
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
