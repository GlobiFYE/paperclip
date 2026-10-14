export const AGENT_RUN_TERMINAL_GRACE_MS = 5 * 60 * 1000;
const terminalStatuses = new Set(["succeeded", "interrupted", "failed", "cancelled", "timed_out"]);
const activeStatuses = new Set(["queued", "scheduled_retry", "running"]);

export function agentRunAllowsJwt(run: {
  status: string;
  finishedAt: Date | null;
  createdAt: Date;
} | null | undefined, now = Date.now()): boolean {
  if (!run) return false;
  if (activeStatuses.has(run.status)) return run.finishedAt === null;
  if (!terminalStatuses.has(run.status) || !run.finishedAt) return false;
  const finished = run.finishedAt.getTime();
  const created = run.createdAt.getTime();
  return Number.isFinite(finished) && Number.isFinite(created)
    && finished >= created && finished <= now && now < finished + AGENT_RUN_TERMINAL_GRACE_MS;
}
