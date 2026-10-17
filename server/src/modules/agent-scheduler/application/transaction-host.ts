import type { AgentSchedulerHost } from "./ports.js";

export type SchedulerActivity = Parameters<AgentSchedulerHost["appendSchedulerEvent"]>[0];

/**
 * Keep the admission audit on the connection that owns the agent row lock.
 * Calling the root host's logger here can wait on that same transaction's FK
 * lock and deadlock. The supplied writer must persist without publishing an
 * uncommitted activity. Root/dequeue publication remains with the root host.
 */
export function bindSchedulerHostToTransaction<TConnection>(
  host: AgentSchedulerHost,
  connection: TConnection,
  persist: (connection: TConnection, activity: SchedulerActivity) => Promise<void>,
): AgentSchedulerHost {
  return {
    countRunningRunsForAgent: (agentId) => host.countRunningRunsForAgent(agentId),
    appendSchedulerEvent: (activity) => persist(connection, activity),
  };
}
