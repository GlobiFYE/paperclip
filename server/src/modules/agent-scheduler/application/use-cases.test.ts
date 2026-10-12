import { describe, expect, it, vi } from "vitest";
import type { AgentSchedulerHost, AgentSchedulerWriter, RunnableWakeRow } from "./ports.js";
import {
  AGENT_SCHEDULER_DEQUEUE_REASON,
  AGENT_SCHEDULER_ENQUEUE_REASON,
  AGENT_SCHEDULER_MATERIALIZING_CLAIM_TTL_MS,
  AGENT_SCHEDULER_MATERIALIZING_REASON,
} from "../domain/policy.js";
import {
  createEvaluateAgentSchedulerAdmission,
  createPromoteAgentRunnableWork,
} from "./use-cases.js";

const BASE_FACTS = {
  schedulerEnabled: true,
  allowParallelExecution: false,
  configuredMaxConcurrentRuns: 20,
  companyId: "company-1",
  agentId: "agent-1",
};

function runnableWake(id: string, overrides: Partial<RunnableWakeRow> = {}): RunnableWakeRow {
  return {
    id,
    companyId: "company-1",
    agentId: "agent-1",
    source: "automation",
    triggerDetail: null,
    reason: null,
    payload: { issueId: `issue-${id}` },
    requestedByActorType: "system",
    requestedByActorId: null,
    idempotencyKey: null,
    requestedAt: new Date("2026-10-08T12:00:00.000Z"),
    ...overrides,
  };
}

function createMemoryWriter(now: () => number = Date.now): AgentSchedulerWriter & {
  parked: Array<{ wakeRequestId: string; schedulerMeta: Record<string, unknown> }>;
  runnable: RunnableWakeRow[];
  materialized: Array<{ wakeId: string; runId: string }>;
  claimed: Set<string>;
} {
  const parked: Array<{ wakeRequestId: string; schedulerMeta: Record<string, unknown> }> = [];
  const runnable: RunnableWakeRow[] = [];
  const materialized: Array<{ wakeId: string; runId: string }> = [];
  const claimed = new Set<string>();
  const claimedAt = new Map<string, number>();

  return {
    parked,
    runnable,
    materialized,
    claimed,
    async listRunnableWakes(agentId, limit) {
      return runnable.filter((row) => row.agentId === agentId).slice(0, limit);
    },
    async countRunnableWakes(agentId) {
      return runnable.filter((row) => row.agentId === agentId).length;
    },
    async parkWakeAsRunnable(input) {
      parked.push({
        wakeRequestId: input.wakeRequestId,
        schedulerMeta: input.schedulerMeta,
      });
      runnable.push(
        runnableWake(input.wakeRequestId, {
          companyId: input.companyId,
          agentId: input.agentId,
          reason: input.enqueueReason,
          requestedAt: new Date(parked.length * 1000 + now()),
        }),
      );
      return true;
    },
    async tryClaimRunnableWake(wakeId) {
      const row = runnable.find((entry) => entry.id === wakeId);
      if (!row) return false;
      const claimTime = claimedAt.get(wakeId);
      const expiredClaim = row.reason === AGENT_SCHEDULER_MATERIALIZING_REASON &&
        claimTime !== undefined &&
        claimTime < now() - AGENT_SCHEDULER_MATERIALIZING_CLAIM_TTL_MS;
      if (
        row.reason !== null &&
        row.reason !== AGENT_SCHEDULER_ENQUEUE_REASON &&
        !expiredClaim
      ) {
        return false;
      }
      row.reason = AGENT_SCHEDULER_MATERIALIZING_REASON;
      claimed.add(wakeId);
      claimedAt.set(wakeId, now());
      return true;
    },
    async recoverStaleMaterializingClaims(agentId) {
      let recovered = 0;
      const staleBefore = now() - AGENT_SCHEDULER_MATERIALIZING_CLAIM_TTL_MS;
      for (const row of runnable) {
        const claimTime = claimedAt.get(row.id);
        if (row.agentId === agentId &&
          row.reason === AGENT_SCHEDULER_MATERIALIZING_REASON &&
          claimTime !== undefined && claimTime < staleBefore) {
          row.reason = AGENT_SCHEDULER_ENQUEUE_REASON;
          claimed.delete(row.id);
          claimedAt.delete(row.id);
          recovered += 1;
        }
      }
      return recovered;
    },
    async releaseClaimedRunnableWake(input) {
      const row = runnable.find((entry) => entry.id === input.wakeId &&
        entry.companyId === input.companyId && entry.agentId === input.agentId);
      if (!row || row.reason !== AGENT_SCHEDULER_MATERIALIZING_REASON) return;
      row.reason = input.enqueueReason;
      claimed.delete(input.wakeId);
      claimedAt.delete(input.wakeId);
    },
    async materializeRunnableWake(input) {
      const index = runnable.findIndex((row) => row.id === input.wake.id);
      if (index < 0) return false;
      runnable.splice(index, 1);
      claimed.delete(input.wake.id);
      claimedAt.delete(input.wake.id);
      materialized.push({ wakeId: input.wake.id, runId: input.runId });
      return true;
    },
  };
}

function createFakeHost(runningRunCount = 0): AgentSchedulerHost & {
  events: unknown[];
  setRunningCount: (n: number) => void;
} {
  let count = runningRunCount;
  const events: unknown[] = [];
  return {
    events,
    setRunningCount(n: number) {
      count = n;
    },
    async countRunningRunsForAgent() {
      return count;
    },
    async appendSchedulerEvent(input) {
      events.push(input);
    },
  };
}

describe("createEvaluateAgentSchedulerAdmission", () => {
  it("materializes when the agent has a free slot", async () => {
    const writer = createMemoryWriter();
    const host = createFakeHost(0);
    const evaluate = createEvaluateAgentSchedulerAdmission({ host, writer });

    const result = await evaluate({
      ...BASE_FACTS,
      runningRunCount: 0,
      wakeRequestId: "wake-a",
      issueId: "issue-a",
    });

    expect(result).toEqual({ action: "materialize" });
    expect(writer.parked).toHaveLength(0);
    expect(host.events).toHaveLength(0);
  });

  it("parks a second simultaneous assignment while one run is active", async () => {
    const writer = createMemoryWriter();
    const host = createFakeHost(1);
    const evaluate = createEvaluateAgentSchedulerAdmission({ host, writer });

    const result = await evaluate({
      ...BASE_FACTS,
      runningRunCount: 1,
      wakeRequestId: "wake-b",
      issueId: "issue-b",
    });

    expect(result).toEqual({ action: "park", queueDepth: 1 });
    expect(writer.parked).toHaveLength(1);
    expect(writer.parked[0]?.wakeRequestId).toBe("wake-b");
    expect(host.events).toHaveLength(1);
    expect(host.events[0]).toMatchObject({
      kind: "enqueue",
      wakeRequestId: "wake-b",
      queueDepth: 1,
      effectiveCapacity: 1,
    });
  });
});

describe("createPromoteAgentRunnableWork", () => {
  it("promotes the oldest runnable wake when a slot opens after the active run finishes", async () => {
    const writer = createMemoryWriter();
    const host = createFakeHost(0);
    await writer.parkWakeAsRunnable({
      wakeRequestId: "wake-queued",
      companyId: "company-1",
      agentId: "agent-1",
      enqueueReason: AGENT_SCHEDULER_ENQUEUE_REASON,
      schedulerMeta: { parkedAt: new Date().toISOString() },
    });

    const promote = createPromoteAgentRunnableWork({ host, writer });
    const createRunForWake = vi.fn(async (wake: RunnableWakeRow) => `run-for-${wake.id}`);

    const result = await promote({
      schedulerEnabled: true,
      allowParallelExecution: false,
      configuredMaxConcurrentRuns: 20,
      agentId: "agent-1",
      companyId: "company-1",
      createRunForWake,
    });

    expect(result).toEqual({ promoted: 1, runIds: ["run-for-wake-queued"] });
    expect(createRunForWake).toHaveBeenCalledTimes(1);
    expect(writer.materialized).toEqual([{ wakeId: "wake-queued", runId: "run-for-wake-queued" }]);
    expect(host.events).toHaveLength(1);
    expect(host.events[0]).toMatchObject({
      kind: "dequeue",
      wakeRequestId: "wake-queued",
      reason: AGENT_SCHEDULER_DEQUEUE_REASON,
      effectiveCapacity: 1,
    });
  });

  it("does not promote while the agent remains at serial capacity", async () => {
    const writer = createMemoryWriter();
    const host = createFakeHost(1);
    await writer.parkWakeAsRunnable({
      wakeRequestId: "wake-waiting",
      companyId: "company-1",
      agentId: "agent-1",
      enqueueReason: AGENT_SCHEDULER_ENQUEUE_REASON,
      schedulerMeta: {},
    });

    const promote = createPromoteAgentRunnableWork({ host, writer });
    const result = await promote({
      schedulerEnabled: true,
      allowParallelExecution: false,
      configuredMaxConcurrentRuns: 20,
      agentId: "agent-1",
      companyId: "company-1",
      createRunForWake: vi.fn(async () => "run-should-not-happen"),
    });

    expect(result).toEqual({ promoted: 0, runIds: [] });
    expect(writer.runnable).toHaveLength(1);
    expect(host.events).toHaveLength(0);
  });

  it("skips a wake that cannot materialize and promotes the next runnable wake", async () => {
    const writer = createMemoryWriter();
    const host = createFakeHost(0);
    await writer.parkWakeAsRunnable({
      wakeRequestId: "wake-stuck",
      companyId: "company-1",
      agentId: "agent-1",
      enqueueReason: AGENT_SCHEDULER_ENQUEUE_REASON,
      schedulerMeta: {},
    });
    await writer.parkWakeAsRunnable({
      wakeRequestId: "wake-ready",
      companyId: "company-1",
      agentId: "agent-1",
      enqueueReason: AGENT_SCHEDULER_ENQUEUE_REASON,
      schedulerMeta: {},
    });

    const promote = createPromoteAgentRunnableWork({ host, writer });
    const createRunForWake = vi.fn(async (wake: RunnableWakeRow) =>
      wake.id === "wake-stuck" ? null : `run-for-${wake.id}`,
    );

    const result = await promote({
      schedulerEnabled: true,
      allowParallelExecution: false,
      configuredMaxConcurrentRuns: 20,
      agentId: "agent-1",
      companyId: "company-1",
      createRunForWake,
    });

    expect(result).toEqual({ promoted: 1, runIds: ["run-for-wake-ready"] });
    expect(createRunForWake).toHaveBeenCalledTimes(2);
    expect(writer.runnable.map((row) => row.id)).toEqual(["wake-stuck"]);
  });

  it("allows only one materializing claim per runnable wake", async () => {
    const writer = createMemoryWriter();
    await writer.parkWakeAsRunnable({
      wakeRequestId: "wake-race",
      companyId: "company-1",
      agentId: "agent-1",
      enqueueReason: AGENT_SCHEDULER_ENQUEUE_REASON,
      schedulerMeta: {},
    });

    const first = await writer.tryClaimRunnableWake("wake-race");
    const second = await writer.tryClaimRunnableWake("wake-race");

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("serializes two back-to-back assignments: park then promote one at a time", async () => {
    const writer = createMemoryWriter();
    const host = createFakeHost(0);
    const evaluate = createEvaluateAgentSchedulerAdmission({ host, writer });
    const promote = createPromoteAgentRunnableWork({ host, writer });

    const first = await evaluate({
      ...BASE_FACTS,
      runningRunCount: 0,
      wakeRequestId: "wake-1",
      issueId: "issue-1",
    });
    expect(first).toEqual({ action: "materialize" });

    host.setRunningCount(1);
    const second = await evaluate({
      ...BASE_FACTS,
      runningRunCount: 1,
      wakeRequestId: "wake-2",
      issueId: "issue-2",
    });
    expect(second).toEqual({ action: "park", queueDepth: 1 });

    host.setRunningCount(0);
    const afterFirstRun = await promote({
      schedulerEnabled: true,
      allowParallelExecution: false,
      configuredMaxConcurrentRuns: 20,
      agentId: "agent-1",
      companyId: "company-1",
      createRunForWake: async (wake) => `run-${wake.id}`,
    });
    expect(afterFirstRun.promoted).toBe(1);
    expect(writer.runnable).toHaveLength(0);
  });
});


describe("scheduler claim and deferred-activity regressions", () => {
  async function park(writer: AgentSchedulerWriter, id: string, agentId = "agent-1") {
    await writer.parkWakeAsRunnable({
      wakeRequestId: id,
      companyId: "company-1",
      agentId,
      enqueueReason: AGENT_SCHEDULER_ENQUEUE_REASON,
      schedulerMeta: {},
    });
  }

  it("restores a null-result claim so the same wake can retry on the next promotion", async () => {
    const writer = createMemoryWriter();
    const host = createFakeHost();
    await park(writer, "wake-retry");
    const promote = createPromoteAgentRunnableWork({ host, writer });
    const first = await promote({ ...BASE_FACTS, createRunForWake: async () => null });
    expect(first).toEqual({ promoted: 0, runIds: [] });
    expect(writer.runnable[0]?.reason).toBe(AGENT_SCHEDULER_ENQUEUE_REASON);
    expect(writer.claimed.size).toBe(0);
    const second = await promote({ ...BASE_FACTS, createRunForWake: async () => "run-retry" });
    expect(second).toEqual({ promoted: 1, runIds: ["run-retry"] });
    expect(writer.runnable).toHaveLength(0);
  });

  it("releases a throwing claim, makes progress, and retries the released wake later", async () => {
    const writer = createMemoryWriter();
    const host = createFakeHost();
    await park(writer, "wake-error");
    await park(writer, "wake-ready");
    const promote = createPromoteAgentRunnableWork({ host, writer });
    const createRunForWake = vi.fn(async (wake: RunnableWakeRow) => {
      if (wake.id === "wake-error") throw new Error("synthetic creation failure");
      return "run-ready";
    });
    expect(await promote({ ...BASE_FACTS, createRunForWake }))
      .toEqual({ promoted: 1, runIds: ["run-ready"] });
    expect(createRunForWake).toHaveBeenCalledTimes(2);
    expect(writer.runnable[0]?.reason).toBe(AGENT_SCHEDULER_ENQUEUE_REASON);
    expect(writer.claimed.size).toBe(0);
    expect(await promote({ ...BASE_FACTS, createRunForWake: async () => "run-recovered" }))
      .toEqual({ promoted: 1, runIds: ["run-recovered"] });
  });

  it("does not reclaim a live claim at the lease boundary", async () => {
    let now = 1_000_000;
    const writer = createMemoryWriter(() => now);
    const host = createFakeHost();
    await park(writer, "wake-live");
    expect(await writer.tryClaimRunnableWake("wake-live")).toBe(true);
    now += AGENT_SCHEDULER_MATERIALIZING_CLAIM_TTL_MS;
    const createRunForWake = vi.fn(async () => "run-unexpected");
    expect(await createPromoteAgentRunnableWork({ host, writer })({ ...BASE_FACTS, createRunForWake }))
      .toEqual({ promoted: 0, runIds: [] });
    expect(createRunForWake).toHaveBeenCalledTimes(0);
    expect(writer.claimed.has("wake-live")).toBe(true);
  });

  it("recovers an expired claim and promotes the wake without manual repair", async () => {
    let now = 1_000_000;
    const writer = createMemoryWriter(() => now);
    const host = createFakeHost();
    await park(writer, "wake-stale");
    expect(await writer.tryClaimRunnableWake("wake-stale")).toBe(true);
    now += AGENT_SCHEDULER_MATERIALIZING_CLAIM_TTL_MS + 1;
    const createRunForWake = vi.fn(async () => "run-after-expiry");
    expect(await createPromoteAgentRunnableWork({ host, writer })({ ...BASE_FACTS, createRunForWake }))
      .toEqual({ promoted: 1, runIds: ["run-after-expiry"] });
    expect(createRunForWake).toHaveBeenCalledTimes(1);
    expect(writer.claimed.size).toBe(0);
    expect(writer.runnable).toHaveLength(0);
  });

  it("does not recover or count another agent's claims", async () => {
    let now = 1_000_000;
    const writer = createMemoryWriter(() => now);
    await park(writer, "wake-other", "agent-2");
    expect(await writer.tryClaimRunnableWake("wake-other")).toBe(true);
    now += AGENT_SCHEDULER_MATERIALIZING_CLAIM_TTL_MS + 1;
    expect(await writer.recoverStaleMaterializingClaims("agent-1")).toBe(0);
    expect(await writer.countRunnableWakes("agent-1")).toBe(0);
    expect(await writer.listRunnableWakes("agent-1", 50)).toEqual([]);
    expect(writer.claimed.has("wake-other")).toBe(true);
    expect(await writer.recoverStaleMaterializingClaims("agent-2")).toBe(1);
    expect(writer.runnable[0]?.reason).toBe(AGENT_SCHEDULER_ENQUEUE_REASON);
  });

  it("returns deferred activity without calling the host inside admission", async () => {
    const writer = createMemoryWriter();
    const host = createFakeHost(1);
    const result = await createEvaluateAgentSchedulerAdmission({ host, writer })({
      ...BASE_FACTS,
      runningRunCount: 1,
      wakeRequestId: "wake-deferred",
      issueId: "issue-deferred",
      deferEnqueueActivity: true,
    });
    expect(result).toMatchObject({
      action: "park",
      queueDepth: 1,
      deferredEnqueueActivity: {
        wakeRequestId: "wake-deferred",
        reason: "agent_at_capacity",
        queueDepth: 1,
      },
    });
    expect(host.events).toHaveLength(0);
    // The host must publish this returned event AFTER its transaction commits.
    // This unit assertion does not prove heartbeat.ts wires that boundary.
    if (result.action !== "park" || !result.deferredEnqueueActivity) throw new Error("Missing event");
    await host.appendSchedulerEvent({ ...result.deferredEnqueueActivity, kind: "enqueue" });
    expect(host.events).toHaveLength(1);
  });
});
