import { taskBudgetMeteringSupport } from "./task-budget-metering.js";
import { compareCents, centsToUnits } from "@paperclipai/shared";
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agentWakeupRequests, agents, approvals, budgetIncidents, budgetPolicies, companies, costEvents, costEventTaskScopes, heartbeatRuns, issues,
  taskBudgetAccountingState, taskBudgetEffects, taskBudgetRunAncestors, taskBudgetRunContexts,
} from "@paperclipai/db";
import type { BudgetMetric, BudgetPolicySummary, TaskBudgetBlock, TaskBudgetCreateInput,
  TaskBudgetPatchInput, TaskBudgetSummary, TaskBudgetMeteringSupport } from "@paperclipai/shared";
import { conflict, forbidden, HttpError, notFound, unprocessable } from "../errors.js";
import { logActivity } from "./activity-log.js";
import { authorizationService } from "./authorization.js";
import {
  attributeTaskCostEvent, captureTaskBudgetRun, initializeTaskBudgetAccounting, lockTaskBudgetCompany,
  recordTaskRunUsageInTransaction, settleTaskBudgetRunFromLedger, taskBudgetAncestors, taskBudgetUsage, type TaskRunUsageSample,
} from "./task-budget-accounting.js";

export type TaskBudgetActor = { type: "board"; userId?: string | null }
  | { type: "agent"; agentId: string; runId: string | null };
const METRICS = ["billed_cents", "total_tokens"] as const;
const WINDOW_START = new Date("1970-01-01T00:00:00Z");
const WINDOW_END = new Date("9999-01-01T00:00:00Z");
type Policy = typeof budgetPolicies.$inferSelect;
type Usage = Awaited<ReturnType<typeof taskBudgetUsage>>;

function observed(usage: Usage, metric: BudgetMetric) {
  return metric === "billed_cents" ? usage.billedCents : usage.totalTokens;
}
function incomplete(usage: Usage, metric: BudgetMetric) {
  return metric === "billed_cents"
    ? usage.unknownCost > 0 || usage.incompleteCostRunIds.length > 0
    : usage.unknownTokens > 0 || usage.incompleteTokenRunIds.length > 0;
}
function policySummary(policy: Policy, usage: Usage, name: string): BudgetPolicySummary {
  const value = observed(usage, policy.metric as BudgetMetric);
  const atLeast = (limit: number) => policy.metric === "billed_cents" ? compareCents(usage.billedCentsExact, limit) >= 0 : value >= limit;
  const status = atLeast(policy.amount) ? "hard_stop" : atLeast(Math.ceil(policy.amount * policy.warnPercent / 100)) ? "warning" : "ok";
  const paused = policy.isActive && (status === "hard_stop" || incomplete(usage, policy.metric as BudgetMetric));
  return { policyId: policy.id, revision: policy.revision, companyId: policy.companyId,
    scopeType: "issue", scopeId: policy.scopeId, scopeName: name, metric: policy.metric as BudgetMetric,
    windowKind: "lifetime", amount: policy.amount, observedAmount: value, remainingAmount: Math.max(0, policy.amount - value),
    utilizationPercent: policy.amount ? value * 100 / policy.amount : 0, warnPercent: policy.warnPercent,
    unpricedEventCount: policy.metric === "billed_cents" ? usage.unknownCost : usage.unknownTokens,
    pendingRunCount: policy.metric === "billed_cents" ? usage.incompleteCostRunIds.length : usage.incompleteTokenRunIds.length,
    unpricedUsagePolicy: "block", observedAmountExact: policy.metric === "billed_cents" ? usage.billedCentsExact : String(value),
    hardStopEnabled: true, notifyEnabled: policy.notifyEnabled, isActive: policy.isActive,
    status, paused, pauseReason: paused ? "budget" : null, windowStart: WINDOW_START, windowEnd: WINDOW_END };
}

async function policiesForScopes(db: Db, companyId: string, ids: string[]) {
  if (!ids.length) return [];
  return db.select().from(budgetPolicies).where(and(eq(budgetPolicies.companyId, companyId),
    eq(budgetPolicies.scopeType, "issue"), inArray(budgetPolicies.scopeId, ids)));
}

export function taskBudgetService(db: Db) {
  async function authorizeManager(tx: Db, companyId: string, issueId: string, actor: TaskBudgetActor, metric: BudgetMetric) {
    if (actor.type === "board") return;
    if (!actor.runId) throw forbidden("Budget allocation requires a registered source run");
    const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, actor.runId),
      eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, actor.agentId)));
    const [agent] = await tx.select().from(agents).where(and(eq(agents.id, actor.agentId), eq(agents.companyId, companyId)));
    if (!run || !agent || run.status !== "running" || ["paused", "terminated", "pending_approval"].includes(agent.status)) {
      throw forbidden("Budget allocation requires an active, authorized agent run");
    }
    const ancestry = await taskBudgetAncestors(tx, companyId, issueId);
    if (ancestry[0].assigneeAgentId === actor.agentId) throw forbidden("Agents cannot increase their own funding", { code: "task_budget_self_increase" });
    const sourceTask = run.contextSnapshot?.issueId ?? run.nativeIssueId;
    if (!ancestry.slice(1).some(row => row.id === sourceTask && row.assigneeAgentId === actor.agentId)) {
      throw forbidden("Only the current owner of a strict funding ancestor may allocate this budget");
    }
    const policies = (await policiesForScopes(tx, companyId, ancestry.slice(1).map(row => row.id)))
      .filter(row => row.isActive && row.metric === metric);
    if (!policies.length) throw forbidden("The board must provide enclosing funding for this metric first");
    const decision = await authorizationService(tx).decide({ actor: { type: "agent", source: "agent_jwt", companyId,
      agentId: actor.agentId, runId: actor.runId, onBehalfOfUserId: run.responsibleUserId }, action: "tasks:assign",
      resource: { type: "issue", companyId, issueId, parentIssueId: ancestry[0].parentId, assigneeAgentId: ancestry[0].assigneeAgentId },
    });
    if (!decision.allowed) throw forbidden(decision.explanation);
    const { budgetServiceInTransaction } = await import("./budgets.js");
    if (await budgetServiceInTransaction(tx).getInvocationBlock(companyId, actor.agentId, { issueId: String(sourceTask), projectId: run.contextSnapshot?.projectId as string | null })) {
      throw forbidden("The manager's execution is blocked by a budget or pause gate");
    }
  }

  async function invocationBlock(tx: Db, companyId: string, issueId: string, metering?: string | TaskBudgetMeteringSupport): Promise<TaskBudgetBlock | null> {
    const [anyPolicy] = await tx.select({ id: budgetPolicies.id }).from(budgetPolicies).where(and(
      eq(budgetPolicies.companyId, companyId), eq(budgetPolicies.scopeType, "issue"), eq(budgetPolicies.isActive, true))).limit(1);
    if (!anyPolicy) return null;
    const ancestry = await taskBudgetAncestors(tx, companyId, issueId);
    const policies = (await policiesForScopes(tx, companyId, ancestry.map(row => row.id))).filter(row => row.isActive);
    for (const ancestor of ancestry.slice().reverse()) {
      for (const metric of METRICS) {
        const policy = policies.find(row => row.scopeId === ancestor.id && row.metric === metric);
        if (!policy) continue;
        const usage = await taskBudgetUsage(tx, companyId, ancestor.id);
        const missing = incomplete(usage, metric);
        const value = observed(usage, metric);
        if (!missing && (metric === "billed_cents" ? compareCents(usage.billedCentsExact, policy.amount) < 0 : value < policy.amount)) continue;
        const scopeName = ancestor.id === issueId ? ancestor.title : "Enclosing task";
        return { code: missing ? "task_budget_usage_unavailable" : "task_budget_exhausted", scopeType: "issue",
          scopeId: ancestor.id, scopeName, metric, policyId: policy.id, policyRevision: policy.revision,
          observedAmount: missing ? null : value, amount: policy.amount,
          reason: missing ? `Usage reporting for ${scopeName} is incomplete. Repair accounting before continuing.`
            : `${scopeName} reached its ${metric === "billed_cents" ? "dollar" : "token"} budget, including delegated work.` };
      }
    }
    const unsupported = policies.find(policy => typeof metering === "string"
      ? !["codex_local", "claude_local"].includes(metering)
      : metering && (policy.metric === "billed_cents" ? metering.billedCents : metering.totalTokens) === "unsupported");
    if (unsupported) {
      const policy = unsupported;
      return { code: "task_budget_metering_unsupported", scopeType: "issue", scopeId: policy.scopeId,
        scopeName: policy.scopeId === issueId ? ancestry[0].title : "Enclosing task", metric: policy.metric as BudgetMetric,
        policyId: policy.id, policyRevision: policy.revision, observedAmount: null, amount: policy.amount,
        reason: `This runtime cannot report authoritative ${policy.metric === "billed_cents" ? "billed cost" : "token usage"} for task budgets. Choose a supported runtime and billing mode.` };
    }
    return null;
  }

  async function evaluatePolicies(tx: Db, companyId: string, scopeIds: string[], sourceIssueId?: string | null) {
    const policies = (await policiesForScopes(tx, companyId, scopeIds)).filter(row => row.isActive);
    for (const policy of policies) {
      const usage = await taskBudgetUsage(tx, companyId, policy.scopeId);
      const value = observed(usage, policy.metric as BudgetMetric);
      const missing = incomplete(usage, policy.metric as BudgetMetric);
      const hard = policy.metric === "billed_cents" ? compareCents(usage.billedCentsExact, policy.amount) >= 0 : value >= policy.amount;
      const soft = value >= Math.ceil(policy.amount * policy.warnPercent / 100);
      const [issue] = await tx.select({ title: issues.title }).from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, policy.scopeId)));
      if (hard) await tx.update(budgetIncidents).set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(budgetIncidents.policyId, policy.id), eq(budgetIncidents.policyRevision, policy.revision), eq(budgetIncidents.thresholdType, "soft"), eq(budgetIncidents.status, "open")));
      if (hard || (soft && policy.notifyEnabled)) {
        const thresholdType = hard ? "hard" : "soft";
        const [existing] = await tx.select().from(budgetIncidents).where(and(eq(budgetIncidents.policyId, policy.id),
          eq(budgetIncidents.policyRevision, policy.revision), eq(budgetIncidents.thresholdType, thresholdType)));
        if (!existing) {
          const [approval] = hard ? await tx.insert(approvals).values({ companyId, type: "budget_override_required", status: "pending",
            payload: { scopeType: "issue", scopeId: policy.scopeId, scopeName: issue?.title ?? "Deleted task", metric: policy.metric,
              windowKind: "lifetime", policyId: policy.id, policyRevision: policy.revision, budgetAmount: policy.amount,
              observedAmount: value, guidance: "Set a new finite limit to fund more work. Enclosing limits still apply." },
          }).returning() : [];
          const [incident] = await tx.insert(budgetIncidents).values({ companyId, policyId: policy.id, policyRevision: policy.revision,
            scopeType: "issue", scopeId: policy.scopeId, metric: policy.metric, windowKind: "lifetime", windowStart: WINDOW_START,
            windowEnd: WINDOW_END, thresholdType, amountLimit: policy.amount, amountObserved: value, approvalId: approval?.id ?? null }).returning();
          await logActivity(tx, { companyId, actorType: "system", actorId: "budget_service", action: `budget.${hard ? "hard" : "soft"}_threshold_crossed`,
            entityType: "budget_incident", entityId: incident.id, issueId: policy.scopeId,
            details: { scopeType: "issue", scopeId: policy.scopeId, metric: policy.metric, amountObserved: value, amountLimit: policy.amount } });
        }
      }
      if (hard || missing) {
        await tx.insert(taskBudgetEffects).values({ companyId, scopeId: policy.scopeId, kind: "stop",
          payload: { issueIds: sourceIssueId ? [sourceIssueId] : [] },
          dedupeKey: `stop:${policy.id}:${policy.revision}:${missing ? `incomplete:${usage.incompleteCostRunIds.concat(usage.incompleteTokenRunIds).sort().join(":")}:${usage.unknownCost}:${usage.unknownTokens}` : "exhausted"}` }).onConflictDoNothing();
      }
    }
  }

  async function patchInTransaction(tx: Db, companyId: string, issueId: string, input: TaskBudgetPatchInput, actor: TaskBudgetActor) {
    await lockTaskBudgetCompany(tx, companyId);
    const ancestry = await taskBudgetAncestors(tx, companyId, issueId);
    const policies = await policiesForScopes(tx, companyId, ancestry.map(row => row.id));
    for (const [field, metric] of [["maxCostCents", "billed_cents"], ["maxTokens", "total_tokens"]] as const) {
      const amount = input[field];
      if (amount === undefined) continue;
      if (amount !== null && (!Number.isSafeInteger(amount) || amount <= 0)) throw unprocessable("Task budgets require positive safe integers");
      const current = policies.find(row => row.scopeId === issueId && row.metric === metric);
      if (input.expectedRevisions[metric] !== (current?.revision ?? 0)) throw conflict("The task budget changed; reload before saving", { code: "task_budget_stale_revision" });
      await authorizeManager(tx, companyId, issueId, actor, metric);
      if (current?.isActive && amount === current.amount) continue;
      if (actor.type === "agent") {
        if (amount === null) throw forbidden("Only the board may remove task caps");
        const targetUsage = await taskBudgetUsage(tx, companyId, issueId);
        if (incomplete(targetUsage, metric)) throw conflict("Repair accounting before allocating additional funding");
        const enclosing = policies.filter(row => row.scopeId !== issueId && row.isActive && row.metric === metric);
        let headroom = Infinity;
        for (const policy of enclosing) {
          const usage = await taskBudgetUsage(tx, companyId, policy.scopeId);
          if (incomplete(usage, metric)) throw conflict("Enclosing budget accounting is incomplete");
          headroom = Math.min(headroom, policy.amount - observed(usage, metric));
        }
        let exceeds = Math.max(0, amount - observed(targetUsage, metric)) > headroom;
        if (metric === "billed_cents") {
          let exactHeadroom: bigint | null = null;
          for (const policy of enclosing) {
            const usage = await taskBudgetUsage(tx, companyId, policy.scopeId);
            const remaining = centsToUnits(policy.amount) - centsToUnits(usage.billedCentsExact);
            exactHeadroom = exactHeadroom === null || remaining < exactHeadroom ? remaining : exactHeadroom;
          }
          const requested = centsToUnits(amount) - centsToUnits(targetUsage.billedCentsExact);
          exceeds = requested > 0n && (exactHeadroom === null || requested > exactHeadroom);
        }
        if (exceeds) {
          throw unprocessable("The allocation exceeds remaining ancestor funding", { code: "task_budget_insufficient_headroom" });
        }
      }
      if ((!current && amount === null) || (current && current.isActive === (amount !== null) && current.amount === (amount ?? current.amount))) continue;
      const revision = current ? current.revision + 1 : 1;
      const attribution = actor.type === "board" ? { updatedByUserId: actor.userId ?? null, updatedByAgentId: null, updatedByRunId: null }
        : { updatedByUserId: null, updatedByAgentId: actor.agentId, updatedByRunId: actor.runId };
      if (current) await tx.update(budgetPolicies).set({ ...attribution, amount: amount ?? current.amount,
        isActive: amount !== null, revision, updatedAt: new Date() }).where(eq(budgetPolicies.id, current.id));
      else await tx.insert(budgetPolicies).values({ companyId, scopeType: "issue", scopeId: issueId, metric,
        windowKind: "lifetime", amount: amount!, revision, createdByUserId: attribution.updatedByUserId,
        createdByAgentId: attribution.updatedByAgentId, createdByRunId: attribution.updatedByRunId, ...attribution });
      if (current) {
        const incidents = await tx.select().from(budgetIncidents).where(and(eq(budgetIncidents.policyId, current.id), eq(budgetIncidents.status, "open")));
        await tx.update(budgetIncidents).set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(budgetIncidents.policyId, current.id), eq(budgetIncidents.status, "open")));
        const approvalIds = incidents.flatMap(row => row.approvalId ? [row.approvalId] : []);
        if (approvalIds.length) await tx.update(approvals).set({ status: "cancelled", decisionNote: "Superseded by an authorized task budget update.", updatedAt: new Date() })
          .where(and(inArray(approvals.id, approvalIds), inArray(approvals.status, ["pending", "revision_requested"])));
      }
      await tx.insert(taskBudgetEffects).values({ companyId, scopeId: issueId, kind: "resume", dedupeKey: `resume:${issueId}:${metric}:${revision}` }).onConflictDoNothing();
      await logActivity(tx, { companyId, actorType: actor.type === "board" ? "user" : "agent",
        actorId: actor.type === "board" ? actor.userId ?? "board" : actor.agentId,
        ...(actor.type === "agent" ? { agentId: actor.agentId, runId: actor.runId } : {}), issueId,
        action: "budget.policy_upserted", entityType: "issue", entityId: issueId,
        details: { scopeType: "issue", metric, amount, revision } });
    }
    await evaluatePolicies(tx, companyId, [issueId]);
  }

  async function summary(companyId: string, issueId: string, actor?: TaskBudgetActor): Promise<TaskBudgetSummary> {
    const ready = await initializeTaskBudgetAccounting(db, companyId);
    const ancestry = await taskBudgetAncestors(db, companyId, issueId);
    const rows = await policiesForScopes(db, companyId, ancestry.map(row => row.id));
    const policies: BudgetPolicySummary[] = [];
    const blockers: TaskBudgetBlock[] = [];
    const remaining: TaskBudgetSummary["remaining"] = { billed_cents: null, total_tokens: null };
    for (const ancestor of ancestry.slice().reverse()) {
      const usage = await taskBudgetUsage(db, companyId, ancestor.id);
      for (const row of rows.filter(policy => policy.scopeId === ancestor.id)) {
        const policy = policySummary(row, usage, ancestor.title);
        policies.push(policy);
        if (!row.isActive) continue;
        const metric = row.metric as BudgetMetric;
        remaining[metric] = remaining[metric] === null ? policy.remainingAmount : Math.min(remaining[metric]!, policy.remainingAmount);
        if (incomplete(usage, metric) || policy.status === "hard_stop") blockers.push({
          code: incomplete(usage, metric) ? "task_budget_usage_unavailable" : "task_budget_exhausted",
          scopeType: "issue", scopeId: row.scopeId, scopeName: ancestor.title, metric, policyId: row.id,
          policyRevision: row.revision, observedAmount: incomplete(usage, metric) ? null : policy.observedAmount,
          amount: row.amount, reason: incomplete(usage, metric) ? "Usage reporting is incomplete. Repair accounting before continuing."
            : `${ancestor.title} reached its ${metric === "billed_cents" ? "dollar" : "token"} limit, including delegated work.`,
        });
      }
    }
    if (!blockers.length && policies.some(policy => policy.isActive) && ancestry[0].assigneeAgentId) {
      const [runtime] = await db.select({ adapterType: agents.adapterType, config: agents.adapterConfig }).from(agents)
        .where(and(eq(agents.companyId, companyId), eq(agents.id, ancestry[0].assigneeAgentId)));
      if (runtime) {
        const block = await invocationBlock(db, companyId, issueId, taskBudgetMeteringSupport(runtime.adapterType, { config: runtime.config }));
        if (block) blockers.push(block);
      }
    }
    for (const blocker of blockers) if (blocker.code === "task_budget_usage_unavailable") remaining[blocker.metric] = null;
    const total = await taskBudgetUsage(db, companyId, issueId);
    const direct = await taskBudgetUsage(db, companyId, issueId, true);
    const permissions = {} as TaskBudgetSummary["permissions"];
    for (const metric of METRICS) {
      let allowed = actor?.type === "board";
      if (actor?.type === "agent") {
        try { await authorizeManager(db, companyId, issueId, actor, metric); allowed = true; }
        catch (error) { if (!(error instanceof HttpError) || error.status !== 403) throw error; }
      }
      permissions[metric] = { canSet: allowed, canIncrease: allowed, canRemove: actor?.type === "board" };
    }
    if (actor?.type === "agent") {
      for (const policy of policies) if (policy.scopeId !== issueId) policy.scopeName = "Enclosing task";
      for (const blocker of blockers) if (blocker.scopeId !== issueId) {
        blocker.scopeName = "Enclosing task";
        blocker.reason = blocker.code === "task_budget_usage_unavailable" ? "Enclosing task usage reporting is incomplete. Repair accounting before continuing."
          : "An enclosing task budget holds this work. Inspect the governing budget before continuing.";
      }
    }
    return { issueId, companyId, policies, ownPolicies: policies.filter(row => row.scopeId === issueId), directUsage: direct,
      descendantUsage: { billedCents: total.billedCents - direct.billedCents, totalTokens: total.totalTokens - direct.totalTokens,
        incompleteCostRunIds: total.incompleteCostRunIds.filter(id => !direct.incompleteCostRunIds.includes(id)),
        incompleteTokenRunIds: total.incompleteTokenRunIds.filter(id => !direct.incompleteTokenRunIds.includes(id)) },
      remaining, blockers, primaryBlocker: blockers[0] ?? null, initialization: ready ? "ready" : "pending",
      legacyAttribution: total.legacyAttribution, permissions };
  }

  return {
    summary,
    executionSummary: async (companyId: string, issueId: string) => {
      const [policy] = await db.select({ id: budgetPolicies.id }).from(budgetPolicies).where(and(
        eq(budgetPolicies.companyId, companyId), eq(budgetPolicies.scopeType, "issue"), eq(budgetPolicies.isActive, true))).limit(1);
      return policy ? summary(companyId, issueId) : null;
    },
    getInvocationBlock: (companyId: string, issueId: string, metering?: string | TaskBudgetMeteringSupport) => invocationBlock(db, companyId, issueId, metering),
    captureRun: (companyId: string, runId: string) => db.transaction(async tx => {
      await lockTaskBudgetCompany(tx as unknown as Db, companyId);
      return captureTaskBudgetRun(tx as unknown as Db, companyId, runId);
    }),
    recordRunUsage: (sample: TaskRunUsageSample) => db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      await lockTaskBudgetCompany(tx, sample.companyId);
      const result = await recordTaskRunUsageInTransaction(tx, sample);
      if (result && !result.duplicate) {
        if (result.event) {
          const month = new Date();
          const start = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
          const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
          const [spend] = await tx.select({
            company: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
            agent: sql<number>`coalesce(sum(${costEvents.costCents}) filter (where ${costEvents.agentId} = ${result.event.agentId}), 0)::double precision`,
          }).from(costEvents).where(and(eq(costEvents.companyId, sample.companyId),
            gte(costEvents.occurredAt, start), lt(costEvents.occurredAt, end)));
          await tx.update(companies).set({ spentMonthlyCents: Number(spend.company) }).where(eq(companies.id, sample.companyId));
          await tx.update(agents).set({ spentMonthlyCents: Number(spend.agent), updatedAt: new Date() }).where(eq(agents.id, result.event.agentId!));
        }
        const scopes = await tx.select({ id: taskBudgetRunAncestors.ancestorIssueId }).from(taskBudgetRunAncestors)
          .where(eq(taskBudgetRunAncestors.contextId, result.context.id));
        await evaluatePolicies(tx, sample.companyId, scopes.map(row => row.id), result.context.issueId);
        const stoppedScopes = sample.isFinal && scopes.length ? await tx.select({ scopeId: taskBudgetEffects.scopeId }).from(taskBudgetEffects)
          .where(and(eq(taskBudgetEffects.companyId, sample.companyId), eq(taskBudgetEffects.kind, "stop"),
            inArray(taskBudgetEffects.scopeId, scopes.map(row => row.id)))) : [];
        for (const scopeId of new Set(stoppedScopes.map(row => row.scopeId))) await tx.insert(taskBudgetEffects).values({
          companyId: sample.companyId, scopeId, kind: "resume",
          dedupeKey: `accounting-resume:${result.context.id}:${result.context.lastSequence}:${scopeId}`,
        }).onConflictDoNothing();
      }
      return result;
    }),
    attributeCostEvent: (event: typeof costEvents.$inferSelect) => db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      await lockTaskBudgetCompany(tx, event.companyId);
      await attributeTaskCostEvent(tx, event);
      const scopes = await tx.select({ id: costEventTaskScopes.ancestorIssueId }).from(costEventTaskScopes)
        .where(eq(costEventTaskScopes.costEventId, event.id));
      await evaluatePolicies(tx, event.companyId, scopes.map(row => row.id), event.issueId);
    }),
    patch: async (companyId: string, issueId: string, input: TaskBudgetPatchInput, actor: TaskBudgetActor) => {
      if (!(await initializeTaskBudgetAccounting(db, companyId))) throw conflict("Task accounting is initializing; retry shortly", { code: "task_budget_accounting_initializing" });
      await db.transaction(tx => patchInTransaction(tx as unknown as Db, companyId, issueId, input, actor));
      return summary(companyId, issueId, actor);
    },
    createPolicies: async (companyId: string, issueId: string, input: TaskBudgetCreateInput, actor: TaskBudgetActor) => {
      if (!(await initializeTaskBudgetAccounting(db, companyId))) throw conflict("Task accounting is initializing; retry creation");
      await patchInTransaction(db, companyId, issueId, { ...input, expectedRevisions: { billed_cents: 0, total_tokens: 0 } }, actor);
    },
    async guardDelegation(companyId: string, parentId: string | null | undefined, agentId: string | null | undefined, runId: string | null | undefined) {
      if (!agentId) return;
      if (!runId) {
        const [funded] = await db.select({ id: budgetPolicies.id }).from(budgetPolicies).where(and(
          eq(budgetPolicies.companyId, companyId), eq(budgetPolicies.scopeType, "issue"), eq(budgetPolicies.isActive, true))).limit(1);
        if (funded) throw forbidden("Task creation with task funding requires a registered source run");
        return;
      }
      const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId)));
      if (!run) throw forbidden("Task creation requires the authenticated source run");
      const sourceIssueId = run.contextSnapshot?.issueId ?? run.nativeIssueId;
      if (typeof sourceIssueId !== "string") return;
      const sourceAncestry = await taskBudgetAncestors(db, companyId, sourceIssueId);
      const funding = (await policiesForScopes(db, companyId, sourceAncestry.map(row => row.id))).filter(row => row.isActive);
      if (!funding.length) return;
      const target = parentId ? await taskBudgetAncestors(db, companyId, parentId) : [];
      if (funding.some(policy => !target.some(row => row.id === policy.scopeId))) throw forbidden("Delegation cannot leave its funding branch", { code: "task_budget_funding_boundary" });
      if (await invocationBlock(db, companyId, sourceIssueId)) throw forbidden("Delegation is held by its source task budget");
    },
    async guardStructureChange(companyId: string, issueId: string, newParentId: string | null | undefined, agentId?: string | null) {
      const [state] = await db.select().from(taskBudgetAccountingState).where(eq(taskBudgetAccountingState.companyId, companyId));
      if (state && state.state !== "ready") throw conflict("Task accounting is initializing; retry this change shortly");
      const old = await taskBudgetAncestors(db, companyId, issueId);
      const next = newParentId ? await taskBudgetAncestors(db, companyId, newParentId) : [];
      if (next.some(row => row.id === issueId)) throw conflict("Task ancestry cannot contain cycles");
      const policies = await policiesForScopes(db, companyId, [...new Set([...old, ...next].map(row => row.id))]);
      if (!policies.some(row => row.isActive)) return;
      if (agentId) throw forbidden("Only the board may change task funding boundaries");
      const contexts = await db.select({ liveRunId: taskBudgetRunContexts.liveRunId, costState: taskBudgetRunContexts.costState,
        tokenState: taskBudgetRunContexts.tokenState }).from(taskBudgetRunAncestors)
        .innerJoin(taskBudgetRunContexts, eq(taskBudgetRunContexts.id, taskBudgetRunAncestors.contextId))
        .where(and(eq(taskBudgetRunAncestors.companyId, companyId), eq(taskBudgetRunAncestors.ancestorIssueId, issueId)));
      if (contexts.some(row => row.costState !== "complete" || row.tokenState !== "complete")) throw conflict("Settle task accounting before moving or deleting funded work");
      const descendantIds = await db.execute(sql`WITH RECURSIVE tree(id) AS (
        SELECT id FROM issues WHERE company_id = ${companyId} AND id = ${issueId}
        UNION SELECT child.id FROM issues child JOIN tree ON child.parent_id = tree.id WHERE child.company_id = ${companyId}
      ) SELECT id FROM tree`);
      const descendants = Array.from(descendantIds as unknown as Array<{ id: string }>).map(row => row.id);
      const [pendingWake] = descendants.length ? await db.select({ id: agentWakeupRequests.id }).from(agentWakeupRequests).where(and(
        eq(agentWakeupRequests.companyId, companyId), inArray(agentWakeupRequests.status, ["queued", "deferred_issue_execution"]),
        sql`coalesce(${agentWakeupRequests.payload}->>'issueId', ${agentWakeupRequests.payload}->>'taskId',
          ${agentWakeupRequests.payload}#>>'{_paperclipWakeContext,issueId}') in (${sql.join(descendants.map(id => sql`${id}`), sql`, `)})`)) : [];
      if (pendingWake) throw conflict("Settle pending task wakes before changing funding", { code: "task_budget_execution_unsettled" });
      const [uncaptured] = descendants.length ? await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
        eq(heartbeatRuns.companyId, companyId), inArray(heartbeatRuns.status, ["queued", "running"]),
        sql`${heartbeatRuns.contextSnapshot}->>'issueId' in (${sql.join(descendants.map(id => sql`${id}`), sql`, `)})`)) : [];
      if (uncaptured) throw conflict("Stop queued and active execution before changing task funding", { code: "task_budget_execution_unsettled" });
      const ids = contexts.flatMap(row => row.liveRunId ? [row.liveRunId] : []);
      if (ids.length) {
        const [active] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(inArray(heartbeatRuns.id, ids),
          inArray(heartbeatRuns.status, ["queued", "running"])));
        if (active) throw conflict("Stop and settle execution before changing its funding branch", { code: "task_budget_execution_unsettled" });
      }
    },
    async retireTask(companyId: string, issueId: string) {
      const own = await policiesForScopes(db, companyId, [issueId]);
      if (!own.length) return;
      const ids = own.map(row => row.id);
      const incidents = await db.select().from(budgetIncidents).where(and(inArray(budgetIncidents.policyId, ids), eq(budgetIncidents.status, "open")));
      await db.update(budgetPolicies).set({ isActive: false, revision: sql`${budgetPolicies.revision} + 1`, updatedAt: new Date() }).where(and(eq(budgetPolicies.companyId, companyId), inArray(budgetPolicies.id, ids)));
      await db.update(budgetIncidents).set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() }).where(and(inArray(budgetIncidents.policyId, ids), eq(budgetIncidents.status, "open")));
      const approvalsToCancel = incidents.flatMap(row => row.approvalId ? [row.approvalId] : []);
      if (approvalsToCancel.length) await db.update(approvals).set({ status: "cancelled", decisionNote: "Task deleted; historical charges remain.", updatedAt: new Date() })
        .where(and(inArray(approvals.id, approvalsToCancel), inArray(approvals.status, ["pending", "revision_requested"])));
    },
    evaluatePolicies: (companyId: string, scopeIds: string[]) => db.transaction(async tx => {
      const db = tx as unknown as Db;
      await lockTaskBudgetCompany(db, companyId);
      const repaired = scopeIds.length ? await db.selectDistinct({ runId: taskBudgetRunContexts.liveRunId }).from(taskBudgetRunAncestors)
        .innerJoin(taskBudgetRunContexts, eq(taskBudgetRunContexts.id, taskBudgetRunAncestors.contextId))
        .where(and(eq(taskBudgetRunAncestors.companyId, companyId), inArray(taskBudgetRunAncestors.ancestorIssueId, scopeIds),
          eq(taskBudgetRunContexts.costState, "incomplete"), sql`${taskBudgetRunContexts.normalization}->>'ledgerManaged' = 'true'`,
          sql`exists (select 1 from heartbeat_runs r where r.id = ${taskBudgetRunContexts.liveRunId} and r.cost_accounted_at is not null)`,
          sql`exists (select 1 from cost_events e where e.company_id = ${companyId} and e.heartbeat_run_id = ${taskBudgetRunContexts.sourceRunId})`,
          sql`not exists (select 1 from cost_events e where e.company_id = ${companyId} and e.heartbeat_run_id = ${taskBudgetRunContexts.sourceRunId}
            and e.billing_type <> 'subscription_included' and (e.cost_status <> 'reported' or e.billing_type = 'unknown'))`)).limit(100) : [];
      for (const row of repaired) {
        const [run] = row.runId ? await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, row.runId))) : [];
        if (run) await settleTaskBudgetRunFromLedger(db, run);
      }
      await evaluatePolicies(db, companyId, scopeIds);
    }),
  };
}
