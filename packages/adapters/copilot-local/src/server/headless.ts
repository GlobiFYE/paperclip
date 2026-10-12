import type { CopilotReasoningEffort } from "../index.js";

/**
 * Headless-safe environment for unattended `copilot` runs. Shared by execute
 * and the testEnvironment hello probe. These keys are forced and cannot be
 * overridden through config.env.
 *
 * - CI=1 stops auto-update downloads without downgrading to the stale bundled
 *   build (do NOT set COPILOT_AUTO_UPDATE=false or pass --no-auto-update).
 * - NO_COLOR=1 keeps stdout parseable.
 * - COPILOT_ALLOW_ALL=false is set EXPLICITLY (not deleted): the child process
 *   env is rebuilt as {...process.env, ...opts.env}, so a host value of "true"
 *   would otherwise survive, trust the cwd and load repo hooks / workspace MCP.
 *   Tool approval comes from the explicit --allow-all-tools flag instead. The
 *   two prompt-mode vars are pinned for the same reason.
 */
export function buildCopilotHeadlessEnv(env: Record<string, string>): Record<string, string> {
  return {
    ...env,
    CI: "1",
    NO_COLOR: "1",
    COPILOT_ALLOW_ALL: "false",
    GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS: "false",
    GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP: "false",
  };
}

/** Flags shared by real runs and the hello probe (everything except prompt/session wiring). */
export function buildCopilotBaseArgs(opts: {
  model: string;
  reasoningEffort: CopilotReasoningEffort | null;
  allowAllPaths: boolean;
  disableBuiltinMcps: boolean;
}): string[] {
  const args = [
    "--output-format", "json",
    "--allow-all-tools",
    "--no-ask-user",
    "--no-color",
    "--log-level", "warning",
    "--model", opts.model,
  ];
  if (opts.reasoningEffort) args.push("--reasoning-effort", opts.reasoningEffort);
  if (opts.allowAllPaths) args.push("--allow-all-paths");
  if (opts.disableBuiltinMcps) args.push("--disable-builtin-mcps");
  args.push("--secret-env-vars=COPILOT_GITHUB_TOKEN");
  return args;
}
