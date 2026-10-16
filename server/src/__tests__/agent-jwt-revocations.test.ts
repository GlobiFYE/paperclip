import { createHash, createHmac, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog, agentApiKeys, agentJwtRevocations, agents, authUsers, boardApiKeys,
  companies, companyMemberships, createDb, heartbeatRuns, instanceUserRoles,
  startEmbeddedPostgresTestDatabase,
} from "@paperclipai/db";
import { createLocalAgentJwt, verifyLocalAgentJwt } from "../agent-auth-jwt.js";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { agentJwtRevocationRoutes } from "../routes/agent-jwt-revocations.js";
import { customerSuccessRunAuthority } from "../services/customer-success-authority.js";
import { cleanupAgentJwtRevocations, revokeAgentJwt } from "../services/agent-jwt-revocations.js";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
describe("persistent run JWT authorization", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let db2: ReturnType<typeof createDb>;
  let companyId: string;
  let agentId: string;
  let runId: string;
  let token: string;
  const userId = `operator-${randomUUID()}`;
  const boardToken = `board-${randomUUID()}`;

  const app = (connection = db, deploymentMode: "authenticated" | "local_trusted" = "authenticated") => {
    const server = express();
    server.use(express.json());
    server.use(actorMiddleware(connection, { deploymentMode }));
    server.get("/actor", (req, res) => res.json(req.actor));
    server.post("/actor", (req, res) => res.json(req.actor));
    server.use("/api", agentJwtRevocationRoutes(connection));
    server.use(errorHandler);
    return server;
  };
  const actor = (credential: string, connection = db, mode: "authenticated" | "local_trusted" = "authenticated") =>
    request(app(connection, mode)).get("/actor").set("Authorization", `Bearer ${credential}`);
  const endpoint = () => `/api/companies/${companyId}/agent-jwt-revocations`;

  beforeAll(async () => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "revocation-fixture");
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "default");
    vi.stubEnv("PAPERCLIP_AGENT_JWT_TTL_SECONDS", "172800");
    vi.stubEnv("PAPERCLIP_AGENT_JWT_TTL_BY_ADAPTER", undefined);
    database = await startEmbeddedPostgresTestDatabase("agent-jwt-revocations-");
    db = createDb(database.connectionString);
    db2 = createDb(database.connectionString);
    await db.insert(authUsers).values({ id: userId, name: "Test operator", email: `${userId}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(instanceUserRoles).values({ userId, role: "instance_admin" });
    await db.insert(boardApiKeys).values({ userId, name: "Test board", keyHash: hash(boardToken) });
  }, 60_000);
  beforeEach(async () => {
    const [company] = await db.insert(companies).values({ name: "JWT fixture", issuePrefix: `T${randomUUID().slice(0, 7)}` }).returning();
    companyId = company.id;
    await db.insert(companyMemberships).values({ companyId, principalId: userId, principalType: "user", status: "active", membershipRole: "owner" });
    const [agent] = await db.insert(agents).values({ companyId, name: "JWT agent", adapterType: "process", status: "active" }).returning();
    agentId = agent.id;
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId, status: "running", createdAt: new Date(Date.now() - 3600_000) }).returning();
    runId = run.id;
    token = createLocalAgentJwt(agentId, companyId, "process", runId)!;
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await database?.cleanup(); vi.unstubAllEnvs(); });

  it("one audited operator write revokes exactly one token on both API instances, including a fresh client", async () => {
    const peer = createLocalAgentJwt(agentId, companyId, "process", runId)!;
    const first = app(db); const second = app(db2);
    expect((await request(first).get("/actor").set("Authorization", `Bearer ${token}`)).body.type).toBe("agent");
    expect((await request(second).get("/actor").set("Authorization", `Bearer ${token}`)).body.type).toBe("agent");
    const handle = `jti:${verifyLocalAgentJwt(token)!.jti}`;
    const revoked = await request(first).post(endpoint()).set("Authorization", `Bearer ${boardToken}`).send({ handle, reason: "fixture compromise" });
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(201);
    expect((await request(first).get("/actor").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    expect((await request(second).get("/actor").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    expect((await actor(token, createDb(database.connectionString))).status).toBe(401);
    expect((await actor(peer, db2)).body.type).toBe("agent");
    const rows = await db.select().from(agentJwtRevocations).where(eq(agentJwtRevocations.companyId, companyId));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.companyId, companyId), eq(activityLog.action, "auth.agent_jwt_revoked")));
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe(userId);
    expect(JSON.stringify(audit)).not.toContain(token);
    const again = await request(first).post(endpoint()).set("Authorization", `Bearer ${boardToken}`).send({ handle, reason: "repeat" });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(revoked.body.id);
    expect(new Date(again.body.expiresAt).getTime()).toBeGreaterThanOrEqual(new Date(revoked.body.expiresAt).getTime());
    const cleanup = await request(first).post(`${endpoint()}/cleanup`).set("Authorization", `Bearer ${boardToken}`);
    expect(cleanup.status).toBe(200);
    expect(cleanup.body).toEqual({ removed: 0 });
    expect((await actor(token, db2)).status).toBe(401);
    await expect(customerSuccessRunAuthority(db, token)).rejects.toThrow("current managed-run credential");
  });

  it("scopes identical handles to company and instance", async () => {
    const [other] = await db.insert(companies).values({ name: "Other", issuePrefix: `O${randomUUID().slice(0, 7)}` }).returning();
    const handle = `jti:${verifyLocalAgentJwt(token)!.jti}`;
    const denied = await request(app()).post(`/api/companies/${other.id}/agent-jwt-revocations`)
      .set("Authorization", `Bearer ${boardToken}`).send({ handle, reason: "no company membership" });
    expect(denied.status).toBe(403);
    await revokeAgentJwt(db, { companyId: other.id, handle, userId, reason: "different company" });
    expect((await actor(token)).body.type).toBe("agent");
    await db.insert(agentJwtRevocations).values({ companyId, instanceId: "other-instance", handle, reason: "different instance", revokedByUserId: userId, expiresAt: new Date(Date.now() + 3600_000) });
    expect((await actor(token)).body.type).toBe("agent");
  });

  it("keeps pre-jti tokens working with valid runs and revokes only the exact token by hash", async () => {
    const parts = token.split(".");
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    delete claims.jti;
    const input = `${parts[0]}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
    const key = createHmac("sha256", "revocation-fixture").update(`jwt:default:${companyId}`).digest("hex");
    const legacy = `${input}.${createHmac("sha256", key).update(input).digest("base64url")}`;
    expect((await actor(legacy)).body.type).toBe("agent");
    await revokeAgentJwt(db, { companyId, handle: `sha256:${hash(legacy)}`, userId, reason: "legacy" });
    expect((await actor(legacy)).status).toBe(401);
    expect((await actor(token)).body.type).toBe("agent");
  });

  it.each(["succeeded", "interrupted", "failed", "cancelled", "timed_out"])("rejects %s without a header at the exact grace boundary", async (status) => {
    const finishedAt = new Date();
    await db.update(heartbeatRuns).set({ status, finishedAt }).where(eq(heartbeatRuns.id, runId));
    const clock = vi.spyOn(Date, "now").mockReturnValue(finishedAt.getTime() + 299_999);
    expect((await actor(token)).body.type).toBe("agent");
    clock.mockReturnValue(finishedAt.getTime() + 300_000);
    expect((await actor(token)).status).toBe(401);
    expect((await actor(token, db2, "local_trusted")).status).toBe(401);
    clock.mockReturnValue(finishedAt.getTime());
    await db.update(heartbeatRuns).set({ finishedAt: null }).where(eq(heartbeatRuns.id, runId));
    expect((await actor(token)).status).toBe(401);
    // Even conversation cancellation cannot grant authentication grace without
    // a terminal timestamp; the local board fallback must remain unavailable.
    await db.update(heartbeatRuns).set({ contextSnapshot: { conversationMode: true } }).where(eq(heartbeatRuns.id, runId));
    const write = await request(app(db2, "local_trusted")).post("/actor").set("Authorization", `Bearer ${token}`);
    expect(write.status).toBe(401);
  });

  it("revocation overrides grace and expired rows remain denied until safe cleanup", async () => {
    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, runId));
    expect((await actor(token)).status).toBe(200);
    const revoked = await revokeAgentJwt(db, { companyId, handle: `jti:${verifyLocalAgentJwt(token)!.jti}`, userId, reason: "grace" });
    expect(revoked.expiresAt.getTime()).toBeGreaterThanOrEqual(verifyLocalAgentJwt(token)!.exp * 1000);
    expect(await cleanupAgentJwtRevocations(db, companyId)).toBe(0);
    expect((await actor(token)).status).toBe(401);
    // A stale expiry never grants authority on the read path.
    await db.update(agentJwtRevocations).set({ expiresAt: new Date(0) }).where(eq(agentJwtRevocations.id, revoked.id));
    expect((await actor(token)).status).toBe(401);
    // Only simulate cleanup once the signed credential is also expired.
    vi.spyOn(Date, "now").mockReturnValue((verifyLocalAgentJwt(token)!.exp + 1) * 1000);
    expect(await cleanupAgentJwtRevocations(db, companyId)).toBe(1);
    expect((await actor(token)).status).toBe(401);
  });

  it("rejects absent, malformed and ownership-mismatched run claims without headers", async () => {
    for (const id of [randomUUID(), "not-a-uuid"]) {
      expect((await actor(createLocalAgentJwt(agentId, companyId, "process", id)!)).status).toBe(401);
    }
    const [peer] = await db.insert(agents).values({ companyId, name: "Peer" }).returning();
    expect((await actor(createLocalAgentJwt(peer.id, companyId, "process", runId)!)).status).toBe(401);
    const [other] = await db.insert(companies).values({ name: "Other run", issuePrefix: `R${randomUUID().slice(0, 7)}` }).returning();
    await db.update(heartbeatRuns).set({ companyId: other.id }).where(eq(heartbeatRuns.id, runId));
    expect((await actor(token)).status).toBe(401);
  });

  it("allows a suspended running row until token exp without an activity deadline", async () => {
    await db.update(heartbeatRuns).set({ lastOutputAt: new Date(Date.now() - 7200_000) }).where(eq(heartbeatRuns.id, runId));
    const expiry = verifyLocalAgentJwt(token)!.exp * 1000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(expiry - 1);
    expect((await actor(token)).body.type).toBe("agent");
    clock.mockReturnValue(expiry);
    expect((await actor(token)).status).toBe(401);
  });

  it("preserves board sessions/keys and CLI/manual DB keys without run rows", async () => {
    expect((await request(app(db, "local_trusted")).get("/actor")).body.type).toBe("board");
    expect((await actor(boardToken)).body.source).toBe("board_key");
    const key = `cli-${randomUUID()}`;
    await db.insert(agentApiKeys).values({ companyId, agentId, name: "local-cli", keyHash: hash(key), responsibleUserId: userId });
    expect((await actor(key)).body).toMatchObject({ type: "agent", source: "agent_key" });
    expect((await actor("invalid", db, "local_trusted")).status).toBe(401);
    const sessionApp = express();
    sessionApp.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async () => ({ user: { id: userId }, session: { id: "session-fixture" } }) as any }));
    sessionApp.get("/actor", (req, res) => res.json(req.actor));
    expect((await request(sessionApp).get("/actor")).body.source).toBe("session");
  });

  it("restricts operator writes and rejects raw-token or expiry fields", async () => {
    const body = { handle: `sha256:${hash(token)}`, reason: "operator action" };
    expect((await request(app()).post(endpoint()).set("Authorization", `Bearer ${token}`).send(body)).status).toBe(403);
    expect((await request(app()).post(endpoint()).set("Authorization", `Bearer ${boardToken}`).send({ ...body, token })).status).toBe(400);
    expect((await request(app()).post(endpoint()).set("Authorization", `Bearer ${boardToken}`).send({ ...body, expiresAt: new Date().toISOString() })).status).toBe(400);
    expect((await db.select().from(agentJwtRevocations).where(eq(agentJwtRevocations.companyId, companyId)))).toHaveLength(0);
  });
});
