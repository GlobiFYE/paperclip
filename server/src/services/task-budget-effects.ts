import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentWakeupRequests, heartbeatRuns, issues, taskBudgetEffects, taskBudgetRunAncestors, taskBudgetRunContexts } from "@paperclipai/db";
import { taskBudgetService } from "./task-budgets.js";
import { lockTaskBudgetCompany } from "./task-budget-accounting.js";

export async function taskBudgetDescendantIds(db: Db, companyId: string, issueId: string): Promise<string[]> {
  const rows = await db.execute(sql`WITH RECURSIVE tree(id) AS (
    SELECT id FROM issues WHERE company_id = ${companyId} AND id = ${issueId}
    UNION SELECT child.id FROM issues child JOIN tree ON child.parent_id = tree.id WHERE child.company_id = ${companyId}
  ) SELECT id FROM tree`);
  return Array.from(rows as unknown as Array<{ id: string }>).map(row => row.id);
}

export interface TaskBudgetEffectHooks {
  cancelRun: (runId: string) => Promise<void>;
  resumeIssue: (issueId: string, dedupeKey: string) => Promise<void>;
}

export async function processTaskBudgetEffects(db: Db, hooks: TaskBudgetEffectHooks, companyId?: string) {
  const now = new Date();
  const effects = await db.select().from(taskBudgetEffects).where(and(companyId ? eq(taskBudgetEffects.companyId, companyId) : undefined,
    or(eq(taskBudgetEffects.state, "pending"), and(eq(taskBudgetEffects.state, "running"), lt(taskBudgetEffects.leaseExpiresAt, now)))))
    .orderBy(asc(taskBudgetEffects.createdAt), asc(taskBudgetEffects.id)).limit(20);
  for (const effect of effects) {
    const lease = new Date(Date.now() + 60000);
    const [claim] = await db.update(taskBudgetEffects).set({ state: "running", leaseExpiresAt: lease,
      attempts: sql`${taskBudgetEffects.attempts} + 1` }).where(and(eq(taskBudgetEffects.id, effect.id),
      or(eq(taskBudgetEffects.state, "pending"), and(eq(taskBudgetEffects.state, "running"), lt(taskBudgetEffects.leaseExpiresAt, now))))).returning();
    if (!claim) continue;
    try {
      const service = taskBudgetService(db);
      const [scope] = await db.select({ id: issues.id }).from(issues).where(and(eq(issues.companyId, effect.companyId), eq(issues.id, effect.scopeId)));
      const block = scope ? await service.getInvocationBlock(effect.companyId, effect.scopeId) : null;
      if (effect.kind === "stop") {
        const targets = await db.transaction(async transaction => {
          const db = transaction as unknown as Db;
          await lockTaskBudgetCompany(db, effect.companyId);
          const [currentScope] = await db.select({ id: issues.id }).from(issues).where(and(eq(issues.companyId, effect.companyId), eq(issues.id, effect.scopeId)));
          const currentBlock = currentScope ? await taskBudgetService(db).getInvocationBlock(effect.companyId, effect.scopeId) : null;
          if (!currentBlock) return null;
          let payload = claim.payload;
          if (!payload.runIds) {
            const ids = await taskBudgetDescendantIds(db, effect.companyId, effect.scopeId);
            const historical = await db.select({ runId: taskBudgetRunContexts.liveRunId }).from(taskBudgetRunAncestors)
              .innerJoin(taskBudgetRunContexts, eq(taskBudgetRunContexts.id, taskBudgetRunAncestors.contextId))
              .where(and(eq(taskBudgetRunAncestors.companyId, effect.companyId), eq(taskBudgetRunAncestors.ancestorIssueId, effect.scopeId)));
            const runIds = historical.flatMap(row => row.runId ? [row.runId] : []);
            const active = await db.select({ id: heartbeatRuns.id, context: heartbeatRuns.contextSnapshot }).from(heartbeatRuns).where(and(
              eq(heartbeatRuns.companyId, effect.companyId), inArray(heartbeatRuns.status, ["queued", "running"]),
              or(runIds.length ? inArray(heartbeatRuns.id, runIds) : undefined,
                ids.length ? sql`${heartbeatRuns.contextSnapshot}->>'issueId' in (${sql.join(ids.map(id => sql`${id}`), sql`, `)})` : undefined)));
            const wakes = ids.length ? await db.select({ id: agentWakeupRequests.id, payload: agentWakeupRequests.payload }).from(agentWakeupRequests)
              .where(and(eq(agentWakeupRequests.companyId, effect.companyId), inArray(agentWakeupRequests.status, ["queued", "deferred_issue_execution"]),
                isNull(agentWakeupRequests.runId), sql`coalesce(${agentWakeupRequests.payload}->>'issueId', ${agentWakeupRequests.payload}->>'taskId',
                  ${agentWakeupRequests.payload}#>>'{_paperclipWakeContext,issueId}') in (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`)) : [];
            const interruptedIssues = new Set<string>(payload.issueIds ?? []);
            for (const run of active) if (typeof run.context?.issueId === "string") interruptedIssues.add(run.context.issueId);
            for (const wake of wakes) {
              const issueId = wake.payload?.issueId ?? wake.payload?.taskId;
              if (typeof issueId === "string") interruptedIssues.add(issueId);
            }
            payload = { issueIds: [...interruptedIssues], runIds: active.map(row => row.id), wakeupIds: wakes.map(row => row.id) };
            await db.update(taskBudgetEffects).set({ payload }).where(and(eq(taskBudgetEffects.id, effect.id), eq(taskBudgetEffects.leaseExpiresAt, lease)));
          }
          return { payload, reason: currentBlock.reason };
        });
        if (targets?.payload.wakeupIds?.length) await db.update(agentWakeupRequests).set({ status: "cancelled", finishedAt: new Date(),
          error: targets.reason, updatedAt: new Date() }).where(and(eq(agentWakeupRequests.companyId, effect.companyId),
          inArray(agentWakeupRequests.id, targets.payload.wakeupIds), inArray(agentWakeupRequests.status, ["queued", "deferred_issue_execution"])));
        for (const runId of targets?.payload.runIds ?? []) await hooks.cancelRun(runId);
      } else if (effect.kind === "resume" && !block && scope) {
        const stops = await db.select({ id: taskBudgetEffects.id, payload: taskBudgetEffects.payload }).from(taskBudgetEffects).where(and(
          eq(taskBudgetEffects.companyId, effect.companyId), eq(taskBudgetEffects.scopeId, effect.scopeId),
          eq(taskBudgetEffects.kind, "stop"), eq(taskBudgetEffects.state, "done"))).orderBy(asc(taskBudgetEffects.createdAt), asc(taskBudgetEffects.id));
        const interrupted = new Map<string, string>();
        for (const stop of stops) for (const issueId of stop.payload.issueIds ?? []) interrupted.set(issueId, stop.id);
        for (const [issueId, stopId] of interrupted) {
          const [issue] = await db.select({ status: issues.status }).from(issues).where(and(eq(issues.companyId, effect.companyId), eq(issues.id, issueId)));
          if (!issue || !["todo", "in_progress"].includes(issue.status)) continue;
          if (!(await service.getInvocationBlock(effect.companyId, issueId))) await hooks.resumeIssue(issueId, `task-budget:${stopId}:${issueId}`);
        }
      }
      await db.update(taskBudgetEffects).set({ state: "done", completedAt: new Date(), leaseExpiresAt: null, lastError: null })
        .where(and(eq(taskBudgetEffects.id, effect.id), eq(taskBudgetEffects.leaseExpiresAt, lease)));
    } catch (error) {
      await db.update(taskBudgetEffects).set({ state: "running", lastError: error instanceof Error ? error.message : "Budget effect failed" })
        .where(and(eq(taskBudgetEffects.id, effect.id), eq(taskBudgetEffects.leaseExpiresAt, lease)));
    }
  }
}
