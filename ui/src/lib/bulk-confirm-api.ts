import type { AttentionItem } from "@paperclipai/shared";
import type { QueryClient } from "@tanstack/react-query";
import { approvalsApi } from "../api/approvals";
import { issuesApi } from "../api/issues";
import { bulkConfirmPlan, validateBulkRecord, type BulkConfirmEntry, type HydratedBulkRecord } from "./bulk-confirm";

export interface BulkHydration {
  records: HydratedBulkRecord[];
  unavailableIds: string[];
}

export const bulkRecordCacheKey = (companyId: string) => ["bulk-confirm-records", companyId] as const;

/** One interaction read per issue, with at most four outstanding API reads. */
export async function hydrateBulkItems(companyId: string, items: readonly AttentionItem[], currentUserId?: string | null,
  queryClient?: QueryClient): Promise<BulkHydration> {
  const groups = new Map<string, AttentionItem[]>();
  for (const item of items) {
    if (item.companyId !== companyId) continue;
    // Metadata can rule a row out, never establish eligibility. Full records
    // remain authoritative, and absent metadata still gets hydrated.
    const metadata = item.subject.metadata;
    if (item.sourceKind === "approval" && typeof metadata?.type === "string" && metadata.type !== "hire_agent") continue;
    if (item.sourceKind === "issue_thread_interaction" && typeof metadata?.kind === "string"
      && !["ask_user_questions", "request_confirmation"].includes(metadata.kind)) continue;
    const key = item.sourceKind === "approval" ? `approval:${item.subject.id}`
      : item.sourceKind === "issue_thread_interaction" && item.relatedIssue ? `issue:${item.relatedIssue.id}` : null;
    if (key) groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const jobs = [...groups.values()];
  const recordsById = new Map<string, HydratedBulkRecord>();
  const unavailableIds: string[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
    while (next < jobs.length) {
      const group = jobs[next++];
      const first = group[0];
      try {
        const read = async () => first.sourceKind === "approval"
          ? [await approvalsApi.get(first.subject.id)]
          : await issuesApi.listInteractions(first.relatedIssue!.id);
        // Desk membership is not a record version. Filters, hides and arrivals
        // reuse unchanged reads, while each submit deliberately bypasses this cache.
        const version = group.reduce((latest, item) => Math.max(latest, Date.parse(item.updatedAt) || 0), 0);
        const records = queryClient ? await queryClient.fetchQuery({
          queryKey: [...bulkRecordCacheKey(companyId), currentUserId ?? null, first.sourceKind === "approval"
            ? `approval:${first.subject.id}` : `issue:${first.relatedIssue!.id}`, version],
          queryFn: read,
          staleTime: Infinity,
          retry: false,
        }) : await read();
        for (const item of group) {
          const record = records.find((record) => record?.id === item.subject.id);
          if (!record) { unavailableIds.push(item.id); continue; }
          const validated = validateBulkRecord(item, record, currentUserId);
          if (validated) recordsById.set(item.id, validated);
        }
      } catch {
        unavailableIds.push(...group.map((item) => item.id));
      }
    }
  }));
  return { records: items.flatMap((item) => recordsById.get(item.id) ?? []), unavailableIds };
}

export interface BulkConfirmResult {
  confirmed: number;
  skipped: number;
  failures: { title: string; reason: string }[];
}

/** Sequential, best-effort revalidation. Existing endpoints have no record-version precondition. */
export async function runBulkConfirm(
  companyId: string,
  snapshot: readonly BulkConfirmEntry[],
  onProgress: (current: number) => void,
  signal?: AbortSignal,
  currentUserId?: string | null,
): Promise<BulkConfirmResult> {
  const result: BulkConfirmResult = { confirmed: 0, skipped: 0, failures: [] };
  for (const [index, entry] of snapshot.entries()) {
    if (signal?.aborted) break;
    onProgress(index + 1);
    try {
      const fresh = await hydrateBulkItems(companyId, [entry.item], currentUserId);
      if (signal?.aborted) break;
      if (fresh.unavailableIds.length) throw new Error("Could not check whether this item changed. Try it individually.");
      const current = bulkConfirmPlan(fresh.records)[0];
      if (!current || current.fingerprint !== entry.fingerprint) {
        result.skipped++;
        continue;
      }
      const action = entry.action;
      if (action.kind === "approve_hire") {
        const receipt = await approvalsApi.approve(action.approvalId);
        if (receipt.status !== "approved") throw new Error(`Approval returned ${receipt.status}. Check it individually.`);
      } else if (action.kind === "accept_confirmation") {
        const receipt = await issuesApi.acceptInteraction(action.issueId, action.interactionId);
        if (receipt.status !== "accepted") throw new Error(`Confirmation returned ${receipt.status}. Check it individually.`);
      } else {
        const receipt = await issuesApi.respondToInteraction(action.issueId, action.interactionId, { answers: action.answers });
        if (receipt.status !== "answered") throw new Error(`Question returned ${receipt.status}. Check it individually.`);
      }
      result.confirmed++;
    } catch (error) {
      result.failures.push({ title: entry.title, reason: error instanceof Error ? error.message : "The request failed. Try it individually." });
    }
  }
  return result;
}
