import type { agents, issues } from "@paperclipai/db";
import { asBoolean, asNumber, parseObject } from "../../adapters/utils.js";

export const TIMER_ACTIONABLE_ISSUE_STATUSES = ["todo", "in_progress"] as const;

export function readHeartbeatTimerPolicy(runtimeConfig: unknown) {
  const heartbeat = parseObject(parseObject(runtimeConfig).heartbeat);
  return {
    enabled: asBoolean(heartbeat.enabled, false),
    intervalSec: Math.max(0, asNumber(heartbeat.intervalSec, 0)),
    skipTimerWhenNoActionableWork: asBoolean(
      heartbeat.skipTimerWhenNoActionableWork ?? heartbeat.requireActionableTimerWork ?? heartbeat.issueOnlyTimer,
      false,
    ),
  };
}

export function hasPendingTaskBoundTimer(
  issue: Pick<typeof issues.$inferSelect, "companyId" | "status" | "assigneeAgentId" | "assigneeUserId" | "hiddenAt" | "harnessKind" | "conversationAgentId" | "originKind">,
  agent: Pick<typeof agents.$inferSelect, "id" | "companyId" | "runtimeConfig"> | null,
  checkpointFinishedAt: Date | null,
  now = Date.now(),
) {
  if (!agent || issue.companyId !== agent.companyId || issue.assigneeAgentId !== agent.id ||
      issue.assigneeUserId || issue.hiddenAt || issue.harnessKind !== null || issue.conversationAgentId || issue.originKind === "chat_channel" ||
      !TIMER_ACTIONABLE_ISSUE_STATUSES.some(status => status === issue.status)) return false;
  const policy = readHeartbeatTimerPolicy(agent.runtimeConfig);
  if (!policy.enabled || !policy.skipTimerWhenNoActionableWork ||
      !Number.isFinite(policy.intervalSec) || policy.intervalSec <= 0) return false;
  if (!checkpointFinishedAt) return false;
  const baseline = checkpointFinishedAt.getTime();
  return Number.isFinite(baseline) && baseline <= now &&
    now <= baseline + policy.intervalSec * 1000 + 60_000;
}
