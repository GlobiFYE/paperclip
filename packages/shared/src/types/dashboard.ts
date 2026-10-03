import type { ActivityEvent } from "./activity.js";

export interface DashboardRunActivityDay {
  date: string;
  succeeded: number;
  /**
   * True failures for the day, excluding process-loss/restart kills that were
   * later recovered by a successful retry (those are surfaced in `recovered`).
   */
  failed: number;
  /**
   * Runs that terminated in a failure state (failed/timed_out) but whose retry
   * chain eventually succeeded — e.g. restart-killed runs that recovered. Kept
   * out of `failed` so the headline failure count reflects true, unrecovered
   * failures.
   */
  recovered: number;
  other: number;
  total: number;
  /**
   * Per-error-code breakdown of the (true) `failed` count for the day, so a
   * spike can be attributed to an error class (e.g. `process_lost`,
   * `provider_quota`, `workspace_validation_failed`). Recovered runs are not
   * included here. Runs with no error code are bucketed under `unknown`.
   */
  failedByErrorCode: Record<string, number>;
}

export interface DashboardSummary {
  companyId: string;
  agents: {
    active: number;
    running: number;
    paused: number;
    error: number;
  };
  tasks: {
    open: number;
    inProgress: number;
    blocked: number;
    done: number;
  };
  costs: {
    monthSpendCents: number;
    monthBudgetCents: number;
    monthUtilizationPercent: number;
  };
  pendingApprovals: number;
  budgets: {
    activeIncidents: number;
    pendingApprovals: number;
    pausedAgents: number;
    pausedProjects: number;
  };
  runActivity: DashboardRunActivityDay[];
}

/**
 * Night-crew focus dashboard (doc/plans/2026-10-02-night-crew.md §2b): the
 * company's single zone-"b" (active-lane) project, front and center on the
 * dashboard. Null when the company has no active lane.
 */
export interface FocusDashboardActiveProject {
  id: string;
  name: string;
  description: string | null;
  status: string;
  zone: string;
}

/**
 * One next step of the active lane — the issue-list select shape the UI rows
 * need, nothing more.
 */
export interface FocusDashboardNextStep {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  priority: string | null;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  updatedAt: Date | string;
}

/**
 * The active-lane HQ payload: one lane, its next steps, its recent activity.
 * Zero lot content, zero other projects, zero metrics.
 */
export interface FocusDashboardSummary {
  activeProject: FocusDashboardActiveProject | null;
  nextSteps: FocusDashboardNextStep[];
  laneActivity: ActivityEvent[];
}