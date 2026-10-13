import express from "express";
import request from "supertest";
import { publicMcpIngressRoutes } from "../routes/public-mcp.js";
import { createPublicMcpExecutor } from "../services/public-mcp/capabilities.js";
import { createDotRunnerMcpTools } from "../services/dot-runner-broker.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, dotAgentBindings, grokBotDispatches,
  grokBotRoutines, mcpOauthGrants, activityLog } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { accessService } from "../services/access.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { createPublicMcpOAuth } from "../services/public-mcp/oauth.js";
import { dotRunnerBroker } from "../services/dot-runner-broker.js";
import { grokRoutineService } from "../services/grok-bot/routine.js";
import { type GrokRoutineWake } from "../services/grok-bot/webhook.js";

let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
beforeAll(async () => {
  temporary = await startEmbeddedPostgresTestDatabase("paperclip-grok-routine-");
  db = createDb(temporary.connectionString);
  vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", randomBytes(32).toString("base64"));
  await instanceSettingsService(db).updateExperimental({ enablePublicMcp: true, enableNativeRunner: true, enableGrokBot: true, enableOpenAiDot: true });
}, 120000);
afterAll(async () => { try { await temporary?.cleanup(); } finally { vi.unstubAllEnvs(); } });

async function fixture() {
  const userId = randomUUID();
  await db.insert(authUsers).values({ id: userId, name: "Grok operator", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
  const [company] = await db.insert(companies).values({ name: "Grok test", issuePrefix: "GK" + randomBytes(3).toString("hex") }).returning();
  await db.insert(companyMemberships).values({ companyId: company!.id, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
  await accessService(db).setPrincipalPermission(company!.id, "user", userId, "agents:create", true, userId);
  const [agent] = await db.insert(agents).values({ companyId: company!.id, name: "Grok test", adapterType: "paperclip_runner", status: "active", adapterConfig: { provider: "grok_bot", allowUnmeteredProvider: true, lifecycleMode: "per_turn" } }).returning();
  const oauth = createPublicMcpOAuth(db, { origin: "https://paperclip.example", resource: "https://paperclip.example/mcp/runner" });
  const client = await oauth.register({ client_name: "Synthetic Grok client", redirect_uris: ["https://client.example/callback"] }, randomUUID());
  const verifier = randomBytes(32).toString("base64url");
  const input = { client_id: client.client_id, redirect_uri: "https://client.example/callback", response_type: "code", resource: oauth.config.resource,
    scope: "paperclip:agent offline_access", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" };
  const requestId = (await oauth.authorize(input)).split("/").at(-1)!;
  const pairing = await dotRunnerBroker(db).createPairing({ companyId: company!.id, agentId: agent!.id, operatorId: userId, provider: "grok_bot" });
  const consent = await oauth.consentDotPairing(requestId, pairing.pairingCode);
  const tokens = await oauth.token({ grant_type: "authorization_code", client_id: client.client_id, redirect_uri: input.redirect_uri,
    resource: oauth.config.resource, code: new URL(consent.redirectUrl).searchParams.get("code"), code_verifier: verifier });
  const principal = await oauth.authenticate(tokens.access_token);
  const delivery = vi.fn().mockResolvedValue({ delivery: "accepted", httpStatus: 200 });
  const service = grokRoutineService(db, delivery);
  const config = { companyId: company!.id, agentId: agent!.id, bindingId: pairing.bindingId, operatorId: userId,
    expectedRevision: 0, botName: "Synthetic Bot", webhookUrl: "https://bot.example.test/routines/synthetic", webhookKey: "synthetic-sender-key" };
  await service.configure(config);
  return { company: company!, agent: agent!, principal, pairing, service, delivery, config, oauth, tokens };
}
async function verification(f: Awaited<ReturnType<typeof fixture>>, sourceEventId = randomUUID()) {
  return f.service.reserve({ companyId: f.company.id, agentId: f.agent.id, bindingId: f.pairing.bindingId, sourceEventId, kind: "verify" });
}
function acknowledgement(row: Awaited<ReturnType<typeof verification>>) {
  const wake = row.payload as GrokRoutineWake & { challenge: string };
  return { correlationId: row.id, bindingId: row.bindingId, bindingGeneration: row.bindingGeneration, challenge: wake.challenge };
}

describe("durable Grok routine qualification", () => {
  it("receives an authenticated Grok acknowledgement through the actual MCP transport without exposing personal or Dot event tools", async () => {
    const f = await fixture(); const row = await verification(f);
    await f.service.send(f.company.id, f.agent.id, row.id);
    const app = express(); app.use(express.json());
    const dispatch = async () => { throw new Error("Personal dispatch forbidden"); };
    app.use(publicMcpIngressRoutes(f.oauth, createPublicMcpExecutor(db, f.oauth, dispatch), undefined, createDotRunnerMcpTools(db)));
    const invoke = (method: string, params: unknown) => request(app).post("/mcp/runner")
      .set("Authorization", `Bearer ${f.tokens.access_token}`).set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method, params });
    const list = await invoke("tools/list", {});
    expect(list.status).toBe(200);
    const names = list.body.result.tools.map((tool: {name: string}) => tool.name);
    expect(names).toContain("paperclip_grok_ack_wake");
    expect(names).not.toContain("paperclip_dot_confirm_event");
    expect(names).not.toContain("paperclip_call_api");
    const reply = await invoke("tools/call", { name: "paperclip_grok_ack_wake", arguments: acknowledgement(row) });
    expect(reply.status).toBe(200);
    expect(reply.body.result.structuredContent).toMatchObject({ outcome: "completed", result: { status: "acknowledged" } });
    expect(await f.service.state(f.company.id, f.agent.id, row.bindingId)).toMatchObject({ verified: true });
  });

  it("rejects acknowledgement after the authorizing person loses permission to manage the agent", async () => {
    const f = await fixture(); const row = await verification(f);
    await f.service.send(f.company.id, f.agent.id, row.id);
    await accessService(db).setPrincipalPermission(f.company.id, "user", f.principal.grant.userId, "agents:create", false, f.principal.grant.userId);
    await expect(f.service.acknowledge(f.principal, acknowledgement(row))).rejects.toThrow("permission");
  });

  it("keeps HTTP delivery and authenticated reply separate, with auditable agent and authorizer", async () => {
    const f = await fixture();
    const row = await verification(f);
    await f.service.send(f.company.id, f.agent.id, row.id);
    expect(await f.service.state(f.company.id, f.agent.id, row.bindingId)).toMatchObject({ verified: false, lastExchange: { status: "accepted", httpStatus: 200, acknowledgedAt: null } });
    expect((await db.select().from(dotAgentBindings).where(eq(dotAgentBindings.id, row.bindingId)))[0]!.status).toBe("connected");
    await f.service.acknowledge(f.principal, acknowledgement(row));
    expect(await f.service.state(f.company.id, f.agent.id, row.bindingId)).toMatchObject({ verified: true, recoveryNeeded: false, lastExchange: { status: "acknowledged" } });
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.company.id), eq(activityLog.action, "grok.wake_verified")));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: "agent", actorId: f.agent.id, details: { authorizingPersonId: f.principal.grant.userId, correlationId: row.id } });
    expect(JSON.stringify(await f.service.state(f.company.id, f.agent.id, row.bindingId))).not.toContain("synthetic-sender-key");
  });

  it("reserves once across concurrent attempts and never resends accepted work after a new controller starts", async () => {
    const f = await fixture(), source = randomUUID();
    const rows = await Promise.all([1, 2, 3].map(() => verification(f, source)));
    expect(new Set(rows.map(r => r.id)).size).toBe(1);
    await Promise.all(rows.map(r => f.service.send(f.company.id, f.agent.id, r.id)));
    const restarted = grokRoutineService(db, f.delivery);
    await restarted.send(f.company.id, f.agent.id, rows[0]!.id);
    expect(f.delivery).toHaveBeenCalledTimes(1);
    await expect(verification(f)).rejects.toThrow("outstanding delivery");
  });

  it("reconciles a lost HTTP response with the same authenticated challenge without retrying", async () => {
    const f = await fixture(); f.delivery.mockResolvedValue({ delivery: "unknown", httpStatus: null });
    const row = await verification(f);
    await f.service.send(f.company.id, f.agent.id, row.id);
    expect(await f.service.state(f.company.id, f.agent.id, row.bindingId)).toMatchObject({ recoveryNeeded: true, verified: false });
    await f.service.acknowledge(f.principal, acknowledgement(row));
    await f.service.acknowledge(f.principal, acknowledgement(row));
    expect(f.delivery).toHaveBeenCalledTimes(1);
    expect(await f.service.state(f.company.id, f.agent.id, row.bindingId)).toMatchObject({ recoveryNeeded: false, verified: true });
  });

  it("does not downgrade an authenticated acknowledgement when an ambiguous transport response arrives later", async () => {
    const f = await fixture(); const row = await verification(f);
    f.delivery.mockImplementation(async () => { await f.service.acknowledge(f.principal, acknowledgement(row)); return { delivery: "unknown", httpStatus: 504 }; });
    await f.service.send(f.company.id, f.agent.id, row.id);
    expect(await f.service.state(f.company.id, f.agent.id, row.bindingId)).toMatchObject({ recoveryNeeded: false, verified: true, lastExchange: { status: "acknowledged" } });
  });

  it("keeps crashed sending intents in recovery and prevents credential replacement while delivery is uncertain", async () => {
    const f = await fixture(); const row = await verification(f);
    await db.update(grokBotDispatches).set({ status: "sending", sentAt: new Date(Date.now() - 60000), updatedAt: new Date(Date.now() - 60000) }).where(eq(grokBotDispatches.id, row.id));
    await f.service.send(f.company.id, f.agent.id, row.id);
    expect(f.delivery).not.toHaveBeenCalled();
    expect(await f.service.state(f.company.id, f.agent.id, row.bindingId)).toMatchObject({ recoveryNeeded: true });
    await expect(f.service.configure({ ...f.config, expectedRevision: 1 })).rejects.toThrow("recover");
  });

  it.each(["wrong nonce", "wrong binding", "wrong generation", "expired", "revoked", "personal grant", "other company"])("rejects %s without readiness or accepted late results", async condition => {
    const f = await fixture(); const other = await fixture(); const row = await verification(f);
    await f.service.send(f.company.id, f.agent.id, row.id);
    const ack = acknowledgement(row);
    let principal = f.principal;
    if (condition === "wrong nonce") ack.challenge = "a-different-nonce-long-enough";
    if (condition === "wrong binding") ack.bindingId = other.pairing.bindingId;
    if (condition === "wrong generation") ack.bindingGeneration++;
    if (condition === "expired") await db.update(grokBotDispatches).set({ expiresAt: new Date(0) }).where(eq(grokBotDispatches.id, row.id));
    if (condition === "revoked") await db.update(mcpOauthGrants).set({ revokedAt: new Date() }).where(eq(mcpOauthGrants.id, f.principal.grant.id));
    if (condition === "personal grant") principal = { ...f.principal, grant: { ...f.principal.grant, purpose: "personal" } };
    if (condition === "other company") principal = other.principal;
    await expect(f.service.acknowledge(principal, ack)).rejects.toThrow();
    expect(await f.service.state(f.company.id, f.agent.id, row.bindingId)).toMatchObject({ verified: false });
  });

  it("stores URL and key together encrypted and rejects stale, foreign or unauthorized configuration", async () => {
    const f = await fixture();
    const [stored] = await db.select().from(grokBotRoutines).where(eq(grokBotRoutines.bindingId, f.pairing.bindingId));
    expect(JSON.stringify(stored)).not.toContain(f.config.webhookKey);
    await expect(f.service.configure({ ...f.config, expectedRevision: 0 })).rejects.toThrow("changed");
    await expect(f.service.configure({ ...f.config, expectedRevision: 1, operatorId: randomUUID() })).rejects.toThrow("permission");
    await expect(f.service.configure({ ...f.config, expectedRevision: 1, companyId: randomUUID() })).rejects.toThrow();
    await expect(f.service.configure({ ...f.config, expectedRevision: 1, webhookUrl: "https://user:password@bot.example.test/routine" })).rejects.toThrow("Invalid");
  });
  it("holds uncertainty across disconnect and requires inspection plus a fresh verification", async () => {
    const f = await fixture(); const row = await verification(f);
    f.delivery.mockResolvedValue({ delivery: "unknown", httpStatus: 504 });
    await f.service.send(f.company.id, f.agent.id, row.id);
    await f.service.recover(f.company.id, f.agent.id, f.principal.grant.userId);
    expect(await f.service.state(f.company.id, f.agent.id, row.bindingId)).toMatchObject({ verified: false, recoveryNeeded: false });
    await expect(f.service.acknowledge(f.principal, acknowledgement(row))).rejects.toThrow("cancelled");
    const next = await verification(f);
    expect(next.id).not.toBe(row.id);
    f.delivery.mockResolvedValue({ delivery: "accepted", httpStatus: 200 });
    await f.service.send(f.company.id, f.agent.id, next.id);
    await f.service.acknowledge(f.principal, acknowledgement(next));
    expect(await f.service.state(f.company.id, f.agent.id, row.bindingId)).toMatchObject({ verified: true });
  });
  it("keeps a revoked binding's unknown activity from being bypassed by reconnecting", async () => {
    const f = await fixture(); const row = await verification(f);
    f.delivery.mockResolvedValue({ delivery: "unknown", httpStatus: null });
    await f.service.send(f.company.id, f.agent.id, row.id);
    await dotRunnerBroker(db).revoke(f.company.id, f.agent.id, f.principal.grant.userId);
    expect(await f.service.recoveryNeeded(f.company.id, f.agent.id)).toBe(true);
    await f.service.recover(f.company.id, f.agent.id, f.principal.grant.userId);
    expect(await f.service.recoveryNeeded(f.company.id, f.agent.id)).toBe(false);
  });

});
