import type {
  TaskBudgetSummary,
  TaskBudgetPatchInput,
  BudgetIncident,
  BudgetIncidentResolutionInput,
  BudgetOverview,
  BudgetPolicySummary,
  BudgetPolicyUpsertInput,
} from "@paperclipai/shared";
import { api } from "./client";

export const budgetsApi = {
  task: (issueId: string) => api.get<TaskBudgetSummary>(`/issues/${issueId}/budget`),
  updateTask: (issueId: string, data: TaskBudgetPatchInput) => api.patch<TaskBudgetSummary>(`/issues/${issueId}/budget`, data),
  overview: (companyId: string) =>
    api.get<BudgetOverview>(`/companies/${companyId}/budgets/overview`),
  upsertPolicy: (companyId: string, data: BudgetPolicyUpsertInput) =>
    api.post<BudgetPolicySummary>(`/companies/${companyId}/budgets/policies`, data),
  resolveIncident: (companyId: string, incidentId: string, data: BudgetIncidentResolutionInput) =>
    api.post<BudgetIncident>(
      `/companies/${companyId}/budget-incidents/${encodeURIComponent(incidentId)}/resolve`,
      data,
    ),
};
