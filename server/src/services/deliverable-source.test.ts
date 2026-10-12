import { describe, expect, it } from "vitest";
import { deliverableDoneBy, isAffirmativeVerification, readDeliverableSources, deliverableSourceFingerprint, deliverableVerifier, extractDeliverableProduct, resolveDeliverableProducts, safeDeliverableHref, type DeliverableSource } from "./deliverable-source.js";

export function source(): DeliverableSource {
  return { issue: { id: "issue", title: "Report", description: "Read `reports/result.md`", statusVersion: 1, updatedAt: new Date(0), assigneeAgentId: "author" } as DeliverableSource["issue"], comments: [], products: [], attachments: [], runtimeServices: [] };
}
describe("deliverable evidence", () => {
  it("qualifies correlated outer columns in SQL emitted by Drizzle", async () => {
    const { drizzle } = await import("drizzle-orm/pg-proxy");
    let statement = "";
    const db = drizzle(async (query) => { statement = query; return { rows: [] }; });
    await readDeliverableSources(db as unknown as Parameters<typeof readDeliverableSources>[0], "company", ["issue"]);
    for (const alias of ["ic", "wp", "ia"]) {
      expect(statement).toContain(`${alias}.issue_id = "issues"."id"`);
      expect(statement).toContain(`${alias}.company_id = "issues"."company_id"`);
    }
    expect(statement).toContain('r.company_id = "issues"."company_id"');
    expect(statement).toContain("limit 12");
    expect(statement).toContain('ac.company_id = "issues"."company_id"');
    expect(statement).toContain('ac.entity_id = "issues"."id"::text');
    expect(statement).toContain("ac.details->'_previous'->>'status' <> 'done'");
    expect(statement).not.toMatch(/= "(?:id|company_id)"/);
  });
  it.each(["Verified the report. 0 failed.", "All 12 tests passed, 0 failed.", "I verified the result.", "Verification passed.", "Verified the build after rerunning; not a regression.", "I verified it. Note: the old flaky test failed earlier but now passes.", "Approved before the release."])("accepts affirmative verification: %s", body => {
    expect(isAffirmativeVerification(body)).toBe(true);
  });
  it.each(["I will verify this.", "Not verified.", "Tests failed.", "Please verify.", "Will be verified tomorrow.", "Verified?", "If verified, ship it."])("rejects non-affirmative verification: %s", body => {
    expect(isAffirmativeVerification(body)).toBe(false);
  });
  it("finds older verification independently of twelve recent comments", () => {
    const s = source();
    s.comments = Array.from({ length: 12 }, (_, id) => ({ id: String(id), body: "Progress note", authorAgentId: "author", createdAt: "new", updatedAt: "new" }));
    s.verifierComments = [{ id: "older", body: "Verified the build after rerunning; not a regression.", authorAgentId: "reviewer", createdAt: "old", updatedAt: "old" }];
    expect(deliverableVerifier(s)).toBe("reviewer");
  });
  it("attributes completion to its actor, falling back to agent or user assignment", () => {
    const s = source();
    expect(deliverableDoneBy(s)).toEqual({ kind: "agent", id: "author" });
    s.completedBy = { kind: "agent", id: "finisher" };
    expect(deliverableDoneBy(s)).toEqual(s.completedBy);
    s.completedBy = { kind: "user", id: "operator" };
    expect(deliverableDoneBy(s)).toEqual(s.completedBy);
    s.completedBy = null; s.issue.assigneeAgentId = null; s.issue.assigneeUserId = "owner";
    expect(deliverableDoneBy(s)).toEqual({ kind: "user", id: "owner" });
  });
  it("excludes the completion actor and historical assignees from verification", () => {
    const s = source();
    s.completedBy = { kind: "agent", id: "qa" };
    s.assigneeAgentIds = ["worker"];
    s.issue.assigneeAgentId = null; s.issue.assigneeUserId = "owner";
    s.verifierComments = ["worker", "qa", "independent"].map(id => ({
      id, body: "All tests passed.", authorAgentId: id, createdAt: "now", updatedAt: "now",
    }));
    expect(deliverableVerifier(s)).toBe("independent");
    s.verifierComments.pop();
    expect(deliverableVerifier(s)).toBeNull();
  });
  it("uses version tuples and ignores display health and assignment churn", () => {
    const s = source();
    s.products = [{ id: "p", title: "Preview", type: "runtime_service", runtimeServiceId: "r", url: "http://localhost:1111", status: "active", healthStatus: "healthy", metadata: null, externalId: null, updatedAt: "v1" }];
    const before = deliverableSourceFingerprint(s);
    s.products[0].healthStatus = "unhealthy";
    s.runtimeServices = [{ id: "r", url: "http://localhost:2222", status: "stopped", healthStatus: "unhealthy" }];
    s.issue.updatedAt = new Date(); s.issue.statusVersion++;
    expect(deliverableSourceFingerprint(s)).toBe(before);
    s.products[0].updatedAt = "v2";
    expect(deliverableSourceFingerprint(s)).not.toBe(before);
    s.products[0].updatedAt = "v1"; s.products[0].url = "https://example.com/new";
    expect(deliverableSourceFingerprint(s)).not.toBe(before);
  });
  it("extracts links, paths and commits without enabling executable URLs", () => {
    expect(extractDeliverableProduct("See [Report](https://example.com/report).")?.href).toBe("https://example.com/report");
    expect(extractDeliverableProduct("Saved `reports/result.md`")?.target).toBe("reports/result.md");
    expect(extractDeliverableProduct("[Report](reports/result.md)")?.target).toBe("reports/result.md");
    expect(extractDeliverableProduct("[Task](/TOP/issues/TOP-12)")?.href).toBe("/TOP/issues/TOP-12");
    expect(extractDeliverableProduct("commit abc1234")?.target).toBe("abc1234");
    for (const url of ["javascript:alert(1)", "//evil.test", "file:///etc/passwd", "https://user:secret@example.com", "/\\evil.test"]) expect(safeDeliverableHref(url)).toBeNull();
  });
  it("reconciles relocated and stopped runtime products", () => {
    const s = source();
    s.products = [{ id: "product", title: "Preview", type: "runtime_service", runtimeServiceId: "runtime", url: "http://localhost:1111", status: "active", healthStatus: "healthy", metadata: null, externalId: null, updatedAt: "old" }];
    s.runtimeServices = [{ id: "runtime", url: "http://localhost:2222", status: "running", healthStatus: "healthy" }];
    expect(resolveDeliverableProducts(s)[0].href).toBe("http://localhost:2222");
    s.runtimeServices[0].status = "stopped";
    expect(resolveDeliverableProducts(s)[0]).toMatchObject({ href: null, unavailable: true });
    s.runtimeServices = [];
    expect(resolveDeliverableProducts(s)[0].unavailable).toBe(true);
  });
  it("fingerprints evidence versions; detects a different verifier", () => {
    const s = source(), before = deliverableSourceFingerprint(s);
    s.comments.push({ id: "c", body: "Verified the report. Tests passed.", authorAgentId: "reviewer", createdAt: "later", updatedAt: "later" });
    expect(deliverableSourceFingerprint(s)).not.toBe(before);
    expect(deliverableVerifier(s)).toBe("reviewer");
    s.comments[0].authorAgentId = "author";
    expect(deliverableVerifier(s)).toBeNull();
    s.comments[0].authorAgentId = "reviewer";
    s.comments[0].body = "Not verified; tests failed.";
    expect(deliverableVerifier(s)).toBeNull();
  });
});
