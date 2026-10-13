import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, AttentionItem } from "@paperclipai/shared";
import { bulkConfirmPlan, type BulkConfirmEntry } from "../lib/bulk-confirm";
import { bulkRecordCacheKey, hydrateBulkItems, runBulkConfirm, type BulkConfirmResult } from "../lib/bulk-confirm-api";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "./ui/button";
import { MarkdownBody } from "./MarkdownBody";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";

interface Snapshot {
  plan: BulkConfirmEntry[];
  individual: AttentionItem[];
}

export function BulkConfirm({ companyId, items, agentMap, userLabelMap, currentUserId, onSelectIndividual, actionLabel = "Confirm all" }: {
  actionLabel?: string;
  companyId: string;
  items: AttentionItem[];
  agentMap: Map<string, Agent>;
  userLabelMap?: ReadonlyMap<string, string>;
  currentUserId?: string | null;
  onSelectIndividual: (item: AttentionItem) => void;
}) {
  const queryClient = useQueryClient();
  const hydrated = useQuery({
    queryKey: [...queryKeys.attention(companyId), "bulk-confirm", currentUserId, items.map((item) => [item.id, item.updatedAt])],
    queryFn: () => hydrateBulkItems(companyId, items, currentUserId, queryClient),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
  // Placeholder data must never bring filtered-out items into the count or dialog.
  const visibleIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);
  const plan = useMemo(() => bulkConfirmPlan((hydrated.data?.records ?? [])
    .filter((record) => visibleIds.has(record.item.id))), [hydrated.data, visibleIds]);
  const unavailableCount = hydrated.data?.unavailableIds.filter((id) => visibleIds.has(id)).length ?? 0;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<BulkConfirmResult | null>(null);
  const running = useRef(false);
  const runController = useRef<AbortController | null>(null);
  const individualToSelect = useRef<AttentionItem | null>(null);
  useEffect(() => () => { runController.current?.abort(); }, []);

  const open = () => {
    if (hydrated.isFetching || plan.length < 2) return;
    const eligibleIds = new Set(plan.map((entry) => entry.item.id));
    setSnapshot(structuredClone({ plan, individual: items.filter((item) => !eligibleIds.has(item.id)) }));
    setResult(null);
  };
  const close = () => { if (!running.current) setSnapshot(null); };
  const confirm = async () => {
    if (!snapshot || running.current || result) return;
    running.current = true;
    const controller = new AbortController();
    runController.current = controller;
    try {
      const nextResult = await runBulkConfirm(companyId, snapshot.plan, setProgress, controller.signal, currentUserId);
      if (!controller.signal.aborted) setResult(nextResult);
    } finally {
      if (!controller.signal.aborted) setProgress(null);
      running.current = false;
      // Submissions bypassed the cache. Retire those cached reads before the
      // attention invalidation builds the next plan; unrelated records stay fresh.
      const submittedSubjects = new Set(snapshot.plan.map((entry) => entry.action.kind === "approve_hire"
        ? `approval:${entry.action.approvalId}` : `issue:${entry.action.issueId}`));
      await queryClient.invalidateQueries({ queryKey: bulkRecordCacheKey(companyId), refetchType: "none",
        predicate: (query) => submittedSubjects.has(String(query.queryKey[3])) });
      // Prefix invalidation covers details, lists, interaction cards and badges.
      await Promise.all([
        queryKeys.attention(companyId), ["decisions"], ["approvals"],
        ["issues", "interactions"], ["issues", "approvals"], queryKeys.sidebarBadges(companyId),
        queryKeys.agents.list(companyId), queryKeys.decisionQueues.list(companyId),
      ].map((queryKey) => queryClient.invalidateQueries({
        queryKey,
        // An in-flight write may finish after unmount. Mark cached data stale,
        // but do not start background refetches for an abandoned run.
        ...(controller.signal.aborted ? { refetchType: "none" as const } : {}),
      })));
    }
  };
  const summary = result
    ? `${result.confirmed} confirmed, ${result.skipped} skipped (changed), ${result.failures.length} failed`
    : null;

  return (
    <div className="space-y-2">
      <Dialog open={snapshot !== null} onOpenChange={(next) => { if (next) open(); else close(); }}>
        {(plan.length >= 2 || snapshot) && (
          <DialogTrigger asChild>
            <Button disabled={hydrated.isFetching || progress !== null || plan.length < 2}>{actionLabel} ({plan.length})</Button>
          </DialogTrigger>
        )}
        {snapshot && (
          <DialogContent showCloseButton={progress === null} className="max-h-(--sz-80vh) overflow-y-auto"
            onCloseAutoFocus={(event) => {
              const item = individualToSelect.current;
              if (!item) return;
              event.preventDefault();
              individualToSelect.current = null;
              onSelectIndividual(item);
            }}>
            <DialogHeader>
              <DialogTitle>Confirm {snapshot.plan.length} items</DialogTitle>
              <DialogDescription>Review each answer before confirming. New arrivals are not included.</DialogDescription>
            </DialogHeader>
            <div className="max-h-(--sz-50vh) space-y-4 overflow-y-auto break-words">
              <ul className="space-y-4">
                {snapshot.plan.map((entry) => (
                  <li key={entry.item.id} className="space-y-1">
                    <p className="text-sm font-semibold">{entry.title}</p>
                    <p className="text-xs text-muted-foreground">
                      Asked by {entry.askedByAgentId ? agentMap.get(entry.askedByAgentId)?.name ?? entry.item.originAgentName ?? "an agent"
                        : entry.askedByUserId ? (entry.askedByUserId === currentUserId ? "You"
                          : userLabelMap?.get(entry.askedByUserId)?.trim() || "a teammate") : "the system"}
                    </p>
                    {entry.answers.map((answer, index) => <p key={index} className="text-sm">{answer}</p>)}
                    {entry.details.length > 0 && (
                      <details className="text-sm">
                        <summary className="cursor-pointer underline">Details for {entry.title}</summary>
                        <div className="space-y-2 py-2">
                          {entry.details.map((detail, index) => (
                            <div key={index}>
                              <p className="font-medium">{detail.label}</p>
                              <MarkdownBody>{detail.markdown}</MarkdownBody>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
              {snapshot.individual.length > 0 && (
                <>
                  <p className="text-sm">{snapshot.individual.length} {snapshot.individual.length === 1 ? "item needs" : "items need"} your individual answer</p>
                  <ul className="space-y-1">
                    {snapshot.individual.map((item) => (
                      <li key={item.id} className="text-sm">
                        <a className="underline" href={`#attention-row-${item.id}`} aria-disabled={progress !== null}
                          onClick={(event) => {
                            event.preventDefault();
                            if (running.current) return;
                            individualToSelect.current = item;
                            close();
                          }}>
                          {item.subject.title ?? "Open item"}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div role="status" aria-live="polite" className="space-y-2 break-words text-sm">
              {progress !== null ? `Confirming ${progress} of ${snapshot.plan.length}...` : summary}
              {result?.failures.map((failure, index) => (
                <p key={index} className="text-destructive">{failure.title}: {failure.reason}</p>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" disabled={progress !== null} onClick={close}>{result ? "Close" : "Cancel"}</Button>
              {!result && <Button disabled={progress !== null} onClick={() => void confirm()}>Confirm {snapshot.plan.length}</Button>}
            </div>
          </DialogContent>
        )}
      </Dialog>
      {!snapshot && summary && (
        <div role="status" className="space-y-2 break-words text-sm">
          <p>{summary}</p>
          {result?.failures.map((failure, index) => <p key={index} className="text-destructive">{failure.title}: {failure.reason}</p>)}
        </div>
      )}
      {unavailableCount ? (
        <p className="text-sm text-muted-foreground">{unavailableCount} {unavailableCount === 1
          ? "item could not be checked. Answer it individually." : "items could not be checked. Answer them individually."}</p>
      ) : null}
    </div>
  );
}
