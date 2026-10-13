import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { AttentionItem } from "@paperclipai/shared";
import { bulkRecordCacheKey, loadAttentionRecords } from "../../lib/bulk-confirm-api";
import { queryKeys } from "../../lib/queryKeys";
import { validateDecisionRecord } from "./classifyDecision";

export function useDecisionRecords(companyId: string | null, items: AttentionItem[], currentUserId?: string | null) {
  const client = useQueryClient();
  return useQuery({
    queryKey: [...queryKeys.attention(companyId!), "individual-records", currentUserId, items.map((item) => [item.id, item.updatedAt])],
    queryFn: async () => {
      const loaded = await loadAttentionRecords(companyId!, items, currentUserId, client, true);
      return new Map(items.map((item) => [item.id, validateDecisionRecord(item, loaded.records.get(item.id), currentUserId)]));
    },
    placeholderData: keepPreviousData, enabled: !!companyId, retry: false, staleTime: 30_000, refetchOnWindowFocus: false,
  });
}

export async function refreshDecisions(client: QueryClient, companyId: string) {
  await client.invalidateQueries({ queryKey: bulkRecordCacheKey(companyId), refetchType: "none" });
  await Promise.all([
    queryKeys.attention(companyId), ["decisions"], ["approvals"], ["issues", "interactions"],
    ["issues", "approvals"], queryKeys.sidebarBadges(companyId), queryKeys.agents.list(companyId),
    queryKeys.decisionQueues.list(companyId),
  ].map((queryKey) => client.invalidateQueries({ queryKey })));
}
