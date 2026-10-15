import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  CROSS_ISSUE_INFLUENCE_ENFORCE_AT,
  observeCrossIssueInfluence,
} from "../services/cross-issue-influence-limit.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("cross-issue influence limit PostgreSQL serialization", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-cross-issue-cap-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("allows exactly one of concurrent attempts 20 and 21", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    const sourceIssueId = randomUUID();
    const targetIssueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `C${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      defaultResponsibleUserId: "board-user",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Concurrent Coder",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "running",
      responsibleUserId: "board-user",
      contextSnapshot: { issueId: sourceIssueId },
    });
    await db.insert(activityLog).values(
      Array.from({ length: 18 }, () => ({
        companyId,
        actorType: "agent" as const,
        actorId: agentId,
        agentId,
        runId,
        action: "issue.cross_issue_influence_observed",
        entityType: "issue",
        entityId: targetIssueId,
      })),
    );

    const input = {
      companyId,
      runId,
      agentId,
      targetIssueId,
      targetIssueIdentifier: "CAP-2",
      kind: "comment" as const,
      now: CROSS_ISSUE_INFLUENCE_ENFORCE_AT,
    };
    // A comment, a PATCH, and an issue-thread interaction resolution race for the
    // last slot of the shared budget: the row lock must let exactly one of 19/20
    // through per attempt and fail the twenty-first closed.
    const decisions = await Promise.all([
      observeCrossIssueInfluence(db, input),
      observeCrossIssueInfluence(db, { ...input, kind: "update" }),
      observeCrossIssueInfluence(db, { ...input, kind: "interaction_resolution" }),
    ]);

    expect(decisions.map((decision) => decision?.allowed).sort()).toEqual([false, true, true]);
    expect(decisions.map((decision) => decision?.count).sort((a, b) => Number(a) - Number(b)))
      .toEqual([19, 20, 21]);

    const recorded = await db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(and(eq(activityLog.companyId, companyId), eq(activityLog.runId, runId)));
    expect(recorded.filter((row) => row.action === "issue.cross_issue_influence_observed")).toHaveLength(20);
    expect(recorded.filter((row) => row.action === "issue.cross_issue_influence_cap_rejected")).toHaveLength(1);
  });

  // An interval wake persists a run whose contextSnapshot names no issue,
  // because only a wake on an issue carries one. That run used to be refused on
  // every comment and every status PATCH, including on the issue it had just
  // checked out. That left an agent woken on a timer unable to write to the
  // board at all. The cap must contain such a run instead of denying it.
  it("lets a run with no source issue write, and exempts the issue it checked out", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `C${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      defaultResponsibleUserId: "board-user",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Interval Sweeper",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "running",
      responsibleUserId: "board-user",
      // Exactly what the scheduler persists for an interval wake: no issueId.
      contextSnapshot: { reason: "interval_elapsed", source: "scheduler", wakeReason: "heartbeat_timer" },
    });
    const [checkedOut] = await db.insert(issues).values({
      companyId,
      title: "Claimed by this run",
      checkoutRunId: runId,
    }).returning({ id: issues.id });
    const [untouched] = await db.insert(issues).values({
      companyId,
      title: "Someone else's issue",
    }).returning({ id: issues.id });
    // The exemption is for the checkout *this* run holds. Another run's claim is
    // not this run's business, so reaching it must still spend the budget.
    const [otherRun] = await db.insert(heartbeatRuns).values({
      companyId,
      agentId,
      status: "running",
      responsibleUserId: "board-user",
      contextSnapshot: { reason: "interval_elapsed", source: "scheduler", wakeReason: "heartbeat_timer" },
    }).returning({ id: heartbeatRuns.id });
    const [claimedByAnotherRun] = await db.insert(issues).values({
      companyId,
      title: "Claimed by a different run",
      checkoutRunId: otherRun!.id,
    }).returning({ id: issues.id });

    const base = {
      companyId,
      runId,
      agentId,
      kind: "comment" as const,
      now: CROSS_ISSUE_INFLUENCE_ENFORCE_AT,
    };

    // Writing to the issue this run holds the checkout on is a same-issue write:
    // exempt, and it must not spend the cross-issue budget.
    await expect(observeCrossIssueInfluence(db, { ...base, targetIssueId: checkedOut!.id }))
      .resolves.toBeNull();

    // Reaching a different issue from the same run is still contained and audited.
    await expect(observeCrossIssueInfluence(db, { ...base, targetIssueId: untouched!.id, kind: "update" }))
      .resolves.toMatchObject({ allowed: true, mode: "enforce", count: 1 });

    // An issue checked out by some *other* run is a cross-issue write like any
    // other. If this were exempt, the exemption would be "anyone's checkout"
    // rather than "mine", and a single run could reach every claimed issue on
    // the board for free.
    await expect(observeCrossIssueInfluence(db, { ...base, targetIssueId: claimedByAnotherRun!.id }))
      .resolves.toMatchObject({ allowed: true, mode: "enforce", count: 2 });

    const recorded = await db
      .select({ action: activityLog.action, details: activityLog.details, entityId: activityLog.entityId })
      .from(activityLog)
      .where(and(eq(activityLog.companyId, companyId), eq(activityLog.runId, runId)));
    expect(recorded).toHaveLength(2);
    expect(recorded.map((row) => row.action)).toEqual([
      "issue.cross_issue_influence_observed",
      "issue.cross_issue_influence_observed",
    ]);
    expect(recorded.map((row) => row.entityId).sort())
      .toEqual([untouched!.id, claimedByAnotherRun!.id].sort());
    for (const row of recorded) {
      expect((row.details as { sourceIssueId: unknown }).sourceIssueId).toBeNull();
    }
  });
});
