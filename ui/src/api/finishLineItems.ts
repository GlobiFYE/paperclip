import type {
  CreateFinishLineItemRequest,
  FinishLineItem,
  UpdateFinishLineItemRequest,
} from "@paperclipai/shared";
import { api } from "./client";

/**
 * Project finish-line items ("what done looks like" bullets). Reads are
 * project-scoped; writes are company-scoped by item id — both match the
 * REST contract in `server/src/routes/finish-line-items.ts`.
 */
export const finishLineItemsApi = {
  list: (companyId: string, projectId: string) =>
    api.get<FinishLineItem[]>(
      `/companies/${companyId}/projects/${projectId}/finish-line-items`,
    ),
  create: (companyId: string, projectId: string, data: CreateFinishLineItemRequest) =>
    api.post<FinishLineItem>(
      `/companies/${companyId}/projects/${projectId}/finish-line-items`,
      data,
    ),
  update: (companyId: string, id: string, data: UpdateFinishLineItemRequest) =>
    api.patch<FinishLineItem>(`/companies/${companyId}/finish-line-items/${id}`, data),
  remove: (companyId: string, id: string) =>
    api.delete<{ deleted: boolean }>(`/companies/${companyId}/finish-line-items/${id}`),
};
