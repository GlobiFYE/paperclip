import { nonIdleSlackIssueCondition } from "./slack-conversation-state.js";
import { and, isNull, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { issues, projects, type Db } from "@paperclipai/db";
import { getCachedInstanceExperimentalFlag } from "./instance-flag-cache.js";
import { instanceSettingsService } from "./instance-settings.js";

export function visibleIssueCondition(): SQL {
  return and(isNull(issues.hiddenAt), isNull(issues.harnessKind))!;
}

export function visibleIssueSql(alias = "issues") {
  return `"${alias}"."hidden_at" IS NULL AND "${alias}"."harness_kind" IS NULL`;
}

/** Work queues and execution totals omit persistent conversation containers. */
export function executionIssueCondition(): SQL {
  return and(visibleIssueCondition(), isNull(issues.conversationAgentId), nonIdleSlackIssueCondition())!;
}

/**
 * Night-crew lot contract (doc/plans/2026-10-02-night-crew.md §1): an issue
 * parked in a zone-"a" project never surfaces on an attention surface —
 * company feeds, the inbox, notification-eligible events. Invisibility is
 * enforced server-side here, not by UI hiding. Execution paths (agents
 * researching and building lot items) keep full access and must NOT use this
 * condition. For the issues table in scope (unaliased, as in
 * `visibleIssueCondition`).
 */
export function lotProjectIssueCondition(): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${projects} lot_project
    WHERE lot_project.id = ${issues.projectId} AND lot_project.zone = 'a'
  )`;
}

/**
 * Same contract as {@link lotProjectIssueCondition} for queries whose subject
 * table references an issue by id (thread interactions, decisions, recovery
 * actions, runs). Issues with a null id reference never match, so rows about
 * non-issue subjects always pass.
 */
export function issueIdOutsideLotProjectCondition(issueId: SQLWrapper): SQL {
  return sql`NOT EXISTS (
    SELECT 1
    FROM ${issues} lot_issue
    JOIN ${projects} lot_project ON lot_project.id = lot_issue.project_id
    WHERE lot_issue.id = ${issueId} AND lot_project.zone = 'a'
  )`;
}

/**
 * Run-shape variant of {@link issueIdOutsideLotProjectCondition} for queries
 * that only have a run's context snapshot issue reference (text) rather than
 * a column holding an issue id. Same lot contract, same fail-open treatment
 * of non-issue references.
 */
export function runIssueIdOutsideLotProjectCondition(runIssueIdText: SQLWrapper): SQL {
  return sql`NOT EXISTS (
    SELECT 1
    FROM ${issues} lot_issue
    JOIN ${projects} lot_project ON lot_project.id = lot_issue.project_id
    WHERE lot_issue.id::text = ${runIssueIdText} AND lot_project.zone = 'a'
  )`;
}

/**
 * Night-crew ADHD edition flag gate (doc/plans/2026-10-02-night-crew.md §7):
 * is this instance's lot view armed? Cached per DB handle (short TTL,
 * invalidated on every experimental-settings write) so call sites do not add
 * a settings round-trip per query. Fails closed (false) on read errors.
 */
export async function lotViewEnabled(db: Db): Promise<boolean> {
  return getCachedInstanceExperimentalFlag(
    db,
    "enableLotView",
    async () => await instanceSettingsService(db).getExperimental() as unknown as Record<string, unknown>,
  );
}

/**
 * Flag-aware {@link lotProjectIssueCondition}: when `enableLotView` is off
 * the lot is not a separate invisible zone — zone-"a" projects behave like
 * classic upstream and no filter applies (undefined inside `and()` means
 * "no filter"). When on, the banked invisibility condition applies
 * unchanged.
 */
export async function lotProjectIssueFilter(db: Db): Promise<SQL | undefined> {
  return (await lotViewEnabled(db)) ? lotProjectIssueCondition() : undefined;
}

/**
 * Flag-aware {@link issueIdOutsideLotProjectCondition}; undefined when the
 * lot view is off.
 */
export async function issueIdOutsideLotFilter(db: Db, issueId: SQLWrapper): Promise<SQL | undefined> {
  return (await lotViewEnabled(db)) ? issueIdOutsideLotProjectCondition(issueId) : undefined;
}

/**
 * Flag-aware {@link runIssueIdOutsideLotProjectCondition}; undefined when the
 * lot view is off.
 */
export async function runIssueIdOutsideLotFilter(
  db: Db,
  runIssueIdText: SQLWrapper,
): Promise<SQL | undefined> {
  return (await lotViewEnabled(db)) ? runIssueIdOutsideLotProjectCondition(runIssueIdText) : undefined;
}
