import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  companies, costEvents, costEventTaskScopes, taskBudgetEffects, heartbeatRuns, issues, taskBudgetAccountingState,
  taskBudgetRunAncestors, taskBudgetRunContexts, taskBudgetUsageReceipts,
} from "@paperclipai/db";
import { conflict, notFound, unprocessable } from "../errors.js";

export async function lockTaskBudgetCompany(db: Db, companyId: string) {
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("no key update");
  if (!company) throw notFound("Company not found");
}

export async function taskBudgetAncestors(db: Db, companyId: string, issueId: string) {
  const result: Array<{ id: string; title: string; parentId: string | null; assigneeAgentId: string | null; depth: number }> = [];
  const visited = new Set<string>();
  let next: string | null = issueId;
  while (next) {
    if (visited.has(next) || visited.size >= 1000) throw conflict("Task funding ancestry contains a cycle or exceeds the supported depth");
    visited.add(next);
    const [row] = await db.select({ id: issues.id, title: issues.title, parentId: issues.parentId,
      assigneeAgentId: issues.assigneeAgentId }).from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, next)));
    if (!row) throw notFound("Task funding ancestor not found");
    result.push({ ...row, depth: result.length });
    next = row.parentId;
  }
  return result;
}

export async function captureTaskBudgetRun(db: Db, companyId: string, runId: string) {
  const [existing] = await db.select().from(taskBudgetRunContexts)
    .where(and(eq(taskBudgetRunContexts.companyId, companyId), eq(taskBudgetRunContexts.sourceRunId, runId)));
  if (existing) return existing;
  const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId)));
  if (!run) throw notFound("Budget source run not found");
  const issueId = typeof run.contextSnapshot?.issueId === "string" ? run.contextSnapshot.issueId : run.nativeIssueId;
  if (!issueId) return null;
  const ancestors = await taskBudgetAncestors(db, companyId, issueId);
  const [issue] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, issueId)));
  const [context] = await db.insert(taskBudgetRunContexts).values({ companyId, sourceRunId: runId, liveRunId: runId,
    issueId, projectId: issue.projectId, billingCode: issue.billingCode }).returning();
  await db.insert(taskBudgetRunAncestors).values(ancestors.map(ancestor => ({ companyId,
    contextId: context.id, ancestorIssueId: ancestor.id, depth: ancestor.depth })));
  return context;
}

export async function attributeTaskCostEvent(db: Db, event: typeof costEvents.$inferSelect,
  provenance = "captured_run") {
  let ancestors: Array<{ ancestorIssueId: string; depth: number }> = [];
  if (event.heartbeatRunId) {
    const context = await captureTaskBudgetRun(db, event.companyId, event.heartbeatRunId);
    if (context) ancestors = await db.select({ ancestorIssueId: taskBudgetRunAncestors.ancestorIssueId,
      depth: taskBudgetRunAncestors.depth }).from(taskBudgetRunAncestors)
      .where(and(eq(taskBudgetRunAncestors.companyId, event.companyId), eq(taskBudgetRunAncestors.contextId, context.id)));
  }
  if (!ancestors.length && event.issueId) {
    ancestors = (await taskBudgetAncestors(db, event.companyId, event.issueId))
      .map(row => ({ ancestorIssueId: row.id, depth: row.depth }));
  }
  if (ancestors.length) await db.insert(costEventTaskScopes).values(ancestors.map(row => ({
    companyId: event.companyId, costEventId: event.id, ...row, provenance,
  }))).onConflictDoNothing();
}

export async function initializeTaskBudgetAccounting(db: Db, companyId: string) {
  return db.transaction(async transaction => {
    const tx = transaction as unknown as Db;
    await lockTaskBudgetCompany(tx, companyId);
    await tx.insert(taskBudgetAccountingState).values({ companyId }).onConflictDoNothing();
    const [state] = await tx.select().from(taskBudgetAccountingState).where(eq(taskBudgetAccountingState.companyId, companyId));
    if (state.state === "ready") return true;
    const batch = await tx.select().from(costEvents).where(and(eq(costEvents.companyId, companyId),
      sql`${costEvents.createdAt} <= (select cutover_at from task_budget_accounting_state where company_id = ${companyId})`,
      state.cursorCreatedAt && state.cursorId
        ? sql`(${costEvents.createdAt}, ${costEvents.id}) > (select cursor_created_at, cursor_id from task_budget_accounting_state where company_id = ${companyId})` : undefined,
    )).orderBy(asc(costEvents.createdAt), asc(costEvents.id)).limit(250);
    for (const event of batch) {
      const [source] = event.issueId ? await tx.select({ id: issues.id }).from(issues)
        .where(and(eq(issues.companyId, companyId), eq(issues.id, event.issueId))) : [];
      if (source) await attributeTaskCostEvent(tx, { ...event, heartbeatRunId: null }, "legacy_current_hierarchy");
    }
    const last = batch.at(-1);
    const active = batch.length < 250 ? await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
      .leftJoin(taskBudgetRunContexts, and(eq(taskBudgetRunContexts.companyId, heartbeatRuns.companyId), eq(taskBudgetRunContexts.sourceRunId, heartbeatRuns.id)))
      .where(and(eq(heartbeatRuns.companyId, companyId), inArray(heartbeatRuns.status, ["queued", "running"]),
        sql`${heartbeatRuns.createdAt} <= (select cutover_at from task_budget_accounting_state where company_id = ${companyId})`, isNull(taskBudgetRunContexts.id),
        sql`coalesce(${heartbeatRuns.contextSnapshot}->>'issueId', ${heartbeatRuns.nativeIssueId}::text) is not null`)).limit(250) : [];
    for (const run of active) await captureTaskBudgetRun(tx, companyId, run.id);
    const ready = batch.length < 250 && active.length < 250;
    await tx.update(taskBudgetAccountingState).set({ state: ready ? "ready" : "pending",
      ...(last ? { cursorCreatedAt: sql`(select created_at from cost_events where id = ${last.id} and company_id = ${companyId})`, cursorId: last.id } : {}), completedAt: ready ? new Date() : null,
    }).where(eq(taskBudgetAccountingState.companyId, companyId));
    return ready;
  });
}

export async function taskBudgetUsage(db: Db, companyId: string, scopeId: string, directOnly = false) {
  const [totals] = await db.select({
    billedCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
    billedCentsExact: sql<string>`coalesce(sum(${costEvents.costCents}), 0)::text`,
    totalTokens: sql<number>`coalesce(sum(${costEvents.totalTokens}), 0)::double precision`,
    legacy: sql<boolean>`coalesce(bool_or(${costEventTaskScopes.provenance} = 'legacy_current_hierarchy'), false)`,
    unknownTokens: sql<number>`count(*) filter (where ${costEvents.totalTokens} is null and ${costEvents.usageReceiptId} is null)::int`,
    unknownCost: sql<number>`count(*) filter (where ${costEvents.usageReceiptId} is null and (${costEvents.costStatus} <> 'reported' or ${costEvents.billingType} = 'unknown') and ${costEvents.billingType} <> 'subscription_included')::int`,
  }).from(costEventTaskScopes).innerJoin(costEvents, and(eq(costEvents.id, costEventTaskScopes.costEventId),
    eq(costEvents.companyId, costEventTaskScopes.companyId))).where(and(eq(costEventTaskScopes.companyId, companyId),
    eq(costEventTaskScopes.ancestorIssueId, scopeId), directOnly ? eq(costEventTaskScopes.depth, 0) : undefined));
  const incomplete = await db.select({ runId: taskBudgetRunContexts.sourceRunId,
    costState: taskBudgetRunContexts.costState, tokenState: taskBudgetRunContexts.tokenState,
    runStatus: heartbeatRuns.status,
  }).from(taskBudgetRunAncestors).innerJoin(taskBudgetRunContexts, and(
    eq(taskBudgetRunContexts.id, taskBudgetRunAncestors.contextId), eq(taskBudgetRunContexts.companyId, taskBudgetRunAncestors.companyId),
  )).leftJoin(heartbeatRuns, eq(heartbeatRuns.id, taskBudgetRunContexts.liveRunId)).leftJoin(issues, and(eq(issues.id, taskBudgetRunContexts.issueId), eq(issues.companyId, taskBudgetRunContexts.companyId))).where(and(eq(taskBudgetRunAncestors.companyId, companyId), eq(taskBudgetRunAncestors.ancestorIssueId, scopeId),
    directOnly ? eq(taskBudgetRunAncestors.depth, 0) : undefined,
    or(eq(taskBudgetRunContexts.costState, "incomplete"), eq(taskBudgetRunContexts.tokenState, "incomplete"),
      and(or(isNull(taskBudgetRunContexts.liveRunId), inArray(heartbeatRuns.status, ["succeeded", "failed", "cancelled", "timed_out"]), inArray(issues.status, ["done", "cancelled"])),
        or(eq(taskBudgetRunContexts.costState, "pending"), eq(taskBudgetRunContexts.tokenState, "pending"))))));
  if (!Number.isFinite(Number(totals.billedCents)) || Math.abs(Number(totals.billedCents)) > Number.MAX_SAFE_INTEGER || !Number.isSafeInteger(Number(totals.totalTokens))) throw conflict("Task usage exceeds safe accounting precision");
  return { billedCents: Number(totals.billedCents), billedCentsExact: totals.billedCentsExact, totalTokens: Number(totals.totalTokens), legacyAttribution: totals.legacy,
    incompleteCostRunIds: [...new Set(incomplete.filter(row => row.costState !== "complete").map(row => row.runId))],
    incompleteTokenRunIds: [...new Set(incomplete.filter(row => row.tokenState !== "complete").map(row => row.runId))],
    unknownCost: Number(totals.unknownCost), unknownTokens: Number(totals.unknownTokens) };
}

export interface TaskRunUsageSample {
  companyId: string;
  runId: string;
  receiptKey: string;
  sourceSequence: number;
  cumulativeBilledCents: number | null;
  cumulativeTotalTokens: number | null;
  isFinal: boolean;
  provenance: string;
  provider: string;
  model: string;
  biller?: string;
  billingType?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

export async function recordTaskRunUsageInTransaction(db: Db, sample: TaskRunUsageSample) {
  for (const value of [sample.sourceSequence, sample.cumulativeBilledCents, sample.cumulativeTotalTokens]) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw unprocessable("Invalid task usage amount");
  }
  const context = await captureTaskBudgetRun(db, sample.companyId, sample.runId);
  if (!context) return null;
  const fingerprint = createHash("sha256").update(JSON.stringify(sample)).digest("hex");
  const [previous] = await db.select().from(taskBudgetUsageReceipts).where(and(
    eq(taskBudgetUsageReceipts.contextId, context.id), eq(taskBudgetUsageReceipts.receiptKey, sample.receiptKey)));
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw conflict("Usage receipt identity has conflicting contents", { code: "task_budget_receipt_conflict" });
    return { event: null, duplicate: true, context };
  }
  if (sample.sourceSequence <= context.lastSequence) return { event: null, duplicate: true, context };
  if ((sample.cumulativeBilledCents !== null && sample.cumulativeBilledCents < context.billedCents)
    || (sample.cumulativeTotalTokens !== null && sample.cumulativeTotalTokens < context.totalTokens)) {
    throw conflict("Cumulative run usage decreased; normalize provider resets before accounting");
  }
  const [receipt] = await db.insert(taskBudgetUsageReceipts).values({ companyId: sample.companyId, contextId: context.id,
    receiptKey: sample.receiptKey, sequence: sample.sourceSequence, billedCents: sample.cumulativeBilledCents,
    totalTokens: sample.cumulativeTotalTokens, isFinal: sample.isFinal, provenance: sample.provenance, fingerprint }).returning();
  const costDelta = sample.cumulativeBilledCents === null ? 0 : sample.cumulativeBilledCents - context.billedCents;
  const tokenDelta = sample.cumulativeTotalTokens === null ? null : sample.cumulativeTotalTokens - context.totalTokens;
  const [run] = await db.select({ agentId: heartbeatRuns.agentId }).from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.companyId, sample.companyId), eq(heartbeatRuns.id, sample.runId)));
  if (!run) throw notFound("Usage run not found");
  const [managed] = await db.select({ pending: heartbeatRuns.costAccountingPending, accountedAt: heartbeatRuns.costAccountedAt })
    .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, sample.companyId), eq(heartbeatRuns.id, sample.runId)));
  if (context.normalization?.ledgerManaged === true || managed?.pending || managed?.accountedAt) {
    throw conflict("Managed run accounting is owned by its canonical usage receipt");
  }
  const [liveIssue] = await db.select({ id: issues.id }).from(issues).where(and(eq(issues.companyId, sample.companyId), eq(issues.id, context.issueId)));
  const rawPrevious = context.normalization ?? {};
  const componentDelta = (field: "inputTokens" | "cachedInputTokens" | "outputTokens") => {
    const current = sample[field] ?? 0;
    const prior = typeof rawPrevious[field] === "number" ? rawPrevious[field] as number : 0;
    return Math.max(0, current - prior);
  };
  const [event] = await db.insert(costEvents).values({ companyId: sample.companyId, agentId: run.agentId,
    heartbeatRunId: sample.runId, issueId: liveIssue?.id ?? null, projectId: context.projectId, billingCode: context.billingCode,
    usageReceiptId: receipt.id, provider: sample.provider, model: sample.model, biller: sample.biller ?? sample.provider,
    billingType: sample.billingType ?? "unknown", costStatus: sample.cumulativeBilledCents === null ? "unpriced" : "reported",
    costCents: costDelta, totalTokens: tokenDelta, inputTokens: componentDelta("inputTokens"),
    cachedInputTokens: componentDelta("cachedInputTokens"), outputTokens: componentDelta("outputTokens"), occurredAt: new Date(),
  }).returning();
  await attributeTaskCostEvent(db, event);
  const [updated] = await db.update(taskBudgetRunContexts).set({
    billedCents: sample.cumulativeBilledCents ?? context.billedCents,
    totalTokens: sample.cumulativeTotalTokens ?? context.totalTokens,
    costState: sample.isFinal ? sample.cumulativeBilledCents === null ? "incomplete" : "complete" : context.costState,
    tokenState: sample.isFinal ? sample.cumulativeTotalTokens === null ? "incomplete" : "complete" : context.tokenState,
    lastSequence: sample.sourceSequence,
    normalization: { ...rawPrevious, inputTokens: sample.inputTokens ?? 0, cachedInputTokens: sample.cachedInputTokens ?? 0, outputTokens: sample.outputTokens ?? 0 },
    updatedAt: new Date(),
  }).where(eq(taskBudgetRunContexts.id, context.id)).returning();
  return { event, duplicate: false, context: updated };
}

export async function settleTaskBudgetRunFromLedger(db: Db, run: typeof heartbeatRuns.$inferSelect, noProviderWork = false) {
  const context = await captureTaskBudgetRun(db, run.companyId, run.id);
  if (!context) return;
  const events = await db.select().from(costEvents).where(and(eq(costEvents.companyId, run.companyId), eq(costEvents.heartbeatRunId, run.id)));
  const [money] = await db.select({ total: sql<string>`coalesce(sum(${costEvents.costCents}), 0)::text` }).from(costEvents)
    .where(and(eq(costEvents.companyId, run.companyId), eq(costEvents.heartbeatRunId, run.id)));
  const costComplete = noProviderWork || events.length > 0 && events.every(event => event.billingType === "subscription_included" || event.costStatus === "reported" && event.billingType !== "unknown");
  const tokenComplete = noProviderWork || events.length > 0 && events.every(event => event.totalTokens !== null);
  const tokens = noProviderWork ? 0 : events.reduce((total, event) => total + (event.totalTokens ?? 0), 0);
  await db.update(taskBudgetRunContexts).set({
    billedCents: noProviderWork ? 0 : Math.ceil(Number(money.total)), totalTokens: tokens,
    costState: costComplete ? "complete" : "incomplete", tokenState: tokenComplete ? "complete" : "incomplete",
    normalization: { ...context.normalization, ledgerManaged: true }, updatedAt: new Date(),
  }).where(eq(taskBudgetRunContexts.id, context.id));
  for (const event of events) await attributeTaskCostEvent(db, event);
  const fingerprint = createHash("sha256").update(JSON.stringify({ noProviderWork, events: events.map(event => ({
    id: event.id, cost: event.costCents, tokens: event.totalTokens, status: event.costStatus,
  })).sort((a, b) => a.id.localeCompare(b.id)) })).digest("hex");
  const stops = await db.select({ scopeId: taskBudgetEffects.scopeId }).from(taskBudgetEffects)
    .innerJoin(taskBudgetRunAncestors, and(eq(taskBudgetRunAncestors.companyId, taskBudgetEffects.companyId),
      eq(taskBudgetRunAncestors.ancestorIssueId, taskBudgetEffects.scopeId)))
    .where(and(eq(taskBudgetEffects.companyId, run.companyId), eq(taskBudgetEffects.kind, "stop"), eq(taskBudgetRunAncestors.contextId, context.id)));
  for (const scopeId of new Set(stops.map(row => row.scopeId))) await db.insert(taskBudgetEffects).values({
    companyId: run.companyId, scopeId, kind: "resume", dedupeKey: `ledger-resume:${context.id}:${fingerprint}:${scopeId}`,
  }).onConflictDoNothing();
}
