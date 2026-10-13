/** The lifecycle controls admission. Execution status describes current work. */
export const AGENT_LIFECYCLE_STATES = [
  "pending_approval", "preparing", "verifying", "ready", "pausing", "paused",
  "resuming", "terminating", "cleaning_up", "terminated", "rejected",
] as const;
export type AgentLifecycleState = typeof AGENT_LIFECYCLE_STATES[number];

export interface AgentLifecycleOperation {
  id: string;
  resumeState?: "preparing" | "verifying" | "ready";
  hostComplete: boolean;
  completedPluginIds: string[];
  leaseOwner?: string;
  leaseUntil?: string;
  retryAt?: string;
  attempts: number;
  responsibleUserId?: string | null;
}

export interface AgentLifecycleRequest {
  companyId: string;
  agentId: string;
  operationId: string;
  version: number;
  phase: AgentLifecycleState;
  /** Server-only, agent-scoped secrets owned by this lifecycle plugin. Never expose to agents or UI. */
  instanceSecrets?: Record<string, string>;
}
export interface AgentLifecycleResult {
  operationId: string;
  version: number;
  status: "complete" | "pending";
  /** Local secret changes. The tenant encrypts these before accepting the result; null removes a key. */
  instanceSecrets?: Record<string, string | null>;
}
