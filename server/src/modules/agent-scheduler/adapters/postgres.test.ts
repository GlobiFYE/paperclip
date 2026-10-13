import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog, agents, agentWakeupRequests, companies, createDb, heartbeatRuns,
  getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase,
  type Db,
} from "@paperclipai/db";
import { createAgentScheduler } from "../index.js";
import { persistActivity } from "../../../services/activity-log.js";
import { createPromoteAgentRunnableWork } from "../application/use-cases.js";
import type { AgentSchedulerDb, AgentSchedulerHost, RunnableWakeRow } from "../application/ports.js";
import {
  AGENT_SCHEDULER_DEQUEUE_REASON as DEQUEUE,
  AGENT_SCHEDULER_ENQUEUE_REASON as ENQUEUE,
  AGENT_SCHEDULER_MATERIALIZING_REASON as MATERIALIZING,
} from "../domain/policy.js";
import { createPostgresAgentSchedulerAdapter } from "./postgres.js";
import { listAgentSchedulerResumeCandidates } from "./resume.js";
import { checkAgentCapacityWithinClaimTransaction } from "./dispatch-capacity.js";

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;
if (!support.supported) console.warn(`Scheduler PostgreSQL tests NOT RUN: ${support.reason}`);

describePostgres("agent scheduler — real PostgreSQL transaction and recovery contracts", () => {
  let db: Db;
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;

  beforeAll(async () => {
    // Never accept a caller-provided database, a production company, or an API
    // credential. The repository helper allocates a new local PostgreSQL cluster.
    if (process.env.DATABASE_URL || process.env.PAPERCLIP_API_KEY) {
      throw new Error("scheduler tests require an isolated environment without production credentials");
    }
    database = await startEmbeddedPostgresTestDatabase("paperclip-agent-scheduler-test-");
    if (new URL(database.connectionString).hostname !== "127.0.0.1") throw new Error("test database must be loopback");
    db = createDb(database.connectionString);
  }, 90_000);

  afterEach(async () => {
    if (!db) return;
    await db.execute(sql`do $$ begin
      if exists (select 1 from pg_trigger where tgname = 'scheduler_test_reject_link') then
        drop trigger scheduler_test_reject_link on agent_wakeup_requests;
      end if;
      if exists (select 1 from pg_proc where proname = 'scheduler_test_reject_link') then
        drop function scheduler_test_reject_link();
      end if;
    end $$`);
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agents);
    await db.delete(companies);
  });
  afterAll(async () => { await database?.cleanup(); });

  async function fixture() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Scheduler fixture",
      issuePrefix: `S${companyId.replace(/-/g, "").slice(0, 7)}`,
      defaultResponsibleUserId: "scheduler-test-owner", requireBoardApprovalForNewAgents: false });
    await db.insert(agents).values({ id: agentId, companyId, name: "Fixture agent", role: "engineer",
      status: "idle", adapterType: "process", adapterConfig: {},
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 20 } },
      permissions: {} });
    return { companyId, agentId };
  }
  async function wakeFor(scope: { companyId: string; agentId: string }, requestedAt = new Date()) {
    const [row] = await db.insert(agentWakeupRequests).values({ ...scope, source: "assignment",
      status: "agent_runnable", reason: ENQUEUE, requestedAt,
      requestedByActorType: "system", payload: { _agentScheduler: { responsibleUserId: "scheduler-test-owner" } },
    }).returning();
    return row! as RunnableWakeRow;
  }
  async function insertRun(wake: RunnableWakeRow, tx: AgentSchedulerDb = db, status = "queued") {
    const [row] = await tx.insert(heartbeatRuns).values({ companyId: wake.companyId, agentId: wake.agentId,
      wakeupRequestId: wake.id, status, invocationSource: wake.source, responsibleUserId: "scheduler-test-owner",
      contextSnapshot: {},
    }).returning({ id: heartbeatRuns.id });
    return row!.id;
  }
  const host = (running = 0): AgentSchedulerHost => ({
    countRunningRunsForAgent: async () => running,
    appendSchedulerEvent: vi.fn(async () => {}),
  });
  const inputs = (scope: { companyId: string; agentId: string }) => ({ ...scope,
    schedulerEnabled: true, allowParallelExecution: false, configuredMaxConcurrentRuns: 20 });
  async function wakeState(wakeId: string) {
    return (await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, wakeId)))[0]!;
  }
  async function runsFor(wakeId: string) {
    return db.select().from(heartbeatRuns).where(eq(heartbeatRuns.wakeupRequestId, wakeId));
  }

  it("commits claim, run and wake link atomically; repeat construction cannot create another root", async () => {
    const wake = await wakeFor(await fixture());
    const writer = createPostgresAgentSchedulerAdapter(db);
    const create = vi.fn(insertRun);
    const id = await writer.createAndLinkRunnableWake({ wake, createRun: create, dequeueReason: DEQUEUE });
    expect(id).toBeTruthy();
    expect(await wakeState(wake.id)).toMatchObject({ status: "queued", runId: id, reason: DEQUEUE });
    expect(await writer.createAndLinkRunnableWake({ wake, createRun: create, dequeueReason: DEQUEUE })).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    expect(await runsFor(wake.id)).toHaveLength(1);
  });

  it.each(["before-insert", "after-insert"] as const)("rolls back %s failure and leaves the wake safely eligible", async phase => {
    const wake = await wakeFor(await fixture());
    const writer = createPostgresAgentSchedulerAdapter(db);
    await expect(writer.createAndLinkRunnableWake({ wake, dequeueReason: DEQUEUE,
      createRun: async (row, tx) => {
        if (phase === "after-insert") await insertRun(row, tx);
        throw new Error("controlled transaction failure");
      },
    })).rejects.toThrow("controlled transaction failure");
    expect(await runsFor(wake.id)).toHaveLength(0);
    expect(await wakeState(wake.id)).toMatchObject({ status: "agent_runnable", reason: ENQUEUE, runId: null, claimedAt: null });
    await writer.createAndLinkRunnableWake({ wake, createRun: insertRun, dequeueReason: DEQUEUE });
    expect(await runsFor(wake.id)).toHaveLength(1);
  });

  it("does not accept a null/no-write result after a callback INSERT", async () => {
    const wake = await wakeFor(await fixture());
    const writer = createPostgresAgentSchedulerAdapter(db);
    await expect(writer.createAndLinkRunnableWake({ wake, dequeueReason: DEQUEUE,
      createRun: async (row, tx) => { await insertRun(row, tx); return null; },
    })).rejects.toThrow("scheduler_null_creation_wrote_a_run");
    expect(await runsFor(wake.id)).toHaveLength(0);
    expect((await wakeState(wake.id)).reason).toBe(ENQUEUE);
  });

  it.each(["two-roots", "wrong-id"] as const)("rolls back an invalid creator receipt: %s", async mode => {
    const wake = await wakeFor(await fixture());
    const writer = createPostgresAgentSchedulerAdapter(db);
    await expect(writer.createAndLinkRunnableWake({ wake, dequeueReason: DEQUEUE,
      createRun: async (row, tx) => {
        const id = await insertRun(row, tx);
        if (mode === "two-roots") await insertRun(row, tx);
        return mode === "wrong-id" ? randomUUID() : id;
      },
    })).rejects.toThrow("scheduler_atomic_creation_result_ambiguous");
    expect(await runsFor(wake.id)).toHaveLength(0);
    expect(await wakeState(wake.id)).toMatchObject({ reason: ENQUEUE, runId: null });
  });

  it("rolls the INSERT back when a real PostgreSQL trigger rejects the wake link", async () => {
    const wake = await wakeFor(await fixture());
    const writer = createPostgresAgentSchedulerAdapter(db);
    await db.execute(sql`create function scheduler_test_reject_link() returns trigger language plpgsql as $$
      begin if NEW.run_id is not null then return null; end if; return NEW; end $$`);
    await db.execute(sql`create trigger scheduler_test_reject_link before update on agent_wakeup_requests
      for each row execute function scheduler_test_reject_link()`);
    await expect(writer.createAndLinkRunnableWake({ wake, createRun: insertRun, dequeueReason: DEQUEUE }))
      .rejects.toThrow("scheduler_atomic_run_link_rejected");
    expect(await runsFor(wake.id)).toHaveLength(0);
    expect(await wakeState(wake.id)).toMatchObject({ reason: ENQUEUE, runId: null });
    await db.execute(sql`drop trigger scheduler_test_reject_link on agent_wakeup_requests`);
    await writer.createAndLinkRunnableWake({ wake, createRun: insertRun, dequeueReason: DEQUEUE });
    expect(await runsFor(wake.id)).toHaveLength(1);
  });

  it("two controllers cannot create two roots while a live creator owns the row lock", async () => {
    const wake = await wakeFor(await fixture());
    const writer = createPostgresAgentSchedulerAdapter(db);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const create = vi.fn(async (row: RunnableWakeRow, tx: AgentSchedulerDb) => {
      entered(); await gate; return insertRun(row, tx);
    });
    const first = writer.createAndLinkRunnableWake({ wake, createRun: create, dequeueReason: DEQUEUE });
    await started;
    try {
      const second = await createPostgresAgentSchedulerAdapter(db).createAndLinkRunnableWake({
        wake, createRun: create, dequeueReason: DEQUEUE,
      });
      expect(second).toBeNull();
      expect(create).toHaveBeenCalledTimes(1);
      // An independent reader cannot see the uncommitted claim or run.
      expect((await wakeState(wake.id)).reason).toBe(ENQUEUE);
      expect(await runsFor(wake.id)).toHaveLength(0);
    } finally { release(); await first; }
    expect(await runsFor(wake.id)).toHaveLength(1);
  });

  it.each(["companyId", "agentId"] as const)("rejects foreign %s without invoking the creator", async field => {
    const wake = await wakeFor(await fixture());
    const create = vi.fn(insertRun);
    const writer = createPostgresAgentSchedulerAdapter(db);
    expect(await writer.createAndLinkRunnableWake({ wake: { ...wake, [field]: randomUUID() },
      createRun: create, dequeueReason: DEQUEUE })).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(await runsFor(wake.id)).toHaveLength(0);
  });

  it("does not authorize a legacy uncertain creation merely because it is old", async () => {
    const scope = await fixture(); const wake = await wakeFor(scope);
    await db.update(agentWakeupRequests).set({ reason: MATERIALIZING, claimedAt: new Date(0) })
      .where(eq(agentWakeupRequests.id, wake.id));
    const writer = createPostgresAgentSchedulerAdapter(db);
    expect(await writer.recoverStaleMaterializingClaims(scope.agentId)).toBe(0);
    const create = vi.fn(insertRun);
    expect(await writer.createAndLinkRunnableWake({ wake, createRun: create, dequeueReason: DEQUEUE })).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(await listAgentSchedulerResumeCandidates(db)).toHaveLength(0);
    const id = await insertRun(wake, db, "running");
    expect(await writer.recoverStaleMaterializingClaims(scope.agentId)).toBe(1);
    expect(await wakeState(wake.id)).toMatchObject({ runId: id, status: "claimed" });
  });

  it("retains ambiguous historical roots instead of creating a third", async () => {
    const scope = await fixture(); const wake = await wakeFor(scope);
    await db.update(agentWakeupRequests).set({ reason: MATERIALIZING }).where(eq(agentWakeupRequests.id, wake.id));
    await insertRun(wake); await insertRun(wake);
    const writer = createPostgresAgentSchedulerAdapter(db);
    expect(await writer.recoverStaleMaterializingClaims(scope.agentId)).toBe(0);
    expect(await listAgentSchedulerResumeCandidates(db)).toHaveLength(0);
    expect((await wakeState(wake.id)).runId).toBeNull();
    expect(await runsFor(wake.id)).toHaveLength(2);
  });

  it("promotes healthy work immediately after an atomic failure without timer heartbeats", async () => {
    const scope = await fixture();
    const bad = await wakeFor(scope, new Date(1));
    const healthy = await wakeFor(scope, new Date(2));
    expect(await db.select().from(heartbeatRuns)).toHaveLength(0);
    expect(await listAgentSchedulerResumeCandidates(db)).toEqual([{ agentId: scope.agentId }]);
    const writer = createPostgresAgentSchedulerAdapter(db);
    const promote = createPromoteAgentRunnableWork({ writer, host: host() });
    const create = vi.fn(async (row: RunnableWakeRow, tx: AgentSchedulerDb) => {
      if (row.id === bad.id) throw new Error("controlled failure before INSERT");
      return insertRun(row, tx);
    });
    expect((await promote({ ...inputs(scope), createRunForWake: create })).promoted).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(await runsFor(bad.id)).toHaveLength(0);
    expect(await runsFor(healthy.id)).toHaveLength(1);
    // A new service instance discovers durable ready work after process loss.
    const resumed = createPromoteAgentRunnableWork({ writer: createPostgresAgentSchedulerAdapter(db), host: host() });
    expect((await resumed({ ...inputs(scope), createRunForWake: insertRun })).promoted).toBe(1);
    expect(await runsFor(bad.id)).toHaveLength(1);
  });

  it.each(["before-insert", "after-insert"] as const)("recovers after terminating its own isolated PostgreSQL backend %s", async phase => {
    const scope = await fixture(); const wake = await wakeFor(scope);
    const writer = createPostgresAgentSchedulerAdapter(db);
    let entered!: () => void; let release!: () => void; let backendPid = 0;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = writer.createAndLinkRunnableWake({ wake, dequeueReason: DEQUEUE,
      createRun: async (row, tx) => {
        const [backend] = await (tx as Db).execute(sql`select pg_backend_pid() as pid`);
        backendPid = Number(backend?.pid);
        let id: string | null = null;
        if (phase === "after-insert") id = await insertRun(row, tx);
        entered(); await gate;
        return id ?? insertRun(row, tx);
      },
    }).then(value => ({ value, error: null as unknown }), error => ({ value: null, error }));
    await started;
    try {
      expect(backendPid).toBeGreaterThan(0);
      // The connection was created by this test's loopback-only database helper.
      // Never target an OS PID or a supplied/production database connection.
      const [terminated] = await db.execute(sql`select pg_terminate_backend(${backendPid}) as stopped`);
      expect(terminated?.stopped).toBe(true);
    } finally { release(); }
    const failed = await first;
    expect(failed.error).toBeTruthy();
    expect(await runsFor(wake.id)).toHaveLength(0);
    expect(await wakeState(wake.id)).toMatchObject({ reason: ENQUEUE, runId: null });
    await createPostgresAgentSchedulerAdapter(db).createAndLinkRunnableWake({ wake, createRun: insertRun, dequeueReason: DEQUEUE });
    expect(await runsFor(wake.id)).toHaveLength(1);
    expect((await wakeState(wake.id)).runId).toBeTruthy();
  });

  it("a lost COMMIT response cannot duplicate the persisted run", async () => {
    const scope = await fixture(); const wake = await wakeFor(scope);
    const writer = createPostgresAgentSchedulerAdapter(db);
    const atomic = writer.createAndLinkRunnableWake;
    writer.createAndLinkRunnableWake = async input => {
      await atomic(input); throw new Error("simulated response loss after actual COMMIT");
    };
    const create = vi.fn(insertRun);
    const promote = createPromoteAgentRunnableWork({ writer, host: host() });
    expect((await promote({ ...inputs(scope), createRunForWake: create })).promoted).toBe(0);
    await promote({ ...inputs(scope), createRunForWake: create });
    expect(create).toHaveBeenCalledTimes(1);
    expect(await runsFor(wake.id)).toHaveLength(1);
    expect((await wakeState(wake.id)).runId).toBeTruthy();
  });

  it("filters skipped candidates before LIMIT and reaches the 51st healthy wake", async () => {
    const scope = await fixture();
    const rows = await db.insert(agentWakeupRequests).values(Array.from({ length: 51 }, (_, i) => ({
      ...scope, source: "assignment", reason: ENQUEUE, status: "agent_runnable", requestedAt: new Date(i + 1),
    }))).returning();
    const healthyId = rows[50]!.id;
    const writer = createPostgresAgentSchedulerAdapter(db);
    const create = vi.fn(async (wake: RunnableWakeRow, tx: AgentSchedulerDb) => wake.id === healthyId ? insertRun(wake, tx) : null);
    const result = await createPromoteAgentRunnableWork({ writer, host: host() })({ ...inputs(scope), createRunForWake: create });
    expect(result.promoted).toBe(1); expect(create).toHaveBeenCalledTimes(51);
    expect(await runsFor(healthyId)).toHaveLength(1);
  });

  it("recovery excludes paused companies and work before the execution cutoff", async () => {
    const scope = await fixture(); await wakeFor(scope, new Date(1));
    expect(await listAgentSchedulerResumeCandidates(db, new Date(2))).toHaveLength(0);
    expect(await listAgentSchedulerResumeCandidates(db)).toHaveLength(1);
    await db.update(companies).set({ status: "paused" }).where(eq(companies.id, scope.companyId));
    expect(await listAgentSchedulerResumeCandidates(db)).toHaveLength(0);
  });

  it("negative control: a different audit connection waits on the held agent FK lock", async () => {
    const scope = await fixture();
    await db.transaction(async tx => {
      await tx.select().from(agents).where(eq(agents.id, scope.agentId)).for("update");
      await expect(db.transaction(async other => {
        await other.execute(sql`set local lock_timeout = '250ms'`);
        await persistActivity(other as unknown as Db, { ...scope, actorType: "system", actorId: "scheduler-test",
          action: "agent.scheduler", entityType: "agent", entityId: scope.agentId, details: { kind: "enqueue" } });
      })).rejects.toThrow();
    });
    expect(await db.select().from(activityLog)).toHaveLength(0);
  });

  it("parks and audits on the exact transaction, including two concurrent agents", async () => {
    const scopes = [await fixture(), await fixture()];
    const rootHost: AgentSchedulerHost = { ...host(1), appendSchedulerEvent: vi.fn(async () => {
      throw new Error("must not call base-connection audit from park transaction");
    }) };
    const scheduler = createAgentScheduler(db, rootHost);
    await Promise.all(scopes.map(scope => db.transaction(async tx => {
      await tx.execute(sql`set local lock_timeout = '2s'`);
      await tx.select().from(agents).where(eq(agents.id, scope.agentId)).for("update");
      const [wake] = await tx.insert(agentWakeupRequests).values({ ...scope, source: "timer", status: "queued" }).returning();
      expect((await scheduler.evaluateAdmissionForDb(tx as unknown as Db)({ ...inputs(scope),
        runningRunCount: 1, wakeRequestId: wake!.id, issueId: null })).action).toBe("park");
    })));
    expect(rootHost.appendSchedulerEvent).not.toHaveBeenCalled();
    const audits = await db.select().from(activityLog).where(eq(activityLog.action, "agent.scheduler"));
    expect(audits).toHaveLength(2);
    for (const scope of scopes) expect(audits.some(a => a.companyId === scope.companyId && a.agentId === scope.agentId)).toBe(true);
    const wakes = await db.select().from(agentWakeupRequests);
    expect(wakes).toHaveLength(2);
    expect(wakes.every(wake => wake.status === "agent_runnable" && wake.runId === null)).toBe(true);
  });

  it("serializes active-run claims across controllers, not only the in-memory start lock", async () => {
    const scope = await fixture(); const firstWake = await wakeFor(scope); const secondWake = await wakeFor(scope);
    const policy = inputs(scope);
    let release!: () => void; let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = db.transaction(async tx => {
      expect(await checkAgentCapacityWithinClaimTransaction(tx as unknown as Db, policy)).toBe(true);
      entered(); await gate;
      return insertRun(firstWake, tx as unknown as AgentSchedulerDb, "running");
    });
    await started;
    try {
      expect(await db.transaction(tx => checkAgentCapacityWithinClaimTransaction(tx as unknown as Db, policy))).toBe(false);
    } finally { release(); }
    const firstId = await first;
    expect(await db.transaction(tx => checkAgentCapacityWithinClaimTransaction(tx as unknown as Db, policy))).toBe(false);
    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, firstId));
    await db.transaction(async tx => {
      expect(await checkAgentCapacityWithinClaimTransaction(tx as unknown as Db, policy)).toBe(true);
      await insertRun(secondWake, tx as unknown as AgentSchedulerDb, "running");
    });
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.status, "running"))).toHaveLength(1);
  });

  it("allows exactly one winner among concurrent claim transactions for a serial agent", async () => {
    const scope = await fixture();
    const wakes = await Promise.all(Array.from({ length: 8 }, () => wakeFor(scope)));
    const won = await Promise.all(wakes.map(wake => db.transaction(async tx => {
      if (!await checkAgentCapacityWithinClaimTransaction(tx as unknown as Db, inputs(scope))) return false;
      await insertRun(wake, tx as unknown as AgentSchedulerDb, "running");
      return true;
    })));
    expect(won.filter(Boolean)).toHaveLength(1);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.status, "running"))).toHaveLength(1);
  });

  it("retains explicit parallel capacity and leaves the third run queued", async () => {
    const scope = await fixture(); const policy = { ...inputs(scope), allowParallelExecution: true, configuredMaxConcurrentRuns: 2 };
    for (let i = 0; i < 3; i++) {
      const wake = await wakeFor(scope);
      await db.transaction(async tx => {
        const allowed = await checkAgentCapacityWithinClaimTransaction(tx as unknown as Db, policy);
        expect(allowed).toBe(i < 2);
        if (allowed) await insertRun(wake, tx as unknown as AgentSchedulerDb, "running");
      });
    }
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.status, "running"))).toHaveLength(2);
  });

  it("capacity locks do not serialize distinct agents and are released on rollback", async () => {
    const a = await fixture(); const b = await fixture();
    await expect(db.transaction(async tx => {
      expect(await checkAgentCapacityWithinClaimTransaction(tx as unknown as Db, inputs(a))).toBe(true);
      expect(await db.transaction(other => checkAgentCapacityWithinClaimTransaction(other as unknown as Db, inputs(b)))).toBe(true);
      throw new Error("controlled claim rollback");
    })).rejects.toThrow("controlled claim rollback");
    expect(await db.transaction(tx => checkAgentCapacityWithinClaimTransaction(tx as unknown as Db, inputs(a)))).toBe(true);
  });

  it("capacity checks reject a mismatched company and preserve flag-off behavior", async () => {
    const scope = await fixture();
    expect(await db.transaction(tx => checkAgentCapacityWithinClaimTransaction(tx as unknown as Db,
      { ...inputs(scope), companyId: randomUUID() }))).toBe(false);
    expect(await db.transaction(tx => checkAgentCapacityWithinClaimTransaction(tx as unknown as Db,
      { ...inputs(scope), schedulerEnabled: false }))).toBe(true);
  });

});
