import { describe, expect, it, vi } from "vitest";
import type { AgentSchedulerHost, AgentSchedulerWriter, RunnableWakeRow } from "./ports.js";
import {
  AGENT_SCHEDULER_DEQUEUE_REASON,
  AGENT_SCHEDULER_ENQUEUE_REASON,
  AGENT_SCHEDULER_MATERIALIZING_CLAIM_TTL_MS,
  AGENT_SCHEDULER_MATERIALIZING_REASON,
} from "../domain/policy.js";
import { createEvaluateAgentSchedulerAdmission, createPromoteAgentRunnableWork } from "./use-cases.js";

const BASE_FACTS = {
  schedulerEnabled: true, allowParallelExecution: false, configuredMaxConcurrentRuns: 20,
  companyId: "company-1", agentId: "agent-1",
};

function runnableWake(id: string, overrides: Partial<RunnableWakeRow> = {}): RunnableWakeRow {
  return {
    id, companyId: "company-1", agentId: "agent-1", source: "automation", triggerDetail: null,
    reason: null, payload: { issueId: `issue-${id}` }, requestedByActorType: "system",
    requestedByActorId: null, idempotencyKey: null, requestedAt: new Date(0), ...overrides,
  };
}

function createMemoryWriter(now: () => number = Date.now): AgentSchedulerWriter & {
  parked: Array<{ wakeRequestId: string; schedulerMeta: Record<string, unknown> }>;
  runnable: RunnableWakeRow[];
  materialized: Array<{ wakeId: string; runId: string }>;
  claimed: Set<string>;
  persistedRuns: Array<{ id: string; wakeId: string; agentId: string; companyId: string }>;
} {
  const parked: Array<{ wakeRequestId: string; schedulerMeta: Record<string, unknown> }> = [];
  const runnable: RunnableWakeRow[] = [];
  const materialized: Array<{ wakeId: string; runId: string }> = [];
  const claimed = new Set<string>();
  const persistedRuns: Array<{ id: string; wakeId: string; agentId: string; companyId: string }> = [];
  const roots = (row: RunnableWakeRow) => persistedRuns.filter((run) =>
    run.wakeId === row.id && run.agentId === row.agentId && run.companyId === row.companyId);
  const eligible = (row: RunnableWakeRow) =>
    (row.reason === null || row.reason === AGENT_SCHEDULER_ENQUEUE_REASON) && roots(row).length === 0;
  return {
    parked, runnable, materialized, claimed, persistedRuns,
    async listRunnableWakes(agentId, limit, options) {
      return runnable.filter((row) => row.agentId === agentId && eligible(row) &&
        !options?.excludeWakeIds?.includes(row.id) &&
        (!options?.requestedAtOrAfter || row.requestedAt >= options.requestedAtOrAfter)).slice(0, limit);
    },
    async createAndLinkRunnableWake(input) {
      const row = runnable.find(entry => entry.id === input.wake.id &&
        entry.companyId === input.wake.companyId && entry.agentId === input.wake.agentId);
      if (!row || !eligible(row)) return null;
      const oldReason = row.reason;
      const priorRunIds = new Set(roots(row).map(run => run.id));
      if (!await this.tryClaimRunnableWake(row.id)) return null;
      try {
        // This fake models only the atomic port. Actual SQL/rollback/visibility
        // are exercised independently by adapters/postgres.test.ts.
        const runId = await input.createRun({ ...row, reason: oldReason }, {});
        if (runId === null) {
          if (roots(row).length) throw new Error("null result after write");
          await this.releaseClaimedRunnableWake({ wakeId: row.id, companyId: row.companyId,
            agentId: row.agentId, enqueueReason: AGENT_SCHEDULER_ENQUEUE_REASON });
          return null;
        }
        if (!roots(row).some(run => run.id === runId)) {
          persistedRuns.push({ id: runId, wakeId: row.id, companyId: row.companyId, agentId: row.agentId });
        }
        if (!await this.materializeRunnableWake({ wake: row, runId, dequeueReason: input.dequeueReason })) {
          throw new Error("synthetic link rejection");
        }
        return runId;
      } catch (error) {
        // Roll back only this transaction's wake; retain concurrent other work.
        for (let i = persistedRuns.length - 1; i >= 0; i--) {
          const run = persistedRuns[i]!;
          if (run.wakeId === row.id && !priorRunIds.has(run.id)) persistedRuns.splice(i, 1);
        }
        for (let i = materialized.length - 1; i >= 0; i--) {
          if (materialized[i]?.wakeId === row.id) materialized.splice(i, 1);
        }
        if (!runnable.some(entry => entry.id === row.id)) runnable.push(row);
        row.reason = oldReason;
        claimed.delete(row.id);
        throw error;
      }
    },
    async countRunnableWakes(agentId) { return runnable.filter((row) => row.agentId === agentId).length; },
    async parkWakeAsRunnable(input) {
      parked.push({ wakeRequestId: input.wakeRequestId, schedulerMeta: input.schedulerMeta });
      runnable.push(runnableWake(input.wakeRequestId, {
        companyId: input.companyId, agentId: input.agentId,
        reason: input.enqueueReason, requestedAt: new Date(parked.length * 1000 + now()),
      }));
      return true;
    },
    async tryClaimRunnableWake(wakeId) {
      const row = runnable.find((entry) => entry.id === wakeId);
      if (!row || !eligible(row)) return false;
      row.reason = AGENT_SCHEDULER_MATERIALIZING_REASON;
      claimed.add(wakeId);
      return true;
    },
    async recoverStaleMaterializingClaims(agentId) {
      let recovered = 0;
      for (const row of [...runnable]) {
        if (row.agentId !== agentId) continue;
        if (row.reason !== null && row.reason !== AGENT_SCHEDULER_ENQUEUE_REASON &&
          row.reason !== AGENT_SCHEDULER_MATERIALIZING_REASON) continue;
        const existing = roots(row);
        if (existing.length !== 1) continue;
        materialized.push({ wakeId: row.id, runId: existing[0]!.id });
        runnable.splice(runnable.indexOf(row), 1);
        claimed.delete(row.id);
        recovered += 1;
      }
      return recovered;
    },
    async releaseClaimedRunnableWake(input) {
      const row = runnable.find((entry) => entry.id === input.wakeId &&
        entry.companyId === input.companyId && entry.agentId === input.agentId);
      if (!row || row.reason !== AGENT_SCHEDULER_MATERIALIZING_REASON || roots(row).length !== 0) return;
      row.reason = input.enqueueReason;
      claimed.delete(input.wakeId);
    },
    async materializeRunnableWake(input) {
      const prior = materialized.find((row) => row.wakeId === input.wake.id);
      if (prior) return prior.runId === input.runId;
      const index = runnable.findIndex((row) => row.id === input.wake.id);
      if (index < 0) return false;
      runnable.splice(index, 1);
      claimed.delete(input.wake.id);
      materialized.push({ wakeId: input.wake.id, runId: input.runId });
      return true;
    },
  };
}

function createFakeHost(runningRunCount = 0): AgentSchedulerHost & {
  events: unknown[]; setRunningCount: (n: number) => void;
} {
  let count = runningRunCount;
  const events: unknown[] = [];
  return {
    events, setRunningCount(n) { count = n; },
    async countRunningRunsForAgent() { return count; },
    async appendSchedulerEvent(input) { events.push(input); },
  };
}

async function park(writer: AgentSchedulerWriter, id: string, agentId = "agent-1") {
  await writer.parkWakeAsRunnable({ wakeRequestId: id, companyId: "company-1", agentId,
    enqueueReason: AGENT_SCHEDULER_ENQUEUE_REASON, schedulerMeta: {} });
}
function persisted(writer: ReturnType<typeof createMemoryWriter>, wakeId: string, id: string, agentId = "agent-1") {
  writer.persistedRuns.push({ id, wakeId, companyId: "company-1", agentId });
}
function setup(count = 0, clock: () => number = Date.now) {
  const writer = createMemoryWriter(clock);
  const host = createFakeHost(count);
  return { writer, host, promote: createPromoteAgentRunnableWork({ host, writer }),
    evaluate: createEvaluateAgentSchedulerAdmission({ host, writer }) };
}

describe("scheduler admission and promotion", () => {
  it("materializes when the agent has a free slot", async () => {
    const { writer, host, evaluate } = setup();
    expect(await evaluate({ ...BASE_FACTS, runningRunCount: 0, wakeRequestId: "a", issueId: "issue-a" }))
      .toEqual({ action: "materialize" });
    expect(writer.parked).toHaveLength(0); expect(host.events).toHaveLength(0);
  });
  it("parks a second assignment while one run is active", async () => {
    const { writer, host, evaluate } = setup(1);
    expect(await evaluate({ ...BASE_FACTS, runningRunCount: 1, wakeRequestId: "b", issueId: "issue-b" }))
      .toEqual({ action: "park", queueDepth: 1 });
    expect(writer.parked[0]?.wakeRequestId).toBe("b");
    expect(host.events[0]).toMatchObject({ kind: "enqueue", wakeRequestId: "b", effectiveCapacity: 1 });
  });
  it("promotes the oldest runnable wake when capacity opens", async () => {
    const { writer, host, promote } = setup(); await park(writer, "oldest"); await park(writer, "newer");
    const create = vi.fn(async (wake: RunnableWakeRow) => `run-${wake.id}`);
    expect(await promote({ ...BASE_FACTS, createRunForWake: create })).toEqual({ promoted: 1, runIds: ["run-oldest"] });
    expect(create).toHaveBeenCalledTimes(1);
    expect(writer.materialized).toEqual([{ wakeId: "oldest", runId: "run-oldest" }]);
    expect(host.events[0]).toMatchObject({ kind: "dequeue", reason: AGENT_SCHEDULER_DEQUEUE_REASON, queueDepth: 1 });
  });
  it("does not create a run while the agent is at serial capacity", async () => {
    const { writer, host, promote } = setup(1); await park(writer, "waiting");
    const create = vi.fn(async () => "unexpected");
    expect(await promote({ ...BASE_FACTS, createRunForWake: create })).toEqual({ promoted: 0, runIds: [] });
    expect(create).toHaveBeenCalledTimes(0); expect(writer.runnable).toHaveLength(1); expect(host.events).toHaveLength(0);
  });
  it("skips a null creation and promotes the next ready wake", async () => {
    const { writer, promote } = setup(); await park(writer, "stuck"); await park(writer, "ready");
    const create = vi.fn(async (wake: RunnableWakeRow) => wake.id === "stuck" ? null : "run-ready");
    expect(await promote({ ...BASE_FACTS, createRunForWake: create })).toEqual({ promoted: 1, runIds: ["run-ready"] });
    expect(create).toHaveBeenCalledTimes(2); expect(writer.runnable.map(row => row.id)).toEqual(["stuck"]);
  });
  it("allows only one materializing claim per wake", async () => {
    const { writer } = setup(); await park(writer, "race");
    expect(await writer.tryClaimRunnableWake("race")).toBe(true);
    expect(await writer.tryClaimRunnableWake("race")).toBe(false);
  });
  it("serializes two assignments through park and promotion", async () => {
    const { writer, host, evaluate, promote } = setup();
    expect(await evaluate({ ...BASE_FACTS, runningRunCount: 0, wakeRequestId: "one", issueId: "one" }))
      .toEqual({ action: "materialize" });
    host.setRunningCount(1);
    expect(await evaluate({ ...BASE_FACTS, runningRunCount: 1, wakeRequestId: "two", issueId: "two" }))
      .toEqual({ action: "park", queueDepth: 1 });
    host.setRunningCount(0);
    expect(await promote({ ...BASE_FACTS, createRunForWake: async () => "run-two" }))
      .toEqual({ promoted: 1, runIds: ["run-two"] });
    expect(writer.runnable).toHaveLength(0);
  });
});

describe("claim recovery and deferred activity", () => {
  it("retries after a confirmed null/no-write creation result", async () => {
    const { writer, promote } = setup(); await park(writer, "retry");
    expect(await promote({ ...BASE_FACTS, createRunForWake: async () => null })).toEqual({ promoted: 0, runIds: [] });
    expect(writer.runnable[0]?.reason).toBe(AGENT_SCHEDULER_ENQUEUE_REASON);
    expect(writer.claimed.size).toBe(0);
    expect(await promote({ ...BASE_FACTS, createRunForWake: async () => "run-retry" }))
      .toEqual({ promoted: 1, runIds: ["run-retry"] });
  });
  it("does not replay inside a failed pass and retries only a rolled-back atomic wake later", async () => {
    const { writer, host, promote } = setup(); await park(writer, "error");
    const create = vi.fn(async () => { throw new Error("synthetic failure"); });
    await promote({ ...BASE_FACTS, createRunForWake: create });
    expect(create).toHaveBeenCalledTimes(1);
    expect(writer.claimed.has("error")).toBe(false);
    expect(writer.runnable[0]?.reason).toBe(AGENT_SCHEDULER_ENQUEUE_REASON);
    await promote({ ...BASE_FACTS, createRunForWake: create });
    expect(create).toHaveBeenCalledTimes(2);
    expect(writer.persistedRuns).toHaveLength(0);
    expect(host.events[0]).toMatchObject({ kind: "blocked", reason: "materialization_outcome_uncertain" });
  });
  it("does not reclaim a live intent at the old lease boundary", async () => {
    let now = 1_000_000; const { writer, promote } = setup(0, () => now);
    await park(writer, "live"); await writer.tryClaimRunnableWake("live");
    now += AGENT_SCHEDULER_MATERIALIZING_CLAIM_TTL_MS;
    const create = vi.fn(async () => "unexpected");
    expect(await promote({ ...BASE_FACTS, createRunForWake: create })).toEqual({ promoted: 0, runIds: [] });
    expect(create).toHaveBeenCalledTimes(0); expect(writer.claimed.has("live")).toBe(true);
  });
  it("does not reauthorize an expired intent without evidence of its result", async () => {
    let now = 1_000_000; const { writer, promote } = setup(0, () => now);
    await park(writer, "stale"); await writer.tryClaimRunnableWake("stale");
    now += AGENT_SCHEDULER_MATERIALIZING_CLAIM_TTL_MS * 10;
    const create = vi.fn(async () => "duplicate");
    expect(await promote({ ...BASE_FACTS, createRunForWake: create })).toEqual({ promoted: 0, runIds: [] });
    expect(create).toHaveBeenCalledTimes(0); expect(writer.claimed.has("stale")).toBe(true);
  });
  it("does not recover, count or list another agent's claims", async () => {
    const { writer } = setup(); await park(writer, "other", "agent-2"); await writer.tryClaimRunnableWake("other");
    persisted(writer, "other", "run-other", "agent-2");
    expect(await writer.recoverStaleMaterializingClaims("agent-1")).toBe(0);
    expect(await writer.countRunnableWakes("agent-1")).toBe(0);
    expect(await writer.listRunnableWakes("agent-1", 50)).toEqual([]);
    expect(writer.claimed.has("other")).toBe(true);
    expect(await writer.recoverStaleMaterializingClaims("agent-2")).toBe(1);
    expect(writer.materialized).toEqual([{ wakeId: "other", runId: "run-other" }]);
  });
  it("returns deferred activity without calling the host inside admission", async () => {
    const { writer, host, evaluate } = setup(1);
    const result = await evaluate({ ...BASE_FACTS, runningRunCount: 1, wakeRequestId: "deferred",
      issueId: "issue-deferred", deferEnqueueActivity: true });
    expect(result).toMatchObject({ action: "park", queueDepth: 1,
      deferredEnqueueActivity: { wakeRequestId: "deferred", reason: "agent_at_capacity" } });
    expect(writer.parked).toHaveLength(1); expect(host.events).toHaveLength(0);
    if (result.action !== "park" || !result.deferredEnqueueActivity) throw new Error("Missing event");
    await host.appendSchedulerEvent({ ...result.deferredEnqueueActivity, kind: "enqueue" });
    expect(host.events).toHaveLength(1);
  });
});

describe("materialization uncertainty regressions", () => {
  it("does not duplicate a live creator after the former five-minute lease expires", async () => {
    let now = 1_000_000; const { writer, host, promote } = setup(0, () => now); await park(writer, "slow");
    let release!: () => void; let started!: () => void; let calls = 0;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const create = vi.fn(async () => {
      if (++calls > 1) { persisted(writer, "slow", "duplicate"); return "duplicate"; }
      started(); await gate; persisted(writer, "slow", "run-only"); return "run-only";
    });
    const first = promote({ ...BASE_FACTS, createRunForWake: create }); await entered;
    now += AGENT_SCHEDULER_MATERIALIZING_CLAIM_TTL_MS * 10;
    try {
      const second = await createPromoteAgentRunnableWork({ host, writer })({ ...BASE_FACTS, createRunForWake: create });
      expect(second).toEqual({ promoted: 0, runIds: [] }); expect(create).toHaveBeenCalledTimes(1);
    } finally { release(); await first; }
    expect(writer.persistedRuns).toHaveLength(1);
  });
  it("does not repeat creation when an atomic commit succeeds but its response is lost", async () => {
    const { writer, promote } = setup(); await park(writer, "committed");
    const atomic = writer.createAndLinkRunnableWake.bind(writer);
    writer.createAndLinkRunnableWake = async input => {
      await atomic(input); throw new Error("response lost after COMMIT");
    };
    const create = vi.fn(async () => "original");
    await promote({ ...BASE_FACTS, createRunForWake: create });
    await promote({ ...BASE_FACTS, createRunForWake: create });
    expect(create).toHaveBeenCalledTimes(1);
    expect(writer.materialized).toEqual([{ wakeId: "committed", runId: "original" }]);
    expect(writer.persistedRuns).toHaveLength(1);
    expect(writer.claimed.size).toBe(0);
  });
  it("repairs an existing run link even while the agent is at capacity", async () => {
    const { writer, promote } = setup(1); await park(writer, "running");
    await writer.tryClaimRunnableWake("running"); persisted(writer, "running", "active");
    const create = vi.fn(async () => "unexpected"); await promote({ ...BASE_FACTS, createRunForWake: create });
    expect(create).toHaveBeenCalledTimes(0);
    expect(writer.materialized).toEqual([{ wakeId: "running", runId: "active" }]);
  });
  it("rolls back the INSERT as well when linking is rejected", async () => {
    const { writer, host, promote } = setup(); await park(writer, "link-false");
    const link = writer.materializeRunnableWake.bind(writer);
    writer.materializeRunnableWake = async () => false;
    const create = vi.fn(async () => { persisted(writer, "link-false", "created"); return "created"; });
    await promote({ ...BASE_FACTS, createRunForWake: create });
    expect(writer.persistedRuns).toHaveLength(0);
    expect(writer.claimed.has("link-false")).toBe(false);
    expect(host.events[0]).toMatchObject({ kind: "blocked", reason: "materialization_outcome_uncertain" });
    writer.materializeRunnableWake = link;
    await promote({ ...BASE_FACTS, createRunForWake: create });
    expect(create).toHaveBeenCalledTimes(2);
    expect(writer.materialized).toEqual([{ wakeId: "link-false", runId: "created" }]);
    expect(writer.persistedRuns).toHaveLength(1);
  });
  it("rolls back both records after a link exception and does not leave an orphan run", async () => {
    const { writer, promote } = setup(); await park(writer, "link-rejected");
    writer.materializeRunnableWake = async () => { throw new Error("connection lost before COMMIT"); };
    const create = vi.fn(async () => { persisted(writer, "link-rejected", "persisted"); return "persisted"; });
    await promote({ ...BASE_FACTS, createRunForWake: create });
    expect(create).toHaveBeenCalledTimes(1);
    expect(writer.materialized).toHaveLength(0);
    expect(writer.persistedRuns).toHaveLength(0);
    expect(writer.runnable[0]?.reason).toBe(AGENT_SCHEDULER_ENQUEUE_REASON);
  });
  it("preserves conflicting historical runs rather than creating a third", async () => {
    const { writer, promote } = setup(); await park(writer, "ambiguous"); await writer.tryClaimRunnableWake("ambiguous");
    persisted(writer, "ambiguous", "run-a"); persisted(writer, "ambiguous", "run-b");
    const create = vi.fn(async () => "third"); await promote({ ...BASE_FACTS, createRunForWake: create });
    expect(writer.materialized).toHaveLength(0); expect(writer.claimed.has("ambiguous")).toBe(true);
    expect(create).toHaveBeenCalledTimes(0);
  });
  it("does not starve ready work behind 50 uncertain creation intents", async () => {
    const { writer, promote } = setup();
    for (let i = 0; i < 50; i++) { await park(writer, `held-${i}`); await writer.tryClaimRunnableWake(`held-${i}`); }
    await park(writer, "ready-51"); const create = vi.fn(async () => "ready");
    expect(await promote({ ...BASE_FACTS, createRunForWake: create })).toEqual({ promoted: 1, runIds: ["ready"] });
    expect(create).toHaveBeenCalledTimes(1); expect(writer.claimed.size).toBe(50);
  });
  it("does not undo a recovered link when its original creator returns late", async () => {
    const { writer } = setup(); await park(writer, "late"); await writer.tryClaimRunnableWake("late");
    const wake = { ...writer.runnable[0]! }; persisted(writer, "late", "one");
    await writer.recoverStaleMaterializingClaims("agent-1");
    expect(await writer.materializeRunnableWake({ wake, runId: "one", dequeueReason: AGENT_SCHEDULER_DEQUEUE_REASON })).toBe(true);
    expect(await writer.materializeRunnableWake({ wake, runId: "other", dequeueReason: AGENT_SCHEDULER_DEQUEUE_REASON })).toBe(false);
    expect(writer.materialized).toHaveLength(1);
  });
});


describe("same-pass healthy progress without a heartbeat", () => {
  it("does not strand healthy work after the last run finishes and creation fails", async () => {
    const { writer, host, promote } = setup(0);
    await park(writer, "bad"); await park(writer, "healthy");
    const create = vi.fn(async (wake: RunnableWakeRow) => {
      if (wake.id === "bad") throw new Error("failure before INSERT");
      return "healthy-run";
    });
    expect(await promote({ ...BASE_FACTS, createRunForWake: create }))
      .toEqual({ promoted: 1, runIds: ["healthy-run"] });
    expect(create).toHaveBeenCalledTimes(2);
    expect(host.events).toContainEqual(expect.objectContaining({ kind: "blocked", wakeRequestId: "bad" }));
  });

  it("filters 50 confirmed no-write candidates before selecting a healthy wake", async () => {
    const { writer, promote } = setup(0);
    for (let i = 0; i < 50; i++) await park(writer, `no-write-${i}`);
    await park(writer, "healthy-51");
    const create = vi.fn(async (wake: RunnableWakeRow) => wake.id === "healthy-51" ? "healthy-run" : null);
    expect(await promote({ ...BASE_FACTS, createRunForWake: create }))
      .toEqual({ promoted: 1, runIds: ["healthy-run"] });
    expect(create).toHaveBeenCalledTimes(51);
  });
});
