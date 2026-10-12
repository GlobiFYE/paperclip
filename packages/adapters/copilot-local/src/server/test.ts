import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  asNumber,
  asString,
  asStringArray,
  ensurePathInEnv,
  parseObject,
} from "@paperclipai/adapter-utils/server-utils";
import {
  ensureAdapterExecutionTargetCommandResolvable,
  maybeRunSandboxInstallCommand,
  ensureAdapterExecutionTargetDirectory,
  runAdapterExecutionTargetProcess,
  describeAdapterExecutionTarget,
  resolveAdapterExecutionTargetCwd,
} from "@paperclipai/adapter-utils/execution-target";
import { SANDBOX_INSTALL_COMMAND } from "../index.js";
import { DEFAULT_COPILOT_LOCAL_MODEL } from "../index.js";
import { buildCopilotBaseArgs, buildCopilotHeadlessEnv } from "./headless.js";
import { resolveCopilotReasoningEffort } from "../index.js";
import { detectCopilotAuthRequired, parseCopilotJsonl } from "./parse.js";
import { firstNonEmptyLine } from "./utils.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function commandLooksLike(command: string, expected: string): boolean {
  const base = path.basename(command).toLowerCase();
  return base === expected || base === `${expected}.cmd` || base === `${expected}.exe`;
}

function summarizeProbeDetail(stdout: string, stderr: string, parsedError: string | null): string | null {
  const raw = parsedError?.trim() || firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  const max = 240;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

async function pathExists(candidate: string): Promise<boolean> {
  return fs.access(candidate).then(() => true).catch(() => false);
}

const CREDENTIAL_ENV_KEYS = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] as const;

/**
 * Strip `//` line comments and block comments from JSONC while leaving
 * string contents (for example URLs containing `//`) untouched. Copilot
 * writes a leading `// User settings ...` comment into config.json.
 */
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
    } else if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/** True when a Copilot config.json (JSONC) records a `copilot login` user. */
export function copilotConfigHasLoggedInUser(contents: string): boolean {
  try {
    const parsed: unknown = JSON.parse(stripJsonComments(contents));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    const user = (parsed as Record<string, unknown>).lastLoggedInUser;
    if (typeof user === "string") return user.trim().length > 0;
    return typeof user === "object" && user !== null && Object.keys(user).length > 0;
  } catch {
    return false;
  }
}

/**
 * Detect Copilot authentication material on the local host: a token env var
 * (adapter env or server env) or a stored `copilot login` recorded in
 * $COPILOT_HOME/config.json (default ~/.copilot/config.json). The keychain
 * itself is not inspected; `lastLoggedInUser` is the on-disk marker.
 */
async function detectLocalCopilotAuth(env: Record<string, string>): Promise<string | null> {
  for (const key of CREDENTIAL_ENV_KEYS) {
    if (isNonEmpty(env[key])) return `${key} adapter environment`;
  }
  for (const key of CREDENTIAL_ENV_KEYS) {
    if (isNonEmpty(process.env[key])) return `${key} server environment`;
  }
  const copilotHome =
    (isNonEmpty(env.COPILOT_HOME) && env.COPILOT_HOME.trim()) ||
    (isNonEmpty(process.env.COPILOT_HOME) && process.env.COPILOT_HOME.trim()) ||
    path.join(os.homedir(), ".copilot");
  const configPath = path.join(copilotHome, "config.json");
  try {
    const contents = await fs.readFile(configPath, "utf8");
    if (copilotConfigHasLoggedInUser(contents)) return `${configPath} (copilot login)`;
  } catch {
    // missing or unreadable config means no stored login
  }
  return null;
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "copilot");
  const target = ctx.executionTarget ?? null;
  const targetIsRemote = target?.kind === "remote";
  const cwd = resolveAdapterExecutionTargetCwd(target, asString(config.cwd, ""), process.cwd());
  const targetLabel = targetIsRemote
    ? ctx.environmentName ?? describeAdapterExecutionTarget(target)
    : null;
  const runId = `copilot-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (targetLabel) {
    checks.push({
      code: "copilot_environment_target",
      level: "info",
      message: `Probing inside environment: ${targetLabel}`,
    });
  }

  try {
    await ensureAdapterExecutionTargetDirectory(runId, target, cwd, {
      cwd,
      env: {},
      createIfMissing: true,
    });
    checks.push({
      code: "copilot_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "copilot_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  // CI=1 blocks auto-update downloads (without downgrading); NO_COLOR keeps output parseable.
  const probeEnv: Record<string, string> = buildCopilotHeadlessEnv(env);
  const runtimeEnv = ensurePathInEnv({ ...process.env, ...probeEnv });
  const installCheck = await maybeRunSandboxInstallCommand({
    runId,
    target,
    adapterKey: "copilot",
    installCommand: SANDBOX_INSTALL_COMMAND,
    detectCommand: command,
    env,
  });
  if (installCheck) checks.push(installCheck);
  try {
    await ensureAdapterExecutionTargetCommandResolvable(command, target, cwd, runtimeEnv);
    checks.push({
      code: "copilot_command_resolvable",
      level: "info",
      message: `Command is executable: ${command}`,
    });
  } catch (err) {
    checks.push({
      code: "copilot_command_unresolvable",
      level: "error",
      message: err instanceof Error ? err.message : "Command is not executable",
      detail: command,
    });
  }

  const canRunProbe =
    checks.every((check) => check.code !== "copilot_cwd_invalid" && check.code !== "copilot_command_unresolvable");

  if (canRunProbe && commandLooksLike(command, "copilot")) {
    const versionProbe = await runAdapterExecutionTargetProcess(
      runId,
      target,
      command,
      ["--version"],
      {
        cwd,
        env: probeEnv,
        timeoutSec: 15,
        graceSec: 5,
        onLog: async () => {},
      },
    );
    const versionLine = firstNonEmptyLine(versionProbe.stdout) || firstNonEmptyLine(versionProbe.stderr);
    const copilotVersion = versionLine.match(/\d+\.\d+\.\d+[\w.+-]*/)?.[0] ?? null;
    if (!versionProbe.timedOut && (versionProbe.exitCode ?? 1) === 0) {
      checks.push({
        code: "copilot_version_detected",
        level: "info",
        message: `Copilot CLI detected${copilotVersion ? `: ${copilotVersion}` : "."}`,
        ...(versionLine ? { detail: versionLine.replace(/\s+/g, " ").trim().slice(0, 120) } : {}),
      });
    } else {
      checks.push({
        code: "copilot_version_probe_failed",
        level: "warn",
        message: versionProbe.timedOut
          ? "`copilot --version` timed out."
          : "`copilot --version` did not exit cleanly.",
        ...(versionLine ? { detail: versionLine } : {}),
      });
    }
  }

  const remoteTokenKey = CREDENTIAL_ENV_KEYS.find((key) => isNonEmpty(env[key]));
  const authSource = targetIsRemote
    ? (remoteTokenKey ? `${remoteTokenKey} adapter environment` : null)
    : await detectLocalCopilotAuth(env);
  if (authSource) {
    checks.push({
      code: "copilot_auth_detected",
      level: "info",
      message: "Copilot authentication material detected.",
      detail: `Source: ${authSource}.`,
    });
  } else {
    checks.push({
      code: "copilot_auth_missing",
      level: "warn",
      message: "No Copilot authentication detected.",
      hint: "Run `copilot login` on the target host, or set COPILOT_GITHUB_TOKEN in the adapter env.",
    });
  }

  if (canRunProbe) {
    if (!commandLooksLike(command, "copilot")) {
      checks.push({
        code: "copilot_hello_probe_skipped_custom_command",
        level: "info",
        message: "Skipped hello probe because command is not `copilot`.",
        detail: command,
        hint: "Use the `copilot` CLI command to run the automatic installation and auth probe.",
      });
    } else {
      const model = asString(config.model, "").trim() || DEFAULT_COPILOT_LOCAL_MODEL;
      const helloProbeTimeoutSec = Math.max(1, asNumber(config.helloProbeTimeoutSec, 60));
      const extraArgs = (() => {
        const fromExtraArgs = asStringArray(config.extraArgs);
        if (fromExtraArgs.length > 0) return fromExtraArgs;
        return asStringArray(config.args);
      })();

      const args = [
        "-p", "Reply with OK",
        ...buildCopilotBaseArgs({
          model,
          reasoningEffort: resolveCopilotReasoningEffort(config.effort ?? config.reasoningEffort),
          allowAllPaths: config.allowAllPaths === true || config.allowAllPaths === "true",
          disableBuiltinMcps: config.disableBuiltinMcps === true || config.disableBuiltinMcps === "true",
        }),
      ];
      if (extraArgs.length > 0) args.push(...extraArgs);

      const probe = await runAdapterExecutionTargetProcess(
        runId,
        target,
        command,
        args,
        {
          cwd,
          env: probeEnv,
          timeoutSec: helloProbeTimeoutSec,
          graceSec: 5,
          onLog: async () => {},
        },
      );
      const parsed = parseCopilotJsonl(probe.stdout);
      const detail = summarizeProbeDetail(probe.stdout, probe.stderr, parsed.errorMessage);
      const authMeta = detectCopilotAuthRequired({
        stdout: probe.stdout,
        stderr: probe.stderr,
      });

      if (probe.timedOut) {
        checks.push({
          code: "copilot_hello_probe_timed_out",
          level: "warn",
          message: "Copilot hello probe timed out.",
          hint: "Retry the probe. If this persists, verify Copilot can run `copilot -p \"Reply with OK\" --allow-all-tools` from this directory manually.",
        });
      } else if ((probe.exitCode ?? 1) === 0) {
        const summary = parsed.summary.trim();
        const gotReply = summary.length > 0 && !parsed.failed;
        checks.push({
          code: gotReply ? "copilot_hello_probe_passed" : "copilot_hello_probe_unexpected_output",
          level: gotReply ? "info" : "warn",
          message: gotReply
            ? "Copilot hello probe succeeded."
            : "Copilot probe exited cleanly but returned no assistant message.",
          ...(summary ? { detail: summary.replace(/\s+/g, " ").trim().slice(0, 240) } : {}),
          ...(gotReply
            ? {}
            : {
              hint: "Try `copilot -p \"Reply with OK\" --output-format json --allow-all-tools --no-ask-user` manually to inspect full output.",
            }),
        });
      } else if (authMeta.requiresAuth) {
        checks.push({
          code: "copilot_hello_probe_auth_required",
          level: "warn",
          message: "Copilot CLI is installed, but authentication is not ready.",
          ...(detail ? { detail } : {}),
          hint: "Run `copilot login` or set COPILOT_GITHUB_TOKEN in the adapter env, then retry the probe.",
        });
      } else {
        checks.push({
          code: "copilot_hello_probe_failed",
          level: "error",
          message: "Copilot hello probe failed.",
          ...(detail ? { detail } : {}),
          hint: "Run `copilot -p \"Reply with OK\" --output-format json --allow-all-tools --no-ask-user` manually in this working directory to debug.",
        });
      }
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
