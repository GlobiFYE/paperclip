import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Agent, Approval } from "@paperclipai/shared";
import { Link } from "../lib/router";
import { approvalsApi } from "../api/approvals";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { HiringList, agentDescription, hireAttention } from "./WhatNeedsMe/CompactDecisions";

export function pendingHires<T extends { type: string; status: string }>(approvals: T[] | undefined): T[] {
  return (approvals ?? []).filter((approval) => approval.type === "hire_agent" && approval.status === "pending");
}
const RECENT_STATUSES = new Set(["active", "idle", "running", "paused", "error"]);
const STATUS_LABEL: Record<string, string> = { idle: "ready", active: "ready", running: "working", paused: "paused", error: "error" };
export function recentHires(agents: Agent[], approvals: Approval[], days: number, now = Date.now()) {
  const rejected = new Set(approvals.filter((approval) => approval.type === "hire_agent" && approval.status === "rejected")
    .map((approval) => approval.payload.agentId).filter((id): id is string => typeof id === "string"));
  return agents.filter((agent) => RECENT_STATUSES.has(agent.status) && !rejected.has(agent.id)
    && new Date(agent.createdAt).getTime() >= now - days * 86_400_000 && new Date(agent.createdAt).getTime() <= now)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
export function Hiring() {
  const { selectedCompanyId } = useCompany();
  return <CompanyHiring key={selectedCompanyId} companyId={selectedCompanyId} />;
}
function CompanyHiring({ companyId }: { companyId: string | null }) {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [days, setDays] = useState(30);
  useEffect(() => setBreadcrumbs([{ label: "Hiring" }]), [setBreadcrumbs]);
  const approvals = useQuery({ queryKey: queryKeys.approvals.list(companyId!), queryFn: () => approvalsApi.list(companyId!), enabled: !!companyId });
  const agents = useQuery({ queryKey: queryKeys.agents.list(companyId!), queryFn: () => agentsApi.list(companyId!), enabled: !!companyId });
  const agentMap = useMemo(() => new Map((agents.data ?? []).map((agent) => [agent.id, agent])), [agents.data]);
  const entries = useMemo(() => pendingHires(approvals.data).map((record) => ({ record, item: hireAttention(record) })), [approvals.data]);
  const recent = useMemo(() => recentHires(agents.data ?? [], approvals.data ?? [], days), [agents.data, approvals.data, days]);
  if (!companyId) return <p>Select an organization first.</p>;
  return <div className="mx-auto flex min-w-0 max-w-3xl flex-col gap-6 px-4 py-6">
    <h1 className="text-xl font-semibold">Hiring</h1>
    {(approvals.error || agents.error) && <p role="alert" className="text-sm text-destructive">Couldn't load hiring data. Refresh the page to try again.</p>}
    <section aria-labelledby="pending-h" className="flex min-w-0 flex-col gap-3">
      <h2 id="pending-h" className="text-lg font-semibold">Waiting for you <Badge variant="secondary">{entries.length}</Badge></h2>
      {approvals.isLoading ? <p>Loading…</p> : !approvals.error && <HiringList companyId={companyId} entries={entries} agentMap={agentMap} />}
    </section>
    <section aria-labelledby="recent-h" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="recent-h" className="text-lg font-semibold">Recently hired</h2>
        <div role="group" aria-label="Time range" className="flex flex-wrap gap-1">{[7, 30, 90].map((value) =>
          <Button key={value} size="sm" variant={value === days ? "default" : "ghost"} aria-pressed={value === days} onClick={() => setDays(value)}>{value} days</Button>)}</div>
      </div>
      {agents.isLoading || approvals.isLoading ? <p>Loading…</p> : !agents.error && !approvals.error && <>
        {!recent.length && <p className="text-sm text-muted-foreground">No new hires in this period.</p>}
        <ul className="flex min-w-0 flex-col gap-3">{recent.map((agent) => <li key={agent.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border p-3">
          <Link to={`/agents/${agent.urlKey ?? agent.id}`} className="min-w-0 flex-1 break-words text-sm hover:underline">
            {agentDescription(agent as unknown as Record<string, unknown>, agentMap, false)}</Link>
          <Badge variant="outline">{STATUS_LABEL[agent.status]}</Badge>
        </li>)}</ul>
      </>}
    </section>
  </div>;
}

/** Both desktop and mobile sidebar surfaces share this pending approval count. */
export function usePendingHireCount(companyId: string | null | undefined) {
  const { data } = useQuery({ queryKey: queryKeys.approvals.list(companyId!), queryFn: () => approvalsApi.list(companyId!),
    enabled: !!companyId, refetchInterval: 60_000 });
  return pendingHires(data).length;
}
