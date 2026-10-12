import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { activityLog, companies, createDb, getEmbeddedPostgresTestSupport, issueComments, issueDeliverables, issues, startEmbeddedPostgresTestDatabase } from "@paperclipai/db";
import { deliverablesService } from "./deliverables.js";
import { generateIssueDeliverableSummary, processPendingDeliverableSummaries } from "./deliverable-summary.js";

import { deliverableCompletionKey, deliverableSourceFingerprint, readDeliverableSources } from "./deliverable-source.js";

const support = await getEmbeddedPostgresTestSupport();
// Sandbox cannot bind loopback; host runs exercise real SQL, uniqueness and advisory locks.
describe.skipIf(!support.supported)(`deliverables PostgreSQL integration${support.reason ? ` (${support.reason})` : ""}`, () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => { temporary = await startEmbeddedPostgresTestDatabase("deliverables-proof-"); db = createDb(temporary.connectionString); }, 90000);
  afterAll(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await db?.$client.end({ timeout: 5 }); await temporary?.cleanup(); });
  it("prioritizes a due retry and late-comment repair over older generated history, and reads completion attribution", async () => {
    const companyId = randomUUID(), finisherId = randomUUID(), workerId = randomUUID();
    const ids = Array.from({ length: 14 }, () => randomUUID());
    const old = new Date(Date.now() - 2 * 86400000), recent = new Date(Date.now() - 1000);
    await db.insert(companies).values({ id: companyId, name: "Priority test", issuePrefix: "PRI" });
    await db.insert(issues).values(ids.map(id => ({ id, companyId, title: id, status: "done", completedAt: old, updatedAt: old })));
    await db.insert(activityLog).values({ companyId, actorType: "agent", actorId: finisherId,
      action: "issue.updated", entityType: "issue", entityId: ids[12],
      details: { status: "done", assigneeAgentId: finisherId, _previous: { status: "in_progress", assigneeAgentId: workerId } } });
    // A redundant done PATCH omits _previous.status and must not replace the finisher.
    await db.insert(activityLog).values({ companyId, actorType: "agent", actorId: randomUUID(),
      action: "issue.updated", entityType: "issue", entityId: ids[12],
      details: { status: "done", _previous: { assigneeAgentId: finisherId } } });
    const sources = await readDeliverableSources(db, companyId, ids);
    expect(sources.get(ids[12])?.completedBy).toEqual({ kind: "agent", id: finisherId });
    expect(sources.get(ids[12])?.assigneeAgentIds).toEqual(expect.arrayContaining([workerId, finisherId]));
    await db.insert(issueDeliverables).values(ids.map((id, index) => ({ companyId, issueId: id,
      summary: "Previously generated.", generationStatus: index === 12 ? "retry_scheduled" as const : "generated" as const,
      completionKey: deliverableCompletionKey(sources.get(id)!), sourceFingerprint: deliverableSourceFingerprint(sources.get(id)!),
      checkedAt: index < 12 ? old : recent, nextAttemptAt: index === 12 ? recent : null,
    })));
    await db.insert(issueComments).values({ companyId, issueId: ids[13], body: "Late completion details." });
    vi.stubEnv("GEMINI_API_KEY", "fake-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "The report is ready. Open the result." }] } }] }))));
    const result = await processPendingDeliverableSummaries(db);
    expect(result.generated).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetch).mock.calls[0][1]?.body)).toContain(ids[12]);
    expect(String(vi.mocked(fetch).mock.calls[1][1]?.body)).toContain(ids[13]);
    expect((await deliverablesService(db).list(companyId, { limit: 30 })).deliverables.find(card => card.issue.id === ids[12])?.doneBy)
      .toMatchObject({ kind: "agent", id: finisherId });
  });
  it("paginates every issue when PostgreSQL timestamps differ only below millisecond precision", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Cursor test", issuePrefix: "CUR" });
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort().reverse();
    for (let i = 0; i < ids.length; i++) {
      await db.insert(issues).values({ id: ids[i], companyId, title: `Report ${i}`, status: "done",
        completedAt: sql`${`2026-10-01T00:00:00.12300${i + 1}Z`}::timestamptz` });
    }
    const list = deliverablesService(db), found: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list.list(companyId, { limit: 1, cursor });
      found.push(...page.deliverables.map(d => d.issue.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor && found.length <= 3);
    expect(found).toEqual(ids);
  });
  it("reads stored text, detects a late comment immediately and enforces one concurrent claim", async () => {
    const companyId = randomUUID(), issueId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Deliverables test", issuePrefix: "DLV" });
    await db.insert(issues).values({ id: issueId, companyId, title: "A completed report", status: "done", completedAt: new Date(Date.now() - 240000) });
    vi.stubEnv("GEMINI_API_KEY", "fake-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "The report is ready. Open the attached result." }] } }] }))));
    await Promise.all([generateIssueDeliverableSummary(db, companyId, issueId), generateIssueDeliverableSummary(db, companyId, issueId)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const list = deliverablesService(db);
    expect((await list.list(companyId, { limit: 30 })).deliverables[0].generationState).toBe("generated");
    await db.update(issues).set({ statusVersion: 2, updatedAt: new Date(), completedAt: new Date(Date.now() - 200000) }).where(eq(issues.id, issueId));
    expect((await list.list(companyId, { limit: 30 })).deliverables[0].generationState).toBe("generated");
    await generateIssueDeliverableSummary(db, companyId, issueId);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [beforeReopen] = await db.select().from(issueDeliverables).where(eq(issueDeliverables.issueId, issueId));
    await db.insert(activityLog).values({ companyId, actorId: "test", action: "issue.updated", entityType: "issue", entityId: issueId,
      details: { status: "in_progress", _previous: { status: "done" } } });
    await db.update(issues).set({ completedAt: new Date(Date.now() - 190000) }).where(eq(issues.id, issueId));
    expect((await list.list(companyId, { limit: 30 })).deliverables[0]).toMatchObject({ generationState: "stale", summary: beforeReopen.summary });
    await generateIssueDeliverableSummary(db, companyId, issueId);
    expect(fetch).toHaveBeenCalledTimes(2);
    await db.insert(issueComments).values({ companyId, issueId, body: "Finished. Read https://example.com/report" });
    expect((await list.list(companyId, { limit: 30 })).deliverables[0].generationState).toBe("stale");
    expect((await list.list(randomUUID(), { limit: 30 })).deliverables).toEqual([]);
    await generateIssueDeliverableSummary(db, companyId, issueId);
    const [stored] = await db.select().from(issueDeliverables).where(eq(issueDeliverables.issueId, issueId));
    expect(stored.regenerationCount).toBe(1);
    expect((await list.list(companyId, { limit: 30 })).deliverables[0]).toMatchObject({ generationState: "generated", product: { href: "https://example.com/report" } });
  });
});
