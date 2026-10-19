import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRuns,
  issues,
  startEmbeddedPostgresTestDatabase,
} from "@paperclipai/db";
import { createSentryRunLinkResolver } from "../sentry-run-links.js";

it("resolves saved task links and rejects foreign company, agent, and task identities", async () => {
  const tempDb = await startEmbeddedPostgresTestDatabase("paperclip-sentry-links-");
  try {
    const db = createDb(tempDb.connectionString);
    const [company] = await db.insert(companies).values({ name: "Fixture", issuePrefix: "TEAM" }).returning();
    const companyId = company!.id;
    const [agent] = await db.insert(agents).values({
      companyId, name: "Fixture", role: "engineer", adapterType: "codex_local",
    }).returning();
    const agentId = agent!.id;
    const [task] = await db.insert(issues).values({ companyId, title: "Fixture task", identifier: "TEAM-42" }).returning();
    const [run] = await db.insert(heartbeatRuns).values({
      companyId, agentId, invocationSource: "assignment", status: "failed", issueId: task!.id,
    }).returning();
    const resolve = createSentryRunLinkResolver(db);
    expect(await resolve({ runId: run!.id, companyId, agentId })).toMatchObject({
      companyId, agentId, companyPrefix: "TEAM", taskId: task!.id, taskIdentifier: "TEAM-42",
    });
    expect(await resolve({ runId: run!.id, companyId: randomUUID() })).toBeNull();
    expect(await resolve({ runId: run!.id, agentId: randomUUID() })).toBeNull();
    const [other] = await db.insert(companies).values({ name: "Other", issuePrefix: "OTHER" }).returning();
    const [otherTask] = await db.insert(issues).values({
      companyId: other!.id, title: "Other task", identifier: "OTHER-1",
    }).returning();
    const [taskless] = await db.insert(heartbeatRuns).values({
      companyId, agentId, invocationSource: "assignment", status: "failed",
    }).returning();
    expect(await resolve({ runId: taskless!.id })).toMatchObject({ taskId: null, taskIdentifier: null });
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: otherTask!.id } }).where(eq(heartbeatRuns.id, taskless!.id));
    expect(await resolve({ runId: taskless!.id })).toMatchObject({ taskId: null, taskIdentifier: null });
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: task!.id } }).where(eq(heartbeatRuns.id, taskless!.id));
    expect(await resolve({ runId: taskless!.id })).toMatchObject({ taskId: task!.id, taskIdentifier: "TEAM-42" });
  } finally {
    await tempDb.cleanup();
  }
}, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
