import { afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Db } from "@paperclipai/db";
import { companyDeliverablesResponseSchema } from "@paperclipai/shared";
import type { Request } from "express";
import { assertCompanyAccess } from "../routes/authz.js";
import { deliverablesService } from "./deliverables.js";
import { deliverableSourceFingerprint, type DeliverableSource } from "./deliverable-source.js";
const context = vi.hoisted(() => ({ sources: new Map<string, DeliverableSource>() }));
vi.mock("./deliverable-source.js", async original => ({ ...await original<typeof import("./deliverable-source.js")>(), readDeliverableSources: vi.fn(async () => context.sources) }));

function fixture() {
  const issue = { id: "11111111-1111-4111-8111-111111111111", companyId: "company", title: "Finished report", status: "done", statusVersion: 1, updatedAt: new Date("2026-10-01Z"), completedAt: new Date("2026-10-01Z"), assigneeAgentId: null, assigneeUserId: null, projectId: null } as DeliverableSource["issue"];
  const source: DeliverableSource = { issue, comments: [], products: [], attachments: [], runtimeServices: [] };
  context.sources = new Map([[issue.id, source]]);
  const row = { issue, projectName: null, completedAt: issue.completedAt, deliverable: { id: "d", generationStatus: "generated", summary: "Stored report summary.", sourceFingerprint: deliverableSourceFingerprint(source), completionKey: issue.completedAt!.toISOString(), regenerationCount: 0 } };
  const where = vi.fn(), limit = vi.fn(async () => [row, row]);
  const query = { from: () => query, leftJoin: () => query, where: (sql: unknown) => { where(sql); return query; }, orderBy: () => query, limit, then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(resolve([{ id: "finisher", name: "Finisher" }])) };
  return { source, row, where, limit, db: { select: () => query } as unknown as Db };
}
afterEach(() => vi.unstubAllEnvs());
describe("company deliverables list", () => {
  it.each(["agent", "user"] as const)("returns the completion actor's name for %s instead of the current assignee", async kind => {
    const f = fixture();
    f.source.completedBy = { kind, id: "finisher" };
    const result = await deliverablesService(f.db).list("company", { limit: 1 });
    expect(result.deliverables[0].doneBy).toEqual({ kind, id: "finisher", name: "Finisher" });
  });
  it.each([null, "2026-10-12T12:00:00.000Z"])("preserves polling fields through the exported response schema: %s", async nextAttemptAt => {
    const f = fixture();
    const result = await deliverablesService(f.db).list("company", { limit: 1 });
    result.deliverables[0].id = f.source.issue.id;
    result.deliverables[0].nextAttemptAt = nextAttemptAt;
    expect(companyDeliverablesResponseSchema.parse(result)).toEqual(result);
  });
  it("reports disabled summaries without exposing credentials or hiding stored text", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("PAPERCLIP_DELIVERABLE_SUMMARY_ENV_FILE", "/tmp/no-deliverables-credentials");
    const f = fixture();
    const response = await deliverablesService(f.db).list("company", { limit: 1 });
    expect(response.summariesEnabled).toBe(false);
    expect(response.deliverables[0].summary).toBe("Stored report summary.");
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    const enabled = await deliverablesService(f.db).list("company", { limit: 1 });
    expect(enabled.summariesEnabled).toBe(true);
    expect(JSON.stringify(enabled)).not.toContain("private-test-key");
  });
  it("keeps text on redundant done PATCHes and marks real re-completions stale", async () => {
    const f = fixture();
    f.source.issue.completedAt = new Date();
    expect((await deliverablesService(f.db).list("company", { limit: 1 })).deliverables[0])
      .toMatchObject({ generationState: "generated", summary: "Stored report summary." });
    f.source.lastReopenedEventId = "reopened-event";
    expect((await deliverablesService(f.db).list("company", { limit: 1 })).deliverables[0])
      .toMatchObject({ generationState: "stale", summary: "Stored report summary." });
  });
  it("enforces company access for agents and board users", () => {
    expect(() => assertCompanyAccess({ actor: { type: "agent", companyId: "other" } } as Request, "company")).toThrow("another company");
    expect(() => assertCompanyAccess({ actor: { type: "board", source: "session", companyIds: ["other"] } } as Request, "company")).toThrow("does not have access");
    expect(() => assertCompanyAccess({ actor: { type: "agent", companyId: "company" } } as Request, "company")).not.toThrow();
  });
  it("scopes done and visible rows by project and date, with stable keyset pagination", async () => {
    const f = fixture();
    const result = await deliverablesService(f.db).list("company", { projectId: "project", from: "2026-10-01", to: "2026-10-12", limit: 1 });
    const dialect = new PgDialect(), query = dialect.sqlToQuery(f.where.mock.calls[0][0]);
    expect(query.sql).toContain('"issues"."company_id"'); expect(query.sql).toContain('"issues"."hidden_at" is null');
    expect(query.sql).toContain("date_trunc('milliseconds'");
    expect(query.params).toEqual(["company", "done", "project", "2026-10-01T00:00:00.000Z", "2026-10-12T00:00:00.000Z"]);
    expect(result.deliverables).toHaveLength(1); expect(result.nextCursor).toBeTruthy();
    await deliverablesService(f.db).list("company", { limit: 1, cursor: result.nextCursor! });
    expect(dialect.sqlToQuery(f.where.mock.calls[1][0]).params).toContain(f.source.issue.id);
  });
  it("GET immediately reports stale on a comment event before any sweep, retaining stored text", async () => {
    const f = fixture();
    f.source.comments = [{ id: "late", body: "Open https://example.com/report", authorAgentId: null, createdAt: "later", updatedAt: "later" }];
    const result = await deliverablesService(f.db).list("company", { limit: 1 });
    expect(result.deliverables[0]).toMatchObject({ generationState: "stale", summary: "Stored report summary.", product: { href: "https://example.com/report" } });
  });
  it("rejects malformed pagination and reversed ranges before querying", async () => {
    const f = fixture();
    await expect(deliverablesService(f.db).list("company", { limit: 1, cursor: "bad" })).rejects.toThrow("cursor");
    await expect(deliverablesService(f.db).list("company", { limit: 1, from: "2026-10-12", to: "2026-10-01" })).rejects.toThrow("range");
    expect(f.where).not.toHaveBeenCalled();
  });
});
