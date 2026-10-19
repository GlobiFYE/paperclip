import "../services/agent-lifecycle.js";
import { accountRunCost } from "../services/run-cost-accounting.js";
import { costService } from "../services/costs.js";
import { initializeTaskBudgetAccounting } from "../services/task-budget-accounting.js";
import { processTaskBudgetEffects } from "../services/task-budget-effects.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { agents, approvals, budgetIncidents, budgetPolicies, companies, costEvents, createDb, heartbeatRuns,
  issues, taskBudgetAccountingState, taskBudgetEffects, taskBudgetRunContexts } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { taskBudgetService } from "../services/task-budgets.js";

vi.mock("../services/activity-log.js", () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock("../services/authorization.js", () => ({ authorizationService: () => ({ decide: async () => ({ allowed: true }) }) }));

describe("task budgets with real accounting", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-task-budgets-");
    db = createDb(database.connectionString);
  }, 90000);
  afterAll(async () => { await database?.cleanup(); });

  async function fixture() {
    const companyId = randomUUID();
    const [company] = await db.insert(companies).values({ id: companyId, name: "Budget fixture", issuePrefix: `T${companyId.slice(0, 7)}` }).returning();
    const [manager] = await db.insert(agents).values({ companyId, name: "Manager", role: "engineer", status: "active", adapterType: "codex_local" }).returning();
    const [worker] = await db.insert(agents).values({ companyId, name: "Worker", role: "engineer", status: "active", adapterType: "claude_local" }).returning();
    async function task(title: string, parentId: string | null = null, agentId = worker.id) {
      return (await db.insert(issues).values({ companyId, title, parentId, assigneeAgentId: agentId, status: "todo" }).returning())[0];
    }
    const root = await task("Root", null, manager.id);
    const a = await task("A", root.id);
    const a1 = await task("A1", a.id);
    const b = await task("B", root.id);
    const service = taskBudgetService(db);
    const board = { type: "board" as const, userId: "fixture-board" };
    await service.patch(companyId, root.id, { maxCostCents: 2000, maxTokens: 500000, expectedRevisions: { billed_cents: 0, total_tokens: 0 } }, board);
    async function run(issueId: string, agentId = worker.id) {
      const row = (await db.insert(heartbeatRuns).values({ companyId, agentId, status: "running", contextSnapshot: { issueId } }).returning())[0];
      await service.captureRun(companyId, row.id);
      return row;
    }
    async function report(runId: string, cents: number | null, tokens: number | null, key = "final", sequence = 1, isFinal = true) {
      return service.recordRunUsage({ companyId, runId, receiptKey: key, sourceSequence: sequence,
        cumulativeBilledCents: cents, cumulativeTotalTokens: tokens, isFinal, provenance: "test_receipt",
        provider: "fixture", model: "fixture", billingType: "metered_api" });
    }
    return { company, companyId, root, a, a1, b, manager, worker, service, board, task, run, report };
  }

  it("charges nested work once and stops the root when shared token funds are exhausted", async () => {
    const f = await fixture();
    for (const child of [f.a, f.b]) await f.service.patch(f.companyId, child.id,
      { maxCostCents: 1500, maxTokens: 300000, expectedRevisions: { billed_cents: 0, total_tokens: 0 } }, f.board);
    const rr = await f.run(f.root.id, f.manager.id); const ar = await f.run(f.a.id); const gr = await f.run(f.a1.id); const br = await f.run(f.b.id);
    await f.report(rr.id, 200, 50000); await f.report(ar.id, 300, 75000); await f.report(gr.id, 400, 100000);
    await f.report(br.id, 500, 125000, "partial", 1, false);
    let summary = await f.service.summary(f.companyId, f.root.id);
    expect(summary.directUsage).toMatchObject({ billedCents: 200, totalTokens: 50000 });
    expect(summary.descendantUsage).toMatchObject({ billedCents: 1200, totalTokens: 300000 });
    expect((await f.service.summary(f.companyId, f.a.id)).remaining.billed_cents).toBe(600);
    await f.report(br.id, 500, 275000, "final", 2);
    const block = await f.service.getInvocationBlock(f.companyId, f.b.id);
    expect(block).toMatchObject({ code: "task_budget_exhausted", scopeId: f.root.id, metric: "total_tokens" });
    await f.report(br.id, 500, 275000, "final", 2);
    summary = await f.service.summary(f.companyId, f.root.id);
    expect(summary.descendantUsage.totalTokens + summary.directUsage.totalTokens).toBe(500000);
    expect(await db.select().from(budgetIncidents).where(and(eq(budgetIncidents.companyId, f.companyId), eq(budgetIncidents.thresholdType, "hard")))).toHaveLength(1);
    await f.service.patch(f.companyId, f.root.id, { maxCostCents: 3000, expectedRevisions: { billed_cents: 1 } }, f.board);
    expect(await f.service.getInvocationBlock(f.companyId, f.b.id)).toMatchObject({ metric: "total_tokens" });
    await f.service.patch(f.companyId, f.root.id, { maxTokens: 600000, expectedRevisions: { total_tokens: 1 } }, f.board);
    expect(await f.service.getInvocationBlock(f.companyId, f.b.id)).toBeNull();
  });

  it("rejects conflicting receipts and stale multi-metric mutations without partial writes", async () => {
    const f = await fixture(); const run = await f.run(f.a.id);
    await f.report(run.id, 10, 100);
    await expect(f.report(run.id, 11, 100)).rejects.toMatchObject({ status: 409 });
    await expect(f.service.patch(f.companyId, f.root.id, { maxCostCents: 2500, maxTokens: 600000,
      expectedRevisions: { billed_cents: 1, total_tokens: 99 } }, f.board)).rejects.toMatchObject({ status: 409 });
    expect((await f.service.summary(f.companyId, f.root.id)).ownPolicies.find(row => row.metric === "billed_cents")?.amount).toBe(2000);
  });

  it("holds missing usage, preserves known charges, and does not repair accounting by raising a cap", async () => {
    const f = await fixture(); const run = await f.run(f.a1.id);
    await f.report(run.id, 40, null);
    expect(await f.service.getInvocationBlock(f.companyId, f.b.id)).toMatchObject({ code: "task_budget_usage_unavailable", metric: "total_tokens" });
    await f.service.patch(f.companyId, f.root.id, { maxTokens: 900000, expectedRevisions: { total_tokens: 1 } }, f.board);
    expect(await f.service.getInvocationBlock(f.companyId, f.b.id)).toMatchObject({ code: "task_budget_usage_unavailable" });
    expect((await f.service.summary(f.companyId, f.root.id)).descendantUsage.billedCents).toBe(40);
    await f.report(run.id, 40, 100, "repaired", 2);
    expect(await f.service.getInvocationBlock(f.companyId, f.b.id)).toBeNull();
  });

  it("serializes simultaneous threshold crossings and emits again at a new policy revision", async () => {
    const f = await fixture();
    const ra = await f.run(f.a.id); const rb = await f.run(f.b.id);
    await Promise.all([f.report(ra.id, 1100, 10), f.report(rb.id, 1100, 10)]);
    const incidents = () => db.select().from(budgetIncidents).where(and(eq(budgetIncidents.companyId, f.companyId), eq(budgetIncidents.thresholdType, "hard")));
    expect(await incidents()).toHaveLength(1);
    await f.service.patch(f.companyId, f.root.id, { maxCostCents: 2500, expectedRevisions: { billed_cents: 1 } }, f.board);
    await f.report(ra.id, 1600, 10, "additional", 2);
    expect(await incidents()).toHaveLength(2);
  });

  it("preserves past charges after moving, hiding, reopening and deleting a source task", async () => {
    const f = await fixture(); const run = await f.run(f.a1.id);
    await f.report(run.id, 100, 1000);
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, run.id));
    const other = await f.task("Other root");
    await f.service.guardStructureChange(f.companyId, f.a1.id, other.id);
    await db.update(issues).set({ parentId: other.id, hiddenAt: new Date(), status: "done" }).where(eq(issues.id, f.a1.id));
    expect((await f.service.summary(f.companyId, f.root.id)).descendantUsage.billedCents).toBe(100);
    const next = await f.run(f.a1.id); await f.report(next.id, 50, 500);
    expect((await f.service.summary(f.companyId, other.id)).descendantUsage.billedCents).toBe(50);
    await db.delete(issues).where(eq(issues.id, f.a1.id));
    expect((await f.service.summary(f.companyId, f.root.id)).descendantUsage.billedCents).toBe(100);
  });

  it("bounds manager allocations by remaining funding and denies self funding and escape", async () => {
    const f = await fixture(); const managerRun = await f.run(f.root.id, f.manager.id);
    const actor = { type: "agent" as const, agentId: f.manager.id, runId: managerRun.id };
    await f.service.patch(f.companyId, f.a.id, { maxCostCents: 1500, expectedRevisions: { billed_cents: 0 } }, actor);
    await expect(f.service.patch(f.companyId, f.b.id, { maxCostCents: 2100, expectedRevisions: { billed_cents: 0 } }, actor)).rejects.toMatchObject({ status: 422 });
    await expect(f.service.patch(f.companyId, f.root.id, { maxCostCents: 3000, expectedRevisions: { billed_cents: 1 } }, actor)).rejects.toMatchObject({ status: 403 });
    await expect(f.service.guardDelegation(f.companyId, null, f.manager.id, managerRun.id)).rejects.toMatchObject({ status: 403 });
    await expect(f.service.patch(f.companyId, f.a.id, { maxCostCents: null, expectedRevisions: { billed_cents: 1 } }, actor)).rejects.toMatchObject({ status: 403 });
  });

  it("keeps runtime support and company boundaries authoritative", async () => {
    const f = await fixture();
    expect(await f.service.getInvocationBlock(f.companyId, f.a.id, "process")).toMatchObject({ code: "task_budget_metering_unsupported" });
    await expect(f.service.summary(randomUUID(), f.root.id)).rejects.toThrow();
  });
  it("recovers a failed stop effect and resumes only the interrupted branch", async () => {
    const f = await fixture();
    const active = await f.run(f.a.id);
    const billing = await f.run(f.b.id);
    const outside = await f.task("Unrelated work");
    const outsideRun = await f.run(outside.id);
    await f.report(billing.id, 2100, 10);
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, billing.id));
    const stop = vi.fn(async (id: string) => { throw new Error(`retry cancellation ${id}`); });
    const resume = vi.fn(async () => {});
    await processTaskBudgetEffects(db, { cancelRun: stop, resumeIssue: resume }, f.companyId);
    const [effect] = await db.select().from(taskBudgetEffects).where(and(eq(taskBudgetEffects.companyId, f.companyId), eq(taskBudgetEffects.kind, "stop")));
    expect(effect.state).toBe("running");
    expect(effect.payload.runIds).toContain(active.id);
    expect(effect.payload.runIds).not.toContain(outsideRun.id);
    expect(effect.lastError).toContain("retry cancellation");
    await db.update(taskBudgetEffects).set({ leaseExpiresAt: new Date(0) }).where(eq(taskBudgetEffects.id, effect.id));
    const stopped = vi.fn(async (id: string) => { await db.update(heartbeatRuns).set({ status: "cancelled" }).where(eq(heartbeatRuns.id, id)); });
    await processTaskBudgetEffects(db, { cancelRun: stopped, resumeIssue: resume }, f.companyId);
    expect(stopped).toHaveBeenCalledWith(active.id);
    await f.report(active.id, 0, 0);
    await f.service.patch(f.companyId, f.root.id, { maxCostCents: 3000, expectedRevisions: { billed_cents: 1 } }, f.board);
    await processTaskBudgetEffects(db, { cancelRun: stopped, resumeIssue: resume }, f.companyId);
    expect(resume).toHaveBeenCalledWith(f.a.id, expect.stringContaining("task-budget:"));
    expect(resume).not.toHaveBeenCalledWith(outside.id, expect.anything());
    expect((await db.select().from(agents).where(eq(agents.id, f.worker.id)))[0].status).toBe("active");
  });

  it("blocks dependent work while a terminal run still lacks its final accounting", async () => {
    const f = await fixture(); const run = await f.run(f.a.id);
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, run.id));
    expect(await f.service.getInvocationBlock(f.companyId, f.b.id)).toMatchObject({ code: "task_budget_usage_unavailable" });
    await f.report(run.id, 0, 123);
    expect(await f.service.getInvocationBlock(f.companyId, f.b.id)).toBeNull();
  });

  it("does not let dismissal or a different adapter bypass a hard stop", async () => {
    const f = await fixture(); const run = await f.run(f.a.id);
    await f.report(run.id, 2000, 1);
    await db.update(budgetIncidents).set({ status: "dismissed" }).where(eq(budgetIncidents.companyId, f.companyId));
    expect(await f.service.getInvocationBlock(f.companyId, f.b.id, "codex_local")).toMatchObject({ code: "task_budget_exhausted" });
    await f.report(run.id, 2000, 2, "next", 2);
    expect(await db.select().from(budgetIncidents).where(and(eq(budgetIncidents.companyId, f.companyId), eq(budgetIncidents.thresholdType, "hard")))).toHaveLength(1);
  });

  it("resumes historical initialization across batches without losing or duplicating charges", async () => {
    const f = await fixture();
    await db.delete(taskBudgetAccountingState).where(eq(taskBudgetAccountingState.companyId, f.companyId));
    await db.insert(costEvents).values(Array.from({ length: 501 }, () => ({
      companyId: f.companyId, agentId: f.worker.id, issueId: f.a.id, provider: "fixture", model: "fixture",
      costCents: 1, totalTokens: 10, occurredAt: new Date(),
    })));
    expect(await initializeTaskBudgetAccounting(db, f.companyId)).toBe(false);
    expect(await initializeTaskBudgetAccounting(db, f.companyId)).toBe(false);
    expect(await initializeTaskBudgetAccounting(db, f.companyId)).toBe(true);
    expect(await initializeTaskBudgetAccounting(db, f.companyId)).toBe(true);
    const summary = await taskBudgetService(db).summary(f.companyId, f.root.id);
    expect(summary.descendantUsage).toMatchObject({ billedCents: 501, totalTokens: 5010 });
    expect(summary.legacyAttribution).toBe(true);
  });

  it("captures preexisting active work at initialization and holds its missing terminal receipt", async () => {
    const f = await fixture();
    await db.delete(taskBudgetAccountingState).where(eq(taskBudgetAccountingState.companyId, f.companyId));
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.worker.id,
      status: "running", contextSnapshot: { issueId: f.a.id } }).returning();
    await initializeTaskBudgetAccounting(db, f.companyId);
    expect(await f.service.getInvocationBlock(f.companyId, f.b.id)).toBeNull();
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, run.id));
    expect(await f.service.getInvocationBlock(f.companyId, f.b.id)).toMatchObject({ code: "task_budget_usage_unavailable" });
    await f.report(run.id, 0, 125);
    expect(await f.service.getInvocationBlock(f.companyId, f.b.id)).toBeNull();
  });

  it("settles the existing durable runtime receipt without a second financial charge", async () => {
    const f = await fixture(); const run = await f.run(f.a.id);
    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date(), costAccountingPending: true,
      usageJson: { provider: "openai", model: "fixture", billingType: "subscription_included", inputTokens: 10,
        cachedInputTokens: 100, outputTokens: 5, accountingReceiptReady: true, ledgerScope: { issueId: f.a.id } },
    }).where(eq(heartbeatRuns.id, run.id));
    expect(await accountRunCost(db, run.id, {}, new Map())).toBe(true);
    expect(await accountRunCost(db, run.id, {}, new Map())).toBe(false);
    await expect(f.report(run.id, 0, 115)).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(costEvents).where(eq(costEvents.heartbeatRunId, run.id))).toHaveLength(1);
    expect((await f.service.summary(f.companyId, f.root.id)).descendantUsage).toMatchObject({ billedCents: 0, totalTokens: 115 });
    expect(await f.service.getInvocationBlock(f.companyId, f.b.id)).toBeNull();
  });

  it("compares fractional cents exactly at the task cap", async () => {
    const f = await fixture();
    await f.service.patch(f.companyId, f.root.id, { maxCostCents: 1, expectedRevisions: { billed_cents: 1 } }, f.board);
    const costs = costService(db);
    for (let index = 0; index < 3; index++) await costs.createEvent(f.companyId, {
      agentId: f.worker.id, issueId: f.a.id, provider: "fixture", model: "fixture", totalTokens: 0,
      costCents: "0.3333333", occurredAt: new Date(), billingType: "metered_api",
    });
    expect(await f.service.getInvocationBlock(f.companyId, f.b.id)).toBeNull();
    await costs.createEvent(f.companyId, { agentId: f.worker.id, issueId: f.a.id, provider: "fixture", model: "fixture",
      totalTokens: 0, costCents: "0.0000001", occurredAt: new Date(), billingType: "metered_api" });
    expect(await f.service.getInvocationBlock(f.companyId, f.b.id)).toMatchObject({ code: "task_budget_exhausted", metric: "billed_cents" });
  });

  it("resumes the unfinished task whose settled receipt crossed the limit", async () => {
    const f = await fixture();
    await f.service.patch(f.companyId, f.root.id, { maxTokens: 1, expectedRevisions: { total_tokens: 1 } }, f.board);
    const run = await f.run(f.a.id);
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, run.id));
    await f.report(run.id, 0, 1);
    const resumed: string[] = [];
    const hooks = { cancelRun: async () => {}, resumeIssue: async (id: string) => { resumed.push(id); } };
    await processTaskBudgetEffects(db, hooks, f.companyId);
    expect(resumed).toEqual([]);
    await f.service.patch(f.companyId, f.root.id, { maxTokens: 2, expectedRevisions: { total_tokens: 2 } }, f.board);
    await processTaskBudgetEffects(db, hooks, f.companyId);
    expect(resumed).toEqual([f.a.id]);
  });

  it("reconciles a canonical run after authoritative pricing repairs its ledger", async () => {
    const f = await fixture(); const run = await f.run(f.a.id);
    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date(), costAccountingPending: true,
      usageJson: { provider: "fixture", model: "fixture", billingType: "metered_api", costStatus: "unpriced",
        inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, accountingReceiptReady: true,
        ledgerScope: { issueId: f.a.id } },
    }).where(eq(heartbeatRuns.id, run.id));
    await accountRunCost(db, run.id, {}, new Map());
    expect(await f.service.getInvocationBlock(f.companyId, f.a.id)).toMatchObject({ code: "task_budget_usage_unavailable", metric: "billed_cents" });
    await db.update(costEvents).set({ costCents: 1, costStatus: "reported" }).where(eq(costEvents.heartbeatRunId, run.id));
    await f.service.evaluatePolicies(f.companyId, [f.root.id]);
    expect(await f.service.getInvocationBlock(f.companyId, f.a.id)).toBeNull();
    expect((await f.service.summary(f.companyId, f.root.id)).descendantUsage).toMatchObject({ billedCents: 1, totalTokens: 15 });
  });

  it("does not expose ancestor titles through an agent's budget summary", async () => {
    const f = await fixture(); const run = await f.run(f.root.id, f.manager.id);
    const summary = await f.service.summary(f.companyId, f.a.id, { type: "agent", agentId: f.manager.id, runId: run.id });
    expect(summary.policies.map(policy => policy.scopeName)).toEqual(["Enclosing task", "Enclosing task"]);
    expect((await f.service.summary(f.companyId, f.a.id, f.board)).policies[0].scopeName).toBe("Root");
  });

  it("holds active unqualified work when a cap is added and retains qualified work", async () => {
    const f = await fixture(); const outside = await f.task("Previously uncapped work");
    const run = await f.run(outside.id);
    await f.service.patch(f.companyId, outside.id, { maxTokens: 1000, expectedRevisions: { total_tokens: 0 } }, f.board);
    expect(await f.service.getInvocationBlock(f.companyId, outside.id)).toMatchObject({ code: "task_budget_usage_unavailable" });
    const stopped = vi.fn(async () => {});
    await processTaskBudgetEffects(db, { cancelRun: stopped, resumeIssue: async () => {} }, f.companyId);
    expect(stopped).toHaveBeenCalledWith(run.id);
    const qualified = await f.task("Qualified active work");
    const qualifiedRun = await f.run(qualified.id);
    await f.service.captureRun(f.companyId, qualifiedRun.id, { billedCents: "included_zero", totalTokens: "reported", reportingBoundary: "run_end" });
    await f.service.patch(f.companyId, qualified.id, { maxTokens: 1000, expectedRevisions: { total_tokens: 0 } }, f.board);
    expect(await f.service.getInvocationBlock(f.companyId, qualified.id)).toBeNull();
  });

  it("denies capped admission until historical initialization is complete", async () => {
    const f = await fixture();
    await db.update(taskBudgetAccountingState).set({ state: "pending" }).where(eq(taskBudgetAccountingState.companyId, f.companyId));
    expect(await f.service.getInvocationBlock(f.companyId, f.a.id)).toMatchObject({ code: "task_budget_accounting_initializing" });
  });

});
