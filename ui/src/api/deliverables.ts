import { api } from "./client";
import type { CompanyDeliverable, CompanyDeliverablesResponse } from "@paperclipai/shared";

export type { CompanyDeliverable, CompanyDeliverablesResponse } from "@paperclipai/shared";

/**
 * Company-level Deliverables client (TOP-193).
 *
 * Talks to the company-scoped deliverables projection endpoint
 * (`GET /api/companies/:companyId/deliverables`). One card per completed
 * issue: the stored plain-English "what was done" summary (written once at
 * completion by a cheap model), the final product link or path, who did and
 * verified the work, and the completion date. The page never triggers model
 * calls — it renders stored text only.
 */

export interface ListDeliverablesParams {
  projectId?: string;
  /** Inclusive ISO lower bound on the issue completion date. */
  from?: string;
  /** Exclusive ISO upper bound on the issue completion date. */
  to?: string;
  limit?: number;
  cursor?: string;
}

function buildDeliverablesQuery(params?: ListDeliverablesParams): string {
  const search = new URLSearchParams();
  if (params?.projectId) search.set("projectId", params.projectId);
  if (params?.from) search.set("from", params.from);
  if (params?.to) search.set("to", params.to);
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.cursor) search.set("cursor", params.cursor);
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** Normalize the response; tolerate a bare array like the artifacts client. */
function normalizeDeliverablesResponse(
  raw: CompanyDeliverablesResponse | CompanyDeliverable[],
): CompanyDeliverablesResponse {
  if (Array.isArray(raw)) {
    return { deliverables: raw, nextCursor: null };
  }
  return {
    deliverables: raw.deliverables ?? [],
    nextCursor: raw.nextCursor ?? null,
  };
}

export const deliverablesApi = {
  list: async (
    companyId: string,
    params?: ListDeliverablesParams,
  ): Promise<CompanyDeliverablesResponse> => {
    const raw = await api.get<CompanyDeliverablesResponse | CompanyDeliverable[]>(
      `/companies/${companyId}/deliverables${buildDeliverablesQuery(params)}`,
    );
    return normalizeDeliverablesResponse(raw);
  },
};
