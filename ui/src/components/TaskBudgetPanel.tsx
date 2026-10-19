import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BudgetMetric, BudgetPolicySummary, TaskBudgetPatchInput } from "@paperclipai/shared";
import { budgetsApi } from "../api/budgets";
import { queryKeys } from "../lib/queryKeys";
import { budgetInputValue, formatBudgetAmount, parseBudgetInput } from "../lib/task-budget-format";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function TaskBudgetPanel({ issueId }: { issueId: string }) {
  const client = useQueryClient();
  const { data, error, isPending } = useQuery({ queryKey: queryKeys.budgets.task(issueId),
    queryFn: () => budgetsApi.task(issueId), refetchInterval: 15000 });
  const [editing, setEditing] = useState(false);
  const [editBaseline, setEditBaseline] = useState<BudgetPolicySummary[]>([]);
  const [dollars, setDollars] = useState("");
  const [tokens, setTokens] = useState("");
  useEffect(() => {
    if (editing) return;
    const cost = data?.ownPolicies.find(row => row.metric === "billed_cents" && row.isActive);
    const token = data?.ownPolicies.find(row => row.metric === "total_tokens" && row.isActive);
    setDollars(cost ? budgetInputValue("billed_cents", cost.amount) : "");
    setTokens(token ? budgetInputValue("total_tokens", token.amount) : "");
  }, [data, editing]);
  const save = useMutation({ mutationFn: (input: TaskBudgetPatchInput) => budgetsApi.updateTask(issueId, input),
    onSuccess: summary => {
      client.setQueryData(queryKeys.budgets.task(issueId), summary);
      void client.invalidateQueries({ queryKey: ["budgets"] });
      setEditing(false);
    } });
  if (error) return <p role="alert" className="text-xs text-destructive">Could not load task budget: {error.message}</p>;
  if (isPending || !data) return null;
  const hasPolicies = data.policies.some(policy => policy.isActive);
  const canEdit = Object.values(data.permissions).some(permission => permission.canSet);
  const invalid = dollars.trim() && parseBudgetInput("billed_cents", dollars) === null
    || tokens.trim() && parseBudgetInput("total_tokens", tokens) === null;
  const submit = () => {
    const changes: TaskBudgetPatchInput = { expectedRevisions: {} };
    for (const [metric, field, draft] of [["billed_cents", "maxCostCents", dollars], ["total_tokens", "maxTokens", tokens]] as const) {
      const policy = editBaseline.find(row => row.metric === metric);
      const amount = draft.trim() ? parseBudgetInput(metric, draft) : null;
      const existing = policy?.isActive ? policy.amount : null;
      if (amount !== existing) {
        changes[field] = amount;
        changes.expectedRevisions[metric] = policy?.revision ?? 0;
      }
    }
    if (changes.maxCostCents === undefined && changes.maxTokens === undefined) { setEditing(false); return; }
    save.mutate(changes);
  };
  return <section className="space-y-3 text-xs" aria-label="Task budget">
    <div className="flex items-center justify-between gap-3">
      <span className="font-medium">Budget</span>
      {canEdit && !editing ? <Button size="sm" variant="ghost" onClick={() => { setEditBaseline(data.ownPolicies); setEditing(true); }}>{hasPolicies ? "Edit" : "Set budget"}</Button> : null}
    </div>
    {data.initialization === "pending" ? <p className="text-muted-foreground">Preparing historical usage…</p> : null}
    {data.primaryBlocker ? <p role="status" className="text-destructive">{data.primaryBlocker.reason}</p> : null}
    {hasPolicies ? <div className="space-y-2">
      {(["billed_cents", "total_tokens"] as BudgetMetric[]).map(metric => {
        const policies = data.policies.filter(row => row.isActive && row.metric === metric);
        if (!policies.length) return null;
        const limiting = policies.reduce((left, right) => left.remainingAmount <= right.remainingAmount ? left : right);
        const own = policies.find(row => row.scopeId === issueId);
        const used = metric === "billed_cents" ? data.directUsage.billedCents + data.descendantUsage.billedCents
          : data.directUsage.totalTokens + data.descendantUsage.totalTokens;
        return <div key={metric} className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 tabular-nums">
            <span>{formatBudgetAmount(metric, used)} used{own ? ` / ${formatBudgetAmount(metric, own.amount)}` : ""}</span>
            <span className={limiting.status === "warning" ? "text-amber-700 dark:text-amber-200" : "text-muted-foreground"}>{data.remaining[metric] === null ? "Usage incomplete" : `${formatBudgetAmount(metric, data.remaining[metric]!)} available`}</span>
          </div>
          {limiting.scopeId !== issueId ? <Link className="text-muted-foreground underline" to={`/issues/${limiting.scopeId}`}>Shared with {limiting.scopeName}</Link> : null}
        </div>;
      })}
      <p className="text-muted-foreground">Charged to this task and its delegated work.</p>
      {data.legacyAttribution ? <p className="text-muted-foreground">Historical usage uses the task hierarchy recorded during setup.</p> : null}
    </div> : <p className="text-muted-foreground">No task spending limit.</p>}
    {editing ? <div className="space-y-3">
      <label className="flex flex-col gap-1">Dollar limit (USD)
        <Input aria-label="Dollar limit (USD)" inputMode="decimal" value={dollars} onChange={event => setDollars(event.target.value)} disabled={!data.permissions.billed_cents.canSet} placeholder="Inherited" />
      </label>
      <label className="flex flex-col gap-1">Token limit
        <Input aria-label="Token limit" inputMode="numeric" value={tokens} onChange={event => setTokens(event.target.value)} disabled={!data.permissions.total_tokens.canSet} placeholder="Inherited" />
      </label>
      <p className="text-muted-foreground">Lifetime limits include delegated work. Blank fields use enclosing limits.</p>
      {invalid ? <p role="alert" className="text-destructive">Enter a positive dollar amount or whole token count.</p> : null}
      {save.error ? <p role="alert" className="text-destructive">{save.error.message}</p> : null}
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={save.isPending}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={Boolean(invalid) || save.isPending || data.initialization !== "ready"}>{save.isPending ? "Saving…" : "Save budget"}</Button>
      </div>
    </div> : null}
  </section>;
}
