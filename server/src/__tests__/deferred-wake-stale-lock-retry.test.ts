import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agentWakeupRequests,
  agents,
  companies,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const mockTelemetryClient = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../telemetry.ts", () => ({ getTelemetryClient: () => mockTelemetryClient }));

import { heartbeatService } from "../services/heartbeat.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres deferred-wake retry tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

// A run that errors (or is left non-running) while holding an issue
// execution lock must not park the reassigned assignee's wake forever. The
// bounded retry pass (`retryDeferredIssueExecutionWakes`) must release the
// stale holder's lock and claim the parked wake within one retry interval,
// while healthy holders keep their lock (single-execution semantics).
describeEmbeddedPostgres("heartbeat retryDeferredIssueExecutionWakes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-deferred-wake-retry-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    mockTelemetryClient.track.mockClear();
    // FK order: issues/heartbeat_runs reference agents, heartbeat_runs reference
    // agent_wakeup_requests (wakeup_request_id). Deleting a parent before its
    // referencer leaves rows behind and pollutes later tests' pass counts.
    const cleanups = [
      () => db.delete(issueComments),
      () => db.delete(heartbeatRunEvents),
      () => db.delete(issues),
      () => db.delete(heartbeatRuns),
      () => db.delete(agentWakeupRequests),
      () => db.delete(heartbeatRuns),
      () => db.delete(agents),
      () => db.delete(companies),
    ];
    for (const cleanup of cleanups) await cleanup().catch(() => undefined);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  // Scheduling suppression (worktree runtime) keeps the promoted run queued:
  // the test asserts the promotion and lock hand-off, never a live dispatch.
  function service() {
    return heartbeatService(db, { runtimeEnv: { PAPERCLIP_IN_WORKTREE: "true" } });
  }

  async function seed(holderStatus: "failed" | "queued" | "running") {
    const companyId = randomUUID();
    const formerAgentId = randomUUID(); // agent whose run holds the lock
    const assigneeAgentId = randomUUID(); // current assignee, parked behind it
    const issueId = randomUUID();
    const holderRunId = randomUUID();
    const parkedWakeId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: formerAgentId,
        companyId,
        name: "Former Owner",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: assigneeAgentId,
        companyId,
        name: "New Owner",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(heartbeatRuns).values({
      id: holderRunId,
      companyId,
      agentId: formerAgentId,
      status: holderStatus,
      invocationSource: "assignment",
      responsibleUserId: "local-board",
      contextSnapshot: { issueId, taskId: issueId, wakeReason: "issue_assigned" },
      ...(holderStatus === "running"
        ? { startedAt: new Date() }
        : holderStatus === "failed"
          ? { startedAt: new Date(), finishedAt: new Date(), error: "run errored while holding issue execution" }
          : {}),
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Reassigned while the old owner's run held the lock",
      status: "in_progress",
      priority: "high",
      // The issue was triaged away from the (error'd) holder's agent.
      assigneeAgentId,
      executionRunId: holderRunId,
      executionAgentNameKey: "former-owner",
      executionLockedAt: new Date(),
    });
    await db.insert(agentWakeupRequests).values({
      id: parkedWakeId,
      companyId,
      agentId: assigneeAgentId,
      source: "assignment",
      reason: "issue_execution_deferred",
      status: "deferred_issue_execution",
      payload: {
        issueId,
        _paperclipWakeContext: {
          issueId,
          taskId: issueId,
          wakeReason: "issue_assigned",
          source: "assignment",
        },
      },
      requestedAt: new Date(),
    });

    return { companyId, formerAgentId, assigneeAgentId, issueId, holderRunId, parkedWakeId };
  }

  async function readWake(wakeId: string) {
    return db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, wakeId))
      .then((rows) => rows[0] ?? null);
  }

  async function readRun(runId: string) {
    return db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
  }

  async function readIssue(issueId: string) {
    return db
      .select({
        executionRunId: issues.executionRunId,
        executionAgentNameKey: issues.executionAgentNameKey,
        executionLockedAt: issues.executionLockedAt,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
  }

  it("claims the reassigned agent's parked wake within one pass after the lock-holding run errors (acceptance)", async () => {
    // The holder's run errored: it is terminal but its release never promoted
    // the parked wake (the observed incident class of stall).
    const { assigneeAgentId, issueId, holderRunId, parkedWakeId } = await seed("failed");

    const result = await service().retryDeferredIssueExecutionWakes();

    expect(result.examined).toBe(1);
    expect(result.staleLocksReleased).toBe(1);

    // The parked assignment wake was promoted: claimed for promotion and
    // bound to a fresh queued run for the current assignee.
    const wake = await readWake(parkedWakeId);
    expect(wake?.status).toBe("queued");
    expect(wake?.reason).toBe("issue_execution_promoted");
    expect(wake?.runId).toBeTruthy();

    const promotedRun = await readRun(wake!.runId!);
    expect(promotedRun?.agentId).toBe(assigneeAgentId);
    expect(promotedRun?.status).toBe("queued");

    // The issue execution lock moved from the error'd holder to the promoted
    // run; the holder's terminal status is preserved.
    const issue = await readIssue(issueId);
    expect(issue?.executionRunId).toBe(promotedRun?.id);
    expect((await readRun(holderRunId))?.status).toBe("failed");
  });

  it("cancels the former assignee's non-running holder and claims the parked wake (incident shape)", async () => {
    // The incident shape: the holder sat non-running (error'd dispatch) while
    // holding the lock, and the issue had been reassigned away from its agent.
    const { assigneeAgentId, issueId, holderRunId, parkedWakeId } = await seed("queued");

    const result = await service().retryDeferredIssueExecutionWakes();

    expect(result.examined).toBe(1);
    expect(result.staleHoldersCancelled).toBe(1);
    expect(result.staleLocksReleased).toBe(1);

    // The stale holder is force-released with the same contract as the
    // wake-admission reassignment force-release.
    const holder = await readRun(holderRunId);
    expect(holder?.status).toBe("cancelled");
    expect(holder?.errorCode).toBe("lock_released_on_reassignment");

    // The parked wake claims within the same pass.
    const wake = await readWake(parkedWakeId);
    expect(wake?.status).toBe("queued");
    expect(wake?.reason).toBe("issue_execution_promoted");
    expect(wake?.runId).toBeTruthy();

    const promotedRun = await readRun(wake!.runId!);
    expect(promotedRun?.agentId).toBe(assigneeAgentId);
    expect(promotedRun?.status).toBe("queued");

    const issue = await readIssue(issueId);
    expect(issue?.executionRunId).toBe(promotedRun?.id);
  });

  it("never touches a running holder, even after reassignment (single-execution preserved)", async () => {
    const { issueId, holderRunId, parkedWakeId } = await seed("running");

    const result = await service().retryDeferredIssueExecutionWakes();

    expect(result.examined).toBe(1);
    expect(result.liveHoldersSkipped).toBe(1);
    expect(result.staleHoldersCancelled).toBe(0);
    expect(result.staleLocksReleased).toBe(0);

    // The wake stays parked and the live holder keeps the lock until its own
    // release drains the queue.
    expect((await readWake(parkedWakeId))?.status).toBe("deferred_issue_execution");
    expect((await readRun(holderRunId))?.status).toBe("running");
    expect((await readIssue(issueId))?.executionRunId).toBe(holderRunId);
  });

  it("never touches a non-running holder that still belongs to the current assignee", async () => {
    const { assigneeAgentId, issueId, holderRunId, parkedWakeId } = await seed("queued");
    // Same-agent shape: the queued holder is the current assignee's own run,
    // so its own release (or the recovery paths) owns the parked wake.
    await db
      .update(heartbeatRuns)
      .set({ agentId: assigneeAgentId })
      .where(eq(heartbeatRuns.id, holderRunId));

    const result = await service().retryDeferredIssueExecutionWakes();

    expect(result.examined).toBe(1);
    expect(result.liveHoldersSkipped).toBe(1);
    expect(result.staleHoldersCancelled).toBe(0);
    expect(result.staleLocksReleased).toBe(0);

    expect((await readWake(parkedWakeId))?.status).toBe("deferred_issue_execution");
    expect((await readRun(holderRunId))?.status).toBe("queued");
    expect((await readIssue(issueId))?.executionRunId).toBe(holderRunId);
  });

  it("is idempotent: a second pass after promotion changes nothing", async () => {
    const { parkedWakeId } = await seed("failed");

    const first = await service().retryDeferredIssueExecutionWakes();
    expect(first.staleLocksReleased).toBe(1);

    // The wake is no longer parked and the new holder is the promoted run of
    // the current assignee, so the second pass must leave everything alone.
    const second = await service().retryDeferredIssueExecutionWakes();
    expect(second.examined).toBe(0);
    expect(second.staleLocksReleased).toBe(0);
    expect((await readWake(parkedWakeId))?.status).toBe("queued");
  });
});
