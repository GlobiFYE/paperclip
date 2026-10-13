import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agents, agentWakeupRequests, companies, createDb, heartbeatRuns, issues, issueComments,
  getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase,
} from "@paperclipai/db";
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

describePostgres("heartbeat runnable scheduler integration", () => {
  let db!: ReturnType<typeof createDb>;
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let heartbeat: ReturnType<typeof heartbeatService>;
  const owner = "scheduler-fixture-owner";
  let releases: Array<() => void> = [];
  const success = { exitCode: 0, signal: null, timedOut: false, errorMessage: null,
    summary: "Isolated scheduler fixture completed.", provider: "test", model: "test-model" };

  beforeAll(async () => {
    if (process.env.DATABASE_URL || process.env.PAPERCLIP_API_KEY) throw new Error("isolated test credentials required");
    database = await startEmbeddedPostgresTestDatabase("heartbeat-agent-runnable-scheduler-");
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
    await db.execute(sql`truncate table ${companies} cascade`);
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

  it("serializes two simultaneous issue assignments despite configured legacy capacity 20", async () => {
    const scope = await fixture(); const controller = holdProvider();
    const tasks = await db.insert(issues).values(["one", "two"].map(name => ({ companyId: scope.companyId,
      title: `Scheduler ${name}`, status: "todo", priority: "medium", assigneeAgentId: scope.agentId,
      responsibleUserId: owner }))).returning({ id: issues.id });
    await Promise.all(tasks.map(task => heartbeat.wakeup(scope.agentId, request(task.id))));
    await vi.waitFor(() => expect(controller.entered).toHaveLength(1), { timeout: 10_000 });
    expect(await activeCount(scope.agentId)).toBe(1);
    releases[0]!();
    await vi.waitFor(() => expect(controller.entered).toHaveLength(2), { timeout: 10_000 });
    expect(controller.maxActive()).toBe(1);
    expect(await activeCount(scope.agentId)).toBe(1);
    releases[1]!();
    await heartbeat.drainActiveRunExecutions();
    const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, scope.agentId));
    expect(runs, JSON.stringify(runs.map(run => ({status:run.status,errorCode:run.errorCode,wakeReason:run.contextSnapshot?.wakeReason,issueId:run.issueId,retryOfRunId:run.retryOfRunId})))).toHaveLength(2);
    expect(runs.every(run => run.status === "succeeded")).toBe(true);
    expect(new Set(runs.map(run => run.wakeupRequestId)).size).toBe(2);
  }, 30_000);

  it("parks a non-issue wake and its audit under the agent lock, then promotes it after completion", async () => {
    const scope = await fixture(); const controller = holdProvider();
    await heartbeat.wakeup(scope.agentId, request());
    await vi.waitFor(() => expect(controller.entered).toHaveLength(1), { timeout: 10_000 });
    await heartbeat.wakeup(scope.agentId, request());
    const parked = await db.select().from(agentWakeupRequests).where(and(
      eq(agentWakeupRequests.agentId, scope.agentId), eq(agentWakeupRequests.status, "agent_runnable"),
    ));
    expect(parked).toHaveLength(1);
    expect(parked[0]!.runId).toBeNull();
    expect(parked[0]!.payload?._agentScheduler).toMatchObject({ triggerReason: "agent_at_capacity",
      effectiveCapacity: 1, responsibleUserId: owner });
    releases[0]!();
    await vi.waitFor(() => expect(controller.entered).toHaveLength(2), { timeout: 10_000 });
    expect(controller.maxActive()).toBe(1);
    releases[1]!(); await heartbeat.drainActiveRunExecutions();
    const wake = (await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, parked[0]!.id)))[0]!;
    expect(wake.runId).toBeTruthy();
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.wakeupRequestId, wake.id))).toHaveLength(1);
  }, 30_000);

  it("startup recovery discovers ready wakes without queued runs or per-agent heartbeat timers", async () => {
    const scope = await fixture();
    const [wake] = await db.insert(agentWakeupRequests).values({ ...scope, source: "on_demand",
      triggerDetail: "manual", reason: "agent_scheduler_enqueued", status: "agent_runnable",
      requestedByActorType: "user", requestedByActorId: owner,
      payload: { manualUserWake: true, _agentScheduler: { enrichedContextSnapshot: {},
        responsibleUserId: owner, sessionIdBefore: null, continuationAttempt: 0 } },
    }).returning();
    expect(await db.select().from(heartbeatRuns)).toHaveLength(0);
    const restarted = heartbeatService(db);
    await restarted.resumeQueuedRuns(); await restarted.drainActiveRunExecutions();
    expect(provider.execute).toHaveBeenCalledTimes(1);
    const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.wakeupRequestId, wake!.id));
    expect(runs).toHaveLength(1); expect(runs[0]!.status).toBe("succeeded");
    await restarted.resumeQueuedRuns(); await restarted.drainActiveRunExecutions();
    expect(provider.execute).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("a real INSERT failure cannot strand a healthy wake in the same agent queue", async () => {
    const scope = await fixture();
    const wakes = await db.insert(agentWakeupRequests).values([true, false].map((fail, index) => ({ ...scope,
      source: "on_demand", triggerDetail: "manual", reason: "agent_scheduler_enqueued", status: "agent_runnable",
      requestedAt: new Date(index + 1), requestedByActorType: "user", requestedByActorId: owner,
      payload: { manualUserWake: true, _agentScheduler: { responsibleUserId: owner,
        enrichedContextSnapshot: { schedulerTestFailure: fail }, continuationAttempt: 0 } },
    }))).returning();
    await db.execute(sql`create function scheduler_integration_fail_insert() returns trigger language plpgsql as $$
      begin if NEW.context_snapshot->>'schedulerTestFailure' = 'true' then
        raise exception 'controlled scheduler fixture INSERT failure'; end if; return NEW; end $$`);
    await db.execute(sql`create trigger scheduler_integration_fail_insert before insert on heartbeat_runs
      for each row execute function scheduler_integration_fail_insert()`);
    await heartbeat.resumeQueuedRuns(); await heartbeat.drainActiveRunExecutions();
    expect(provider.execute).toHaveBeenCalledTimes(1);
    const healthyRuns = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.wakeupRequestId, wakes[1]!.id));
    expect(healthyRuns).toHaveLength(1); expect(healthyRuns[0]!.status).toBe("succeeded");
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.wakeupRequestId, wakes[0]!.id))).toHaveLength(0);
    const bad = (await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, wakes[0]!.id)))[0]!;
    expect(bad).toMatchObject({ status: "agent_runnable", reason: "agent_scheduler_enqueued", runId: null });
  }, 30_000);

  it("preserves an explicit safe parallel override", async () => {
    const scope = await fixture(true); const controller = holdProvider();
    await Promise.all([heartbeat.wakeup(scope.agentId, request()), heartbeat.wakeup(scope.agentId, request())]);
    await vi.waitFor(() => expect(controller.entered).toHaveLength(2), { timeout: 10_000 });
    expect(await activeCount(scope.agentId)).toBe(2);
    expect(controller.maxActive()).toBe(2);
    for (const release of releases) release();
    await heartbeat.drainActiveRunExecutions();
  }, 30_000);
});
