import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response } from "express";
import type { TokenUsageSummary } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenUsageRoutes } from "../../routes/token-usage.js";
import { parseCollectorTime } from "../../services/token-usage.js";

const companyId = "57cfaea0-c864-4bff-9433-2fad7be3d4c5";
const url = `/api/companies/${companyId}/token-usage`;
let dir: string;
let file: string;
let fixture: string;
const admin: Request["actor"] = { type: "board", source: "session", userId: "admin", isInstanceAdmin: true, companyIds: [companyId, "other"] };
function app(actor: Request["actor"] = admin) { return actor; }

// Exercise the actual router without requiring a listening socket.
function request(actor: Request["actor"]) {
  return {
    get: (path: string) => new Promise<{
      status: number;
      headers: Record<string, string>;
      body: TokenUsageSummary & { available?: false; reason?: string; error?: string };
    }>((resolve, reject) => {
      const url = new URL(path, "http://localhost");
      const query: Record<string, string | string[]> = {};
      for (const key of url.searchParams.keys()) {
        const values = url.searchParams.getAll(key);
        query[key] = values.length === 1 ? values[0]! : values;
      }
      const req = { method: "GET", url: url.pathname.replace(/^\/api/, ""), query, actor } as Request;
      const headers: Record<string, string> = {};
      let status = 200;
      const res = {
        setHeader: (key: string, value: string) => { headers[key.toLowerCase()] = value; },
        json: (body: TokenUsageSummary) => resolve({ status, headers, body }),
      } as unknown as Response;
      tokenUsageRoutes()(req, res, (err?: unknown) => {
        if (!err) { reject(new Error("Route did not match")); return; }
        const error = err as { status?: number; message: string };
        status = error.status ?? 500;
        res.json({ error: error.message });
      });
    }),
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "token-usage-"));
  file = join(dir, "summary.json");
  fixture = await readFile(new URL("./fixtures/summary.json", import.meta.url), "utf8");
  await writeFile(file, fixture);
  vi.stubEnv("PANTHEON_USAGE_SUMMARY_PATH", file);
  vi.stubEnv("PANTHEON_USAGE_COMPANY_ID", companyId);
  vi.stubEnv("PANTHEON_USAGE_TZ", "America/Los_Angeles");
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-12T19:12:00Z"));
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });

describe("token usage route", () => {
  it("reads the fixture, sorts providers/models, and keeps counts separate", async () => {
    const res = await request(app()).get(url);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toMatchObject({ window: "d7", generatedAt: "2026-10-12T12:00:00-07:00", generatedAtMs: Date.parse("2026-10-12T19:00:00Z"), stale: false, partial: false });
    expect(res.body.providers[0]).toMatchObject({ key: "mimo", tokens: 49_700_000, count: 1414, countUnit: "calls", cachedTokens: 698_000_000 });
    expect(res.body.providers[0].models).toEqual([{ name: "model-a", tokens: 49_700_000, tokensIn: 40_000_000, tokensOut: 9_700_000, calls: 1414 }]);
    expect(res.body.total).toEqual({ tokens: 49_701_730, tokensIn: 40_001_510, tokensOut: 9_700_220, cachedTokens: 698_000_100 });
    expect(res.body.sources).toEqual([{name: "hermes_state_db", status: "ok"}, {name: "hermes_logs", status: "ok"}, {name: "paperclip_runs", status: "ok"}]);
    expect(JSON.stringify(res.body)).not.toContain("/private/path");
  });
  it.each(["today", "d7", "d30"])("selects %s and reads each request afresh", async (window) => {
    const source = JSON.parse(fixture);
    source.windows[window].providers = {};
    await writeFile(file, JSON.stringify(source));
    expect((await request(app()).get(`${url}?window=${window}`)).body.providers).toEqual([]);
    await writeFile(file, fixture);
    expect((await request(app()).get(`${url}?window=${window}`)).body.providers.length).toBeGreaterThan(0);
  });
  it("filters only fully empty providers and maps local/subscription kinds", async () => {
    const { body } = await request(app()).get(url);
    const rows = Object.fromEntries(body.providers.map((p: { key: string }) => [p.key, p]));
    expect(rows.unknown).toBeUndefined();
    expect(rows.nvidia).toMatchObject({ tokens: 0, rateLimited: 3, kind: "cloud" });
    for (const key of ["cached", "errors", "warning", "calls"]) expect(rows[key]).toBeDefined();
    for (const key of ["local", "local_ollama"]) expect(rows[key]).toMatchObject({ kind: "local", countUnit: "calls" });
    for (const key of ["claude", "openai"]) expect(rows[key]).toMatchObject({ kind: "subscription", countUnit: "runs" });
  });
  it.each(["skipped", "error", "absent"])("reports partial collection for %s", async (status) => {
    const source = JSON.parse(fixture);
    if (status === "absent") delete source.collection;
    else source.collection.paperclip_runs = status;
    await writeFile(file, JSON.stringify(source));
    const { body } = await request(app()).get(url);
    expect(body.partial).toBe(true);
    if (status === "absent") expect(body.sources).toEqual([]);
    else expect(body.sources).toContainEqual({ name: "paperclip_runs", status });
  });
  it("sorts model rows by tokens and retains error-only models", async () => {
    const source = JSON.parse(fixture);
    const model = source.windows.d7.providers.mimo.models.empty;
    source.windows.d7.providers.mimo.models = {
      small: { ...model, tokens_in: 10 },
      empty: model,
      failed: { ...model, errors: 1 },
      large: { ...model, tokens_out: 100 },
    };
    await writeFile(file, JSON.stringify(source));
    const { body } = await request(app()).get(url);
    expect(body.providers[0]?.models.map((row) => row.name)).toEqual(["large", "small", "failed"]);
  });
  it("uses the default company and collector timezone when unset", async () => {
    delete process.env.PANTHEON_USAGE_COMPANY_ID;
    delete process.env.PANTHEON_USAGE_TZ;
    vi.stubEnv("TZ", "UTC");
    const { body } = await request(app()).get(url);
    expect(body.generatedAt).toBe("2026-10-12T12:00:00-07:00");
    expect(body.window).toBe("d7");
  });
  it("marks stale only when older than one hour", async () => {
    vi.mocked(Date.now).mockReturnValue(Date.parse("2026-10-12T20:00:00Z"));
    expect((await request(app()).get(url)).body.stale).toBe(false);
    vi.mocked(Date.now).mockReturnValue(Date.parse("2026-10-12T20:00:00.001Z"));
    expect((await request(app()).get(url)).body.stale).toBe(true);
  });
  it.each(["missing", "directory", "json", "schema", "date"])("returns generic unavailable for %s", async (failure) => {
    if (failure === "missing") await rm(file);
    if (failure === "directory") vi.stubEnv("PANTHEON_USAGE_SUMMARY_PATH", dir);
    if (failure === "json") await writeFile(file, "private invalid contents");
    if (failure === "schema") await writeFile(file, '{"windows":{}}');
    if (failure === "date") await writeFile(file, fixture.replace("2026-10-12T12:00:00", "2026-02-30T12:00:00"));
    const res = await request(app()).get(url);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false, reason: ["missing", "directory"].includes(failure) ? "unreadable" : "malformed" });
  });
  it.each(["year", "", "d7&window=d30"])("rejects bad window %s", async (value) => {
    expect((await request(app()).get(`${url}?window=${value}`)).status).toBe(400);
  });
  it.each<Request["actor"]>([
    { type: "agent", agentId: "agent", companyId, source: "agent_key" },
    { type: "none" },
    { type: "board", source: "session", companyIds: [companyId], isInstanceAdmin: false },
    { ...admin, companyIds: [] },
  ])("rejects unauthorized actor %#", async (actor) => {
    expect((await request(app(actor)).get(url)).status).toBe(403);
  });
  it("accepts local trusted board and denies nonconfigured companies", async () => {
    expect((await request(app({ type: "board", source: "local_implicit" })).get(url)).status).toBe(200);
    expect((await request(app()).get("/api/companies/other/token-usage")).body).toEqual({ available: false, reason: "not_configured" });
    vi.stubEnv("PANTHEON_USAGE_COMPANY_ID", "other");
    expect((await request(app()).get(url)).body).toEqual({ available: false, reason: "not_configured" });
    expect((await request(app()).get("/api/companies/other/token-usage")).body.window).toBe("d7");
  });
});

describe("collector timezone", () => {
  it.each([
    ["2026-01-12T12:00:00", "-08:00"],
    ["2026-07-12T12:00:00", "-07:00"],
    ["2026-03-08T01:59:59", "-08:00"],
    ["2026-03-08T03:00:00", "-07:00"],
    ["2026-11-01T01:30:00", "-07:00"],
    ["2026-11-01T02:00:00", "-08:00"],
  ])("resolves %s on a UTC server", (wall, offset) => {
    vi.stubEnv("TZ", "UTC");
    expect(parseCollectorTime(wall, "America/Los_Angeles")).toEqual({ generatedAt: wall + offset, generatedAtMs: Date.parse(wall + offset) });
  });
  it("rejects nonexistent DST times and invalid zones", () => {
    expect(() => parseCollectorTime("2026-03-08T02:30:00", "America/Los_Angeles")).toThrow();
    expect(() => parseCollectorTime("2026-10-12T12:00:00", "invalid")).toThrow();
  });
  it("supports a configured non-hour timezone offset", () => {
    expect(parseCollectorTime("2026-10-12T12:00:00", "Asia/Kolkata").generatedAt).toBe("2026-10-12T12:00:00+05:30");
  });
});

describe("tolerant parsing (inspection TU-R1)", () => {
  it("keeps the selected window when another window or the collection map has unexpected values", async () => {
    const { readFile } = await import("node:fs/promises");
    const fixture = JSON.parse(await readFile(new URL("./fixtures/summary.json", import.meta.url), "utf8"));
    fixture.windows.d30 = { providers: { broken: { display: 5, total: { requests: -1 } } } };
    fixture.collection = { ...(fixture.collection ?? {}), hermes_logs: "partial", extra: { nested: true } };
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "tu-"));
    const file = join(dir, "summary.json");
    await writeFile(file, JSON.stringify(fixture));
    const prev = process.env.PANTHEON_USAGE_SUMMARY_PATH;
    process.env.PANTHEON_USAGE_SUMMARY_PATH = file;
    try {
      const { readTokenUsage } = await import("../../services/token-usage.js");
      const result = await readTokenUsage("d7");
      expect("available" in result).toBe(false);
      if ("available" in result) return;
      expect(result.providers.length).toBeGreaterThan(0);
      expect(result.partial).toBe(true);
      expect(result.sources.find((s) => s.name === "hermes_logs")?.status).toBe("error");
      const bad = await readTokenUsage("d30");
      expect(bad).toEqual({ available: false, reason: "malformed" });
    } finally {
      if (prev === undefined) delete process.env.PANTHEON_USAGE_SUMMARY_PATH; else process.env.PANTHEON_USAGE_SUMMARY_PATH = prev;
    }
  });
});
