import { and, desc, eq, isNotNull } from "drizzle-orm";
import { environmentLeases, heartbeatRuns, issues, type Db } from "@paperclipai/db";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { redactSensitiveText } from "../redaction.js";
import { accessService } from "./access.js";
import { issueReadSqlCondition, type AuthorizationActor } from "./authorization.js";
import { hasRemoteTerminationReceipt } from "./remote-execution-termination.js";
import { hasRequiredWorkspaceRecovery } from "./workspace-restore-recovery-state.js";

export const DAYTONA_API_URL = "https://app.daytona.io/api";
export const DAYTONA_METHOD = "workspace-diagnostics";
const leaseId = z.string().uuid();
const schemas = {
  daytona_get_account: z.object({}).strict(),
  daytona_list_workspaces: z.object({
    issueId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).default(25),
    offset: z.number().int().min(0).max(10000).default(0),
  }).strict(),
  daytona_get_workspace: z.object({ leaseId }).strict(),
  daytona_get_workspace_recovery: z.object({ leaseId }).strict(),
};
type ToolName = keyof typeof schemas;
const descriptions: Record<ToolName, string> = {
  daytona_get_account: "Verify this connection's Daytona organization identity. Returns only its organization ID, never the API key or its raw key record.",
  daytona_list_workspaces: "List this company's Paperclip task workspaces recorded in Daytona, including retained recovery sources. Returns lease IDs for inspection; never lists unrelated Daytona sandboxes.",
  daytona_get_workspace: "Read live Daytona state, resource configuration, and lifecycle errors for one accessible Paperclip workspace lease. Does not start the sandbox or execute commands.",
  daytona_get_workspace_recovery: "Inspect the saved run's workspace-copyback failure and exact stop receipt. File recovery and permission to continue the task are separate; unknown action outcomes do not authorize replay.",
};
export const DAYTONA_TOOLS = Object.entries(schemas).map(([name, schema]) => ({
  name, title: name.replace("daytona_", "").replaceAll("_", " "), description: descriptions[name as ToolName],
  inputSchema: z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, unknown>,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}));

export function isDaytonaConnection(connection: { transport: string; config?: Record<string, unknown> }) {
  return connection.transport === "rest_api" && connection.config?.sourceTemplateKey === "daytona"
    && connection.config.connectionMethodKey === DAYTONA_METHOD && connection.config.url === DAYTONA_API_URL;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const failure = (status: number, code: string, message: string) => new HttpError(status, message, { code });
export type DaytonaRequest = (url: string, init: RequestInit) => Promise<Response>;

/** Fixed read endpoints only. Provider objects never cross the credential boundary wholesale. */
export function daytonaClient(headers: Record<string, string>, request: DaytonaRequest, pinnedOrganizationId?: unknown) {
  const authorization = headers.Authorization;
  if (!authorization || !/^Bearer [^\r\n]+$/.test(authorization)) {
    throw failure(422, "daytona_credential_missing", "Reconnect Daytona to restore its API key.");
  }
  const secret = authorization.slice(7);
  const sanitize = (text: string) => redactSensitiveText(text.split(secret).join("[REDACTED]"))
    .replace(/(?:https?|wss?):\/\/[^\s<>"']+/g, "[private provider address]").slice(0, 2000);
  async function read(path: string): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await request(DAYTONA_API_URL + path, {
        method: "GET", redirect: "error", headers: { Authorization: authorization! }, signal: AbortSignal.timeout(15000),
      });
    } catch { throw failure(502, "daytona_unavailable", "Daytona could not be reached. No workspace operation was performed."); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const status = [401, 403, 404, 429].includes(response.status) ? response.status : 502;
      throw failure(status, "daytona_read_failed", status === 401 || status === 403
        ? "Daytona denied access. Reconnect with a key for the correct organization."
        : status === 404 ? "Daytona no longer has this workspace." : "Daytona could not complete the diagnostic read. Try again later.");
    }
    const reader = response.body?.getReader();
    if (!reader) throw failure(502, "daytona_invalid_response", "Daytona returned an empty response.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 1024 * 1024) throw failure(502, "daytona_output_limit", "Daytona's diagnostic response exceeded the limit.");
        chunks.push(part.value);
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw failure(502, "daytona_unavailable", "Daytona could not complete the diagnostic read. Try again later.");
    } finally { await reader.cancel().catch(() => {}); }
    try { return record(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
    catch { throw failure(502, "daytona_invalid_response", "Daytona returned an invalid diagnostic response."); }
  }
  async function identity() {
    const value = await read("/api-keys/current");
    const organizationId = value.organizationId;
    if (!z.string().uuid().safeParse(organizationId).success ||
      (pinnedOrganizationId && organizationId !== pinnedOrganizationId)) {
      throw failure(403, "daytona_organization_mismatch", "The Daytona key does not identify the configured organization.");
    }
    return { organizationId: organizationId as string };
  }
  return {
    probe: identity,
    async inspect(sandboxId: string) {
      if (!z.string().uuid().safeParse(sandboxId).success) throw failure(422, "daytona_source_invalid", "The saved workspace has no valid Daytona sandbox ID.");
      const account = await identity();
      const value = await read(`/sandbox/${sandboxId}`);
      if (value.id !== sandboxId || value.organizationId !== account.organizationId) {
        throw failure(403, "daytona_workspace_mismatch", "Daytona returned a workspace outside this connection's organization.");
      }
      const safe: Record<string, unknown> = {};
      for (const key of ["id", "name", "state", "desiredState", "createdAt", "updatedAt", "cpu", "gpu", "memory", "disk", "recoverable", "autoStopInterval", "autoArchiveInterval", "autoDeleteInterval", "errorReason"]) {
        const item = value[key];
        if (typeof item === "string") safe[key] = sanitize(item);
        else if (typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) safe[key] = item;
      }
      return safe;
    },
  };
}

type Binding = { companyId: string; agentId: string | null; runId?: string | null; responsibleUserId?: string | null };
type Connection = { companyId: string; config: Record<string, unknown> };
/** Scope comes from host-owned leases and ordinary issue authorization, never provider labels or caller sandbox IDs. */
export async function executeDaytonaTool(input: {
  db: Db; binding: Binding; connection: Connection; headers: Record<string, string>;
  request: DaytonaRequest; toolName: string; parameters: unknown;
}) {
  const { db, binding, connection } = input;
  if (!binding.agentId || connection.companyId !== binding.companyId) throw failure(404, "daytona_workspace_not_found", "Workspace not found.");
  if (!Object.hasOwn(schemas, input.toolName)) throw failure(404, "daytona_tool_not_found", "Daytona action not found.");
  const name = input.toolName as ToolName;
  const parsed = schemas[name].safeParse(input.parameters);
  if (!parsed.success) throw failure(422, "daytona_arguments_invalid", "Invalid Daytona diagnostic arguments.");
  const actor: AuthorizationActor = { type: "agent", companyId: binding.companyId, agentId: binding.agentId,
    runId: binding.runId ?? undefined, onBehalfOfUserId: binding.responsibleUserId };
  if (name === "daytona_get_account") {
    const config = record(connection.config.methodConfig);
    return daytonaClient(input.headers, input.request, config.organizationId).probe();
  }
  const access = accessService(db);
  const visible = await issueReadSqlCondition(db, actor);
  const scope = and(eq(environmentLeases.companyId, binding.companyId), eq(environmentLeases.provider, "daytona"),
    eq(issues.companyId, binding.companyId), isNotNull(environmentLeases.providerLeaseId), visible);
  const project = (lease: typeof environmentLeases.$inferSelect) => ({
    leaseId: lease.id, issueId: lease.issueId, runId: lease.heartbeatRunId, executionWorkspaceId: lease.executionWorkspaceId,
    leaseStatus: lease.status, leasePolicy: lease.leasePolicy, acquiredAt: lease.acquiredAt,
    releasedAt: lease.releasedAt, cleanupStatus: lease.cleanupStatus,
  });
  if (name === "daytona_list_workspaces") {
    const decision = await access.decide({ actor, action: "company_scope:read", resource: { type: "company", companyId: binding.companyId } });
    if (!decision.allowed) throw failure(403, "daytona_scope_denied", "Company-wide workspace discovery is outside this agent's access.");
    const args = parsed.data as z.infer<typeof schemas.daytona_list_workspaces>;
    const rows = await db.select({ lease: environmentLeases }).from(environmentLeases)
      .innerJoin(issues, eq(issues.id, environmentLeases.issueId))
      .where(and(scope, args.issueId ? eq(environmentLeases.issueId, args.issueId) : undefined))
      .orderBy(desc(environmentLeases.acquiredAt), environmentLeases.id).offset(args.offset).limit(args.limit + 1);
    return { items: rows.slice(0, args.limit).map(({ lease }) => project(lease)),
      nextOffset: rows.length > args.limit ? args.offset + args.limit : null };
  }
  const args = parsed.data as { leaseId: string };
  const [row] = await db.select({ lease: environmentLeases, issue: issues }).from(environmentLeases)
    .innerJoin(issues, eq(issues.id, environmentLeases.issueId)).where(and(scope, eq(environmentLeases.id, args.leaseId))).limit(1);
  if (!row) throw failure(404, "daytona_workspace_not_found", "Workspace not found.");
  const decision = await access.decide({ actor, action: "issue:read", resource: { type: "issue", companyId: binding.companyId,
    issueId: row.issue.id, projectId: row.issue.projectId, parentIssueId: row.issue.parentId,
    assigneeAgentId: row.issue.assigneeAgentId, assigneeUserId: row.issue.assigneeUserId } });
  if (!decision.allowed) throw failure(404, "daytona_workspace_not_found", "Workspace not found.");
  if (name === "daytona_get_workspace") {
    const config = record(connection.config.methodConfig);
    return { ...project(row.lease), provider: await daytonaClient(input.headers, input.request, config.organizationId).inspect(row.lease.providerLeaseId!) };
  }
  const [run] = row.lease.heartbeatRunId ? await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, binding.companyId), eq(heartbeatRuns.id, row.lease.heartbeatRunId),
  )).limit(1) : [];
  return { ...project(row.lease), taskStatus: row.issue.status,
    runStatus: run?.status ?? null, errorCode: run?.errorCode ?? null,
    workspaceRestoreFailure: run?.resultJson?.workspaceRestoreFailure ?? null,
    fileRecoveryRequired: hasRequiredWorkspaceRecovery(run?.resultJson),
    stopConfirmed: hasRemoteTerminationReceipt(row.lease),
    continuationAuthorized: false,
  };
}
