import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "../../lib/router";
import { attentionApi } from "../../api/attention";
import { agentsApi } from "../../api/agents";
import { authApi } from "../../api/auth";
import { accessApi } from "../../api/access";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { queryKeys } from "../../lib/queryKeys";
import { buildCompanyUserLabelMap } from "../../lib/company-members";
import { attentionIsAging } from "../../lib/attention";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { PageSkeleton } from "../../components/PageSkeleton";
import { BulkConfirm } from "../../components/BulkConfirm";
import { AllDecisions } from "../WhatNeedsMe";
import { classifyDecision, type DecisionCategory } from "./classifyDecision";
import { useDecisionRecords } from "./useDecisionRecords";
import { HiringList, ConfirmationRow } from "./CompactDecisions";
import { QuestionQueue } from "./QuestionQueue";

export const decisionTabs = [
  ["hiring", "Hiring"], ["yesno", "Yes / No"], ["questions", "Questions"],
  ["closer_look", "Needs a closer look"], ["all", "All"],
] as const;
export type DecisionTab = typeof decisionTabs[number][0];
export function defaultDecisionTab(counts: Record<DecisionCategory, number>): DecisionTab {
  return counts.hiring ? "hiring" : counts.yesno ? "yesno" : counts.question ? "questions" : "closer_look";
}

export function DecisionTabs() {
  const { selectedCompanyId } = useCompany();
  return <CompanyDecisionTabs key={selectedCompanyId} companyId={selectedCompanyId} />;
}
function CompanyDecisionTabs({ companyId }: { companyId: string | null }) {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => setBreadcrumbs([{ label: "Decisions" }]), [setBreadcrumbs]);
  const [params, setParams] = useSearchParams();
  const feed = useQuery({ queryKey: [...queryKeys.attention(companyId!), "with-dismissed", null, null],
    queryFn: () => attentionApi.list(companyId!, { includeDismissed: true, all: true }), enabled: !!companyId });
  const agents = useQuery({ queryKey: queryKeys.agents.list(companyId!), queryFn: () => agentsApi.list(companyId!), enabled: !!companyId });
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: () => authApi.getSession() });
  const userId = session.data?.user?.id ?? session.data?.session?.userId ?? null;
  const members = useQuery({ queryKey: queryKeys.access.companyUserDirectory(companyId!), queryFn: () => accessApi.listUserDirectory(companyId!), enabled: !!companyId });
  const userLabelMap = useMemo(() => buildCompanyUserLabelMap(members.data?.users), [members.data]);
  const agentMap = useMemo(() => new Map((agents.data ?? []).map((agent) => [agent.id, agent])), [agents.data]);
  const items = useMemo(() => (feed.data?.items ?? []).filter((item) => !item.dismissal?.isActive && !attentionIsAging(item)), [feed.data]);
  const hydrated = useDecisionRecords(companyId, items, userId);
  const counts: Record<DecisionCategory, number> = { hiring: 0, yesno: 0, question: 0, closer_look: 0 };
  const categorized = items.map((item) => {
    const record = hydrated.data?.get(item.id);
    const category = classifyDecision(item, record);
    counts[category]++;
    return { item, record, category };
  });
  const requested = params.get("tab");
  const tab: DecisionTab = decisionTabs.some(([key]) => key === requested) ? requested as DecisionTab
    : params.has("decisionId") ? "all" : defaultDecisionTab(counts);
  const selectTab = (nextTab: DecisionTab) => setParams((previous) => {
    const next = new URLSearchParams(previous); next.set("tab", nextTab); next.delete("decisionId"); return next;
  });
  const loading = feed.isLoading || hydrated.isFetching || session.isLoading;
  useEffect(() => {
    if (loading || feed.error || requested === tab) return;
    setParams((previous) => { const next = new URLSearchParams(previous); next.set("tab", tab); return next; }, { replace: true });
  }, [loading, feed.error, requested, tab, setParams]);
  if (!companyId) return <p>Select an organization first.</p>;
  if (loading && !requested && tab !== "all") return <PageSkeleton variant="approvals" />;
  const hires = categorized.flatMap(({ item, record, category }) => category === "hiring" && record?.kind === "approval" ? [{ item, record: record.record }] : []);
  const confirmations = categorized.flatMap(({ item, record, category }) => category === "yesno" && record?.kind === "interaction" && record.record.kind === "request_confirmation" ? [{ item, record: record.record }] : []);
  const questions = categorized.flatMap(({ record, category }) => category === "question" && record ? [record] : []);
  return <div className="flex min-w-0 max-w-3xl flex-col gap-4">
    {tab !== "all" && <h1 className="text-xl font-bold">Decisions</h1>}
    <div role="tablist" aria-label="Decision categories" className="flex flex-wrap gap-2">
      {decisionTabs.map(([key, label]) => <Button key={key} role="tab" aria-label={`${label} ${key === "all" ? items.length : counts[key === "questions" ? "question" : key]}`} id={`decision-tab-${key}`} aria-controls="decision-tab-panel" aria-selected={tab === key}
        variant={tab === key ? "default" : "outline"} tabIndex={tab === key ? 0 : -1} onClick={() => selectTab(key)}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index = decisionTabs.findIndex(([value]) => value === key);
          const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? decisionTabs.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + decisionTabs.length) % decisionTabs.length;
          const next = decisionTabs[nextIndex][0];
          selectTab(next); document.getElementById(`decision-tab-${next}`)?.focus();
        }}>{label}<Badge variant="secondary">{key === "all" ? items.length : counts[key === "questions" ? "question" : key]}</Badge></Button>)}
    </div>
    {feed.error && <p role="alert" className="text-destructive">Could not load decisions. Refresh to try again.</p>}
    <div role="tabpanel" id="decision-tab-panel" aria-labelledby={`decision-tab-${tab}`} className="min-w-0">
      {tab === "all" && <AllDecisions />}
      {tab === "closer_look" && <AllDecisions onlyItemIds={new Set(categorized.filter(({ category }) => category === "closer_look").map(({ item }) => item.id))} />}
      {tab === "hiring" && <HiringList companyId={companyId} entries={hires} agentMap={agentMap} currentUserId={userId} userLabelMap={userLabelMap} />}
      {tab === "yesno" && <div className="flex flex-col gap-3">
        <BulkConfirm companyId={companyId} items={confirmations.map(({ item }) => item)} agentMap={agentMap} currentUserId={userId} userLabelMap={userLabelMap} onSelectIndividual={() => {}} />
        {!confirmations.length && <p>All caught up</p>}
        <ul className="flex flex-col gap-3">{confirmations.map(({ record }) => <ConfirmationRow key={record.id} companyId={companyId} record={record} />)}</ul>
      </div>}
      {tab === "questions" && <QuestionQueue companyId={companyId} entries={questions} agentMap={agentMap} currentUserId={userId} userLabelMap={userLabelMap} />}
    </div>
  </div>;
}
