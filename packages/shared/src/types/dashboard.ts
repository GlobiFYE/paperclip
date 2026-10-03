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
   * spike can be attributed to an error class (e.g. process_lost,
   * provider_quota, workspace_validation_failed). Recovered runs are not
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
 * Night-crew focus dashboard (doc/plans/2026-10-02-night-crew.md §2b): one
 * lane per zone-"b" project, front and center on the dashboard.
 */
export interface FocusDashboardActiveProject {
  id: string;
  name: string;
  description: string | null;
  status: string;
  zone: string;
  color?: string | null;
  icon?: string | null;
}

/** One selectable option of a previewed question, mirroring the card payload field names. */
export interface QuestionPreviewOption {
  id: string;
  label: string;
}

/**
 * A single question a lane is blocked on: one question of a pending
 * `ask_user_questions` interaction on a next-step issue. Field names mirror
 * the interaction card payload (`payload.questions[].{id, prompt, options}`).
 */
export interface QuestionPreview {
  interactionId: string;
  questionId: string;
  prompt: string;
  options: QuestionPreviewOption[];
}

/**
 * One next step of a lane — the issue-list select shape the UI rows need,
 * nothing more, plus the pending questions that block it.
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
  /**
   * Pending ask-user-questions prompts attached to this task (ADHD edition):
   * the pending `ask_user_questions` interactions on the issue, flattened to
   * one preview per question in the card payload. Empty when the task is not
   * waiting on the user.
   */
  questions: QuestionPreview[];
}

/**
 * One focus lane: a zone-"b" project holding an active lane, its next steps
 * (with any pending questions nested), and the lane's recent activity.
 */
export interface FocusDashboardLane {
  project: FocusDashboardActiveProject;
  nextSteps: FocusDashboardNextStep[];
  laneActivity: ActivityEvent[];
}

/**
 * The active-lane HQ payload: every lane the owner can hold (sized by the
 * focusLaneProjectLimit setting, default 1 = the most-recently-updated
 * zone-"b" project), each with its own next steps and recent activity. Zero
 * lot content, zero other projects, zero metrics.
 */
export interface FocusDashboardSummary {
  lanes: FocusDashboardLane[];
}
