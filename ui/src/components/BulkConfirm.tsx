import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, AttentionItem } from "@paperclipai/shared";
import { bulkConfirmPlan, type BulkConfirmEntry } from "../lib/bulk-confirm";
import { hydrateBulkItems, runBulkConfirm, type BulkConfirmResult } from "../lib/bulk-confirm-api";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";

interface Snapshot {
  plan: BulkConfirmEntry[];
  individual: AttentionItem[];
}

export function BulkConfirm({ companyId, items, revision, agentMap }: {
  companyId: string;
  items: AttentionItem[];
  revision: string | undefined;
  agentMap: Map<string, Agent>;
}) {
  const queryClient = useQueryClient();
  const hydrated = useQuery({
    queryKey: [...queryKeys.attention(companyId), "bulk-confirm", revision, items.map((item) => [item.id, item.updatedAt])],
    queryFn: () => hydrateBulkItems(companyId, items),
    retry: false,
  });
  const plan = useMemo(() => bulkConfirmPlan(hydrated.data?.records ?? []), [hydrated.data]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<BulkConfirmResult | null>(null);
  const running = useRef(false);

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
    try {
      setResult(await runBulkConfirm(companyId, snapshot.plan, setProgress));
    } finally {
      setProgress(null);
      running.current = false;
      // Prefix invalidation covers details, lists, interaction cards and badges.
      await Promise.all([
        queryKeys.attention(companyId), ["decisions"], ["approvals"],
        ["issues", "interactions"], queryKeys.sidebarBadges(companyId),
        queryKeys.agents.list(companyId), queryKeys.decisionQueues.list(companyId),
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
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
            <Button disabled={hydrated.isFetching || progress !== null || plan.length < 2}>Confirm all ({plan.length})</Button>
          </DialogTrigger>
        )}
        {snapshot && (
          <DialogContent showCloseButton={progress === null} className="max-h-(--sz-80vh) overflow-y-auto">
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
                        : entry.askedByUserId ? `user ${entry.askedByUserId}` : "the system"}
                    </p>
                    {entry.answers.map((answer, index) => <p key={index} className="text-sm">{answer}</p>)}
                  </li>
                ))}
              </ul>
              <p className="text-sm">{snapshot.individual.length} items need your individual answer</p>
              <ul className="space-y-1">
                {snapshot.individual.map((item) => (
                  <li key={item.id} className="text-sm">
                    <a className="underline" href={item.subject.href ?? item.relatedIssue?.href ?? `#attention-row-${item.id}`}>
                      {item.subject.title ?? "Open item"}
                    </a>
                  </li>
                ))}
              </ul>
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
      {hydrated.data?.unavailableIds.length ? (
        <p className="text-sm text-muted-foreground">{hydrated.data.unavailableIds.length} items could not be checked. Answer them individually.</p>
      ) : null}
    </div>
  );
}
