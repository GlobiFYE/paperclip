import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalAgentJwt, MAX_AGENT_JWT_TTL_SECONDS, resolveAgentJwtTtlSeconds, verifyLocalAgentJwt } from "../agent-auth-jwt.js";
import { agentRunAllowsJwt, AGENT_RUN_TERMINAL_GRACE_MS } from "../agent-run-auth.js";

beforeEach(() => {
  vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "policy-fixture");
  vi.stubEnv("PAPERCLIP_INSTANCE_ID", "default");
  vi.stubEnv("PAPERCLIP_AGENT_JWT_TTL_SECONDS", undefined);
  vi.stubEnv("PAPERCLIP_AGENT_JWT_TTL_BY_ADAPTER", undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("run JWT policy", () => {
  it("mints a unique random jti even for identical claims in the same second", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const tokens = Array.from({ length: 100 }, () => createLocalAgentJwt("a", "c", "codex_local", "r")!);
    expect(new Set(tokens).size).toBe(100);
    const handles = tokens.map((token) => verifyLocalAgentJwt(token)!.jti);
    expect(new Set(handles).size).toBe(100);
    for (const handle of handles) expect(handle).toMatch(/^[a-f0-9-]{36}$/);
  });

  it("preserves 48h compatibility with adapter > global > default precedence", () => {
    expect(resolveAgentJwtTtlSeconds("codex_local")).toBe(172800);
    expect(resolveAgentJwtTtlSeconds("process")).toBe(172800);
    vi.stubEnv("PAPERCLIP_AGENT_JWT_TTL_SECONDS", "7200");
    vi.stubEnv("PAPERCLIP_AGENT_JWT_TTL_BY_ADAPTER", '{"codex_local":172800,"process":600}');
    expect(resolveAgentJwtTtlSeconds("codex_local")).toBe(172800);
    expect(resolveAgentJwtTtlSeconds("process")).toBe(600);
    expect(resolveAgentJwtTtlSeconds("http")).toBe(7200);
    const claims = verifyLocalAgentJwt(createLocalAgentJwt("a", "c", "process", "r")!)!;
    expect(claims.exp - claims.iat).toBe(600);
  });

  it.each(["", "0", "-1", "1.5", "Infinity", "172801", "oops", " 10 "])("rejects malformed global TTL %j", (value) => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_TTL_SECONDS", value);
    expect(() => createLocalAgentJwt("a", "c", "process", "r")).toThrow("integer between");
  });
  it.each(["", "null", "[]", "{", '{"codex_local":0}', '{"process":172801}', '{"process":1.5}', '{"bad name":600}', '{"process":true}'])("rejects malformed adapter map %j", (value) => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_TTL_BY_ADAPTER", value);
    expect(() => resolveAgentJwtTtlSeconds("codex_local")).toThrow();
  });

  it("expires at exp exactly, and does not re-evaluate mint policy on authentication", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    vi.stubEnv("PAPERCLIP_AGENT_JWT_TTL_SECONDS", "60");
    const token = createLocalAgentJwt("a", "c", "process", "r")!;
    vi.stubEnv("PAPERCLIP_AGENT_JWT_TTL_SECONDS", "invalid");
    clock.mockReturnValue(1_800_000_059_999);
    expect(verifyLocalAgentJwt(token)).not.toBeNull();
    clock.mockReturnValue(1_800_000_060_000);
    expect(verifyLocalAgentJwt(token)).toBeNull();
  });

  it.each([
    { jti: "" }, { jti: 5 }, { jti: "x".repeat(129) },
    { iat: 1_800_000_001 }, { exp: 1_800_000_000.5 },
    { exp: 1_800_000_000 + MAX_AGENT_JWT_TTL_SECONDS + 1 },
  ])("rejects invalid signed claims %j", (changes) => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const parts = createLocalAgentJwt("a", "c", "process", "r")!.split(".");
    const claims = { ...JSON.parse(Buffer.from(parts[1], "base64url").toString()), ...changes };
    const input = `${parts[0]}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
    const key = createHmac("sha256", "policy-fixture").update("jwt:default:c").digest("hex");
    expect(verifyLocalAgentJwt(`${input}.${createHmac("sha256", key).update(input).digest("base64url")}`)).toBeNull();
  });
});

describe("terminal grace", () => {
  const finishedAt = new Date("2026-01-01T01:00:00Z");
  const createdAt = new Date("2026-01-01T00:00:00Z");
  it.each(["succeeded", "interrupted", "failed", "cancelled", "timed_out"])("bounds %s by its terminal timestamp", (status) => {
    const run = { status, createdAt, finishedAt };
    const boundary = finishedAt.getTime() + AGENT_RUN_TERMINAL_GRACE_MS;
    expect(agentRunAllowsJwt(run, boundary - 1)).toBe(true);
    expect(agentRunAllowsJwt(run, boundary)).toBe(false);
    expect(agentRunAllowsJwt(run, boundary + 1)).toBe(false);
    expect(agentRunAllowsJwt({ ...run, finishedAt: null }, boundary - 1)).toBe(false);
    expect(agentRunAllowsJwt({ ...run, finishedAt: new Date(NaN) }, boundary - 1)).toBe(false);
    expect(agentRunAllowsJwt({ ...run, finishedAt: new Date(boundary + 1) }, boundary)).toBe(false);
    expect(agentRunAllowsJwt({ ...run, finishedAt: new Date(createdAt.getTime() - 1) }, boundary)).toBe(false);
  });
  it.each(["queued", "scheduled_retry", "running"])("allows suspended %s rows without a sliding activity timeout", (status) => {
    expect(agentRunAllowsJwt({ status, createdAt, finishedAt: null }, finishedAt.getTime() + 48 * 3600_000)).toBe(true);
    expect(agentRunAllowsJwt({ status, createdAt, finishedAt }, finishedAt.getTime())).toBe(false);
  });
  it("rejects missing and unknown runs", () => {
    expect(agentRunAllowsJwt(null)).toBe(false);
    expect(agentRunAllowsJwt({ status: "mystery", createdAt, finishedAt: null })).toBe(false);
  });
});
