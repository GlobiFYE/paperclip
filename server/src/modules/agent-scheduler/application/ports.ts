import type { Db } from "@paperclipai/db";

export type RunnableWakeRow = {
  id: string;
  companyId: string;
  agentId: string;
  source: string;
  triggerDetail: string | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  requestedByActorType: string | null;
  requestedByActorId: string | null;
  idempotencyKey: string | null;
  requestedAt: Date;
};

export type AgentSchedulerEnqueueActivity = {
  companyId: string;
  agentId: string;
  wakeRequestId: string;
  issueId: string | null;
  reason: string;
  queueDepth: number;
  effectiveCapacity: number;
};

export type AgentSchedulerHost = {
  countRunningRunsForAgent(agentId: string): Promise<number>;
  appendSchedulerEvent(input: AgentSchedulerEnqueueActivity & {
    kind: "enqueue" | "dequeue";
  }): Promise<void>;
};

export type AgentSchedulerWriter = {
  listRunnableWakes(agentId: string, limit: number): Promise<RunnableWakeRow[]>;
  countRunnableWakes(agentId: string): Promise<number>;
  parkWakeAsRunnable(input: {
    wakeRequestId: string;
    companyId: string;
    agentId: string;
    enqueueReason: string;
    schedulerMeta: Record<string, unknown>;
  }): Promise<boolean>;
  tryClaimRunnableWake(wakeId: string): Promise<boolean>;
  recoverStaleMaterializingClaims(agentId: string): Promise<number>;
  releaseClaimedRunnableWake(input: {
    wakeId: string;
    companyId: string;
    agentId: string;
    enqueueReason: string;
  }): Promise<void>;
  materializeRunnableWake(input: {
    wake: RunnableWakeRow;
    runId: string;
    dequeueReason: string;
  }): Promise<boolean>;
};

export type AgentSchedulerDb = Pick<Db, "select" | "insert" | "update" | "transaction">;
