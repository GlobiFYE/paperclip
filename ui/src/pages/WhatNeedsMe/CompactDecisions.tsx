import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Agent, Approval, AttentionItem, RequestConfirmationInteraction } from "@paperclipai/shared";
import { approvalsApi } from "../../api/approvals";
import { issuesApi } from "../../api/issues";
import { BulkConfirm } from "../../components/BulkConfirm";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { MarkdownBody } from "../../components/MarkdownBody";
import { refreshDecisions } from "./useDecisionRecords";

const str = (value: unknown) => typeof value === "string" ? value : "";
const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
export function agentDescription(payload: Record<string, unknown>, agents: Map<string, Agent>, reason = true) {
  const manager = agents.get(str(payload.reportsTo))?.name;
  const capabilities = str(payload.capabilities).replace(/\s+/g, " ").split(/(?<=[.!?])\s/)[0];
  return [str(payload.name) || "New agent", str(payload.title) || str(payload.role) || "Title not specified",
    str(obj(payload.metadata).division) || "Division not specified", str(obj(payload.adapterConfig).model) || "Default model",
    manager ? `reports to ${manager}` : payload.reportsTo ? "Manager unavailable" : "Reports to the owner",
    reason ? capabilities : ""].filter(Boolean).join(" · ");
}

/** A list approval is already a full API record; this identity lets it reuse G's snapshot/re-read path. */
export function hireAttention(approval: Approval): AttentionItem {
  const date = (value: Date) => new Date(value).toISOString();
  return {
    id: `approval:${approval.id}`, companyId: approval.companyId, sourceKind: "approval",
    subject: { id: approval.id, companyId: approval.companyId, kind: "approval", title: str(approval.payload.name) || "New agent",
      identifier: null, status: approval.status, href: `/approvals/${approval.id}` }, relatedIssue: null,
    whyNow: "Waiting for your approval", decisionVerbs: [], inlineResolvable: true, entryRule: "pending", exitRule: "resolved",
    dedupKey: approval.id, dismissalKey: approval.id, dismissal: null, severity: "low", rank: 1,
    activityAt: date(approval.updatedAt), createdAt: date(approval.createdAt), updatedAt: date(approval.updatedAt),
    project: null, workspace: null, expiresAt: null, ruleKey: null, originAgentName: null, queues: [], shelf: false,
    retentionDays: 7, keep: false, archivedAt: null, retentionVersion: 1, decideBy: null, decideByAttribution: null,
    snoozedUntil: null, detail: null, trainingExampleId: null,
  };
}

function useRowAction(companyId: string) {
  const client = useQueryClient();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  async function run(action: () => Promise<{ status: string }>, expected: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError(null);
    try {
      const receipt = await action();
      if (receipt.status !== expected) throw new Error("This item changed. Refresh and review it again.");
      setResolved(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "The answer could not be saved. Try again.");
    } finally {
      await refreshDecisions(client, companyId);
      lock.current = false; setBusy(false);
    }
  }
  return { run, busy, error, resolved };
}

export function HiringList({ companyId, entries, agentMap, currentUserId, userLabelMap }: {
  companyId: string; entries: { item: AttentionItem; record: Approval }[]; agentMap: Map<string, Agent>;
  currentUserId?: string | null; userLabelMap?: ReadonlyMap<string, string>;
}) {
  return <div className="flex min-w-0 flex-col gap-3">
    <BulkConfirm companyId={companyId} items={entries.map(({ item }) => item)} agentMap={agentMap}
      currentUserId={currentUserId} userLabelMap={userLabelMap} actionLabel="Approve all" onSelectIndividual={() => {}} />
    {entries.length === 0 && <p>All caught up</p>}
    <ul className="flex min-w-0 flex-col gap-3">
      {entries.map(({ record }) => <HireRow key={record.id} companyId={companyId} approval={record} agentMap={agentMap} />)}
    </ul>
  </div>;
}
function HireRow({ companyId, approval, agentMap }: { companyId: string; approval: Approval; agentMap: Map<string, Agent> }) {
  const action = useRowAction(companyId);
  if (action.resolved) return null;
  return <li className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border p-3">
    <p className="min-w-0 flex-1 break-words text-sm">{agentDescription(approval.payload, agentMap)}</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={action.busy} onClick={() => void action.run(() => approvalsApi.approve(approval.id), "approved")}>Approve</Button>
      <Button size="sm" variant="outline" disabled={action.busy}
        onClick={() => void action.run(() => approvalsApi.reject(approval.id, "Cancelled by the owner."), "rejected")}>Cancel</Button>
    </div>
    {action.error && <p role="alert" className="w-full text-sm text-destructive">{action.error}</p>}
  </li>;
}

export function ConfirmationRow({ companyId, record }: { companyId: string; record: RequestConfirmationInteraction }) {
  const action = useRowAction(companyId);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  if (action.resolved) return null;
  const reject = () => action.run(() => issuesApi.rejectInteraction(record.issueId, record.id, reason.trim() || undefined), "rejected");
  return <li className="flex min-w-0 flex-col gap-3 rounded-md border p-3">
    <div className="flex flex-wrap items-center gap-3">
      <p className="min-w-0 flex-1 break-words text-sm">{record.payload.prompt}</p>
      <div className="flex gap-2">
        <Button disabled={action.busy} onClick={() => void action.run(() => issuesApi.acceptInteraction(record.issueId, record.id), "accepted")}>Yes</Button>
        <Button variant="outline" disabled={action.busy} onClick={() => {
          if (record.payload.rejectRequiresReason) setDeclining(true); else void reject();
        }}>No</Button>
      </div>
    </div>
    {declining && <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); if (reason.trim()) void reject(); }}>
      <Input autoFocus aria-label="Reason for declining" placeholder="Why are you declining?" value={reason} onChange={(event) => setReason(event.target.value)} />
      <Button type="submit" disabled={action.busy || !reason.trim()}>Submit reason</Button>
    </form>}
    {record.payload.detailsMarkdown && <details><summary className="cursor-pointer text-sm underline">Details</summary>
      <MarkdownBody>{record.payload.detailsMarkdown}</MarkdownBody></details>}
    {action.error && <p role="alert" className="text-sm text-destructive">{action.error}</p>}
  </li>;
}
