import { and, desc, eq, inArray, not, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, approvals, heartbeatRuns } from "@paperclipai/db";
import { isHeartbeatRunVisibleInMine, type SidebarBadges } from "@paperclipai/shared";
import { runIssueIdOutsideLotFilter } from "./issue-visibility.js";

const ACTIONABLE_APPROVAL_STATUSES = ["pending", "revision_requested"];
const FAILED_HEARTBEAT_STATUSES = ["failed", "timed_out"];

function normalizeTimestamp(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isDismissed(
  dismissedAtByKey: ReadonlyMap<string, number>,
  itemKey: string,
  activityAt: Date | string | null | undefined,
) {
  const dismissedAt = dismissedAtByKey.get(itemKey);
  if (dismissedAt == null) return false;
  return dismissedAt >= normalizeTimestamp(activityAt);
}

export function sidebarBadgeService(db: Db) {
  return {
    get: async (
      companyId: string,
      extra?: {
        currentUserId?: string | null;
        dismissals?: ReadonlyMap<string, number>;
        joinRequests?: Array<{ id: string; updatedAt: Date | string | null; createdAt: Date | string }>;
        unreadTouchedIssues?: number;
      },
    ): Promise<SidebarBadges> => {
      const actionableApprovals = await db
        .select({ id: approvals.id, updatedAt: approvals.updatedAt })
        .from(approvals)
        .where(
          and(
            eq(approvals.companyId, companyId),
            inArray(approvals.status, ACTIONABLE_APPROVAL_STATUSES),
          ),
        )
        .then((rows) =>
          rows.filter((row) => !isDismissed(extra?.dismissals ?? new Map(), `approval:${row.id}`, row.updatedAt)).length
        );

      // Lot contract, flag-aware: with enableLotView off, a failed run is
      // badged like classic upstream no matter which project its issue lives
      // in; armed, a run whose issue lives in a zone-"a" (lot) project is
      // night-crew burn and never badges the sidebar.
      const runLotFilter = await runIssueIdOutsideLotFilter(db, sql`(${heartbeatRuns.contextSnapshot} ->> 'issueId')`);
      const latestRunByAgent = await db
        .selectDistinctOn([heartbeatRuns.agentId], {
          id: heartbeatRuns.id,
          runStatus: heartbeatRuns.status,
          responsibleUserId: heartbeatRuns.responsibleUserId,
          createdAt: heartbeatRuns.createdAt,
        })
        .from(heartbeatRuns)
        .innerJoin(agents, eq(heartbeatRuns.agentId, agents.id))
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            eq(agents.companyId, companyId),
            not(eq(agents.status, "terminated")),
            runLotFilter,
          ),
        )
        .orderBy(heartbeatRuns.agentId, desc(heartbeatRuns.createdAt));

      const failedRuns = latestRunByAgent.filter((row) =>
        FAILED_HEARTBEAT_STATUSES.includes(row.runStatus)
        && (extra?.currentUserId === undefined || isHeartbeatRunVisibleInMine(row, extra.currentUserId))
        && !isDismissed(extra?.dismissals ?? new Map(), `run:${row.id}`, row.createdAt),
      ).length;

      const joinRequests = (extra?.joinRequests ?? []).filter((row) =>
        !isDismissed(
          extra?.dismissals ?? new Map(),
          `join:${row.id}`,
          row.updatedAt ?? row.createdAt,
        )
      ).length;
      const unreadTouchedIssues = extra?.unreadTouchedIssues ?? 0;
      return {
        inbox: actionableApprovals + failedRuns + joinRequests + unreadTouchedIssues,
        approvals: actionableApprovals,
        failedRuns,
        joinRequests,
      };
    },
  };
}
