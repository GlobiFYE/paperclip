import { ensurePostgresDatabase, applyPendingMigrations } from "@paperclipai/db";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, companies, companyMemberships, companySecrets, connectionGrants, createDb, environmentLeases,
  heartbeatRuns, issues, toolConnections, toolProfiles, toolProfileBindings } from "@paperclipai/db";
import { toolAccessService } from "../services/tool-access.js";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { DAYTONA_API_URL, daytonaClient } from "../services/daytona.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const external = process.env.PAPERCLIP_TEST_DATABASE_URL;
const support = external ? { supported: true } : await getEmbeddedPostgresTestSupport();
const actor = { actorType: "user" as const, actorId: "daytona-reviewer" };
const credential = "daytona-fixture-secret";
(support.supported ? describe : describe.skip)("Daytona governed diagnostics", () => {
  let db: ReturnType<typeof createDb>;
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => {
    if (external) {
      const url = new URL(external); url.pathname = "/daytona_" + randomUUID().replaceAll("-", "");
      await ensurePostgresDatabase(external, url.pathname.slice(1)); await applyPendingMigrations(url.toString()); db = createDb(url.toString());
    }
    else { temp = await startEmbeddedPostgresTestDatabase("daytona-connector-"); db = createDb(temp.connectionString); }
  }, 30000);
  afterAll(async () => { await db?.$client.end(); await temp?.cleanup(); });
  async function fixture(personal = false) {
    const [company] = await db.insert(companies).values({ name: "Daytona fixture", issuePrefix: `D${randomUUID().slice(0, 6)}` }).returning();
    await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: actor.actorId, membershipRole: "admin", status: "active" });
    const organizationId = randomUUID(), sandboxId = randomUUID();
    const request = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.method).toBe("GET");
      expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${credential}`);
      if (url === `${DAYTONA_API_URL}/api-keys/current`) return Response.json({ organizationId, key: credential });
      if (url === `${DAYTONA_API_URL}/sandbox/${sandboxId}`) return Response.json({ id: sandboxId, organizationId,
        state: "stopped", cpu: 4, memory: 4, disk: 10, env: { TOKEN: credential }, previewToken: "private-preview",
        errorReason: `Cannot reach https://private.example/?token=secret ${credential}` });
      throw new Error("Unexpected provider request");
    });
    const service = toolAccessService(db, { remoteHttpRequest: request, remoteHttpEndpointLookup: async () => [{ address: "8.8.8.8", family: 4 }] });
    const connected = await service.connectGalleryApp(company.id, { galleryKey: "daytona", methodKey: "workspace-diagnostics",
      ...(personal ? { grantKind: "user" as const } : {}), credentialValues: { "credentials.authorization": credential } }, actor);
    const [agent] = await db.insert(agents).values({ companyId: company.id, name: "Maintainer", role: "engineer", adapterType: "process" }).returning();
    await service.finishGalleryAppConnection(company.id, connected.connectionId, { enabledCatalogEntryIds: connected.catalog.map(c => c.id),
      askFirstCatalogEntryIds: [], access: { agentIds: [agent.id] } }, actor);
    const [issue] = await db.insert(issues).values({ companyId: company.id, title: "Workspace recovery", assigneeAgentId: agent.id }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: company.id, agentId: agent.id, issueId: issue.id,
      scopeKind: "issue", invocationSource: "on_demand", status: "running", responsibleUserId: actor.actorId, contextSnapshot: { issueId: issue.id } }).returning();
    const [profile] = await db.insert(toolProfiles).values({ companyId: company.id, profileKey: randomUUID(), name: "Diagnostic reads", defaultAction: "allow" }).returning();
    await db.insert(toolProfileBindings).values({ companyId: company.id, profileId: profile.id, targetType: "agent", targetId: agent.id });
    const [lease] = await db.insert(environmentLeases).values({ companyId: company.id, issueId: issue.id, heartbeatRunId: run.id,
      provider: "daytona", providerLeaseId: sandboxId, status: "released", leasePolicy: "retain_on_failure", cleanupStatus: "success", releasedAt: new Date() }).returning();
    const gateway = createToolGatewayService(db, { remoteHttpRequest: request });
    const session = await gateway.createSession({ companyId: company.id, agentId: agent.id, runId: run.id, issueId: issue.id });
    const tools = await gateway.listToolsForSession(session.token);
    const call = (name: string, parameters: unknown) => {
      const tool = tools.find(t => t.upstreamToolName === name);
      expect(tool, name).toBeTruthy();
      return gateway.executeTool({ sessionToken: session.token, tool: tool!.name, parameters, idempotencyKey: randomUUID() });
    };
    return { company, service, connected, agent, issue, run, lease, request, call, gateway, tools, organizationId };
  }

  it.each([false, true])("vaults the selected identity and executes bounded reads through the gateway (personal=%s)", async personal => {
    const f = await fixture(personal);
    const [grant] = await db.select().from(connectionGrants).where(eq(connectionGrants.connectionId, f.connected.connectionId));
    expect(grant.kind).toBe(personal ? "user" : "organization");
    const [secret] = await db.select().from(companySecrets).where(eq(companySecrets.id, grant.credentialSecretRefs[0].secretId));
    expect(secret.scope).toBe(personal ? "user" : "company");
    expect(secret.ownerUserId).toBe(personal ? actor.actorId : null);
    expect(f.connected.catalog).toHaveLength(4);
    expect(f.connected.catalog.every(c => c.isReadOnly && !c.isWrite && !c.isDestructive)).toBe(true);
    expect(JSON.stringify(await f.service.getConnection(f.connected.connectionId))).not.toContain(credential);
    const identity = JSON.stringify(await f.call("daytona_get_account", {}));
    expect(identity).toContain(f.organizationId);
    expect(identity).not.toContain(credential);
    f.request.mockClear();
    const listing = await f.call("daytona_list_workspaces", {});
    expect(JSON.stringify(listing)).toContain(f.lease.id);
    expect(f.request).not.toHaveBeenCalled();
    const result = JSON.stringify(await f.call("daytona_get_workspace", { leaseId: f.lease.id }));
    expect(result).toContain("stopped");
    expect(result).not.toContain(credential);
    expect(result).not.toContain("private-preview");
    expect(result).not.toContain("private.example");
    expect(result).not.toContain('"env"');
    expect(f.request).toHaveBeenCalledTimes(2);
  });

  it("rejects foreign leases, arbitrary provider IDs and unknown command arguments before provider dispatch", async () => {
    const f = await fixture();
    const [other] = await db.insert(companies).values({ name: "Other tenant", issuePrefix: `O${randomUUID().slice(0, 6)}` }).returning();
    const [lease] = await db.insert(environmentLeases).values({ companyId: other.id, provider: "daytona", providerLeaseId: randomUUID() }).returning();
    f.request.mockClear();
    await expect(f.call("daytona_get_workspace", { leaseId: lease.id })).rejects.toThrow("Workspace not found");
    await expect(f.call("daytona_get_workspace", { leaseId: f.lease.id, command: "printenv" })).rejects.toThrow();
    await expect(f.call("daytona_get_workspace", { sandboxId: f.lease.providerLeaseId })).rejects.toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });

  it("rechecks revocation for an already-created gateway session", async () => {
    const f = await fixture();
    await db.update(toolConnections).set({ enabled: false }).where(and(eq(toolConnections.id, f.connected.connectionId), eq(toolConnections.companyId, f.company.id)));
    f.request.mockClear();
    await expect(f.call("daytona_get_workspace", { leaseId: f.lease.id })).rejects.toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });

  it("reports retained file recovery separately from permission to continue the task", async () => {
    const f = await fixture();
    await db.update(heartbeatRuns).set({ resultJson: { workspaceRestoreFailure: "restore_failed",
      workspaceRestoreRecovery: { schema: "paperclip.workspace-restore-recovery.v1", leaseIds: [f.lease.id] } } }).where(eq(heartbeatRuns.id, f.run.id));
    f.request.mockClear();
    const value = JSON.stringify(await f.call("daytona_get_workspace_recovery", { leaseId: f.lease.id }));
    expect(value).toContain('"fileRecoveryRequired":true');
    expect(value).toContain('"continuationAuthorized":false');
    expect(f.request).not.toHaveBeenCalled();
    // The retained source metadata is audit history after verified copyback.
    await db.update(heartbeatRuns).set({ resultJson: {
      workspaceRestoreRecovery: { schema: "paperclip.workspace-restore-recovery.v1", leaseIds: [f.lease.id] },
      repairedWorkspaceRestoreFailure: "restore_failed",
    } }).where(eq(heartbeatRuns.id, f.run.id));
    expect(JSON.stringify(await f.call("daytona_get_workspace_recovery", { leaseId: f.lease.id })))
      .toContain('"fileRecoveryRequired":false');
  });
});

describe("Daytona diagnostic client", () => {
  it("fails closed on organization mismatch and never forwards provider errors", async () => {
    const request = vi.fn(async () => Response.json({ organizationId: randomUUID() }));
    await expect(daytonaClient({ Authorization: `Bearer ${credential}` }, request, randomUUID()).probe()).rejects.toThrow("configured organization");
    const rejected = vi.fn(async () => new Response(`private ${credential}`, { status: 403 }));
    await expect(daytonaClient({ Authorization: `Bearer ${credential}` }, rejected).probe()).rejects.toThrow("Daytona denied access");
  });
  it("bounds provider output", async () => {
    const request = vi.fn(async () => new Response("x".repeat(1024 * 1024 + 1)));
    await expect(daytonaClient({ Authorization: `Bearer ${credential}` }, request).probe()).rejects.toThrow("exceeded the limit");
  });
  it("does not expose a transport stream error containing a provider credential", async () => {
    const request = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error(`Transport failed with ${credential}`)); },
    })));
    await expect(daytonaClient({ Authorization: `Bearer ${credential}` }, request).probe())
      .rejects.toThrow("Daytona could not complete the diagnostic read");
  });
});
