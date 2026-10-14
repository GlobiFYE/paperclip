import { describe, expect, it } from "vitest";
import { hasPendingTaskBoundTimer, readHeartbeatTimerPolicy } from "./task-timer-policy.js";
import { decideLegacyContinuation, type LegacyContinuationInput } from "../recovery/legacy-continuation.js";

const now = Date.parse("2026-10-14T12:00:00Z");
const issue = {
  companyId: "company", status: "in_progress", assigneeAgentId: "agent",
  assigneeUserId: null, hiddenAt: null, harnessKind: null, conversationAgentId: null, originKind: "manual",
};
const checkpointFinishedAt = new Date(now - 60_000);
const agent = {
  id: "agent", companyId: "company", createdAt: new Date(now - 60_000),
  lastHeartbeatAt: new Date(now - 60_000),
  runtimeConfig: { heartbeat: { enabled: true, intervalSec: 120, skipTimerWhenNoActionableWork: true } },
};

describe("task-bound timer policy", () => {
  it.each(["skipTimerWhenNoActionableWork", "requireActionableTimerWork", "issueOnlyTimer"])(
    "shares the scheduler's %s parsing with recovery", key => {
      expect(readHeartbeatTimerPolicy({ heartbeat: { enabled: true, intervalSec: 120, [key]: true } }))
        .toEqual({ enabled: true, intervalSec: 120, skipTimerWhenNoActionableWork: true });
    },
  );
  it("preserves strict parsing of malformed timer settings", () => {
    expect(readHeartbeatTimerPolicy({ heartbeat: { enabled: "true", intervalSec: "120" } }))
      .toEqual({ enabled: false, intervalSec: 0, skipTimerWhenNoActionableWork: false });
  });
  it("lets a healthy task timer own only its bounded checkpoint gap", () => {
    expect(hasPendingTaskBoundTimer(issue, agent, checkpointFinishedAt, now)).toBe(true);
    expect(hasPendingTaskBoundTimer(issue, agent, checkpointFinishedAt, now + 120_000)).toBe(true);
    expect(hasPendingTaskBoundTimer(issue, agent, checkpointFinishedAt, now + 120_001)).toBe(false);
  });
  it("does not renew the checkpoint deadline when claims or unrelated runs update the agent heartbeat", () => {
    for (const elapsed of [120_001, 180_000, 300_000]) {
      const checkedAt = now + elapsed;
      const recentlyClaimed = { ...agent, lastHeartbeatAt: new Date(checkedAt) };
      expect(hasPendingTaskBoundTimer(issue, recentlyClaimed, checkpointFinishedAt, checkedAt)).toBe(false);
    }
  });
  it.each(["backlog", "blocked", "in_review", "done", "cancelled"])("does not own %s work", status => {
    expect(hasPendingTaskBoundTimer({ ...issue, status }, agent, checkpointFinishedAt, now)).toBe(false);
  });
  it.each([
    { companyId: "other" }, { assigneeAgentId: "other" }, { assigneeUserId: "human" },
    { hiddenAt: new Date(now) }, { harnessKind: "skill_test" }, { harnessKind: "" }, { conversationAgentId: "agent" }, { originKind: "chat_channel" },
  ])("does not own ineligible task state %j", patch => {
    expect(hasPendingTaskBoundTimer({ ...issue, ...patch }, agent, checkpointFinishedAt, now)).toBe(false);
  });
  it.each([
    { enabled: false }, { skipTimerWhenNoActionableWork: false }, { intervalSec: 0 },
    { intervalSec: -1 }, { intervalSec: Number.NaN }, { intervalSec: Number.POSITIVE_INFINITY },
  ])("does not own an unavailable timer %j", patch => {
    expect(hasPendingTaskBoundTimer(issue, { ...agent, runtimeConfig: { heartbeat: { ...agent.runtimeConfig.heartbeat, ...patch } } }, checkpointFinishedAt, now)).toBe(false);
  });
  it("fails closed for a missing agent or missing/invalid/future checkpoint", () => {
    expect(hasPendingTaskBoundTimer(issue, null, checkpointFinishedAt, now)).toBe(false);
    expect(hasPendingTaskBoundTimer(issue, agent, null, now)).toBe(false);
    expect(hasPendingTaskBoundTimer(issue, agent, new Date("invalid"), now)).toBe(false);
    expect(hasPendingTaskBoundTimer(issue, agent, new Date(now + 1), now)).toBe(false);
  });
  it("retains disposition recovery when the task timer is overdue", () => {
    const continuation: LegacyContinuationInput = {
      run: { id: "run", companyId: "company", agentId: "agent", status: "succeeded", runtimeMode: "legacy" },
      issue: { ...issue, id: "issue" }, agent: { ...agent, status: "idle" },
      episode: { id: "run", attempt: 0, maxAttempts: 2 },
      gates: { stopped: false, paused: false, budgetBlocked: false, pendingWait: false, activeExecution: false, ownedLifecycle: hasPendingTaskBoundTimer(issue, agent, checkpointFinishedAt, now), conversation: false, agentInvokable: true },
    };
    expect(decideLegacyContinuation(continuation)).toEqual({ kind: "skip", reason: "owned_lifecycle" });
    expect(decideLegacyContinuation({ ...continuation, gates: { ...continuation.gates, ownedLifecycle: hasPendingTaskBoundTimer(issue, agent, checkpointFinishedAt, now + 120_001) } }))
      .toMatchObject({ kind: "enqueue", nextAttempt: 1 });
  });
});
