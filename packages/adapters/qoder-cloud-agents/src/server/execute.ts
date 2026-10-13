import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AdapterExecutionContext, AdapterExecutionResult, AdapterInvocationMeta } from "@paperclipai/adapter-utils";
import {
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE,
  asNumber,
  asString,
  buildPaperclipEnv,
  isForbiddenConfigEnvKey,
  joinPromptSections,
  parseObject,
  readPaperclipIssueWorkModeFromContext,
  hydrateFreshSessionHandoff,
  selectPaperclipPromptSections,
  selectInitialCommunicationGuidance,
  isPaperclipRecoveryWakePayload,
  renderTemplate,
} from "@paperclipai/adapter-utils/server-utils";
import { DEFAULT_QODER_API_BASE_URL, DEFAULT_QODER_CLOUD_AGENTS_MODEL } from "../index.js";
import {
  QoderApiError,
  createQoderClient,
  normalizeQoderApiBaseUrl,
  type QoderClient,
  type QoderFetch,
  type QoderRecord,
} from "./client.js";

export type QoderCloudAgentsExecuteDeps = {
  fetchImpl?: QoderFetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

type QoderCloudAgentsSession = {
  qoderSessionId: string;
  qoderAgentId: string;
  managedAgent: boolean;
  environmentId: string;
  apiBaseUrl: string;
  model?: string;
  repoUrl?: string;
  repoRef?: string;
  repoMountPath?: string;
  envFingerprint: string;
};

type QoderRepo = { url: string; ref: string | null; mountPath: string };

type TurnOutcome = {
  kind: "idle" | "terminated";
  stopReason: string | null;
  lastMessage: string | null;
  lastError: string | null;
  /** True when the pending action is a tool call Qoder already allowed, so only a worker can answer it. */
  awaitingToolWorker: boolean;
};

const ADAPTER_TYPE = "qoder_cloud_agents";
const MANAGED_AGENT_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch"];
const RESERVED_SESSION_ENV_NAMES = new Set(["SERVER_ENDPOINT", "USER_ID", "WORK_DIR"]);
const RESERVED_SESSION_ENV_PREFIXES = ["CAW_", "QODER_"];
const SESSION_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SESSION_ENV_MAX_ENTRIES = 64;
const SESSION_ENV_MAX_VALUE_BYTES = 8 * 1024;
const SESSION_ENV_MAX_TOTAL_BYTES = 64 * 1024;
const BUSY_SESSION_STATUSES = new Set(["running", "rescheduling"]);
const IDLE_POLL_INTERVAL_MS = 3_000;
const MAX_STREAM_RECONNECTS = 5;
const STREAM_RECONNECT_BASE_DELAY_MS = 1_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringEnvMap(value: unknown): Record<string, string> {
  const parsed = parseObject(value);
  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (isForbiddenConfigEnvKey(key)) continue;
    if (typeof entry === "string") {
      env[key] = entry;
    } else if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      const rec = entry as Record<string, unknown>;
      if (rec.type === "plain" && typeof rec.value === "string") env[key] = rec.value;
    }
  }
  return env;
}

function trimNullable(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function formatRunError(err: unknown): string {
  if (err instanceof Error && err.message.trim().length > 0) return err.message.trim();
  return String(err);
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && entry?.type === "text")
    .map((entry) => asString(entry.text, ""))
    .join("\n")
    .trim();
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Qoder fixes session env vars at creation, so only values that stay stable
 * across heartbeats belong here; run-scoped values travel in the prompt.
 *
 * The resolved config env also carries variables Paperclip injects for a local
 * child process (TMPDIR, scratch dirs, SSH_AUTH_SOCK, host paths). Those are
 * meaningless in a remote container and change every run, so only the keys the
 * operator saved on the agent are forwarded.
 */
export function buildSessionEnv(
  ctx: AdapterExecutionContext,
  configEnv: Record<string, string>,
): { env: Record<string, string>; dropped: string[] } {
  const operatorKeys = new Set(Object.keys(parseObject(parseObject(ctx.agent.adapterConfig).env)));
  const candidate: Record<string, string> = {
    ...Object.fromEntries(Object.entries(configEnv).filter(([key]) => operatorKeys.has(key))),
    ...buildPaperclipEnv(ctx.agent),
  };
  // No Paperclip run token reaches Qoder (registry: supportsLocalAgentJwt=false),
  // so drop the callback wiring instead of pointing the agent at an API it
  // cannot authenticate against.
  delete candidate.PAPERCLIP_API_KEY;
  delete candidate.PAPERCLIP_API_URL;
  delete candidate.PAPERCLIP_API_BRIDGE_MODE;
  delete candidate.PAPERCLIP_WAKE_PAYLOAD_JSON;

  const env: Record<string, string> = {};
  const dropped: string[] = [];
  let totalBytes = 0;
  for (const key of Object.keys(candidate).sort()) {
    const value = candidate[key];
    // Qoder credentials are adapter inputs, not session env.
    if (RESERVED_SESSION_ENV_PREFIXES.some((prefix) => key.toUpperCase().startsWith(prefix))) continue;
    if (value.length === 0) continue;
    const valueBytes = Buffer.byteLength(value, "utf8");
    const entryBytes = Buffer.byteLength(key, "utf8") + valueBytes;
    if (
      !SESSION_ENV_NAME_PATTERN.test(key) ||
      RESERVED_SESSION_ENV_NAMES.has(key) ||
      valueBytes > SESSION_ENV_MAX_VALUE_BYTES ||
      Object.keys(env).length >= SESSION_ENV_MAX_ENTRIES ||
      totalBytes + entryBytes > SESSION_ENV_MAX_TOTAL_BYTES
    ) {
      dropped.push(key);
      continue;
    }
    env[key] = value;
    totalBytes += entryBytes;
  }
  return { env, dropped };
}

function fingerprintEnv(env: Record<string, string>): string {
  const entries = Object.keys(env).sort().map((key) => [key, env[key]]);
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

function buildRunContextNote(ctx: AdapterExecutionContext, sessionEnv: Record<string, string>, repo: QoderRepo | null): string {
  const { runId, context } = ctx;
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const runValues: Array<[string, string | null]> = [
    ["PAPERCLIP_RUN_ID", runId],
    ["PAPERCLIP_TASK_ID", trimNullable(context.taskId) ?? trimNullable(context.issueId)],
    ["PAPERCLIP_WAKE_REASON", trimNullable(context.wakeReason)],
    ["PAPERCLIP_WAKE_COMMENT_ID", trimNullable(context.wakeCommentId) ?? trimNullable(context.commentId)],
    ["PAPERCLIP_APPROVAL_ID", trimNullable(context.approvalId)],
    ["PAPERCLIP_APPROVAL_STATUS", trimNullable(context.approvalStatus)],
    ["PAPERCLIP_LINKED_ISSUE_IDS", linkedIssueIds.length > 0 ? linkedIssueIds.join(",") : null],
    ["PAPERCLIP_ISSUE_WORK_MODE", readPaperclipIssueWorkModeFromContext(context)],
  ];
  const lines = [
    "Paperclip runtime note:",
    "Values for this run (not set in the shell, because Qoder fixes session env vars at session creation):",
    ...runValues.filter(([, value]) => value).map(([key, value]) => `- ${key}=${value}`),
  ];
  const envKeys = Object.keys(sessionEnv).filter((key) => key.startsWith("PAPERCLIP_")).sort();
  if (envKeys.length > 0) {
    lines.push(`These PAPERCLIP_* environment variables are set in the session shell: ${envKeys.join(", ")}`);
  }
  if (repo) {
    lines.push(
      `Repository ${repo.url} is cloned at ${repo.mountPath}. Run git commands there.`,
      "Container storage is temporary: commit and push any work that must survive this session.",
    );
  }
  return lines.join("\n");
}

async function buildInstructionsPrefix(
  config: Record<string, unknown>,
  onLog: AdapterExecutionContext["onLog"],
): Promise<{ prefix: string; notes: string[]; chars: number }> {
  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  if (!instructionsFilePath) {
    return { prefix: "", notes: [], chars: 0 };
  }

  try {
    const contents = await fs.readFile(instructionsFilePath, "utf8");
    const instructionsDir = `${path.dirname(instructionsFilePath)}/`;
    const prefix = `${contents.trim()}\n\nThe above agent instructions were loaded from ${instructionsFilePath}. Resolve any relative file references from ${instructionsDir}.\n`;
    return {
      prefix,
      chars: prefix.length,
      notes: [
        `Loaded agent instructions from ${instructionsFilePath}`,
        `Prepended instructions + path directive to prompt (relative references from ${instructionsDir}).`,
      ],
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await onLog(
      "stderr",
      `[paperclip] Warning: could not read agent instructions file "${instructionsFilePath}": ${reason}\n`,
    );
    return {
      prefix: "",
      chars: 0,
      notes: [
        `Configured instructionsFilePath ${instructionsFilePath}, but file could not be read; continuing without injected instructions.`,
      ],
    };
  }
}

function readSession(params: Record<string, unknown> | null): QoderCloudAgentsSession | null {
  const record = asRecord(params);
  if (!record) return null;
  const qoderSessionId = trimNullable(record.qoderSessionId) ?? trimNullable(record.sessionId);
  const qoderAgentId = trimNullable(record.qoderAgentId);
  const environmentId = trimNullable(record.environmentId);
  const apiBaseUrl = trimNullable(record.apiBaseUrl);
  const envFingerprint = trimNullable(record.envFingerprint);
  if (!qoderSessionId || !qoderAgentId || !environmentId || !apiBaseUrl || !envFingerprint) return null;
  const model = trimNullable(record.model);
  const repoUrl = trimNullable(record.repoUrl);
  const repoRef = trimNullable(record.repoRef);
  const repoMountPath = trimNullable(record.repoMountPath);
  return {
    qoderSessionId,
    qoderAgentId,
    managedAgent: record.managedAgent === true,
    environmentId,
    apiBaseUrl,
    ...(model ? { model } : {}),
    ...(repoUrl ? { repoUrl } : {}),
    ...(repoRef ? { repoRef } : {}),
    ...(repoMountPath ? { repoMountPath } : {}),
    envFingerprint,
  };
}

function sessionMatches(
  session: QoderCloudAgentsSession | null,
  expected: {
    apiBaseUrl: string;
    configuredAgentId: string | null;
    configuredEnvironmentId: string | null;
    model: string;
    repo: QoderRepo | null;
    envFingerprint: string;
  },
): boolean {
  if (!session) return false;
  if (session.apiBaseUrl !== expected.apiBaseUrl) return false;
  if (session.envFingerprint !== expected.envFingerprint) return false;
  if (expected.configuredAgentId) {
    if (session.qoderAgentId !== expected.configuredAgentId) return false;
  } else {
    // A Qoder session pins its agent snapshot, so a model change needs a new session.
    if (!session.managedAgent || session.model !== expected.model) return false;
  }
  if (expected.configuredEnvironmentId && session.environmentId !== expected.configuredEnvironmentId) return false;
  return (session.repoUrl ?? null) === (expected.repo?.url ?? null)
    && (session.repoRef ?? null) === (expected.repo?.ref ?? null)
    && (session.repoMountPath ?? null) === (expected.repo?.mountPath ?? null);
}

function parseRepoUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function defaultMountPath(url: URL): string {
  const name = url.pathname.split("/").filter(Boolean).pop()?.replace(/\.git$/i, "") || "repo";
  return `/data/workspace/${name}`;
}

function buildRepoResource(repo: QoderRepo, token: string | null): QoderRecord {
  const isGitHub = new URL(repo.url).hostname.toLowerCase() === "github.com";
  return {
    type: isGitHub ? "github_repository" : "git_repository",
    url: repo.url,
    mount_path: repo.mountPath,
    ...(repo.ref ? { checkout: { type: "branch", name: repo.ref } } : {}),
    ...(token ? (isGitHub ? { authorization_token: token } : { password: token }) : {}),
  };
}

function readModelId(value: unknown): string | null {
  return trimNullable(value) ?? trimNullable(asRecord(value)?.id);
}

async function resolveEnvironmentId(client: QoderClient, configured: string | null): Promise<string> {
  if (configured) return configured;
  // A self_hosted environment needs an external worker to return tool results,
  // so only a Qoder-hosted one is a safe default.
  const existing = (await client.listEnvironments())
    .filter((entry) => !entry.archived_at && asRecord(entry.config)?.type === "cloud")
    .map((entry) => trimNullable(entry.id))
    .find((id): id is string => Boolean(id));
  if (existing) return existing;
  const created = trimNullable((await client.createEnvironment({ name: "default" })).id);
  if (!created) throw new Error("Qoder did not return an environment ID.");
  return created;
}

async function resolveManagedAgentId(
  client: QoderClient,
  agent: AdapterExecutionContext["agent"],
  model: string,
): Promise<string> {
  const metadata = {
    managed_by: "paperclip",
    paperclip_agent_id: agent.id,
    paperclip_company_id: agent.companyId,
  };
  let existing: QoderRecord | null = null;
  try {
    existing = (await client.searchAgents({ managed_by: "paperclip", paperclip_agent_id: agent.id }))
      .find((entry) => trimNullable(entry.id) && !entry.archived_at) ?? null;
  } catch (err) {
    // Search is a beta endpoint; an auth failure will also fail the create below.
    if (err instanceof QoderApiError && err.status === 401) throw err;
  }
  const existingId = trimNullable(existing?.id);
  if (existing && existingId) {
    if (readModelId(existing.model) !== model && typeof existing.version === "number") {
      await client.updateAgent(existingId, { version: existing.version, model });
    }
    return existingId;
  }
  const created = trimNullable((await client.createAgent({
    name: `Paperclip ${agent.name}`.slice(0, 256),
    model,
    system: `You are ${agent.name}, an agent managed by Paperclip. Follow the instructions in each message.`,
    tools: [{
      type: "agent_toolset_20260401",
      enabled_tools: MANAGED_AGENT_TOOLS,
      configs: MANAGED_AGENT_TOOLS.map((name) => ({ name, permission_policy: { type: "always_allow" } })),
    }],
    metadata,
  })).id);
  if (!created) throw new Error("Qoder did not return an agent ID.");
  return created;
}

function eventLine(event: Record<string, unknown>): string {
  return `${JSON.stringify(event)}\n`;
}

async function emitStatus(onLog: AdapterExecutionContext["onLog"], status: string, message?: string) {
  await onLog("stdout", eventLine({ type: "qoder_cloud_agents.status", status, ...(message ? { message } : {}) }));
}

/** Null means the stored session can no longer be used and a fresh one is needed. */
async function probeSession(client: QoderClient, sessionId: string): Promise<string | null> {
  try {
    const session = await client.getSession(sessionId);
    const status = trimNullable(session.status);
    if (!status || status === "terminated" || session.archived_at) return null;
    return status;
  } catch (err) {
    if (err instanceof QoderApiError && err.status === 404) return null;
    throw err;
  }
}

async function waitForIdle(
  client: QoderClient,
  sessionId: string,
  sleep: NonNullable<QoderCloudAgentsExecuteDeps["sleep"]>,
  signal: AbortSignal,
): Promise<void> {
  for (;;) {
    const status = trimNullable((await client.getSession(sessionId)).status);
    if (!status || !BUSY_SESSION_STATUSES.has(status)) return;
    await sleep(IDLE_POLL_INTERVAL_MS, signal);
  }
}

function pendingEventIds(event: QoderRecord): string[] {
  const ids = asRecord(event.stop_reason)?.event_ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

function readTerminalEvent(event: QoderRecord): Pick<TurnOutcome, "kind" | "stopReason"> | null {
  const type = asString(event.type, "");
  if (type === "session.status_idle") {
    return { kind: "idle", stopReason: trimNullable(asRecord(event.stop_reason)?.type) };
  }
  if (type === "session.status_terminated" || type === "session.deleted") {
    return { kind: "terminated", stopReason: type };
  }
  return null;
}

async function streamTurn(input: {
  client: QoderClient;
  sessionId: string;
  cursor: string | null;
  onLog: AdapterExecutionContext["onLog"];
  sleep: NonNullable<QoderCloudAgentsExecuteDeps["sleep"]>;
  signal: AbortSignal;
}): Promise<TurnOutcome> {
  const { client, sessionId, onLog, sleep, signal } = input;
  let cursor = input.cursor;
  let lastMessage: string | null = null;
  let lastError: string | null = null;
  let reconnects = 0;
  const allowedToolUseIds = new Set<string>();
  const outcome = (terminal: Pick<TurnOutcome, "kind" | "stopReason">, event: QoderRecord): TurnOutcome => {
    const pending = pendingEventIds(event);
    return {
      ...terminal,
      lastMessage,
      lastError,
      awaitingToolWorker: terminal.stopReason === "requires_action"
        && pending.length > 0
        && pending.every((id) => allowedToolUseIds.has(id)),
    };
  };

  for (;;) {
    let streamFailure: string | null = null;
    try {
      for await (const frame of client.streamEvents(sessionId, cursor)) {
        if (frame.id) cursor = frame.id;
        if (!frame.data) continue;
        let event: QoderRecord | null = null;
        try {
          event = asRecord(JSON.parse(frame.data));
        } catch {
          event = null;
        }
        const type = asString(event?.type, "");
        // Delta frames are stream-only previews of a buffered event that follows.
        if (!event || !type || type === "event_start" || type === "event_delta") continue;
        reconnects = 0;
        await onLog("stdout", eventLine({ type: "qoder_cloud_agents.event", event }));
        if (type === "agent.message") {
          lastMessage = contentText(event.content) || lastMessage;
        } else if ((type === "agent.tool_use" || type === "agent.mcp_tool_use") && event.evaluated_permission === "allow") {
          const id = trimNullable(event.id);
          if (id) allowedToolUseIds.add(id);
        } else if (type === "session.error") {
          const error = asRecord(event.error);
          if (asRecord(error?.retry_status)?.type !== "retrying") {
            lastError = trimNullable(error?.message) ?? trimNullable(error?.type) ?? "Qoder session error";
          }
        }
        const terminal = readTerminalEvent(event);
        if (terminal) return outcome(terminal, event);
      }
    } catch (err) {
      if (signal.aborted) throw err;
      // A stale token will not recover by reconnecting.
      if (err instanceof QoderApiError && (err.status === 401 || err.status === 403 || err.status === 404)) throw err;
      streamFailure = formatRunError(err);
    }

    signal.throwIfAborted();
    reconnects += 1;
    if (reconnects > MAX_STREAM_RECONNECTS) {
      // The stream is gone; recover the turn's outcome from event history when it already ended.
      const session = await client.getSession(sessionId);
      if (!BUSY_SESSION_STATUSES.has(asString(session.status, ""))) {
        for (const event of await client.listRecentEvents(sessionId)) {
          const terminal = readTerminalEvent(event);
          if (terminal) return outcome(terminal, event);
        }
      }
      throw new Error(
        `Lost the Qoder event stream for session ${sessionId} before the turn finished${streamFailure ? `: ${streamFailure}` : "."}`,
      );
    }
    await emitStatus(onLog, "running", `Qoder event stream closed; reconnecting (attempt ${reconnects}).`);
    await sleep(STREAM_RECONNECT_BASE_DELAY_MS * 2 ** (reconnects - 1), signal);
  }
}

function readUsage(session: QoderRecord | null): Record<string, number> | null {
  const usage = asRecord(session?.usage);
  if (!usage) return null;
  const result: Record<string, number> = {};
  for (const key of ["model_credits", "sandbox_runtime_credits", "total_credits"]) {
    if (typeof usage[key] === "number") result[key] = usage[key];
  }
  return Object.keys(result).length > 0 ? result : null;
}

export async function execute(
  ctx: AdapterExecutionContext,
  deps: QoderCloudAgentsExecuteDeps = {},
): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, onDispatch } = ctx;
  const sleep = deps.sleep ?? defaultSleep;
  const billing = { provider: "qoder", biller: "qoder", billingType: "api" as const };
  const configError = (errorMessage: string): AdapterExecutionResult => ({
    exitCode: 1,
    signal: null,
    timedOut: false,
    errorMessage,
    ...billing,
    clearSession: false,
  });

  const rawEnv = asStringEnvMap(config.env);
  const token = asString(rawEnv.QODER_ACCESS_TOKEN, "").trim() || asString(rawEnv.QODER_PAT, "").trim();
  if (!token) return configError("QODER_ACCESS_TOKEN is required for qoder_cloud_agents.");
  const repoToken = trimNullable(rawEnv.QODER_REPO_TOKEN);

  const workspace = parseObject(context.paperclipWorkspace);
  const repoUrlRaw = asString(config.repoUrl, "").trim() || asString(workspace.repoUrl, "").trim();
  let repo: QoderRepo | null = null;
  if (repoUrlRaw) {
    const parsed = parseRepoUrl(repoUrlRaw);
    if (!parsed) {
      return configError(`qoder_cloud_agents requires an http(s) repoUrl; Qoder cannot clone "${repoUrlRaw}".`);
    }
    repo = {
      url: repoUrlRaw,
      ref: trimNullable(config.repoStartingRef) ?? trimNullable(workspace.repoRef),
      mountPath: trimNullable(config.repoMountPath) ?? defaultMountPath(parsed),
    };
  }

  const apiBaseUrl = normalizeQoderApiBaseUrl(asString(config.apiBaseUrl, ""), DEFAULT_QODER_API_BASE_URL);
  const configuredAgentId = trimNullable(config.qoderAgentId);
  const configuredEnvironmentId = trimNullable(config.environmentId);
  const model = asString(config.model, "").trim() || DEFAULT_QODER_CLOUD_AGENTS_MODEL;
  const timeoutSec = Math.max(0, asNumber(config.timeoutSec, 0));
  const { env: sessionEnv, dropped: droppedEnvKeys } = buildSessionEnv(ctx, rawEnv);
  const envFingerprint = fingerprintEnv(sessionEnv);

  const storedSession = readSession(runtime.sessionParams);
  const candidateSession = sessionMatches(storedSession, {
    apiBaseUrl,
    configuredAgentId,
    configuredEnvironmentId,
    model,
    repo,
    envFingerprint,
  }) ? storedSession : null;

  const abort = new AbortController();
  let stopKind: "cancelled" | "timeout" | null = null;
  const onRunCancelled = () => {
    stopKind ??= "cancelled";
    abort.abort(new Error("Qoder Cloud Agents run was cancelled"));
  };
  const timeoutTimer = timeoutSec > 0
    ? setTimeout(() => {
        stopKind ??= "timeout";
        abort.abort(new Error(`Qoder Cloud Agents run timed out after ${timeoutSec}s`));
      }, timeoutSec * 1000)
    : null;
  const client = createQoderClient({ apiBaseUrl, token, fetchImpl: deps.fetchImpl, signal: abort.signal });

  let session: QoderCloudAgentsSession | null = candidateSession;
  let turnStarted = false;
  const failure = (errorMessage: string, extra: Partial<AdapterExecutionResult> = {}): AdapterExecutionResult => ({
    exitCode: 1,
    signal: null,
    timedOut: false,
    errorMessage,
    sessionId: session?.qoderSessionId ?? null,
    sessionDisplayId: session?.qoderSessionId ?? null,
    sessionParams: session,
    ...billing,
    costUsd: null,
    clearSession: false,
    ...extra,
    resultJson: {
      status: "error",
      ...(session ? { qoderSessionId: session.qoderSessionId, qoderAgentId: session.qoderAgentId } : {}),
      error: errorMessage,
      ...extra.resultJson,
    },
  });
  const cancelRemoteTurn = async () => {
    if (!session || !turnStarted) return;
    try {
      await client.cancelSession(session.qoderSessionId);
    } catch (err) {
      await onLog("stderr", `[paperclip] Warning: could not cancel Qoder session ${session.qoderSessionId}: ${formatRunError(err)}\n`);
    }
  };

  try {
    if (ctx.signal) {
      await ctx.onCancellationReady?.();
      if (ctx.signal.aborted) onRunCancelled();
      else ctx.signal.addEventListener("abort", onRunCancelled, { once: true });
    }
    abort.signal.throwIfAborted();

    // This adapter has no local child process, so crossing into the first
    // Qoder request is its dispatch boundary.
    onDispatch?.();
    // A stored session decides resumed-versus-fresh prompt content, so confirm
    // Qoder still has it before rendering the prompt.
    const liveStatus = candidateSession ? await probeSession(client, candidateSession.qoderSessionId) : null;
    const canReuseSession = Boolean(candidateSession && liveStatus);
    if (!canReuseSession) session = null;

    const promptTemplate = asString(config.promptTemplate, context.conversationMode === true
      ? DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE
      : DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE);
    const bootstrapPromptTemplate = asString(config.bootstrapPromptTemplate, "");
    const templateData = {
      agentId: agent.id,
      companyId: agent.companyId,
      runId,
      company: { id: agent.companyId },
      agent,
      run: { id: runId, source: "on_demand" },
      context,
    };
    const instructions = await buildInstructionsPrefix(config, onLog);
    await hydrateFreshSessionHandoff(ctx, { resumedSession: canReuseSession });
    const { taskContextNote, wakePrompt } = selectPaperclipPromptSections(context, {
      resumedSession: canReuseSession,
      includeCommunicationGuidance: false,
    });
    const renderedBootstrapPrompt =
      !canReuseSession && bootstrapPromptTemplate.trim().length > 0
        ? renderTemplate(bootstrapPromptTemplate, templateData).trim()
        : "";
    const renderedPrompt =
      (canReuseSession && wakePrompt.length > 0) || isPaperclipRecoveryWakePayload(context.paperclipWake)
        ? ""
        : renderTemplate(promptTemplate, templateData).trim();
    const prompt = joinPromptSections([
      selectInitialCommunicationGuidance(context, { resumedSession: canReuseSession }),
      instructions.prefix,
      renderedBootstrapPrompt,
      wakePrompt,
      taskContextNote,
      buildRunContextNote(ctx, sessionEnv, repo),
      renderedPrompt,
    ]);
    const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
    const finalPrompt = joinPromptSections([prompt, sessionHandoffNote]);

    if (droppedEnvKeys.length > 0) {
      await onLog(
        "stderr",
        `[paperclip] Warning: Qoder session env limits rejected these variables; they were not forwarded: ${droppedEnvKeys.join(", ")}\n`,
      );
    }
    if (onMeta) {
      const meta: AdapterInvocationMeta = {
        adapterType: ADAPTER_TYPE,
        command: "qoder-cloud-agents-api",
        commandNotes: [
          ...instructions.notes,
          canReuseSession
            ? `Reusing Qoder session ${candidateSession?.qoderSessionId ?? "unknown"}`
            : "Creating a new Qoder session",
          `Qoder API: ${apiBaseUrl}`,
          repo ? `Repository: ${repo.url}${repo.ref ? ` @ ${repo.ref}` : ""} -> ${repo.mountPath}` : "Repository: none",
          ...(droppedEnvKeys.length > 0 ? [`Env vars not forwarded: ${droppedEnvKeys.join(", ")}`] : []),
        ],
        prompt: finalPrompt,
        promptMetrics: {
          promptChars: finalPrompt.length,
          instructionsChars: instructions.chars,
          bootstrapPromptChars: renderedBootstrapPrompt.length,
          wakePromptChars: wakePrompt.length,
          taskContextChars: taskContextNote.length,
          heartbeatPromptChars: renderedPrompt.length,
        },
        context: {
          qoderCloudAgents: {
            apiBaseUrl,
            qoderAgentId: configuredAgentId,
            environmentId: configuredEnvironmentId,
            repoUrl: repo?.url ?? null,
            repoRef: repo?.ref ?? null,
            canReuseSession,
          },
        },
      };
      await onMeta(meta);
    }

    if (session && liveStatus && BUSY_SESSION_STATUSES.has(liveStatus)) {
      // Qoder rejects a new user.message with 409 while a turn is in flight.
      await emitStatus(onLog, "running", `Waiting for the prior turn on Qoder session ${session.qoderSessionId} to finish.`);
      await waitForIdle(client, session.qoderSessionId, sleep, abort.signal);
    }

    if (!session) {
      const environmentId = await resolveEnvironmentId(client, configuredEnvironmentId);
      const qoderAgentId = configuredAgentId ?? await resolveManagedAgentId(client, agent, model);
      const created = await client.createSession({
        agent: qoderAgentId,
        environment_id: environmentId,
        title: `Paperclip ${agent.name}`.slice(0, 256),
        metadata: { paperclip_agent_id: agent.id, paperclip_company_id: agent.companyId },
        ...(Object.keys(sessionEnv).length > 0 ? { environment_variables: sessionEnv } : {}),
        ...(repo ? { resources: [buildRepoResource(repo, repoToken)] } : {}),
      });
      const qoderSessionId = trimNullable(created.id);
      if (!qoderSessionId) throw new Error("Qoder did not return a session ID.");
      session = {
        qoderSessionId,
        qoderAgentId,
        managedAgent: !configuredAgentId,
        environmentId,
        apiBaseUrl,
        ...(configuredAgentId ? {} : { model }),
        ...(repo ? { repoUrl: repo.url, repoMountPath: repo.mountPath, ...(repo.ref ? { repoRef: repo.ref } : {}) } : {}),
        envFingerprint,
      };
    }
    const activeSession = session;
    const reportedModel = activeSession.managedAgent ? model : null;

    const userMessage = { type: "user.message", content: [{ type: "text", text: finalPrompt }] };
    let sent: QoderRecord[];
    try {
      sent = await client.sendEvents(activeSession.qoderSessionId, [userMessage]);
    } catch (err) {
      if (!(err instanceof QoderApiError) || err.status !== 409) throw err;
      // Another turn started between the probe and the send.
      await waitForIdle(client, activeSession.qoderSessionId, sleep, abort.signal);
      sent = await client.sendEvents(activeSession.qoderSessionId, [userMessage]);
    }
    turnStarted = true;
    await onLog("stdout", eventLine({
      type: "qoder_cloud_agents.init",
      sessionId: activeSession.qoderSessionId,
      agentId: activeSession.qoderAgentId,
      ...(reportedModel ? { model: reportedModel } : {}),
    }));
    await emitStatus(onLog, "running", `Started a turn on Qoder session ${activeSession.qoderSessionId}.`);

    const outcome = await streamTurn({
      client,
      sessionId: activeSession.qoderSessionId,
      cursor: sent.map((event) => trimNullable(event.id)).filter(Boolean).pop() ?? null,
      onLog,
      sleep,
      signal: abort.signal,
    });

    const succeeded = outcome.kind === "idle" && outcome.stopReason === "end_turn";
    if (outcome.kind === "idle" && outcome.stopReason === "requires_action") {
      // A pending action never times out, so clear it or the session stays blocked.
      await cancelRemoteTurn();
    }
    let usage: Record<string, number> | null = null;
    try {
      usage = readUsage(await client.getSession(activeSession.qoderSessionId));
    } catch {
      // Usage is informational; the turn outcome is already known.
    }

    const errorMessage = succeeded
      ? null
      : outcome.kind === "terminated"
        ? `Qoder session ${activeSession.qoderSessionId} was terminated.`
        : outcome.awaitingToolWorker
          ? `Qoder allowed a tool call but nothing executed it: environment ${activeSession.environmentId} appears to be self-hosted with no worker returning tool results. Set environmentId to a Qoder-hosted (cloud) environment.`
          : outcome.stopReason === "requires_action"
            ? "Qoder turn stopped waiting for tool confirmation, which Paperclip cannot answer. Set the Qoder agent's tool permission policies to always_allow."
            : outcome.lastError ?? `Qoder turn ended with stop reason "${outcome.stopReason ?? "unknown"}".`;
    await onLog("stdout", eventLine({
      type: "qoder_cloud_agents.result",
      status: succeeded ? "finished" : "error",
      ...(outcome.stopReason ? { stopReason: outcome.stopReason } : {}),
      ...(outcome.lastMessage ? { result: outcome.lastMessage } : {}),
      ...(errorMessage ? { error: errorMessage } : {}),
      ...(usage ? { usage } : {}),
    }));

    const terminated = outcome.kind === "terminated";
    return {
      exitCode: succeeded ? 0 : 1,
      signal: null,
      timedOut: false,
      errorMessage,
      sessionId: terminated ? null : activeSession.qoderSessionId,
      sessionDisplayId: terminated ? null : activeSession.qoderSessionId,
      sessionParams: terminated ? null : activeSession,
      ...billing,
      model: reportedModel,
      costUsd: null,
      summary: outcome.lastMessage ? firstNonEmptyLine(outcome.lastMessage) : null,
      resultJson: {
        status: succeeded ? "finished" : "error",
        qoderSessionId: activeSession.qoderSessionId,
        qoderAgentId: activeSession.qoderAgentId,
        environmentId: activeSession.environmentId,
        ...(outcome.stopReason ? { stopReason: outcome.stopReason } : {}),
        ...(outcome.lastMessage ? { result: outcome.lastMessage } : {}),
        ...(errorMessage ? { error: errorMessage } : {}),
        // Session-cumulative credits snapshot, not this run's delta.
        ...(usage ? { qoderSessionUsage: usage } : {}),
      },
      clearSession: terminated,
    };
  } catch (err) {
    if (stopKind) {
      await cancelRemoteTurn();
      const timedOut = stopKind === "timeout";
      const message = timedOut
        ? `Qoder Cloud Agents run timed out after ${timeoutSec}s`
        : "Qoder Cloud Agents run was cancelled";
      if (turnStarted) {
        await onLog("stdout", eventLine({ type: "qoder_cloud_agents.result", status: "error", error: message }));
      }
      return failure(message, {
        timedOut,
        ...(timedOut ? {} : { exitCode: null, errorCode: "cancelled" }),
        resultJson: timedOut
          ? {}
          : { executionCancellation: { state: "acknowledged", acknowledgedAt: new Date().toISOString() } },
      });
    }
    const error = formatRunError(err);
    const reason = err instanceof QoderApiError && err.status === 401
      ? `${error} Check that QODER_ACCESS_TOKEN is valid for ${apiBaseUrl}; service account tokens expire after at most 12 hours.`
      : error;
    if (turnStarted) {
      await onLog("stdout", eventLine({ type: "qoder_cloud_agents.result", status: "error", error: reason }));
    }
    return failure(reason);
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    ctx.signal?.removeEventListener("abort", onRunCancelled);
  }
}
