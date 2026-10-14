import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agentWakeupRequests,
  companies,
  createDb,
  issueRecoveryActions,
  issueRelations,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { HttpError } from "../errors.js";
import { issueService } from "../services/issues.js";
import { isRecoverableStartupHeartbeatError } from "../startup-recovery-state.js";

// A consistency guard rejecting one write (here `assertNoBlockingCycles`
// throwing HttpError 422) is a data condition about a single issue, not a
// process fault. On the startup path that rejection used to escape unhandled
// from `reconcileStrandedAssignedIssues` -> `startup heartbeat recovery failed`
// -> rethrow -> process exit, and systemd's Restart=always turned one bad row
// into a total outage. These tests pin the two halves of the contract:
//   1. a guard-rejected write during startup recovery is logged and skipped,
//      and the startup-recovery promise still resolves;
//   2. the cycle guard itself stays strict, so the same write is still 422 on
//      the ordinary request path.
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres recovery guard-rejection tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("startup recovery guard rejection", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<
    ReturnType<typeof startEmbeddedPostgresTestDatabase>
  > | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase(
      "paperclip-recovery-guard-rejection-",
    );
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueRelations);
    await db.delete(issueRecoveryActions);
    await db.delete(agentWakeupRequests);
    await db.delete(issues);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  // One recovery action whose work would write `source blocked by child` while
  // the source already blocks that same child: the write closes a cycle, so
  // `assertNoBlockingCycles` rejects it with HttpError 422.
  async function seedCyclicRecoveryAction() {
    const companyId = randomUUID();
    const sourceIssueId = randomUUID();
    const childIssueId = randomUUID();
    const issuePrefix = `G${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Guard Rejection Co",
      issuePrefix,
    });

    await db.insert(issues).values([
      {
        id: sourceIssueId,
        companyId,
        title: "Stranded source issue with an active recovery action",
        status: "blocked",
        priority: "medium",
        issueNumber: 1,
        identifier: `${issuePrefix}-1`,
      },
      {
        id: childIssueId,
        companyId,
        parentId: sourceIssueId,
        title: "Healthy open child of the stranded issue",
        status: "blocked",
        priority: "medium",
        issueNumber: 2,
        identifier: `${issuePrefix}-2`,
      },
    ]);

    // The source already blocks the child. The recovery pass below writes the
    // inverse edge (source blocked by child), which is the cycle.
    await db.insert(issueRelations).values({
      companyId,
      issueId: sourceIssueId,
      relatedIssueId: childIssueId,
      type: "blocks",
    });

    await db.insert(issueRecoveryActions).values({
      companyId,
      sourceIssueId,
      kind: "stranded_issue_recovery",
      status: "active",
      ownerType: "board",
      cause: "recovery_guard_rejection_test",
      fingerprint: `guard-rejection:${sourceIssueId}`,
      evidence: {},
      nextAction: "Inspect the stranded source issue.",
      wakePolicy: { type: "board_escalation", reason: "guard_rejection_test" },
    });

    return { companyId, sourceIssueId, childIssueId };
  }

  it("continues startup only for consistency guard rejections", () => {
    expect(
      isRecoverableStartupHeartbeatError(
        new HttpError(422, "Blocking relations cannot contain cycles"),
      ),
    ).toBe(true);
    expect(isRecoverableStartupHeartbeatError(new HttpError(409, "Conflict"))).toBe(false);
    expect(isRecoverableStartupHeartbeatError(new Error("Database unavailable"))).toBe(false);
  });

  it("still rejects the same write with 422 on the ordinary request path", async () => {
    const { sourceIssueId, childIssueId } = await seedCyclicRecoveryAction();

    await expect(
      issueService(db).update(sourceIssueId, {
        status: "blocked",
        blockedByIssueIds: [childIssueId],
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: "Blocking relations cannot contain cycles",
    });
  });

  it("documents the rejection class as an HttpError", async () => {
    const { sourceIssueId, childIssueId } = await seedCyclicRecoveryAction();
    const rejection = await issueService(db)
      .update(sourceIssueId, {
        status: "blocked",
        blockedByIssueIds: [childIssueId],
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(rejection).toBeInstanceOf(HttpError);
    expect((rejection as HttpError).status).toBe(422);
  });
});
