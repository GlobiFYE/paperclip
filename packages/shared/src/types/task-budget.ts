import type { BudgetMetric } from "../constants.js";
import type { BudgetPolicySummary } from "./budget.js";

export interface TaskBudgetCreateInput {
  maxCostCents?: number;
  maxTokens?: number;
}

export interface TaskBudgetPatchInput {
  maxCostCents?: number | null;
  maxTokens?: number | null;
  expectedRevisions: Partial<Record<BudgetMetric, number>>;
}

export type TaskBudgetBlockCode = "task_budget_exhausted" | "task_budget_usage_unavailable"
  | "task_budget_metering_unsupported" | "task_budget_accounting_initializing";

export interface TaskBudgetBlock {
  code: TaskBudgetBlockCode;
  scopeType: "issue";
  scopeId: string;
  scopeName: string;
  metric: BudgetMetric;
  policyId: string | null;
  policyRevision: number | null;
  observedAmount: number | null;
  amount: number | null;
  reason: string;
}

export interface TaskBudgetUsage {
  billedCents: number;
  totalTokens: number;
  incompleteCostRunIds: string[];
  incompleteTokenRunIds: string[];
}

export interface TaskBudgetSummary {
  issueId: string;
  companyId: string;
  policies: BudgetPolicySummary[];
  ownPolicies: BudgetPolicySummary[];
  directUsage: TaskBudgetUsage;
  descendantUsage: TaskBudgetUsage;
  remaining: Record<BudgetMetric, number | null>;
  blockers: TaskBudgetBlock[];
  primaryBlocker: TaskBudgetBlock | null;
  initialization: "pending" | "ready";
  legacyAttribution: boolean;
  permissions: Record<BudgetMetric, { canSet: boolean; canIncrease: boolean; canRemove: boolean }>;
}

export interface TaskBudgetMeteringSupport {
  billedCents: "reported" | "included_zero" | "unsupported";
  totalTokens: "reported" | "unsupported";
  reportingBoundary: "incremental" | "turn_end" | "run_end";
}
