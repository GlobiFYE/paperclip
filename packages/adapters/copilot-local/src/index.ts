import { buildSandboxNpmInstallCommand } from "@paperclipai/adapter-utils";

export const type = "copilot_local";
export const label = "GitHub Copilot CLI";

export const SANDBOX_INSTALL_COMMAND = buildSandboxNpmInstallCommand("@github/copilot");

/** "auto" lets Copilot pick the best available model for the account. */
export const DEFAULT_COPILOT_LOCAL_MODEL = "auto";

/**
 * Static model catalog: union of the `models.list` result recorded for
 * copilot 1.0.86 and the authenticated ACP discovery fixture for 1.0.88.
 * The live list depends on account entitlement and needs a JSON-RPC probe
 * (`copilot --headless --stdio` -> `models.list`), which is out of scope for
 * v1; any model id can still be typed in manually.
 */
export const models = [
  { id: DEFAULT_COPILOT_LOCAL_MODEL, label: "Auto" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { id: "gpt-6-luna", label: "GPT-6 Luna" },
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
  { id: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
  { id: "gpt-5-mini", label: "GPT-5 mini" },
  { id: "claude-opus-4.8", label: "Claude Opus 4.8" },
  { id: "claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { id: "grok-4.7", label: "Grok 4.7" },
  { id: "grok-4.6", label: "Grok 4.6" },
  { id: "grok-4.5", label: "Grok 4.5" },
  { id: "kimi-k3", label: "Kimi K3" },
  { id: "kimi-k2.7-code", label: "Kimi K2.7 Code" },
  { id: "mai-code-1.1-flash", label: "MAI-Code-1.1-Flash" },
];

/** Values accepted by `copilot --reasoning-effort`. Support varies per model. */
export const COPILOT_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type CopilotReasoningEffort = (typeof COPILOT_REASONING_EFFORTS)[number];

/**
 * Normalize a configured effort onto a value `--reasoning-effort` accepts.
 * Returns null for empty/unknown values so the flag is omitted and the CLI
 * (or model) default applies instead of failing the run.
 */
export function resolveCopilotReasoningEffort(effort: unknown): CopilotReasoningEffort | null {
  if (typeof effort !== "string") return null;
  const normalized = effort.trim().toLowerCase();
  return (COPILOT_REASONING_EFFORTS as readonly string[]).includes(normalized)
    ? (normalized as CopilotReasoningEffort)
    : null;
}

export const agentConfigurationDoc = `# copilot_local agent configuration

Adapter: copilot_local

Use when:
- You want Paperclip to run the GitHub Copilot CLI (copilot) locally on the host machine
- You want Copilot sessions resumed across heartbeats with --resume
- You want Paperclip skills made available to Copilot without polluting the agent workspace

Don't use when:
- You need webhook-style external invocation (use http or openclaw_gateway)
- You only need a one-shot script without an AI coding agent loop (use process)
- The GitHub Copilot CLI is not installed on the machine that runs Paperclip

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the run prompt. Its directory is made readable via --add-dir so sibling files (HEARTBEAT.md, SOUL.md, TOOLS.md) can be opened.
- promptTemplate (string, optional): run prompt template
- model (string, optional): Copilot model id (for example gpt-5.4, claude-sonnet-5.5). Defaults to "auto", which lets Copilot choose. Available models depend on your Copilot entitlement.
- effort (string, optional; alias reasoningEffort): reasoning effort (none | minimal | low | medium | high | xhigh | max), forwarded as --reasoning-effort. Support varies by model; omit to use the model default.
- command (string, optional): defaults to "copilot"
- extraArgs (string[], optional): additional CLI args appended before the prompt
- env (object, optional): KEY=VALUE environment variables. Use COPILOT_GITHUB_TOKEN for credentials.

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds
- allowAllPaths (boolean, optional): pass --allow-all-paths so Copilot may touch files outside the working directory. Defaults to false.
- disableBuiltinMcps (boolean, optional): pass --disable-builtin-mcps to turn off the built-in GitHub MCP server. Defaults to false.

Notes:
- Runs use \`copilot -p <prompt> --output-format json --allow-all-tools --no-ask-user --no-color\`; the prompt is passed as an argument, not stdin, and tool use is auto-approved without setting COPILOT_ALLOW_ALL.
- The adapter forces CI=1, NO_COLOR=1 and COPILOT_ALLOW_ALL=false (plus GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=false and GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP=false) so unattended runs never prompt, never download CLI updates, and never trust the cwd or load repo hooks/workspace MCP. These cannot be overridden via config.env. Do not set COPILOT_AUTO_UPDATE=false or pass --no-auto-update: they pin a stale bundled CLI that rejects newer flags (reported as copilot_cli_outdated).
- Prompts larger than 100 KB are sent on stdin instead of -p to stay under the OS argument-size limit.
- Fresh runs pin a generated UUID with --session-id; later heartbeats resume it with --resume=<id> when the stored session cwd matches the current cwd. If Copilot reports the session no longer exists, the run is retried once with a fresh session.
- Authentication: set COPILOT_GITHUB_TOKEN in the adapter env (fine-grained PAT or OAuth token with Copilot access), or run \`copilot login\` on the host to store an OAuth login in the keychain. GH_TOKEN / GITHUB_TOKEN are not promoted by Paperclip because Paperclip reserves them for git remote access.
- The token is hidden from Copilot output with --secret-env-vars=COPILOT_GITHUB_TOKEN.
- Usage is billed in GitHub premium requests, which Copilot reports cumulatively per session; Paperclip records the per-run delta in resultJson.premiumRequests and does not price runs in USD.
- Desired Paperclip skills are staged in a per-run directory and exposed to Copilot via COPILOT_SKILLS_DIRS (comma-separated; an existing value is kept after ours).
- Personal skills are read from $COPILOT_HOME/skills (default ~/.copilot/skills).
`;
