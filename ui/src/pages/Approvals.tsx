import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { approvalsApi } from "../api/approvals";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { PageTabBar } from "../components/PageTabBar";
import { Tabs } from "@/components/ui/tabs";
import { ShieldCheck } from "lucide-react";
import { ApprovalCard } from "../components/ApprovalCard";
import { PageSkeleton } from "../components/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { approvalLabel, approvalSubject } from "../components/ApprovalPayload";

type StatusFilter = "pending" | "all";
type BulkSnapshot = {
  companyId: string;
  items: { id: string; label: string; name: string | null; title: string | null; subject: string }[];
  otherCount: number;
};

export function Approvals() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const pathSegment = location.pathname.split("/").pop() ?? "pending";
  const statusFilter: StatusFilter = pathSegment === "all" ? "all" : "pending";
  const [actionError, setActionError] = useState<string | null>(null);
  const [bulkSnapshot, setBulkSnapshot] = useState<BulkSnapshot | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<number | null>(null);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const bulkInFlight = useRef(false);
  const bulkTrigger = useRef<HTMLButtonElement>(null);
  const pendingList = useRef<HTMLDivElement>(null);
  const focusPendingList = useRef(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Approvals" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.approvals.list(selectedCompanyId!),
    queryFn: () => approvalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.approve(id),
    onSuccess: (_approval, id) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
      navigate(`/approvals/${id}?resolved=approved`);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to approve");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.reject(id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to reject");
    },
  });

  const filtered = (data ?? [])
    .filter(
      (a) => statusFilter === "all" || a.status === "pending" || a.status === "revision_requested",
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const pendingCount = (data ?? []).filter(
    (a) => a.status === "pending" || a.status === "revision_requested",
  ).length;
  const bulkEligible = filtered.filter((a) => a.type === "hire_agent" && a.status === "pending");
  const bulkBusy = bulkProgress !== null;
  const currentBulk = bulkSnapshot?.companyId === selectedCompanyId;

  function openBulkDialog() {
    if (!selectedCompanyId || bulkInFlight.current) return;
    setBulkSnapshot({
      companyId: selectedCompanyId,
      items: bulkEligible.map((approval) => {
        const name = typeof approval.payload.name === "string" ? approval.payload.name.trim() || null : null;
        const title = typeof approval.payload.title === "string" ? approval.payload.title.trim() || null : null;
        const subject = approvalSubject(approval.payload) ?? approval.id;
        return {
          id: approval.id,
          label: approvalSubject(approval.payload)
            ? approvalLabel(approval.type, approval.payload)
            : `${approvalLabel(approval.type, approval.payload)}: ${approval.id}`,
          name,
          title,
          subject: name ?? subject,
        };
      }),
      otherCount: pendingCount - bulkEligible.length,
    });
    setBulkResult(null);
    setBulkOpen(true);
  }

  async function approveBulk() {
    if (!bulkSnapshot || !currentBulk || bulkInFlight.current || bulkResult) return;
    bulkInFlight.current = true;
    let approved = 0;
    const failures: string[] = [];
    for (const [index, item] of bulkSnapshot.items.entries()) {
      setBulkProgress(index + 1);
      try {
        await approvalsApi.approve(item.id);
        approved += 1;
      } catch (err) {
        failures.push(`${item.subject}: ${err instanceof Error ? err.message : "Failed to approve"}`);
      }
    }
    setBulkResult(`${approved} approved, ${failures.length} failed${failures.length ? `: ${failures.join("; ")}` : ""}`);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(bulkSnapshot.companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(bulkSnapshot.companyId) }),
    ]);
    setBulkProgress(null);
    bulkInFlight.current = false;
  }

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select an organization first.</p>;
  }

  if (isLoading) {
    return <PageSkeleton variant="approvals" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={statusFilter} onValueChange={(v) => navigate(`/approvals/${v}`)}>
          <PageTabBar items={[
            { value: "pending", label: <>Pending{pendingCount > 0 && (
              <Badge variant="ghost" className={cn(
                "ml-1.5 px-1.5 text-(length:--text-nano)",
                "bg-yellow-500/20 text-yellow-500"
              )}>
                {pendingCount}
              </Badge>
            )}</> },
            { value: "all", label: "All" },
          ]} />
        </Tabs>
        {statusFilter === "pending" && bulkEligible.length >= 2 && (
          <Button ref={bulkTrigger} onClick={openBulkDialog} disabled={bulkBusy || approveMutation.isPending || rejectMutation.isPending}>
            Approve all ({bulkEligible.length})
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}
      {currentBulk && bulkResult && !bulkOpen && <p role="status" className="text-sm break-words">{bulkResult}</p>}

      <Dialog open={bulkOpen && currentBulk} onOpenChange={(open) => { if (!bulkInFlight.current) setBulkOpen(open); }}>
        <DialogContent
          className="max-h-(--sz-calc-18) overflow-y-auto"
          showCloseButton={!bulkBusy && !bulkResult}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = focusPendingList.current ? pendingList.current : bulkTrigger.current ?? pendingList.current;
            target?.focus();
            focusPendingList.current = false;
          }}
        >
          <DialogHeader>
            <DialogTitle>Approve all hires ({bulkSnapshot?.items.length ?? 0})</DialogTitle>
            <DialogDescription>Review these hire requests before approving them. Only the items listed here will be approved.</DialogDescription>
          </DialogHeader>
          <ul aria-label="Hires to approve" tabIndex={0} className="max-h-(--sz-50vh) overflow-y-auto space-y-3 text-sm">
            {bulkSnapshot?.items.map((item) => (
              <li key={item.id} className="space-y-1 break-words">
                <p className="font-medium">{item.label}</p>
                <p>Name: {item.name ?? item.subject}</p>
                <p className="text-muted-foreground">Title: {item.title ?? "Not provided"}</p>
              </li>
            ))}
          </ul>
          {!!bulkSnapshot?.otherCount && (
            <p className="text-sm">
              {bulkSnapshot.otherCount} other approvals need individual review. {" "}
              <a href="#pending-approvals" className="underline" aria-disabled={bulkBusy} onClick={(event) => {
                event.preventDefault();
                if (bulkInFlight.current) return;
                focusPendingList.current = true;
                setBulkOpen(false);
              }}>View pending list</a>
            </p>
          )}
          <p role="status" className="text-sm break-words">
            {bulkResult ?? (bulkBusy ? `Approving ${bulkProgress} of ${bulkSnapshot?.items.length}...` : null)}
          </p>
          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button variant="outline" disabled={bulkBusy} onClick={() => setBulkOpen(false)}>
              {bulkResult ? "Close" : "Cancel"}
            </Button>
            {!bulkResult && <Button disabled={bulkBusy} onClick={() => void approveBulk()}>Approve {bulkSnapshot?.items.length}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div id="pending-approvals" ref={pendingList} tabIndex={-1} aria-label="Approvals list">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ShieldCheck className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              {statusFilter === "pending" ? "No pending approvals." : "No approvals yet."}
            </p>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="grid gap-3">
            {filtered.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                requesterAgent={approval.requestedByAgentId ? (agents ?? []).find((a) => a.id === approval.requestedByAgentId) ?? null : null}
                onApprove={() => approveMutation.mutate(approval.id)}
                onReject={() => rejectMutation.mutate(approval.id)}
                detailLink={`/approvals/${approval.id}`}
                isPending={bulkBusy || approveMutation.isPending || rejectMutation.isPending}
                pendingAction={
                  approveMutation.isPending ? "approve" : rejectMutation.isPending ? "reject" : null
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
