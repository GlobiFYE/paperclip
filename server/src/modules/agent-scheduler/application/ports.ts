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
    kind: "enqueue" | "dequeue" | "blocked";
  }): Promise<void>;
};

export type AgentSchedulerWriter<Transaction = unknown> = {
  listRunnableWakes(agentId: string, limit: number, options?: {
    excludeWakeIds?: string[];
    requestedAtOrAfter?: Date;
  }): Promise<RunnableWakeRow[]>;
  /** Pure database callback: claim, INSERT and wake link commit together.
   * Never invoke providers, publish events, or use a different DB connection.
   */
  createAndLinkRunnableWake(input: {
    wake: RunnableWakeRow;
    createRun: (wake: RunnableWakeRow, tx: Transaction) => Promise<string | null>;
    dequeueReason: string;
  }): Promise<string | null>;
  countRunnableWakes(agentId: string): Promise<number>;
  parkWakeAsRunnable(input: {
    wakeRequestId: string;
    companyId: string;
    agentId: string;
    enqueueReason: string;
    schedulerMeta: Record<string, unknown>;
  }): Promise<boolean>;
  tryClaimRunnableWake(wakeId: string): Promise<boolean>;
  /** Repair links to one persisted root run; NEVER re-enqueue based on age. */
  recoverStaleMaterializingClaims(agentId: string): Promise<number>;
  /** Only safe after a confirmed null/no-write creation result. */
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
