import { createProviderStoppedBoundary } from "@paperclipai/adapter-utils/provider-stopped-boundary";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  adapterExecutionTargetIsRemote,
  adapterExecutionTargetRemoteCwd,
  overrideAdapterExecutionTargetRemoteCwd,
  adapterExecutionTargetSessionIdentity,
  adapterExecutionTargetSessionMatches,
  adapterExecutionTargetUsesManagedHome,
  adapterExecutionTargetUsesPaperclipBridge,
  describeAdapterExecutionTarget,
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetRuntimeCommandInstalled,
  prepareAdapterExecutionTargetRuntime,
  readAdapterExecutionTarget,
  resolveAdapterExecutionTargetTimeoutSec,
  resolveAdapterExecutionTargetCommandForLogs,
  runAdapterExecutionTargetProcess,
  startAdapterExecutionTargetPaperclipBridge,
} from "@paperclipai/adapter-utils/execution-target";
import {
  asNumber,
  asString,
  asStringArray,
  buildPaperclipEnv,
  buildRuntimeToolsEnv,
  buildInvocationEnvForLogs,
  ensureAbsoluteDirectory,
  joinPromptSections,
  ensurePathInEnv,
  refreshPaperclipWorkspaceEnvForExecution,
  isPaperclipSkillSourceMissing,
  readPaperclipRuntimeSkillEntries,
  readPaperclipIssueWorkModeFromContext,
  resolveLegacyPaperclipDesiredSkillNames,
  parseObject,
  renderTemplate,
  hydrateFreshSessionHandoff,
  selectPaperclipPromptSections,
  selectInitialCommunicationGuidance,
  isPaperclipRecoveryWakePayload,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE,
} from "@paperclipai/adapter-utils/server-utils";
import {
  DEFAULT_COPILOT_LOCAL_MODEL,
  SANDBOX_INSTALL_COMMAND,
  resolveCopilotReasoningEffort,
} from "../index.js";
import {
  computePremiumRequestsDelta,
  describeCopilotFailure,
  detectCopilotAuthRequired,
  detectCopilotOutdatedCli,
  extractCopilotRuntimeEvents,
  isCopilotSessionUnrecoverableError,
  isCopilotTransientNetworkError,
  parseCopilotJsonl,
  parseCopilotUsageReport,
  computeCopilotUsageDelta,
  readCopilotUsageCumulative,
  type CopilotUsageReport,
} from "./parse.js";
import { firstNonEmptyLine } from "./utils.js";
import { buildCopilotBaseArgs, buildCopilotHeadlessEnv } from "./headless.js";

/** Prompts above this size go through stdin (Linux MAX_ARG_STRLEN is 128 KiB). */
const MAX_PROMPT_ARG_BYTES = 100_000;

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Wrap `onLog` so each complete copilot JSONL stdout line is also mapped to
 * `onEvent` runtime events (assistant snippet, tool name). This keeps the raw
 * run log intact while lighting up the issue-thread activity indicator, which
 * reads `currentToolName` / `lastAssistantSnippet` / `lastEventAt` derived from
 * `onEvent` rather than from the raw log stream. Stdout arrives in arbitrary
 * chunks, so lines are buffered and split on newlines. `flush` must be called
 * once the process exits so the final line reaches `onEvent` even when copilot
 * closes stdout without a trailing newline (otherwise the last assistant
 * message or tool call would be missing from live status).
 */
function createCopilotEventForwardingLog(
  onLog: AdapterExecutionContext["onLog"],
  onEvent: AdapterExecutionContext["onEvent"],
): { log: AdapterExecutionContext["onLog"]; flush: () => Promise<void> } {
  if (!onEvent) return { log: onLog, flush: async () => {} };
  let buffer = "";
  const emitLine = async (raw: string): Promise<void> => {
    const line = raw.trim();
    if (!line) return;
    for (const event of extractCopilotRuntimeEvents(line)) {
      await onEvent({ eventType: event.eventType, stream: "stdout", message: event.message, payload: event.payload });
    }
  };
  return {
    log: async (stream, chunk) => {
      await onLog(stream, chunk);
      if (stream !== "stdout") return;
      buffer += chunk;
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        await emitLine(line);
      }
    },
    flush: async () => {
      const remaining = buffer;
      buffer = "";
      await emitLine(remaining);
    },
  };
}

function hasNonEmptyEnvValue(env: Record<string, string>, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.trim().length > 0;
}

function buildCopilotRuntimeEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ensurePathInEnv({ ...process.env, ...buildCopilotHeadlessEnv(env) })).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function renderPaperclipEnvNote(env: Record<string, string>): string {
  const paperclipKeys = Object.keys(env)
    .filter((key) => key.startsWith("PAPERCLIP_"))
    .sort();
  if (paperclipKeys.length === 0) return "";
  return [
    "Paperclip runtime note:",
    `The following PAPERCLIP_* environment variables are available in this run: ${paperclipKeys.join(", ")}`,
    "Do not assume these variables are missing without checking your shell environment.",
    "",
    "",
  ].join("\n");
}

function renderApiAccessNote(env: Record<string, string>): string {
  if (!hasNonEmptyEnvValue(env, "PAPERCLIP_API_URL") || !hasNonEmptyEnvValue(env, "PAPERCLIP_API_KEY")) return "";
  return [
    "Paperclip API access note:",
    "Use shell commands with curl to make Paperclip API requests when needed.",
    "Include X-Paperclip-Run-Id on mutating requests.",
    "",
    "",
  ].join("\n");
}

async function buildCopilotSkillsDir(
  config: Record<string, unknown>,
): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-copilot-skills-"));
  const target = path.join(tmp, "skills");
  await fs.mkdir(target, { recursive: true });
  const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredNames = new Set(resolveLegacyPaperclipDesiredSkillNames(config, availableEntries));
  for (const entry of availableEntries) {
    if (!desiredNames.has(entry.key)) continue;
    if (isPaperclipSkillSourceMissing(entry)) continue;
    await fs.symlink(entry.source, path.join(target, entry.runtimeName));
  }
  return target;
}

/**
 * Maps a server-managed instruction working copy (host path) to the registered
 * copy on the remote target. Mirrors server path conventions in
 * agent-instruction-working-copies.ts (legacy single-file copy) and
 * agent-directory-working-copies.ts (agent files; remote root is exposed as
 * paperclipWorkspace.agentHome). Returns null for external instruction files.
 */
function resolveManagedRemoteInstructions(input: {
  localInstructionsFilePath: string;
  remoteCwd: string;
  agentHome: string;
  instructionCopy: Record<string, unknown>;
}): { dir: string; filePath: string } | null {
  // Preferred: explicit structured field from the server.
  const explicitRoot = asString(input.instructionCopy.executionRoot, "").trim().replace(/\/+$/, "");
  const explicitEntry = asString(input.instructionCopy.entryFile, "").trim();
  if (explicitRoot && explicitEntry) {
    return { dir: explicitRoot, filePath: path.posix.join(explicitRoot, explicitEntry) };
  }
  // Fallback only (older servers without context.paperclipInstructionCopy):
  // infer from the server's host path conventions.
  const file = input.localInstructionsFilePath.split(path.sep).join("/");
  if (!file) return null;
  const legacy = /\/\.paperclip-runtime\/(instruction-edits-[^/]+)\/instructions\/(.+)$/.exec(file);
  if (legacy && input.remoteCwd) {
    const dir = path.posix.join(input.remoteCwd, ".paperclip-runtime", legacy[1]!, "instructions");
    return { dir, filePath: path.posix.join(dir, legacy[2]!) };
  }
  const directory = /\/file-sync\/runs\/[^/]+\/live\/(.+)$/.exec(file);
  if (directory && input.agentHome) {
    const dir = input.agentHome.replace(/\/+$/, "");
    return { dir, filePath: path.posix.join(dir, directory[1]!) };
  }
  return null;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const providerStop = createProviderStoppedBoundary(ctx.onProviderStopped);

  const { runId, agent, runtime, config, context, onLog, onMeta, onEvent, onSpawn, authToken } = ctx;
  const executionTarget = readAdapterExecutionTarget({
    executionTarget: ctx.executionTarget,
    legacyRemoteExecution: ctx.executionTransport?.remoteExecution,
  });
  const executionTargetIsRemote = adapterExecutionTargetIsRemote(executionTarget);

  const promptTemplate = asString(
    config.promptTemplate,
    context.conversationMode === true
      ? DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE
      : DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  );
  const command = asString(config.command, "copilot");
  const model = asString(config.model, "").trim() || DEFAULT_COPILOT_LOCAL_MODEL;

  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceId = asString(workspaceContext.workspaceId, "");
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "");
  const workspaceRepoRef = asString(workspaceContext.repoRef, "");
  const agentHome = asString(workspaceContext.agentHome, "");
  const workspaceHints = Array.isArray(context.paperclipWorkspaces)
    ? context.paperclipWorkspaces.filter(
      (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
    )
    : [];
  const configuredCwd = asString(config.cwd, "");
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();
  let effectiveExecutionCwd = adapterExecutionTargetRemoteCwd(executionTarget, cwd);
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
  const copilotSkillEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredCopilotSkillNames = resolveLegacyPaperclipDesiredSkillNames(config, copilotSkillEntries);
  const envConfig = parseObject(config.env);

  const hasExplicitApiKey =
    typeof envConfig.PAPERCLIP_API_KEY === "string" && envConfig.PAPERCLIP_API_KEY.trim().length > 0;
  const env: Record<string, string> = {
    ...buildPaperclipEnv(agent, ctx.agentIdentity),
    ...buildRuntimeToolsEnv(ctx.runtimeTools),
  };
  env.PAPERCLIP_RUN_ID = runId;
  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    null;
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
    null;
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim().length > 0
      ? context.approvalId.trim()
      : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
      ? context.approvalStatus.trim()
      : null;
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const issueWorkMode = readPaperclipIssueWorkModeFromContext(context);
  if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
  if (issueWorkMode) env.PAPERCLIP_ISSUE_WORK_MODE = issueWorkMode;
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  if (linkedIssueIds.length > 0) env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
  refreshPaperclipWorkspaceEnvForExecution({
    env,
    envConfig,
    workspaceCwd: effectiveWorkspaceCwd,
    workspaceSource,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    workspaceHints,
    agentHome,
    executionTargetIsRemote,
    executionCwd: effectiveExecutionCwd,
  });
  if (!hasExplicitApiKey && authToken) {
    env.PAPERCLIP_API_KEY = authToken;
  }
  const reasoningEffort = resolveCopilotReasoningEffort(config.effort ?? config.reasoningEffort);
  const allowAllPaths = asBoolean(config.allowAllPaths);
  const disableBuiltinMcps = asBoolean(config.disableBuiltinMcps);
  const runtimeEnv = buildCopilotRuntimeEnv(env);
  const timeoutSec = resolveAdapterExecutionTargetTimeoutSec(
    executionTarget,
    asNumber(config.timeoutSec, 0),
  );
  const graceSec = asNumber(config.graceSec, 20);
  await ensureAdapterExecutionTargetRuntimeCommandInstalled({
    runId,
    target: executionTarget,
    installCommand: ctx.runtimeCommandSpec?.installCommand,
    detectCommand: ctx.runtimeCommandSpec?.detectCommand,
    cwd,
    env: runtimeEnv,
    timeoutSec,
    graceSec,
    onLog,
  });
  await ensureAdapterExecutionTargetCommandResolvable(command, executionTarget, cwd, runtimeEnv, {
    installCommand: SANDBOX_INSTALL_COMMAND,
    timeoutSec,
  });
  const resolvedCommand = await resolveAdapterExecutionTargetCommandForLogs(command, executionTarget, cwd, runtimeEnv);
  const extraArgs = (() => {
    const fromExtraArgs = asStringArray(config.extraArgs);
    if (fromExtraArgs.length > 0) return fromExtraArgs;
    return asStringArray(config.args);
  })();
  let restoreRemoteWorkspace: (() => Promise<void>) | null = null;
  let localSkillsDir: string | null = null;
  let remoteSkillsDir: string | null = null;
  let remoteInstructionsDir: string | null = null;
  const usageFiles: string[] = [];
  let remoteRuntimeRootDir: string | null = null;
  let paperclipBridge: Awaited<ReturnType<typeof startAdapterExecutionTargetPaperclipBridge>> = null;

  const localInstructionsFilePath = asString(config.instructionsFilePath, "").trim();
  // Paperclip-managed instruction bundles are already staged on the remote
  // target by the server, which harvests agent edits only from that registered
  // directory. Reuse it instead of staging a duplicate copy.
  const managedRemoteInstructions = executionTargetIsRemote
    ? resolveManagedRemoteInstructions({
        localInstructionsFilePath,
        remoteCwd: effectiveExecutionCwd,
        agentHome: asString(parseObject(context.paperclipWorkspace).agentHome, ""),
        instructionCopy: parseObject(context.paperclipInstructionCopy),
      })
    : null;
  if (executionTargetIsRemote) {
    try {
      localSkillsDir = await buildCopilotSkillsDir(config);
      await onLog(
        "stdout",
        `[paperclip] Syncing workspace and Copilot runtime assets to ${describeAdapterExecutionTarget(executionTarget)}.\n`,
      );
      const preparedExecutionTargetRuntime = await prepareAdapterExecutionTargetRuntime({
        runId,
        target: executionTarget,
        adapterKey: "copilot",
        timeoutSec,
        workspaceLocalDir: cwd,
        installCommand: SANDBOX_INSTALL_COMMAND,
        detectCommand: command,
        onProgress: (line) => onLog("stdout", line),
        onRuntimeProgress: ctx.onRuntimeProgress,
        assets: [{
          key: "skills",
          localDir: localSkillsDir,
          followSymlinks: true,
        }, ...(localInstructionsFilePath && !managedRemoteInstructions
          ? [{ key: "instructions", localDir: path.dirname(localInstructionsFilePath) }]
          : [])],
      });
      restoreRemoteWorkspace = () =>
        preparedExecutionTargetRuntime.restoreWorkspace((line) => onLog("stdout", line));
      effectiveExecutionCwd = preparedExecutionTargetRuntime.workspaceRemoteDir ?? effectiveExecutionCwd;
      refreshPaperclipWorkspaceEnvForExecution({
        env,
        envConfig,
        workspaceCwd: effectiveWorkspaceCwd,
        workspaceSource,
        workspaceId,
        workspaceRepoUrl,
        workspaceRepoRef,
        workspaceHints,
        agentHome,
        executionTargetIsRemote,
        executionCwd: effectiveExecutionCwd,
      });
      remoteRuntimeRootDir = preparedExecutionTargetRuntime.runtimeRootDir;
      const managedHome = adapterExecutionTargetUsesManagedHome(executionTarget);
      const managedRemoteHomeDir =
        managedHome && preparedExecutionTargetRuntime.runtimeRootDir
          ? preparedExecutionTargetRuntime.runtimeRootDir
          : null;
      if (managedRemoteHomeDir) {
        env.HOME = managedRemoteHomeDir;
      }
      // Deliver the synced skills snapshot via --add-dir (see buildArgs) from
      // its isolated per-run location instead of copying it over the shared
      // ~/.copilot/skills home, which may hold skills Paperclip does not own.
      if (desiredCopilotSkillNames.length > 0 && preparedExecutionTargetRuntime.assetDirs.skills) {
        remoteSkillsDir = preparedExecutionTargetRuntime.assetDirs.skills;
      }
      // The instructions directory is a host path; point Copilot at the staged
      // copy on the remote target instead.
      if (localInstructionsFilePath && !managedRemoteInstructions && preparedExecutionTargetRuntime.assetDirs.instructions) {
        remoteInstructionsDir = preparedExecutionTargetRuntime.assetDirs.instructions;
      }
    } catch (error) {
      await Promise.allSettled([
        restoreRemoteWorkspace?.(),
        localSkillsDir ? fs.rm(path.dirname(localSkillsDir), { recursive: true, force: true }).catch(() => undefined) : Promise.resolve(),
      ]);
      throw error;
    }
  }
  // The try/finally starts here so a bridge-start failure still cleans the
  // staged skills dir and restores the remote workspace.
  try {
    const runtimeExecutionTarget = overrideAdapterExecutionTargetRemoteCwd(executionTarget, effectiveExecutionCwd);
    if (executionTargetIsRemote && adapterExecutionTargetUsesPaperclipBridge(executionTarget)) {
      paperclipBridge = await startAdapterExecutionTargetPaperclipBridge({
        runId,
        target: runtimeExecutionTarget,
        runtimeRootDir: remoteRuntimeRootDir,
        adapterKey: "copilot",
        timeoutSec,
        hostApiToken: env.PAPERCLIP_API_KEY,
        onLog,
      });
      if (paperclipBridge) {
        Object.assign(env, paperclipBridge.env);
      }
    }

    // Local runs expose desired skills through a dedicated per-run directory
    // (passed with --add-dir) rather than symlinking into the user's
    // ~/.copilot/skills home, so the operator's Copilot install is not polluted.
    // Remote runs sync skills into the remote runtime root above.
    if (!executionTargetIsRemote && desiredCopilotSkillNames.length > 0) {
      localSkillsDir = await buildCopilotSkillsDir(config);
      await onLog(
        "stderr",
        `[paperclip] Prepared ${desiredCopilotSkillNames.length} Copilot skill(s) for COPILOT_SKILLS_DIRS delivery.\n`,
      );
    }

    const runtimeSessionParams = parseObject(runtime.sessionParams);
    const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "");
    const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
    const runtimeRemoteExecution = parseObject(runtimeSessionParams.remoteExecution);
    const canResumeSession =
      runtimeSessionId.length > 0 &&
      (runtimeSessionCwd.length === 0 || path.resolve(runtimeSessionCwd) === path.resolve(effectiveExecutionCwd)) &&
      adapterExecutionTargetSessionMatches(runtimeRemoteExecution, runtimeExecutionTarget);
    const sessionId = canResumeSession ? runtimeSessionId : null;
    if (executionTargetIsRemote && runtimeSessionId && !canResumeSession) {
      await onLog(
        "stdout",
        `[paperclip] Copilot session "${runtimeSessionId}" does not match the current remote execution identity and will not be resumed in "${effectiveExecutionCwd}". Starting a fresh remote session.\n`,
      );
    } else if (runtimeSessionId && !canResumeSession) {
      await onLog(
        "stdout",
        `[paperclip] Copilot session "${runtimeSessionId}" was saved for cwd "${runtimeSessionCwd}" and will not be resumed in "${effectiveExecutionCwd}".\n`,
      );
    }

    // Read from the local path; reference the staged remote copy in the prompt
    // and --add-dir when running on a remote target.
    const instructionsFilePath = localInstructionsFilePath;
    // Local path locally, staged path remotely, null when unavailable.
    const effectiveInstructionsFilePath: string | null = !instructionsFilePath
      ? null
      : !executionTargetIsRemote
        ? instructionsFilePath
        : managedRemoteInstructions
          ? managedRemoteInstructions.filePath
          : remoteInstructionsDir
            ? path.posix.join(remoteInstructionsDir.replace(/\/+$/, ""), path.basename(instructionsFilePath))
            : null;
    const effectiveInstructionsDirPath: string | null = !instructionsFilePath
      ? null
      : !executionTargetIsRemote
        ? path.dirname(instructionsFilePath)
        : managedRemoteInstructions
          ? managedRemoteInstructions.dir
          : remoteInstructionsDir?.replace(/\/+$/, "") || null;
    const instructionsDir = effectiveInstructionsDirPath ? `${effectiveInstructionsDirPath}/` : "";
    let instructionsPrefix = "";
    if (instructionsFilePath) {
      try {
        const instructionsContents = await fs.readFile(instructionsFilePath, "utf8");
        instructionsPrefix = effectiveInstructionsFilePath
          ? `${instructionsContents}\n\n` +
            `The above agent instructions were loaded from ${effectiveInstructionsFilePath}. ` +
            `Resolve any relative file references from ${instructionsDir}. ` +
            `This base directory is authoritative for sibling instruction files such as ` +
            `./HEARTBEAT.md, ./SOUL.md, and ./TOOLS.md; do not resolve those from the parent agent directory.\n\n`
          : `${instructionsContents}\n\n`;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await onLog(
          "stdout",
          `[paperclip] Warning: could not read agent instructions file "${instructionsFilePath}": ${reason}\n`,
        );
      }
    }
    const commandNotes = (() => {
      const notes: string[] = ["Prompt is passed to Copilot via -p for non-interactive execution."];
      notes.push("Added --output-format json --allow-all-tools --no-ask-user for structured, unattended output.");
      notes.push("Set headless env (CI=1, NO_COLOR=1) so unattended runs skip prompts and never download CLI updates.");
      if (reasoningEffort) notes.push(`Added --reasoning-effort ${reasoningEffort}.`);
      const effectiveSkillsDir = executionTargetIsRemote ? remoteSkillsDir : localSkillsDir;
      if (effectiveSkillsDir) {
        notes.push(`Exposing ${desiredCopilotSkillNames.length} desired skill(s) via COPILOT_SKILLS_DIRS=${effectiveSkillsDir}.`);
      }
      if (effectiveInstructionsDirPath) {
        notes.push(`Added --add-dir ${effectiveInstructionsDirPath} so sibling instruction files are readable.`);
      }
      if (!instructionsFilePath) return notes;
      if (instructionsPrefix.length > 0) {
        notes.push(`Loaded agent instructions from ${instructionsFilePath}`);
        if (effectiveInstructionsDirPath) {
          notes.push(`Prepended instructions + path directive to prompt (relative references from ${instructionsDir}).`);
        } else {
          notes.push("Instructions directory was not staged on the remote target; prepended instructions content without path directive.");
        }
        return notes;
      }
      notes.push(
        `Configured instructionsFilePath ${instructionsFilePath}, but file could not be read; continuing without injected instructions.`,
      );
      return notes;
    })();

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
    const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
    const paperclipEnvNote = renderPaperclipEnvNote(env);
    const apiAccessNote = renderApiAccessNote(env);

    const buildArgs = (
      resumeSessionId: string | null,
      freshSessionId: string,
      usageFile: string | null,
      prompt: string | null,
    ) => {
      const args = buildCopilotBaseArgs({ model, reasoningEffort, allowAllPaths, disableBuiltinMcps });
      // Make the agent instructions directory readable so Copilot can open
      // sibling instruction files (./HEARTBEAT.md, ./SOUL.md, ./TOOLS.md).
      // Remote targets use the staged copy of the directory.
      if (effectiveInstructionsDirPath) {
        args.push("--add-dir", effectiveInstructionsDirPath);
      }
      if (usageFile) args.push("--usage-output-file", usageFile);
      if (resumeSessionId) args.push(`--resume=${resumeSessionId}`);
      else args.push("--session-id", freshSessionId);
      if (extraArgs.length > 0) args.push(...extraArgs);
      // Without -p the CLI reads the prompt from stdin (same JSONL output).
      if (prompt !== null) args.push("-p", prompt);
      return args;
    };

    const runAttempt = async (resumeSessionId: string | null) => {
      const freshSessionId = randomUUID();
      await hydrateFreshSessionHandoff(ctx, { resumedSession: Boolean(resumeSessionId) });
      const attemptSections = selectPaperclipPromptSections(context, {
        resumedSession: Boolean(resumeSessionId),
        includeCommunicationGuidance: false,
      });
      const attemptBootstrapPrompt = !resumeSessionId && bootstrapPromptTemplate.trim().length > 0
        ? renderTemplate(bootstrapPromptTemplate, templateData).trim()
        : "";
      const attemptWakePrompt = attemptSections.wakePrompt;
      const attemptRenderedPrompt = Boolean(resumeSessionId) && attemptWakePrompt.length > 0
        || isPaperclipRecoveryWakePayload(context.paperclipWake)
        ? ""
        : renderTemplate(promptTemplate, templateData);
      const attemptBasePrompt = joinPromptSections([
        instructionsPrefix,
        attemptBootstrapPrompt,
        attemptWakePrompt,
        attemptSections.taskContextNote,
        sessionHandoffNote,
        paperclipEnvNote,
        apiAccessNote,
        attemptRenderedPrompt,
      ]);
      const prompt = joinPromptSections([
        selectInitialCommunicationGuidance(context, { resumedSession: Boolean(resumeSessionId) }),
        attemptBasePrompt,
      ]);
      const promptMetrics = {
        promptChars: prompt.length,
        instructionsChars: instructionsPrefix.length,
        bootstrapPromptChars: attemptBootstrapPrompt.length,
        wakePromptChars: attemptWakePrompt.length,
        taskContextChars: attemptSections.taskContextNote.length,
        sessionHandoffChars: sessionHandoffNote.length,
        runtimeNoteChars: paperclipEnvNote.length + apiAccessNote.length,
        heartbeatPromptChars: attemptRenderedPrompt.length,
      };
      const usageFile = executionTargetIsRemote
        ? null
        : path.join(os.tmpdir(), `paperclip-copilot-usage-${randomUUID()}.json`);
      if (usageFile) usageFiles.push(usageFile);
      const promptViaStdin = Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_ARG_BYTES;
      const args = buildArgs(resumeSessionId, freshSessionId, usageFile, promptViaStdin ? null : prompt);
      const invocationEnv = buildCopilotHeadlessEnv(env);
      // Copilot loads skills from COPILOT_SKILLS_DIRS (comma-separated dirs whose
      // children are skill folders); --add-dir only reads <dir>/.github/skills.
      const skillsDirForRun = executionTargetIsRemote ? remoteSkillsDir : localSkillsDir;
      if (skillsDirForRun) {
        // Remote runs must not inherit a host path from the server's own env.
        const inherited = (executionTargetIsRemote
          ? (env.COPILOT_SKILLS_DIRS ?? "")
          : (env.COPILOT_SKILLS_DIRS ?? process.env.COPILOT_SKILLS_DIRS ?? "")).trim();
        invocationEnv.COPILOT_SKILLS_DIRS = inherited ? `${skillsDirForRun},${inherited}` : skillsDirForRun;
      }
      const invocationRuntimeEnv = buildCopilotRuntimeEnv(env);
      const loggedEnv = buildInvocationEnvForLogs(invocationEnv, {
        runtimeEnv: invocationRuntimeEnv,
        includeRuntimeKeys: ["HOME"],
        resolvedCommand,
      });
      if (onMeta) {
        await onMeta({
          adapterType: "copilot_local",
          command: resolvedCommand,
          cwd: effectiveExecutionCwd,
          commandNotes,
          commandArgs: promptViaStdin
            ? [...args, `<prompt ${prompt.length} chars via stdin>`]
            : args.map((value, index) => (
              index === args.length - 1 ? `<prompt ${prompt.length} chars>` : value
            )),
          env: loggedEnv,
          prompt,
          promptMetrics: { ...promptMetrics, promptChars: prompt.length },
          context,
        });
      }

      const eventForwarder = createCopilotEventForwardingLog(onLog, onEvent);
      const proc = await runAdapterExecutionTargetProcess(runId, runtimeExecutionTarget, command, args, {
        onProcessStopped: providerStop.beginInvocation(),
        cwd,
        env: invocationEnv,
        ...(promptViaStdin ? { stdin: prompt } : {}),
        timeoutSec,
        graceSec,
        onSpawn,
        onRuntimeProgress: ctx.onRuntimeProgress,
        onLog: eventForwarder.log,
        runLogTail: paperclipBridge?.runLogTail,
        settleRunDisposition: paperclipBridge?.settleRunDisposition,
      });
      await eventForwarder.flush();
      const usageReport = usageFile
        ? parseCopilotUsageReport(await fs.readFile(usageFile, "utf8").catch(() => ""))
        : null;
      return {
        proc,
        usageReport,
        parsed: parseCopilotJsonl(proc.stdout),
        resumed: Boolean(resumeSessionId),
        freshSessionId,
      };
    };

    const previousPremiumRequests = (() => {
      const raw = runtimeSessionParams.premiumRequestsCumulative;
      return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
    })();

    const previousUsageCumulative = readCopilotUsageCumulative(runtimeSessionParams.usageCumulative);

    const toResult = (
      attempt: {
        proc: {
          exitCode: number | null;
          signal: string | null;
          timedOut: boolean;
          stdout: string;
          stderr: string;
          errorCode?: string | null;
        };
        parsed: ReturnType<typeof parseCopilotJsonl>;
        usageReport: CopilotUsageReport | null;
        resumed: boolean;
        freshSessionId: string;
      },
      clearSessionOnMissingSession = false,
    ): AdapterExecutionResult => {
      const authMeta = detectCopilotAuthRequired({
        stdout: attempt.proc.stdout,
        stderr: attempt.proc.stderr,
      });
      const networkUnavailable = isCopilotTransientNetworkError(attempt.proc.stdout, attempt.proc.stderr);
      // Usage file counters are session-cumulative; a fresh/retried session starts at 0.
      const currentCumulative = attempt.usageReport?.cumulative ?? null;
      const previousCumulative = attempt.resumed ? previousUsageCumulative : null;
      const usageDelta = currentCumulative
        ? computeCopilotUsageDelta(currentCumulative, previousCumulative)
        : null;
      const billing = {
        // Copilot bills GitHub premium requests, not dollars: leave USD unpriced.
        // Only complete when final usage evidence exists: the usage file was
        // read or the stream carried its trailing `result` line.
        usageComplete: attempt.usageReport !== null || attempt.parsed.resultExitCode !== null,
        costStatus: "unpriced" as const,
        usageBasis: "per_run" as const,
        provider: "github",
        biller: "github",
        model: attempt.usageReport?.currentModel ?? attempt.parsed.model ?? model,
        ...(usageDelta ? { usage: usageDelta.usage } : {}),
        billingType: "credits" as const,
        costUsd: null,
      };

      const timedOut = attempt.proc.timedOut;
      // A null exit code means the process never exited normally (killed by a
      // signal). In-band session.error / blocking warnings and a non-zero
      // `result.exitCode` also fail the run even when the process exits 0.
      const failed =
        timedOut ||
        attempt.proc.exitCode === null ||
        attempt.proc.exitCode !== 0 ||
        attempt.parsed.failed ||
        (attempt.parsed.resultExitCode ?? 0) !== 0;

      // A resumed attempt keeps its id. A fresh one keeps the id we passed unless
      // the CLI died before emitting any JSON event (auth/arg errors): returning
      // null for a session that exists would make the host clear the task session.
      const resolvedSessionId =
        attempt.parsed.sessionId ??
        (attempt.resumed
          ? (sessionId ?? null)
          : !failed || attempt.parsed.eventCount > 0
            ? attempt.freshSessionId
            : null);
      const previousForAttempt = attempt.resumed ? previousPremiumRequests : null;
      const premiumRequestsCumulative = attempt.parsed.premiumRequestsCumulative;
      const premiumRequests = computePremiumRequestsDelta(premiumRequestsCumulative, previousForAttempt);
      const storedCumulative = premiumRequestsCumulative ?? previousForAttempt;
      const resolvedSessionParams = resolvedSessionId
        ? ({
          sessionId: resolvedSessionId,
          cwd: effectiveExecutionCwd,
          ...(workspaceId ? { workspaceId } : {}),
          ...(workspaceRepoUrl ? { repoUrl: workspaceRepoUrl } : {}),
          ...(workspaceRepoRef ? { repoRef: workspaceRepoRef } : {}),
          ...(executionTargetIsRemote
            ? {
                remoteExecution: adapterExecutionTargetSessionIdentity(runtimeExecutionTarget),
              }
            : {}),
          ...(storedCumulative !== null ? { premiumRequestsCumulative: storedCumulative } : {}),
          ...((currentCumulative ?? previousCumulative)
            ? { usageCumulative: currentCumulative ?? previousCumulative }
            : {}),
        } as Record<string, unknown>)
        : null;

      if (timedOut) {
        return {
          exitCode: attempt.proc.exitCode,
          signal: attempt.proc.signal,
          timedOut: true,
          ...billing,
          errorMessage: `Timed out after ${timeoutSec}s`,
          errorCode: authMeta.requiresAuth
            ? "copilot_auth_required"
            : networkUnavailable
              ? "copilot_network_unavailable"
              : null,
          // Keep the session and its updated cumulative counters so the next
          // resume does not subtract a stale baseline and double count.
          sessionId: resolvedSessionId,
          sessionParams: resolvedSessionParams,
          sessionDisplayId: resolvedSessionId,
          clearSession: Boolean(clearSessionOnMissingSession && !resolvedSessionId),
        };
      }

      const outdatedCli = detectCopilotOutdatedCli(attempt.proc.stderr);
      const parsedError = typeof attempt.parsed.errorMessage === "string" ? attempt.parsed.errorMessage.trim() : "";
      const stderrLine = firstNonEmptyLine(attempt.proc.stderr);
      const structuredFailure = describeCopilotFailure({
        errorMessage: attempt.parsed.errorMessage,
        stderr: attempt.proc.stderr,
      });
      const fallbackErrorMessage =
        parsedError ||
        attempt.parsed.modelCallErrorMessage ||
        structuredFailure ||
        stderrLine ||
        (attempt.proc.signal
          ? `Copilot was terminated by signal ${attempt.proc.signal}`
          : `Copilot exited with code ${attempt.proc.exitCode ?? -1}`);
      const errorMessage = outdatedCli
        ? `Copilot CLI rejected ${outdatedCli.flag ? `option ${outdatedCli.flag}` : "an option"} as unknown: the installed build is older than this adapter expects. ` +
          "This usually happens when COPILOT_AUTO_UPDATE=false or --no-auto-update pins the stale bundled version; remove them (the adapter relies on CI=1 instead) or update the CLI."
        : fallbackErrorMessage;

      const resultJson: Record<string, unknown> = {
        premiumRequests,
        premiumRequestsCumulative,
        // Per-run delta of the session-cumulative cost; the raw cumulative is alongside.
        ...(usageDelta?.totalPremiumRequestCost != null
          ? {
              totalPremiumRequestCost: usageDelta.totalPremiumRequestCost,
              totalPremiumRequestCostCumulative: currentCumulative?.totalPremiumRequestCost ?? null,
            }
          : {}),
        codeChanges: attempt.parsed.codeChanges,
        totalApiDurationMs: attempt.parsed.totalApiDurationMs,
        toolCalls: attempt.parsed.toolCalls,
        toolResults: attempt.parsed.toolResults,
        ...(failed ? { stderr: attempt.proc.stderr } : {}),
      };

      return {
        exitCode: attempt.proc.exitCode,
        signal: attempt.proc.signal,
        timedOut: false,
        ...billing,
        errorMessage: failed ? errorMessage : null,
        // Forward the transport-level error code from the run-disposition seam
        // first (e.g. `duplex_channel_lost`), then classify auth/network.
        errorCode: attempt.proc.errorCode
          ? attempt.proc.errorCode
          : failed && outdatedCli
          ? "copilot_cli_outdated"
          : failed && authMeta.requiresAuth
          ? "copilot_auth_required"
          : failed && networkUnavailable
          ? "copilot_network_unavailable"
          : null,
        sessionId: resolvedSessionId,
        sessionParams: resolvedSessionParams,
        sessionDisplayId: resolvedSessionId,
        resultJson,
        summary: attempt.parsed.summary,
        clearSession: Boolean(clearSessionOnMissingSession && !resolvedSessionId),
      };
    };

    const initial = await runAttempt(sessionId);
    if (
      sessionId &&
      !initial.proc.timedOut &&
      (initial.proc.exitCode ?? 0) !== 0 &&
      !ctx.signal?.aborted &&
      isCopilotSessionUnrecoverableError(initial.proc.stdout, initial.proc.stderr)
    ) {
      await onLog(
        "stdout",
        `[paperclip] Copilot resume session "${sessionId}" is unavailable; retrying with a fresh session.\n`,
      );
      const retry = await runAttempt(null);
      return toResult(retry, true);
    }

    return toResult(initial);
  } finally {
    try {
      await providerStop.collectBeforeRestore();
    } finally {
      await Promise.all([
        ...usageFiles.map((file) => fs.rm(file, { force: true }).catch(() => undefined)),
        paperclipBridge?.stop(),
        restoreRemoteWorkspace?.(),
        localSkillsDir ? fs.rm(path.dirname(localSkillsDir), { recursive: true, force: true }).catch(() => undefined) : Promise.resolve(),
      ]);
    }
  }
}
