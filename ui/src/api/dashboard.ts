import type { DashboardSummary, FocusDashboardSummary } from "@paperclipai/shared";
import { api } from "./client";

export const dashboardApi = {
  summary: (companyId: string) => api.get<DashboardSummary>(`/companies/${companyId}/dashboard`),
  focus: (companyId: string) => api.get<FocusDashboardSummary>(`/companies/${companyId}/dashboard/focus`),
};
