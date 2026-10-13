import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agents, agentWakeupRequests, companies, createDb, heartbeatRuns, issues, issueComments, issueRelations, projects,
  getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase,
} from "@paperclipai/db";
import { issueTreeControlService } from "../services/issue-tree-control.js";
import { heartbeatService } from "../services/heartbeat.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { runningProcesses } from "../adapters/index.js";

// Only the provider is substituted. Enqueue, SQL transactions, queue recovery,
// run claiming, execution state, finalization and next-run promotion are real.
const provider = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../adapters/index.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.js")>("../adapters/index.js");
  return { ...actual, getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute: provider.execute })) };
});
vi.mock("../services/agent-task-run-telemetry.js", () => ({ emitAgentTaskRun: vi.fn(async () => {}), emitAgentTaskRunById: vi.fn(async () => {}) }));

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;
if (!support.supported) console.warn(`Heartbeat scheduler integration NOT RUN: ${support.reason}`);

describePostgres("heartbeat parked work lifecycle controls", () => {
  let db!: ReturnType<typeof createDb>;
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let heartbeat: ReturnType<typeof heartbeatService>;
  const owner = "scheduler-fixture-owner";
  let releases: Array<() => void> = [];
  const success = { exitCode: 0, signal: null, timedOut: false, errorMessage: null,
    summary: "Isolated scheduler fixture completed.", provider: "test", model: "test-model" };

  beforeAll(async () => {
    if (process.env.DATABASE_URL || process.env.PAPERCLIP_API_KEY) throw new Error("isolated test credentials required");
    database = await startEmbeddedPostgresTestDatabase("heartbeat-agent-scheduler-controls-");
    db = createDb(database.connectionString);
    heartbeat = heartbeatService(db);
  }, 90_000);
  beforeEach(async () => {
    provider.execute.mockReset();
    provider.execute.mockResolvedValue(success);
    await instanceSettingsService(db).updateExperimental({ enableAgentRunnableScheduler: true });
  });
  afterEach(async () => {
    provider.execute.mockResolvedValue(success);
    for (const release of releases) release();
    releases = [];
    await heartbeat.drainActiveRunExecutions();
    runningProcesses.clear();
    await db.execute(sql`do $$ begin
      if exists (select 1 from pg_trigger where tgname = 'scheduler_integration_fail_insert') then
        drop trigger scheduler_integration_fail_insert on heartbeat_runs;
      end if;
      if exists (select 1 from pg_proc where proname = 'scheduler_integration_fail_insert') then
        drop function scheduler_integration_fail_insert();
      end if;
    end $$`);
    // This database was created by the isolated helper above, never supplied
    // by env. The real execution lifecycle writes many related fixture tables.
    await db.transaction(async tx => {
      await tx.execute(sql`set local client_min_messages = warning`);
      await tx.execute(sql`truncate table ${companies} cascade`);
    });
  });
  afterAll(async () => { await database?.cleanup(); });

  async function fixture(parallel = false) {
    const companyId = randomUUID(); const agentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Scheduler integration fixture", status: "active",
      issuePrefix: `I${companyId.replace(/-/g, "").slice(0, 7)}`, defaultResponsibleUserId: owner,
      requireBoardApprovalForNewAgents: false });
    await db.insert(agents).values({ id: agentId, companyId, name: "Fixture agent", role: "engineer",
      status: "idle", adapterType: "codex_local", adapterConfig: {}, permissions: {},
      runtimeConfig: { heartbeat: { enabled: false, intervalSec: 0, wakeOnDemand: true,
        maxConcurrentRuns: parallel ? 2 : 20, allowParallelExecution: parallel } } });
    return { companyId, agentId };
  }
  function holdProvider() {
    let active = 0; let maxActive = 0;
    const entered: string[] = [];
    provider.execute.mockImplementation(async (ctx: { runId?: string; context?: Record<string, unknown>; agent?: { id: string; companyId: string } }) => {
      active++; maxActive = Math.max(maxActive, active); entered.push(ctx.runId ?? `call-${entered.length}`);
      try {
        await new Promise<void>(resolve => { releases.push(resolve); });
        const issueId = ctx.context?.issueId;
        if (typeof issueId === "string" && ctx.agent?.companyId) {
          // Model an executor that completes its own fixture task. Leaving it
          // in_progress would correctly trigger unrelated missing-state recovery.
          await db.insert(issueComments).values({ companyId: ctx.agent.companyId, issueId,
            authorAgentId: ctx.agent.id, authorType: "agent", createdByRunId: ctx.runId,
            body: "Isolated provider fixture finished the assigned task; no external model was called." });
          await db.update(issues).set({ status: "done", completedAt: new Date() }).where(and(
            eq(issues.id, issueId), eq(issues.companyId, ctx.agent.companyId),
          ));
        }
        return success;
      } finally { active--; }
    });
    return { entered, maxActive: () => maxActive };
  }
  const request = (issueId?: string) => ({
    source: issueId ? "assignment" as const : "on_demand" as const,
    triggerDetail: "manual" as const,
    reason: issueId ? "issue_assigned" : "scheduler-fixture",
    requestedByActorType: "user" as const,
    requestedByActorId: owner,
    allowRunCoalescing: false,
    payload: issueId ? { issueId } : { manualUserWake: true },
    contextSnapshot: issueId ? { issueId } : {},
  });
  async function activeCount(agentId: string) {
    return (await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.agentId, agentId),
      eq(heartbeatRuns.status, "running")))).length;
  }

  async function parked(scope: { companyId: string; agentId: string }, payload: Record<string, unknown> = {}, createdAt = new Date()) {
    const [wake] = await db.insert(agentWakeupRequests).values({
      ...scope, status: "agent_runnable", source: "automation", reason: "agent_scheduler_enqueued",
      payload, requestedAt: createdAt, createdAt,
    }).returning();
    return wake!;
  }
  async function state(id: string) {
    const [row] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, id));
    return row!;
  }

  it("does not park duplicate dependency-ready wakes on repeated recovery passes", async () => {
    const scope = await fixture(); const controller = holdProvider();
    const [blocker] = await db.insert(issues).values({ companyId: scope.companyId, title: "finished blocker",
      status: "done", responsibleUserId: owner }).returning();
    const [dependent] = await db.insert(issues).values({ companyId: scope.companyId, title: "ready dependent",
      status: "blocked", assigneeAgentId: scope.agentId, responsibleUserId: owner,
      blockedTransitionAt: new Date(Date.now() - 60_000) }).returning();
    await db.insert(issueRelations).values({ companyId: scope.companyId, issueId: blocker!.id,
      relatedIssueId: dependent!.id, type: "blocks" });
    await heartbeat.wakeup(scope.agentId, request());
    await vi.waitFor(() => expect(controller.entered).toHaveLength(1), { timeout: 10_000 });
    for (let pass = 0; pass < 5; pass++) await heartbeat.reconcileResolvedDependencyWakes({ companyId: scope.companyId });
    const wakes = await db.select().from(agentWakeupRequests).where(and(
      eq(agentWakeupRequests.companyId, scope.companyId),
      sql`${agentWakeupRequests.payload}->>'issueId' = ${dependent!.id}`,
    ));
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.status).toBe("agent_runnable");
    releases[0]!();
    await vi.waitFor(() => expect(controller.entered).toHaveLength(2), { timeout: 10_000 });
    releases[1]!(); await heartbeat.drainActiveRunExecutions();
    const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, scope.agentId));
    expect(runs).toHaveLength(2);
    expect(runs.every(run => run.status === "succeeded")).toBe(true);
  }, 30_000);

  it.each(["company", "agent", "project"] as const)("budget cancellation includes parked work for the %s scope", async scopeType => {
    const scope = await fixture(); const foreign = await fixture();
    const [project] = await db.insert(projects).values({ companyId: scope.companyId, name: "budget fixture" }).returning();
    const target = await parked(scope, { projectId: project!.id });
    const other = await parked(foreign);
    await heartbeat.cancelBudgetScopeWork({ companyId: scope.companyId, scopeType,
      scopeId: scopeType === "company" ? scope.companyId : scopeType === "agent" ? scope.agentId : project!.id });
    expect((await state(target.id)).status).toBe("cancelled");
    expect((await state(other.id)).status).toBe("agent_runnable");
    await heartbeat.resumeQueuedRunsForAgent(scope.companyId, scope.agentId);
    await heartbeat.drainActiveRunExecutions();
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it("budget cancellation preserves parked work admitted after its cutoff", async () => {
    const scope = await fixture(); const cutoff = new Date();
    const old = await parked(scope, {}, new Date(cutoff.getTime() - 1000));
    const newer = await parked(scope, {}, new Date(cutoff.getTime() + 1000));
    await heartbeat.cancelBudgetScopeWork({ companyId: scope.companyId, scopeType: "agent", scopeId: scope.agentId,
      createdBefore: cutoff });
    expect((await state(old.id)).status).toBe("cancelled");
    expect((await state(newer.id)).status).toBe("agent_runnable");
  });

  it("agent cancellation leaves no old parked wake to run after resume", async () => {
    const scope = await fixture(); const foreign = await fixture();
    const target = await parked(scope); const other = await parked(foreign);
    const receipt = await heartbeat.cancelInvocationsForAgents([scope.agentId], "fixture agent stop");
    expect(receipt.wakeupsCancelled).toBe(1);
    expect((await state(target.id)).status).toBe("cancelled");
    expect((await state(other.id)).status).toBe("agent_runnable");
    await heartbeat.resumeQueuedRunsForAgent(scope.companyId, scope.agentId);
    await heartbeat.drainActiveRunExecutions();
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it("subtree cancellation covers parked root and child wakes without cancelling siblings", async () => {
    const scope = await fixture();
    const [root] = await db.insert(issues).values({ companyId: scope.companyId, title: "root", status: "todo" }).returning();
    const [child] = await db.insert(issues).values({ companyId: scope.companyId, title: "child", status: "todo", parentId: root!.id }).returning();
    const [sibling] = await db.insert(issues).values({ companyId: scope.companyId, title: "sibling", status: "todo" }).returning();
    const a = await parked(scope, { issueId: root!.id }); const b = await parked(scope, { issueId: child!.id });
    const c = await parked(scope, { issueId: sibling!.id });
    const receipt = await issueTreeControlService(db).cancelUnclaimedWakeupsForTree(scope.companyId, root!.id, "fixture tree stop");
    expect(receipt.map(row => row.id).sort()).toEqual([a.id, b.id].sort());
    expect((await state(a.id)).status).toBe("cancelled");
    expect((await state(b.id)).status).toBe("cancelled");
    expect((await state(c.id)).status).toBe("agent_runnable");
  });
});
