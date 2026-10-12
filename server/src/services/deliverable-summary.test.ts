import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { issueDeliverables, type Db } from "@paperclipai/db";
import type { DeliverableSource } from "./deliverable-source.js";
const state = vi.hoisted(() => ({ source: null as DeliverableSource | null }));
vi.mock("./deliverable-source.js", async importOriginal => ({
  ...await importOriginal<typeof import("./deliverable-source.js")>(),
  readDeliverableSources: vi.fn(async () => new Map(state.source ? [[state.source.issue.id, structuredClone(state.source)]] : [])),
}));
import { deliverableGenerationState, generateIssueDeliverableSummary, processPendingDeliverableSummaries } from "./deliverable-summary.js";

type Row = typeof issueDeliverables.$inferSelect;
/** Transaction-serialized in-memory repository; model and clocks are controlled, SQL CAS is enforced. */
function repository(candidateCount = 1) {
  let row: Row | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  const dialect = new PgDialect();
  const db = {
    transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const next = tail.then(() => fn(db)); tail = next.catch(() => {}); return next;
    },
    execute: vi.fn(async () => []),
    insert: () => ({ values: (values: object) => ({ onConflictDoNothing: async () => {
      row ??= { id: "row", summary: null, generationStatus: "pending", generationAttempts: 0,
        companyId: "company", issueId: "issue", claimToken: null, claimedAt: null, nextAttemptAt: null,
        createdAt: new Date(), updatedAt: new Date(), generatedAt: null, generationError: null, summaryModel: null, summaryFromTaskDetails: false,
        regenerationCount: 0, completionKey: null, configFingerprint: null, checkedAt: null, sourceFingerprint: null, attemptTimes: [], ...values } as Row;
    } }) }),
    select: (selection?: object) => {
      let candidateQuery = false;
      const get = () => candidateQuery ? Array.from({ length: candidateCount }, () => ({ issueId: "issue", companyId: "company" }))
        : selection && "count" in selection ? [{ count: row?.attemptTimes.filter(t => Date.parse(t) > Date.now() - 60000).length ?? 0 }]
        : row ? [structuredClone(row)] : [];
      const chain = { from: () => chain, where: () => chain, for: async () => get(),
        leftJoin: () => { candidateQuery = true; return chain; }, orderBy: () => chain, limit: async () => get() };
      return chain;
    },
    update: () => ({ set: (patch: Partial<Row>) => ({ where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const query = dialect.sqlToQuery(condition);
      const token = query.sql.includes('"claim_token"') ? query.params.at(-1) : null;
      const matches = row && (!token || row.claimToken === token);
      if (matches) Object.assign(row!, patch);
      return { then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(undefined)), returning: async () => matches ? [structuredClone(row)] : [] };
    } }) }),
  };
  return { db: db as unknown as Db, row: () => row!, set: (patch: Partial<Row>) => Object.assign(row!, patch) };
}
function addComment(body = "Finished. Open https://example.com/report") {
  state.source!.comments.unshift({ id: String(state.source!.comments.length), body, authorAgentId: "author", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}
const success = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "The report is ready. Open the attached file to read it." }] } }] }), { status: 200 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  vi.stubEnv("GEMINI_API_KEY", "test-secret");
  vi.stubEnv("PAPERCLIP_DELIVERABLE_SUMMARY_ENV_FILE", "/tmp/no-deliverables-credentials");
  vi.stubGlobal("fetch", vi.fn(async () => success()));
  state.source = { issue: { id: "issue", companyId: "company", title: "Report", description: "A report", status: "done", statusVersion: 1, updatedAt: new Date(Date.now() - 240000), completedAt: new Date(Date.now() - 240000), hiddenAt: null } as DeliverableSource["issue"], comments: [], products: [], attachments: [], runtimeServices: [] };
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("durable summary sweep", () => {
  it("prioritizes actionable work and changed evidence before bounded daily rechecks", async () => {
    const { drizzle } = await import("drizzle-orm/pg-proxy");
    let statement = "", parameters: unknown[] = [];
    const db = drizzle(async (query, params) => { statement = query; parameters = params; return { rows: [] }; });
    await processPendingDeliverableSummaries(db as unknown as Db);
    expect(statement).toContain('"issue_deliverables"."checked_at"');
    expect(statement).toContain("interval '24 hours'");
    expect(statement).toMatch(/order by case[\s\S]*then 0[\s\S]*then 1[\s\S]*then 2 else 3 end/);
    expect(statement).toContain('ec.updated_at >');
    expect(statement).toContain('ep.updated_at >');
    expect(statement).toMatch(/limit \$\d+$/);
    expect(parameters.at(-1)).toBe(10);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("stores success once, with provenance and the working default model", async () => {
    const r = repository();
    expect((await generateIssueDeliverableSummary(r.db, "company", "issue")).outcome).toBe("generated");
    expect(r.row()).toMatchObject({ generationStatus: "generated", generationAttempts: 1, summaryFromTaskDetails: true, summaryModel: "gemini-3.5-flash-lite" });
    await generateIssueDeliverableSummary(r.db, "company", "issue");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([403, 503])("%s schedules backoff and remains terminal after the attempt cap", async status => {
    vi.mocked(fetch).mockImplementation(async () => new Response("test-secret", { status }));
    const r = repository();
    await generateIssueDeliverableSummary(r.db, "company", "issue");
    expect(r.row().generationStatus).toBe("retry_scheduled");
    await generateIssueDeliverableSummary(r.db, "company", "issue");
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const delay of [300000, 1800000, 7200000]) {
      expect(r.row().nextAttemptAt!.getTime() - Date.now()).toBe(delay);
      vi.setSystemTime(Date.now() + delay + 1);
      await generateIssueDeliverableSummary(r.db, "company", "issue");
    }
    expect(r.row().generationStatus).toBe("failed_final");
    expect(fetch).toHaveBeenCalledTimes(4);
    await generateIssueDeliverableSummary(r.db, "company", "issue");
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(r.row().nextAttemptAt).toBeNull();
    vi.setSystemTime(Date.now() + 30 * 86400000);
    expect(deliverableGenerationState(r.row(), state.source!)).toBe("failed_final");
    await processPendingDeliverableSummaries(r.db);
    expect(fetch).toHaveBeenCalledTimes(4);
    vi.stubEnv("PAPERCLIP_DELIVERABLE_SUMMARY_CONFIG_VERSION", "manual-requeue");
    vi.mocked(fetch).mockImplementation(async () => success());
    await generateIssueDeliverableSummary(r.db, "company", "issue");
    expect(r.row().generationStatus).toBe("generated");
    expect(JSON.stringify(r.row())).not.toContain("test-secret");
  });
  it("skips missing credentials before any claim or rate slot and recovers when credentials return", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const r = repository();
    await generateIssueDeliverableSummary(r.db, "company", "issue");
    expect(r.row()).toBeNull(); expect(fetch).not.toHaveBeenCalled();
    expect(r.db.execute).not.toHaveBeenCalled();
    expect((await processPendingDeliverableSummaries(r.db)).candidates).toBe(0);
    expect(r.row()).toBeNull();
    vi.stubEnv("GEMINI_API_KEY", "test-secret"); vi.setSystemTime(Date.now() + 60001);
    await generateIssueDeliverableSummary(r.db, "company", "issue");
    expect(r.row().generationStatus).toBe("generated");
  });
  it("waits three minutes so a completion comment arriving after the status change is included", async () => {
    const r = repository(); state.source!.issue.completedAt = new Date();
    await generateIssueDeliverableSummary(r.db, "company", "issue"); expect(fetch).not.toHaveBeenCalled();
    addComment(); vi.setSystemTime(Date.now() + 180001);
    await generateIssueDeliverableSummary(r.db, "company", "issue");
    expect(String(vi.mocked(fetch).mock.calls[0][1]?.body)).toContain("Finished.");
  });
  it("GET detects late comments before the sweep; repairs interrupted commentless completions at most twice", async () => {
    const r = repository(); await generateIssueDeliverableSummary(r.db, "company", "issue");
    addComment(); expect(deliverableGenerationState(r.row(), state.source!)).toBe("stale");
    await generateIssueDeliverableSummary(r.db, "company", "issue"); expect(r.row().regenerationCount).toBe(1);
    addComment("Second update"); await generateIssueDeliverableSummary(r.db, "company", "issue");
    addComment("Third update"); expect(deliverableGenerationState(r.row(), state.source!)).toBe("failed_final");
    await generateIssueDeliverableSummary(r.db, "company", "issue"); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("discards a response if input changes during a slow provider call and prevents overlapping sweeps", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const r = repository(); const running = processPendingDeliverableSummaries(r.db);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(r.row().generationStatus).toBe("generating");
    expect((await processPendingDeliverableSummaries(r.db)).candidates).toBe(0);
    await generateIssueDeliverableSummary(r.db, "company", "issue"); expect(fetch).toHaveBeenCalledTimes(1);
    addComment(); finish(success()); await running;
    expect(r.row()).toMatchObject({ summary: null, generationStatus: "stale", regenerationCount: 1 });
    vi.mocked(fetch).mockImplementation(async () => success());
    await generateIssueDeliverableSummary(r.db, "company", "issue"); expect(r.row().generationStatus).toBe("generated");
  });
  it("recovers an expired lease and fences off the old worker's result", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const r = repository(), running = generateIssueDeliverableSummary(r.db, "company", "issue");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    vi.setSystemTime(Date.now() + 120001);
    await generateIssueDeliverableSummary(r.db, "company", "issue");
    finish(success()); expect((await running).outcome).toBe("skipped");
    expect(r.row().generationAttempts).toBe(2);
  });
  it("keeps reassigned done issues generated, but requeues provider failures when configuration changes", async () => {
    const r = repository();
    await generateIssueDeliverableSummary(r.db, "company", "issue");
    state.source!.issue.statusVersion++;
    state.source!.issue.updatedAt = new Date();
    state.source!.issue.assigneeAgentId = "new-assignee";
    expect(deliverableGenerationState(r.row(), state.source!)).toBe("generated");
    await generateIssueDeliverableSummary(r.db, "company", "issue");
    expect(fetch).toHaveBeenCalledTimes(1);
    r.set({ generationStatus: "failed_final", generationAttempts: 4, generationError: "Provider unavailable", nextAttemptAt: new Date(Date.now() + 86400000) });
    vi.stubEnv("PAPERCLIP_DELIVERABLE_SUMMARY_CONFIG_VERSION", "requeue-1");
    await generateIssueDeliverableSummary(r.db, "company", "issue");
    expect(r.row()).toMatchObject({ generationStatus: "generated", generationAttempts: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("preserves stored text and attempts on a redundant done PATCH; retains stale text during a genuine re-completion", async () => {
    const r = repository();
    await generateIssueDeliverableSummary(r.db, "company", "issue");
    const summary = r.row().summary;
    state.source!.issue.completedAt = new Date(Date.now() - 200000);
    await generateIssueDeliverableSummary(r.db, "company", "issue");
    expect(r.row()).toMatchObject({ summary, generationAttempts: 1, generationStatus: "generated" });
    expect(fetch).toHaveBeenCalledTimes(1);
    state.source!.issue.completedAt = new Date();
    state.source!.lastReopenedEventId = "actual-reopen";
    expect(deliverableGenerationState(r.row(), state.source!)).toBe("stale");
    await generateIssueDeliverableSummary(r.db, "company", "issue");
    expect(r.row().summary).toBe(summary);
    vi.setSystemTime(Date.now() + 180001);
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = generateIssueDeliverableSummary(r.db, "company", "issue");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(r.row().summary).toBe(summary);
    finish(success()); await pending;
    expect(r.row().generationStatus).toBe("generated");
  });
  it("stops the sweep immediately when the durable rate gate rejects", async () => {
    const r = repository(10);
    await generateIssueDeliverableSummary(r.db, "company", "issue");
    const checkedAt = new Date(Date.now() - 60000);
    r.set({ checkedAt, generationStatus: "pending", attemptTimes: Array(5).fill(new Date().toISOString()) });
    expect((await processPendingDeliverableSummaries(r.db)).candidates).toBe(1);
    expect(r.row().checkedAt).toEqual(checkedAt);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("regenerates on re-completion but honors the rolling five-attempt admission cap", async () => {
    const r = repository();
    for (let i = 0; i < 6; i++) { state.source!.lastReopenedEventId = `reopen-${i}`; state.source!.issue.completedAt = new Date(Date.now() - 240000 + i); await generateIssueDeliverableSummary(r.db, "company", "issue"); }
    expect(fetch).toHaveBeenCalledTimes(5);
    vi.setSystemTime(Date.now() + 60001);
    await generateIssueDeliverableSummary(r.db, "company", "issue"); expect(fetch).toHaveBeenCalledTimes(6);
  });
});
