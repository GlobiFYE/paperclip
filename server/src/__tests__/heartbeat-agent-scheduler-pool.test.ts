import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agents, agentWakeupRequests, companies, createDb, heartbeatRuns, issues,
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

describePostgres("heartbeat runnable scheduler pool pressure", () => {
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
    provider.execute.mockImplementation(async (ctx: { runId?: string; context?: Record<string, unknown>; agent?: { companyId: string } }) => {
      active++; maxActive = Math.max(maxActive, active); entered.push(ctx.runId ?? `call-${entered.length}`);
      try {
        await new Promise<void>(resolve => { releases.push(resolve); });
        const issueId = ctx.context?.issueId;
        if (typeof issueId === "string" && ctx.agent?.companyId) {
          // Model an executor that completes its own fixture task. Leaving it
          // in_progress would correctly trigger unrelated missing-state recovery.
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

  it("parks a burst larger than the connection pool while one run is active", async () => {
    const scope = await fixture(); const controller = holdProvider();
    await heartbeat.wakeup(scope.agentId, request());
    await vi.waitFor(() => expect(controller.entered).toHaveLength(1), { timeout: 10_000 });
    // More concurrent enqueues than postgres.js' default pool size. Every
    // transaction can wait on the agent row without borrowing another slot.
    await Promise.all(Array.from({ length: 12 }, () => heartbeat.wakeup(scope.agentId, request())));
    const waiting = await db.select().from(agentWakeupRequests).where(and(
      eq(agentWakeupRequests.agentId, scope.agentId), eq(agentWakeupRequests.status, "agent_runnable"),
    ));
    expect(waiting).toHaveLength(12);
    expect(await activeCount(scope.agentId)).toBe(1);
    provider.execute.mockResolvedValue(success);
    releases[0]!();
    await heartbeat.drainActiveRunExecutions();
    const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, scope.agentId));
    expect(runs).toHaveLength(13);
    expect(runs.every(run => run.status === "succeeded")).toBe(true);
  }, 30_000);
});
