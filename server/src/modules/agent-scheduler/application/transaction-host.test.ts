import { describe, expect, it, vi } from "vitest";
import type { AgentSchedulerHost } from "./ports.js";
import { bindSchedulerHostToTransaction, type SchedulerActivity } from "./transaction-host.js";

const EVENT: SchedulerActivity = {
  companyId: "company-1",
  agentId: "agent-1",
  wakeRequestId: "wake-1",
  issueId: "issue-1",
  reason: "agent_at_capacity",
  queueDepth: 1,
  effectiveCapacity: 1,
  kind: "enqueue",
};

function rootHost(): AgentSchedulerHost {
  return {
    countRunningRunsForAgent: vi.fn(async () => 2),
    appendSchedulerEvent: vi.fn(async () => {}),
  };
}

describe("transaction-bound scheduler activity", () => {
  it("persists on the exact transaction and never invokes the base-connection logger", async () => {
    const host = rootHost();
    const tx = { identity: "transaction-1" };
    const calls: Array<{ connection: typeof tx; activity: SchedulerActivity }> = [];
    const scoped = bindSchedulerHostToTransaction(host, tx, async (connection, activity) => {
      calls.push({ connection, activity });
    });
    await scoped.appendSchedulerEvent(EVENT);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.connection).toBe(tx);
    expect(calls[0]?.activity).toEqual(EVENT);
    expect(host.appendSchedulerEvent).toHaveBeenCalledTimes(0);
  });

  it("preserves capacity reads through the existing host", async () => {
    const host = rootHost();
    const persist = vi.fn(async () => {});
    const scoped = bindSchedulerHostToTransaction(host, {}, persist);
    expect(await scoped.countRunningRunsForAgent("agent-1")).toBe(2);
    expect(host.countRunningRunsForAgent).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(0);
  });

  it("propagates persistence failure rather than retrying on a different connection", async () => {
    const host = rootHost();
    const failure = new Error("synthetic audit persistence failure");
    const scoped = bindSchedulerHostToTransaction(host, {}, async () => { throw failure; });
    let caught: unknown;
    try { await scoped.appendSchedulerEvent(EVENT); } catch (error) { caught = error; }
    expect(caught).toBe(failure);
    expect(host.appendSchedulerEvent).toHaveBeenCalledTimes(0);
  });
});
