import { sql } from "drizzle-orm";
import { executionWorkspaces } from "@paperclipai/db";
import type { createDeliveryWorkCoordinator } from "./delivery-work-coordinator.js";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

export const TERMINAL_WORKSPACE_RETRY_MS = 5 * 60 * 1000;

export function notifyTerminalWorkspaceWork(transaction: object) {
  return notifyDeliveryWork(transaction, DELIVERY_QUEUES.terminalWorkspaces);
}

export function terminalWorkspaceDeadlineSql(cooldownMs: number) {
  return sql<number | null>`(
    WITH RECURSIVE task_tree AS (
      SELECT id, company_id, status, completed_at, cancelled_at, updated_at
      FROM issues WHERE id = ${executionWorkspaces.sourceIssueId}
        AND company_id = ${executionWorkspaces.companyId}
      UNION
      SELECT child.id, child.company_id, child.status, child.completed_at, child.cancelled_at, child.updated_at
      FROM issues child JOIN task_tree parent ON child.parent_id = parent.id
        AND child.company_id = parent.company_id
    )
    SELECT CASE WHEN count(*) > 0 AND bool_and(status IN ('done', 'cancelled'))
      THEN extract(epoch FROM max(CASE WHEN status = 'done'
        THEN coalesce(completed_at, updated_at) ELSE coalesce(cancelled_at, updated_at) END)) * 1000 + ${cooldownMs}
      ELSE NULL END FROM task_tree
  )`;
}

export function registerTerminalWorkspaceWork(
  coordinator: ReturnType<typeof createDeliveryWorkCoordinator>,
  service: {
    sweepTerminalWorkspaces(limit?: number, signal?: AbortSignal): Promise<{ checked: number }>;
    nextTerminalWorkspaceSweepAt(): Promise<number | null>;
    hasTerminalWorkspaceSweepContinuation(): boolean;
  },
  canRun: () => boolean,
) {
  let next: number | null = Date.now();
  let recovered = false;
  const worker = coordinator.register(DELIVERY_QUEUES.terminalWorkspaces, {
    retryMs: TERMINAL_WORKSPACE_RETRY_MS,
    run: signal => {
      recovered = false;
      next = Date.now() + TERMINAL_WORKSPACE_RETRY_MS;
      return service.sweepTerminalWorkspaces(50, signal);
    },
    hasPending: async () => {
      if (!canRun()) next = Date.now() + TERMINAL_WORKSPACE_RETRY_MS;
      else if (service.hasTerminalWorkspaceSweepContinuation()) next = Date.now() + 1000;
      else {
        const deadline = await service.nextTerminalWorkspaceSweepAt();
        next = deadline === null ? null : deadline > Date.now()
          ? deadline : Date.now() + TERMINAL_WORKSPACE_RETRY_MS;
        recovered = true;
      }
      return false;
    },
    nextRunAt: () => next,
  });
  return { ...worker, hasUnrecoveredWork: () => !recovered };
}
