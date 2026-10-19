import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { IssueDocument } from "@paperclipai/shared";
import { ApiError } from "@/api/client";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { getCachedIssueDetail } from "@/lib/issueDetailCache";

const PLAN_DOCUMENT_STALE_TIME_MS = 30_000;

/**
 * The issue's `plan` document, or null when none exists (a 404 is the normal
 * "no plan yet" answer, not an error). Shared by the redesigned thread (its
 * "Plan updated" marker) and the properties pane's Plan tab, so both consume
 * one cached fetch. Keyed under queryKeys.issues.documents so document-scope
 * invalidations refresh it.
 */
export function useIssuePlanDocument(issueId: string | null | undefined) {
  const queryClient = useQueryClient();
  const enabled = Boolean(issueId) && !issueId?.startsWith("chat:");
  const cachedIssue = enabled ? getCachedIssueDetail(queryClient, issueId) : undefined;
  const detailState = cachedIssue
    ? queryClient.getQueryState(queryKeys.issues.detail(cachedIssue.id))
      ?? queryClient.getQueryState(queryKeys.issues.detail(cachedIssue.identifier ?? ""))
    : undefined;
  const canSeed = detailState?.status === "success"
    && !detailState.isInvalidated
    && Date.now() - detailState.dataUpdatedAt < PLAN_DOCUMENT_STALE_TIME_MS;
  return useQuery<IssueDocument | null>({
    queryKey: [...queryKeys.issues.documents(issueId ?? ""), "plan"],
    enabled,
    initialData: canSeed ? cachedIssue?.planDocument : undefined,
    initialDataUpdatedAt: detailState?.dataUpdatedAt,
    staleTime: PLAN_DOCUMENT_STALE_TIME_MS,
    queryFn: async () => {
      try {
        return await issuesApi.getDocument(issueId!, "plan");
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
}
