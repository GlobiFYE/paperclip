import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AdapterExecutionContext,
  AdapterRuntimeMcpServer,
} from "@paperclipai/adapter-utils";
import {
  adapterExecutionTargetUsesManagedHome,
  describeAdapterExecutionTarget,
  prepareAdapterExecutionTargetRuntime,
  readAdapterExecutionTargetHomeDir,
  runAdapterExecutionTargetShellCommand,
  type AdapterExecutionTarget,
} from "@paperclipai/adapter-utils/execution-target";
import { refreshPaperclipWorkspaceEnvForExecution } from "@paperclipai/adapter-utils/server-utils";
import {
  copyBackAgyAuth,
  resolveAgyOAuthTokenPath,
  stageAgyHomeForSync,
} from "./credentials.js";
import { stageAgyMcpConfigForSync } from "./mcp.js";
import { SANDBOX_INSTALL_COMMAND } from "../index.js";

export interface PrepareAgyRemoteRunInput {
  runId: string;
  executionTarget: AdapterExecutionTarget | null;
  cwd: string;
  command: string;
  timeoutSec: number;
  graceSec: number;
  runtimeCommandSpec: AdapterExecutionContext["runtimeCommandSpec"];
  onLog: AdapterExecutionContext["onLog"];
  onRuntimeProgress: AdapterExecutionContext["onRuntimeProgress"];
  runtimeEnv: Record<string, string>;
  env: Record<string, string>;
  envConfig: Record<string, unknown>;
  runtimeMcpServers: AdapterRuntimeMcpServer[];
  skillsAssetDir: string | null;
  effectiveExecutionCwd: string;
  workspaceCwd: string;
  workspaceSource: string;
  workspaceId: string;
  workspaceRepoUrl: string;
  workspaceRepoRef: string;
  workspaceHints: Record<string, unknown>[];
  agentHome: string;
}

export interface PreparedAgyRemoteRun {
  restoreRemoteWorkspace: (() => Promise<void>) | null;
  remoteRuntimeRootDir: string | null;
  remoteSkillsDir: string | null;
  stagedAgyHomeDir: string | null;
  stagedMcpConfigDir: string | null;
  effectiveExecutionCwd: string;
  cleanupSetupFailure: () => Promise<void>;
}

/**
 * Remote-run setup for agy_local: stage the Antigravity home and MCP
 * config on the controller, sync the workspace and runtime assets to the
 * target, and wire the run environment (managed HOME, CLI homes pointed
 * at the staged asset dir, remote MCP config link). Extracted from
 * execute.ts so the executor stays reviewable; behavior is unchanged.
 */
export async function prepareAgyRemoteRun(
  input: PrepareAgyRemoteRunInput,
): Promise<PreparedAgyRemoteRun> {
  const {
    runId,
    executionTarget,
    cwd,
    command,
    timeoutSec,
    graceSec,
    onLog,
    runtimeEnv,
    env,
    envConfig,
    runtimeMcpServers,
    skillsAssetDir,
    workspaceCwd,
    workspaceSource,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    workspaceHints,
    agentHome,
  } = input;

  let restoreRemoteWorkspace: (() => Promise<void>) | null = null;
  let remoteRuntimeRootDir: string | null = null;
  let remoteSkillsDir: string | null = null;
  let stagedAgyHomeDir: string | null = null;
  let stagedMcpConfigDir: string | null = null;
  let effectiveExecutionCwd = input.effectiveExecutionCwd;
  // Assigned by the MCP link step once the remote home is known; the
  // mcp-config asset's restore callback delegates to it during teardown.
  let restoreRemoteMcpConfig: (() => Promise<void>) | null = null;

  // Remote setup stages credential-bearing temp directories on the
  // controller before the run starts. Any failure after staging — during
  // runtime preparation, command resolution, or bridge startup — must run
  // the same teardown as a completed run, or those files leak and the
  // remote workspace is never restored.
  const cleanupSetupFailure = async (): Promise<void> => {
    await Promise.allSettled([
      restoreRemoteWorkspace?.(),
      stagedAgyHomeDir
        ? fs.rm(stagedAgyHomeDir, { recursive: true, force: true }).catch(() => undefined)
        : Promise.resolve(),
      stagedMcpConfigDir
        ? fs.rm(stagedMcpConfigDir, { recursive: true, force: true }).catch(() => undefined)
        : Promise.resolve(),
    ]);
  };

  try {
    const hostTokenPath =
      resolveAgyOAuthTokenPath(runtimeEnv.HOME || os.homedir(), runtimeEnv) ??
      path.join(runtimeEnv.HOME || os.homedir(), ".gemini", "antigravity-cli", "antigravity-oauth-token");
    stagedAgyHomeDir = await stageAgyHomeForSync({
      homedir: runtimeEnv.HOME || os.homedir(),
      env: runtimeEnv,
      runId,
    });

    if (runtimeMcpServers.length > 0) {
      stagedMcpConfigDir = await stageAgyMcpConfigForSync({
        servers: runtimeMcpServers,
        runId,
        homedir: runtimeEnv.HOME || os.homedir(),
        env: runtimeEnv,
      });
    }

    await onLog(
      "stdout",
      `[paperclip] Syncing workspace and Antigravity runtime assets to ${describeAdapterExecutionTarget(executionTarget)}.\n`,
    );

    const preparedExecutionTargetRuntime = await prepareAdapterExecutionTargetRuntime({
      runId,
      target: executionTarget,
      adapterKey: "agy",
      timeoutSec,
      workspaceLocalDir: cwd,
      installCommand: input.runtimeCommandSpec?.installCommand ?? SANDBOX_INSTALL_COMMAND,
      detectCommand: command,
      onProgress: (line) => onLog("stdout", line),
      onRuntimeProgress: input.onRuntimeProgress,
      assets: [
        ...(skillsAssetDir
          ? [
              {
                key: "skills",
                localDir: skillsAssetDir,
                followSymlinks: true,
              },
            ]
          : []),
        {
          key: "agy-home",
          localDir: stagedAgyHomeDir,
          followSymlinks: true,
          restore: async ({ assetDir, readFile }: { assetDir: string; readFile: (p: string) => Promise<Buffer> }) => {
            await copyBackAgyAuth({
              readSandboxAuth: () =>
                readFile(path.posix.join(assetDir, "antigravity-oauth-token")),
              hostTokenPath,
              log: (line) => onLog("stdout", `${line}\n`),
              env: process.env,
            });
          },
        },
        ...(stagedMcpConfigDir
          ? [
              {
                key: "mcp-config",
                localDir: stagedMcpConfigDir,
                followSymlinks: true,
                restore: async () => {
                  await restoreRemoteMcpConfig?.();
                },
              },
            ]
          : []),
      ],
    });

    restoreRemoteWorkspace = () =>
      preparedExecutionTargetRuntime.restoreWorkspace((line) => onLog("stdout", line));
    effectiveExecutionCwd = preparedExecutionTargetRuntime.workspaceRemoteDir ?? effectiveExecutionCwd;

    refreshPaperclipWorkspaceEnvForExecution({
      env,
      envConfig,
      workspaceCwd,
      workspaceSource,
      workspaceId,
      workspaceRepoUrl,
      workspaceRepoRef,
      workspaceHints,
      agentHome,
      executionTargetIsRemote: true,
      executionCwd: effectiveExecutionCwd,
    });

    remoteRuntimeRootDir = preparedExecutionTargetRuntime.runtimeRootDir;
    remoteSkillsDir = preparedExecutionTargetRuntime.assetDirs.skills ?? null;

    const managedHome = adapterExecutionTargetUsesManagedHome(executionTarget);
    const managedRemoteHomeDir =
      managedHome && preparedExecutionTargetRuntime.runtimeRootDir
        ? preparedExecutionTargetRuntime.runtimeRootDir
        : null;
    if (managedRemoteHomeDir) {
      env.HOME = managedRemoteHomeDir;
    }
    const remoteHomeDir =
      managedRemoteHomeDir ??
      (await readAdapterExecutionTargetHomeDir(runId, executionTarget, {
        cwd: effectiveExecutionCwd,
        env,
        timeoutSec,
        graceSec,
        onLog,
      }));

    if (preparedExecutionTargetRuntime.assetDirs["agy-home"]) {
      // Point the CLI home at the staged asset directory itself. The
      // remote user's own ~/.gemini/antigravity-cli must never be
      // deleted or replaced: on SSH targets it holds their real login,
      // settings and conversation state.
      const stagedAgyHomeRemote = preparedExecutionTargetRuntime.assetDirs["agy-home"];
      env.ANTIGRAVITY_CLI_HOME = stagedAgyHomeRemote;
      env.GEMINI_CLI_HOME = stagedAgyHomeRemote;
    }

    if (remoteHomeDir && preparedExecutionTargetRuntime.assetDirs["mcp-config"]) {
      const stagedMcpConfigRemote = preparedExecutionTargetRuntime.assetDirs["mcp-config"];
      const targetMcpConfig = path.posix.join(remoteHomeDir, ".gemini", "config", "mcp_config.json");
      const stagedMcpFile = path.posix.join(stagedMcpConfigRemote, "mcp_config.json");
      const backupMcpConfig = `${targetMcpConfig}.paperclip-backup-${runId}`;
      // The link below replaces the remote user's own mcp_config.json (on
      // SSH targets remoteHomeDir is their real home, not a private one).
      // Preserve a pre-existing file first and put it back during workspace
      // restore, so servers configured only on the remote machine survive
      // the run. To prevent concurrent runs from deleting each other's active
      // tools, teardown only replaces or deletes targetMcpConfig if this run
      // is still the one pointing targetMcpConfig at stagedMcpFile.
      restoreRemoteMcpConfig = async () => {
        await runAdapterExecutionTargetShellCommand(
          runId,
          executionTarget,
          `if [ -L ${JSON.stringify(targetMcpConfig)} ] && [ "$(readlink ${JSON.stringify(targetMcpConfig)})" = ${JSON.stringify(stagedMcpFile)} ] || ([ -f ${JSON.stringify(targetMcpConfig)} ] && cmp -s ${JSON.stringify(targetMcpConfig)} ${JSON.stringify(stagedMcpFile)}); then if [ -e ${JSON.stringify(backupMcpConfig)} ] || [ -L ${JSON.stringify(backupMcpConfig)} ]; then rm -f ${JSON.stringify(targetMcpConfig)}; mv ${JSON.stringify(backupMcpConfig)} ${JSON.stringify(targetMcpConfig)}; else rm -f ${JSON.stringify(targetMcpConfig)}; fi; else rm -rf ${JSON.stringify(backupMcpConfig)}; fi`,
          { cwd: effectiveExecutionCwd, env, timeoutSec, graceSec, onLog },
        ).catch(() => undefined);
      };
      await runAdapterExecutionTargetShellCommand(
        runId,
        executionTarget,
        `mkdir -p ${JSON.stringify(path.posix.dirname(targetMcpConfig))}; if [ -L ${JSON.stringify(targetMcpConfig)} ] && [ "$(readlink ${JSON.stringify(targetMcpConfig)})" = ${JSON.stringify(stagedMcpFile)} ]; then rm -f ${JSON.stringify(targetMcpConfig)}; elif [ -e ${JSON.stringify(targetMcpConfig)} ] || [ -L ${JSON.stringify(targetMcpConfig)} ]; then if [ ! -e ${JSON.stringify(backupMcpConfig)} ] && [ ! -L ${JSON.stringify(backupMcpConfig)} ]; then cp -a ${JSON.stringify(targetMcpConfig)} ${JSON.stringify(backupMcpConfig)}; fi; rm -f ${JSON.stringify(targetMcpConfig)}; fi; ln -s ${JSON.stringify(stagedMcpFile)} ${JSON.stringify(targetMcpConfig)} || cp -a ${JSON.stringify(stagedMcpFile)} ${JSON.stringify(targetMcpConfig)}`,
        { cwd: effectiveExecutionCwd, env, timeoutSec, graceSec, onLog },
      );
      await onLog(
        "stdout",
        `[paperclip] Configured ${runtimeMcpServers.length} Paperclip-managed MCP server(s) in remote ${targetMcpConfig}.\n`,
      );
    }

    Object.assign(runtimeEnv, {
      ...(env.HOME ? { HOME: env.HOME } : {}),
      ...(env.ANTIGRAVITY_CLI_HOME ? { ANTIGRAVITY_CLI_HOME: env.ANTIGRAVITY_CLI_HOME } : {}),
      ...(env.GEMINI_CLI_HOME ? { GEMINI_CLI_HOME: env.GEMINI_CLI_HOME } : {}),
    });
  } catch (error) {
    await cleanupSetupFailure();
    throw error;
  }

  return {
    restoreRemoteWorkspace,
    remoteRuntimeRootDir,
    remoteSkillsDir,
    stagedAgyHomeDir,
    stagedMcpConfigDir,
    effectiveExecutionCwd,
    cleanupSetupFailure,
  };
}
