import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, companies, authUsers, companyMemberships, principalPermissionGrants, activityLog, heartbeatRuns, createDb } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { pluginAgentInstructions } from "../services/plugin-agent-instructions.js";

describe("user-bound plugin files through native authorization and storage", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let service: ReturnType<typeof pluginAgentInstructions>;
  let home: string;
  const previousHome = process.env.PAPERCLIP_HOME;
  const companyId = randomUUID(), agentId = randomUUID(), userId = randomUUID();
  const context = { invocationScope: { companyId, actionUserId: userId } };
  beforeAll(async () => {
    home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "plugin-instructions-")));
    process.env.PAPERCLIP_HOME = home;
    database = await startEmbeddedPostgresTestDatabase("plugin-instructions-db-");
    db = createDb(database.connectionString);
    service = pluginAgentInstructions(db);
    await db.insert(companies).values({ id: companyId, name: "Plugin fixture", issuePrefix: "PIF" });
    await db.insert(authUsers).values({ id: userId, name: "Editor", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(agents).values({ id: agentId, companyId, name: "Fixture", adapterConfig: { instructionsBundleMode: "managed" } });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "operator" });
    await db.insert(principalPermissionGrants).values({ companyId, principalType: "user", principalId: userId, permissionKey: "agents:configure", scope: { agentIds: [agentId] } });
  }, 90_000);
  afterAll(async () => {
    if (previousHome === undefined) delete process.env.PAPERCLIP_HOME; else process.env.PAPERCLIP_HOME = previousHome;
    await database?.cleanup();
    if (home) await fs.rm(home, { recursive: true, force: true });
  });
  it("writes instructions and supporting text, reads back, rejects stale and cross-company access, and rechecks revoked grants", async () => {
    for (const filePath of ["AGENTS.md", "scripts/helper.py"]) {
      const input = { companyId, agentId, path: filePath };
      const before = await service.read(input, context);
      expect(before.contentHash).toBeNull();
      const saved = await service.write({ ...input, content: "# reviewed fixture\n", baseHash: null }, context);
      const after = await service.read(input, context);
      expect(after.contentHash).toBe(saved.contentHash);
      expect(after.content).toBe("# reviewed fixture\n");
      await expect(service.write({ ...input, content: "stale overwrite", baseHash: null }, context)).rejects.toMatchObject({ status: 409 });
    }
    const other = randomUUID();
    await expect(service.read({ companyId: other, agentId, path: "AGENTS.md" }, { invocationScope: { companyId: other, actionUserId: userId } })).rejects.toMatchObject({ status: 404 });
    await db.update(agents).set({ status: "running" }).where(eq(agents.id, agentId));
    await expect(service.write({ companyId, agentId, path: "AGENTS.md", content: "not while running", baseHash: null }, context)).rejects.toMatchObject({ status: 409 });
    await db.update(agents).set({ status: "idle" }).where(eq(agents.id, agentId));
    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, agentId));
    const [stopping] = await db.insert(heartbeatRuns).values({ companyId, agentId, status: "running" }).returning();
    await expect(service.write({ companyId, agentId, path: "new.txt", content: "not while stopping", baseHash: null }, context)).rejects.toMatchObject({ status: 409 });
    await db.update(heartbeatRuns).set({ status: "cancelled", finishedAt: new Date() }).where(eq(heartbeatRuns.id, stopping.id));
    await db.update(heartbeatRuns).set({ resultJson: { executionCancellation: { state: "requested" } } }).where(eq(heartbeatRuns.id, stopping.id));
    await expect(service.write({ companyId, agentId, path: "new.txt", content: "not before stop receipt", baseHash: null }, context)).rejects.toMatchObject({ status: 409 });
    await db.update(heartbeatRuns).set({ resultJson: { executionCancellation: { state: "acknowledged" } } }).where(eq(heartbeatRuns.id, stopping.id));
    await db.delete(principalPermissionGrants).where(eq(principalPermissionGrants.principalId, userId));
    await expect(service.write({ companyId, agentId, path: "AGENTS.md", content: "unauthorized", baseHash: null }, context)).rejects.toMatchObject({ status: 403 });
    const audit = await db.select().from(activityLog).where(eq(activityLog.entityId, agentId));
    expect(audit.filter(row => row.action === "agent.files_updated")).toHaveLength(2);
    expect(audit.filter(row => row.action === "agent.files_updated").every(row => row.actorId === userId)).toBe(true);
  });
});
