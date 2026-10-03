import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  activityLog,
  agents,
  approvals,
  companies,
  costEvents,
  heartbeatRuns,
  issues,
  projects,
} from "@paperclipai/db";
import { notFound } from "../errors.js";
import { budgetService } from "./budgets.js";
import {
  executionIssueCondition,
  lotProjectIssueFilter,
  runIssueIdOutsideLotFilter,
  visibleIssueCondition,
} from "./issue-visibility.js";
import { retryIdempotentDatabaseOperation } from "../database-retry.js";

const DASHBOARD_RUN_ACTIVITY_DAYS = 14;

/**
 * Night-crew focus dashboard (doc/plans/2026-10-02-night-crew.md §2b): the
 * active lane is a single zone-\"b\" project, so one bounded look at recent
 * lane rows is all the feed needs.
 */
const FOCUS_NEXT_STEPS_LIMIT = 5;
const FOCUS_LANE_ACTIVITY_LIMIT = 10;

function formatUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getUtcMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function getRecentUtcDateKeys(now: Date, days: number): string[] {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, index) => {
    const dayOffset = index - (days - 1);
    return formatUtcDateKey(new Date(todayUtc + dayOffset * 24 * 60 * 60 * 1000));
  });
}

export function dashboardService(db: Db) {
  const budgets = budgetService(db);
  return {
    summary: async (companyId: string) => {
      // This lookup only reads the company row. Rebuild it after a transient
      // disconnect; do not replay the later summary or budget workflows.
      const company = await retryIdempotentDatabaseOperation(() => db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows[0] ?? null));

      if (!company) throw notFound("Company not found");

      const agentRows = await db
        .select({ status: agents.status, count: sql<number>`count(*)` })
        .from(agents)
        .where(eq(agents.companyId, companyId))
        .groupBy(agents.status);

      // Lot contract, flag-aware: with enableLotView off, lot-project tasks
      // count toward the dashboard like classic upstream; with it on they
      // never do.
      const lotTaskFilter = await lotProjectIssueFilter(db);
      const taskRows = await retryIdempotentDatabaseOperation(() => db
        .select({ status: issues.status, count: sql<number>`count(*)` })
        .from(issues)
        .where(and(
          eq(issues.companyId, companyId),
          executionIssueCondition(),
          lotTaskFilter,
        ))
        .groupBy(issues.status));

      const pendingApprovals = await retryIdempotentDatabaseOperation(() => db
        .select({ count: sql<number>`count(*)` })
        .from(approvals)
        .where(and(eq(approvals.companyId, companyId), eq(approvals.status, "pending")))
        .then((rows) => Number(rows[0]?.count ?? 0)));

      const agentCounts: Record<string, number> = {
        active: 0,
        running: 0,
        paused: 0,
        error: 0,
      };
      for (const row of agentRows) {
        const count = Number(row.count);
        // "idle" agents are operational — count them as active
        const bucket = row.status === "idle" ? "active" : row.status;
        agentCounts[bucket] = (agentCounts[bucket] ?? 0) + count;
      }

      const taskCounts: Record<string, number> = {
        open: 0,
        inProgress: 0,
        blocked: 0,
        done: 0,
      };
      for (const row of taskRows) {
        const count = Number(row.count);
        if (row.status === "in_progress") taskCounts.inProgress += count;
        if (row.status === "blocked") taskCounts.blocked += count;
        if (row.status === "done") taskCounts.done += count;
        if (row.status !== "done" && row.status !== "cancelled") taskCounts.open += count;
      }

      const now = new Date();
      const monthStart = getUtcMonthStart(now);
      const runActivityDays = getRecentUtcDateKeys(now, DASHBOARD_RUN_ACTIVITY_DAYS);
      const runActivityStart = new Date(`${runActivityDays[0]}T00:00:00.000Z`);
      const [{ monthSpend }] = await retryIdempotentDatabaseOperation(() => db
        .select({
          monthSpend: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
        })
        .from(costEvents)
        .where(
          and(
            eq(costEvents.companyId, companyId),
            gte(costEvents.occurredAt, monthStart),
          ),
        ));

      const monthSpendCents = Number(monthSpend);
      // Per-day run breakdown. A run is "recovered" when its retry chain later
      // succeeded (recovered_runs = all ancestors of a succeeded retry), so a
      // restart-killed run whose retry succeeded is pulled out of the headline
      // failed count. error_code is carried through so a failure spike can be
      // attributed to an error class (e.g. process_lost, provider_quota).
      // Both recursive arms are bounded to the chart window: a retry is always
      // created after the run it retries, so ancestors of an out-of-window
      // child are themselves out of window and invisible to the membership
      // test below. Unbounded, the seed walks every run the company ever had.
      // Flag-aware lot contract: the run-shape filter is undefined when the
      // lot view is off, so the chart aggregates every run like classic
      // upstream; armed, lot-issue runs stay out of the chart.
      const runLotClause = await runIssueIdOutsideLotFilter(db, sql`(run.context_snapshot ->> 'issueId')`);
      const runActivityRows = (await db.execute(sql`
        WITH RECURSIVE recovered_runs(id) AS (
          SELECT parent.id
          FROM ${heartbeatRuns} AS child
          JOIN ${heartbeatRuns} AS parent ON parent.id = child.retry_of_run_id
          WHERE child.company_id = ${companyId}
            AND child.status = 'succeeded'
            AND child.created_at >= ${runActivityStart.toISOString()}::timestamptz
          UNION
          SELECT parent.id
          FROM recovered_runs rr
          JOIN ${heartbeatRuns} AS child ON child.id = rr.id
          JOIN ${heartbeatRuns} AS parent ON parent.id = child.retry_of_run_id
          WHERE child.created_at >= ${runActivityStart.toISOString()}::timestamptz
        )
        SELECT
          to_char(run.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
          run.status AS status,
          run.error_code AS error_code,
          (run.id IN (SELECT id FROM recovered_runs)) AS recovered,
          count(*)::double precision AS count
        FROM ${heartbeatRuns} AS run
        WHERE run.company_id = ${companyId}
          AND run.created_at >= ${runActivityStart.toISOString()}::timestamptz
          ${runLotClause ? sql`AND ${runLotClause}` : sql``}
        GROUP BY date, run.status, run.error_code, recovered
      `)) as unknown as Iterable<{
        date: string;
        status: string;
        error_code: string | null;
        recovered: boolean | string;
        count: number | string;
      }>;

      const runActivity = new Map(
        runActivityDays.map((date) => [
          date,
          {
            date,
            succeeded: 0,
            failed: 0,
            recovered: 0,
            other: 0,
            total: 0,
            failedByErrorCode: {} as Record<string, number>,
          },
        ]),
      );
      for (const row of runActivityRows) {
        const bucket = runActivity.get(String(row.date));
        if (!bucket) continue;
        const count = Number(row.count);
        const status = String(row.status);
        // Postgres booleans can arrive as JS boolean or "t"/"true" depending on driver.
        const recovered = row.recovered === true || row.recovered === "t" || row.recovered === "true";
        if (status === "succeeded") {
          bucket.succeeded += count;
        } else if (status === "failed" || status === "timed_out") {
          if (recovered) {
            bucket.recovered += count;
          } else {
            bucket.failed += count;
            const code =
              typeof row.error_code === "string" && row.error_code.length > 0
                ? row.error_code
                : "unknown";
            bucket.failedByErrorCode[code] = (bucket.failedByErrorCode[code] ?? 0) + count;
          }
        } else {
          bucket.other += count;
        }
        bucket.total += count;
      }

      const utilization =
        company.budgetMonthlyCents > 0
          ? (monthSpendCents / company.budgetMonthlyCents) * 100
          : 0;
      const budgetOverview = await budgets.overview(companyId);

      return {
        companyId,
        agents: {
          active: agentCounts.active,
          running: agentCounts.running,
          paused: agentCounts.paused,
          error: agentCounts.error,
        },
        tasks: taskCounts,
        costs: {
          monthSpendCents,
          monthBudgetCents: company.budgetMonthlyCents,
          monthUtilizationPercent: Number(utilization.toFixed(2)),
        },
        pendingApprovals,
        budgets: {
          activeIncidents: budgetOverview.activeIncidents.length,
          pendingApprovals: budgetOverview.pendingApprovalCount,
          pausedAgents: budgetOverview.pausedAgentCount,
          pausedProjects: budgetOverview.pausedProjectCount,
        },
        runActivity: Array.from(runActivity.values()),
      };
    },

    /**
     * Night-crew ADHD edition focus surface (doc/plans/2026-10-02-night-crew.md
     * §2b): the dashboard as active-lane HQ. One zone-"b" project front and
     * center, its next steps, and the lane's recent activity — zero lot
     * content, zero other projects, zero metrics. Company-scoped like every
     * other summary read.
     */
    focus: async (companyId: string) => {
      // The platform keeps at most one zone-"b" project per company; the
      // ordered lookup is defensive so a second one (import quirk, manual
      // write) still resolves deterministically to the most recently updated
      // lane instead of a coin flip. Archived lanes never resolve.
      const activeProject = await retryIdempotentDatabaseOperation(() => db
        .select({
          id: projects.id,
          name: projects.name,
          description: projects.description,
          status: projects.status,
          zone: projects.zone,
        })
        .from(projects)
        .where(
          and(
            eq(projects.companyId, companyId),
            eq(projects.zone, "b"),
            isNull(projects.archivedAt),
          ),
        )
        .orderBy(desc(projects.updatedAt))
        .limit(1)
        .then((rows) => rows[0] ?? null));

      if (!activeProject) {
        return { activeProject: null, nextSteps: [], laneActivity: [] };
      }

      // The lane's next 1-3 steps (bounded above): visible, executable,
      // unhidden work — in_progress first (work in progress is the headline),
      // then todo, most recently touched first inside each bucket.
      const nextSteps = await retryIdempotentDatabaseOperation(() => db
        .select({
          id: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          priority: issues.priority,
          assigneeAgentId: issues.assigneeAgentId,
          assigneeUserId: issues.assigneeUserId,
          updatedAt: issues.updatedAt,
        })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            eq(issues.projectId, activeProject.id),
            visibleIssueCondition(),
            executionIssueCondition(),
            inArray(issues.status, ["todo", "in_progress"]),
          ),
        )
        .orderBy(
          sql`case when ${issues.status} = 'in_progress' then 0 else 1 end`,
          desc(issues.updatedAt),
        )
        .limit(FOCUS_NEXT_STEPS_LIMIT));

      // Lane activity: recent activity-log rows whose subject belongs to the
      // active project — project events about the lane itself plus issue
      // events for the lane's issues. Other projects' (and lot) events never
      // match; the scoping is structural, not a filter bolted on top.
      const laneActivity = await retryIdempotentDatabaseOperation(() => db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.companyId, companyId),
            or(
              and(
                eq(activityLog.entityType, "project"),
                eq(activityLog.entityId, activeProject.id),
              ),
              and(
                eq(activityLog.entityType, "issue"),
                sql`exists (
                  select 1
                  from ${issues} lane_issue
                  where lane_issue.company_id = ${companyId}
                    and lane_issue.project_id = ${activeProject.id}
                    and lane_issue.id::text = ${activityLog.entityId}
                )`,
              ),
            ),
          ),
        )
        .orderBy(desc(activityLog.createdAt))
        .limit(FOCUS_LANE_ACTIVITY_LIMIT));

      return { activeProject, nextSteps, laneActivity };
    },
  };
}
