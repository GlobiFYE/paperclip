import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { asBoolean } from "@paperclipai/adapter-utils/server-utils";
import type { AdapterRuntimeMcpServer } from "@paperclipai/adapter-utils";

type PreparedOpenCodeRuntimeConfig = {
  env: Record<string, string>;
  notes: string[];
  cleanup: () => Promise<void>;
};

/**
 * Build the `mcp` block OpenCode needs to reach a Paperclip-assigned runtime MCP
 * gateway. These are remote HTTP servers authenticated with a run-scoped bearer
 * token, so the token is written into the staged config file only -- never into
 * env or notes, both of which reach the log stream.
 */
function buildRuntimeMcpBlock(servers: AdapterRuntimeMcpServer[]): Record<string, unknown> {
  const block: Record<string, unknown> = {};
  for (const server of servers) {
    const name = server.name.trim();
    block[name] = {
      type: "remote",
      url: server.url,
      enabled: true,
      oauth: false,
      headers: { Authorization: `Bearer ${server.token}` },
      timeout: 30_000,
    };
  }
  return block;
}

/**
 * Reserve a collision-free config key for a Paperclip-assigned server. A user
 * config may already define a server under the assigned name; the issue's
 * contract is that merging must never clobber a user-defined entry, so fall back
 * through suffixed names instead of overwriting.
 */
function collisionSafeMcpName(preferred: string, existing: Record<string, unknown>): string {
  const base = preferred.replace(/[^A-Za-z0-9_-]/g, "_") || "paperclip_assigned";
  if (!Object.prototype.hasOwnProperty.call(existing, base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}_${index}`;
    if (!Object.prototype.hasOwnProperty.call(existing, candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

/**
 * Filter raw runtime MCP server records down to the ones that are actually
 * deliverable. A malformed record must not produce a config with an empty URL or
 * an `Authorization: Bearer undefined` header, which would surface to the model
 * as a confusing auth failure instead of a missing tool.
 */
function usableRuntimeMcpServers(raw: unknown): AdapterRuntimeMcpServer[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is AdapterRuntimeMcpServer => {
    if (!isPlainObject(entry)) return false;
    const { name, url, token } = entry as Record<string, unknown>;
    return (
      typeof name === "string" &&
      name.trim().length > 0 &&
      typeof url === "string" &&
      url.trim().length > 0 &&
      typeof token === "string" &&
      token.length > 0
    );
  });
}

function resolveXdgConfigHome(env: Record<string, string>): string {
  return (
    (typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim()) ||
    (typeof process.env.XDG_CONFIG_HOME === "string" && process.env.XDG_CONFIG_HOME.trim()) ||
    path.join(os.homedir(), ".config")
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Recursively replace {env:VAR} placeholders with the resolved value. Used to bake
// gateway provider secrets (e.g. the LLM-gateway virtual key) into opencode.json
// SERVER-SIDE, where the value is reliably present. OpenCode's own {env:...}
// resolution happens inside the (possibly sandboxed) run process, whose env
// plumbing is not guaranteed to carry the key to OpenCode's spawned server -- so
// we resolve it here. Unresolvable placeholders are left intact for OpenCode to try.
function expandEnvPlaceholders<T>(value: T, resolve: (name: string) => string | undefined): T {
  if (typeof value === "string") {
    return value.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => {
      const resolved = resolve(name);
      return resolved !== undefined && resolved.length > 0 ? resolved : match;
    }) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => expandEnvPlaceholders(entry, resolve)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = expandEnvPlaceholders(entry, resolve);
    }
    return out as unknown as T;
  }
  return value;
}

function parseProviderConfig(
  raw: unknown,
  resolveEnv: (name: string) => string | undefined,
  notes: string[],
): Record<string, unknown> | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Surface the misconfiguration instead of silently dropping the provider
    // block; an unparseable value would otherwise be undiagnosable.
    notes.push("PAPERCLIP_OPENCODE_PROVIDERS contains invalid JSON; custom providers ignored.");
    return null;
  }
  if (!isPlainObject(parsed)) {
    notes.push(
      "PAPERCLIP_OPENCODE_PROVIDERS is set but is not a JSON object; custom providers ignored.",
    );
    return null;
  }
  // Only keep provider entries that are themselves objects; surface the ones
  // we drop so a malformed entry is just as diagnosable as malformed JSON.
  const providers: Record<string, unknown> = {};
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (isPlainObject(value)) providers[key] = expandEnvPlaceholders(value, resolveEnv);
    else skipped.push(key);
  }
  if (skipped.length > 0) {
    notes.push(
      `PAPERCLIP_OPENCODE_PROVIDERS: skipped provider(s) with non-object values: ${skipped.join(", ")}.`,
    );
  }
  return Object.keys(providers).length > 0 ? providers : null;
}

function parseConfiguredModelRef(raw: unknown): { provider: string; model: string } | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) return null;
  return { provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) };
}

async function readJsonObject(filepath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filepath, "utf8");
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function prepareOpenCodeRuntimeConfig(input: {
  env: Record<string, string>;
  config: Record<string, unknown>;
  targetIsRemote?: boolean;
  /**
   * Run-scoped runtime MCP servers assigned to this run by the Paperclip runtime
   * (`ctx.runtimeMcp`). These are the only path by which plugin-contributed and
   * gateway-aggregated tools reach OpenCode: `buildRuntimeToolsEnv` only exposes
   * the fixed connection-intent tool pair, and OpenCode has no other Paperclip
   * tool transport.
   */
  runtimeMcpServers?: AdapterRuntimeMcpServer[];
}): Promise<PreparedOpenCodeRuntimeConfig> {
  const skipPermissions = asBoolean(input.config.dangerouslySkipPermissions, true);
  const runtimeMcpServers = usableRuntimeMcpServers(input.runtimeMcpServers);
  const targetIsRemote = input.targetIsRemote === true;

  // Staging is required to deliver assigned MCP servers, so it can no longer be
  // gated on `dangerouslySkipPermissions`. The permission override is the
  // permission-loosening half of the staged config and stays gated on it.
  //
  // For remote targets the host XDG config dir must not be copied -- that leaks
  // host paths into a remote runtime -- so a remote stage writes only the blocks
  // that are safe to synthesize (the assigned MCP servers).
  const shouldInjectPermissionOverride = skipPermissions && !targetIsRemote;
  const shouldStage = skipPermissions || runtimeMcpServers.length > 0;
  if (!shouldStage) {
    return {
      env: input.env,
      notes: [],
      cleanup: async () => {},
    };
  }
  if (targetIsRemote && !skipPermissions) {
    return {
      env: input.env,
      notes: [],
      cleanup: async () => {},
    };
  }

  const sourceConfigDir = path.join(resolveXdgConfigHome(input.env), "opencode");
  const runtimeConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-config-"));
  const runtimeConfigDir = path.join(runtimeConfigHome, "opencode");
  const runtimeConfigPath = path.join(runtimeConfigDir, "opencode.json");

  await fs.mkdir(runtimeConfigDir, { recursive: true });
  if (!targetIsRemote) {
    try {
      await fs.cp(sourceConfigDir, runtimeConfigDir, {
        recursive: true,
        force: true,
        errorOnExist: false,
        dereference: false,
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException | null)?.code !== "ENOENT") {
        throw err;
      }
    }
  }

  const existingConfig = await readJsonObject(runtimeConfigPath);
  const existingPermission = isPlainObject(existingConfig.permission)
    ? existingConfig.permission
    : {};
  const notes = shouldInjectPermissionOverride
    ? [
        "Injected runtime OpenCode config with permission.external_directory=allow to avoid headless approval prompts.",
      ]
    : [];

  // Merge gateway/custom provider definitions supplied via PAPERCLIP_OPENCODE_PROVIDERS
  // (a JSON object in OpenCode's `provider` shape). OpenCode resolves a `--model
  // provider/model` only when that model exists in a provider's `models` map, and
  // OPENCODE_ALLOW_ALL_MODELS does NOT bypass its internal getModel(). So routing a
  // gateway model (e.g. an EU LLM gateway exposing OpenAI-compatible /v1) requires a
  // custom provider with an explicit models map. We accept it as config (not
  // hard-coded) so the gateway URL, key env, and model list stay declarative.
  const resolveEnv = (name: string): string | undefined => input.env[name] ?? process.env[name];
  const gatewayProviders = parseProviderConfig(
    input.env.PAPERCLIP_OPENCODE_PROVIDERS ?? process.env.PAPERCLIP_OPENCODE_PROVIDERS,
    resolveEnv,
    notes,
  );
  const existingProvider = isPlainObject(existingConfig.provider) ? existingConfig.provider : {};
  let nextProvider = gatewayProviders
    ? { ...existingProvider, ...gatewayProviders }
    : existingProvider;
  if (gatewayProviders) {
    notes.push(
      `Injected ${Object.keys(gatewayProviders).length} custom OpenCode provider(s) from PAPERCLIP_OPENCODE_PROVIDERS: ${Object.keys(gatewayProviders).join(", ")}.`,
    );
  }

  // Register the configured model on its provider's models map. OpenCode resolves
  // `--model provider/model` only when the model id exists in that map, so ids the
  // models.dev catalog does not carry — OpenRouter routing variants such as
  // `openai/gpt-oss-120b:nitro`, or models newer than the bundled catalog — are
  // otherwise rejected with "Model not found" even though the provider serves them.
  // An empty entry deep-merges with catalog metadata, so this is a no-op for models
  // the catalog already knows, and we never clobber an explicit definition from the
  // user config or PAPERCLIP_OPENCODE_PROVIDERS.
  const configuredModel = parseConfiguredModelRef(input.config.model);
  if (configuredModel) {
    const providerEntry = isPlainObject(nextProvider[configuredModel.provider])
      ? { ...(nextProvider[configuredModel.provider] as Record<string, unknown>) }
      : {};
    const providerModels = isPlainObject(providerEntry.models)
      ? { ...(providerEntry.models as Record<string, unknown>) }
      : {};
    if (!isPlainObject(providerModels[configuredModel.model])) {
      providerModels[configuredModel.model] = {};
      providerEntry.models = providerModels;
      nextProvider = { ...nextProvider, [configuredModel.provider]: providerEntry };
      notes.push(
        `Registered configured model ${configuredModel.provider}/${configuredModel.model} in the runtime OpenCode config.`,
      );
    }
  }

  const nextConfig: Record<string, unknown> = { ...existingConfig };
  if (shouldInjectPermissionOverride) {
    nextConfig.permission = {
      ...existingPermission,
      external_directory: "allow",
    };
  }
  if (Object.keys(nextProvider).length > 0) {
    nextConfig.provider = nextProvider;
  }

  // Merge the run-scoped runtime MCP servers into any user-defined `mcp` entries.
  // This is the delivery path for plugin-contributed and gateway-aggregated tools;
  // without it an `opencode_local` agent sees only the fixed connection-intent pair
  // that `buildRuntimeToolsEnv` exposes.
  if (runtimeMcpServers.length > 0) {
    const existingMcp = isPlainObject(existingConfig.mcp) ? existingConfig.mcp : {};
    const mergedMcp: Record<string, unknown> = { ...existingMcp };
    const assignedNames: string[] = [];
    for (const [preferred, definition] of Object.entries(buildRuntimeMcpBlock(runtimeMcpServers))) {
      const name = collisionSafeMcpName(preferred, mergedMcp);
      mergedMcp[name] = definition;
      assignedNames.push(name);
    }
    nextConfig.mcp = mergedMcp;
    // Report the assigned server names only. The bearer token is deliberately
    // excluded: notes are surfaced in the run log.
    notes.push(
      `Injected ${assignedNames.length} Paperclip runtime MCP server(s) into the runtime OpenCode config: ${assignedNames.join(", ")}.`,
    );
  }

  // Pin OpenCode's auxiliary "small" model (used for session-title generation and
  // other helper tasks) via PAPERCLIP_OPENCODE_SMALL_MODEL. OpenCode otherwise
  // defaults the small model to a built-in provider default (e.g. a claude-* model
  // for the anthropic provider); when that provider is repointed at a gateway that
  // does not serve that exact model, the title-gen call fails and aborts the run.
  // Setting small_model to a gateway-served model keeps every call on supported models.
  const smallModel = (input.env.PAPERCLIP_OPENCODE_SMALL_MODEL ?? process.env.PAPERCLIP_OPENCODE_SMALL_MODEL)?.trim();
  if (smallModel) {
    nextConfig.small_model = smallModel;
    notes.push(`Pinned OpenCode small_model to ${smallModel}.`);
  }
  // The staged config now carries run-scoped MCP bearer tokens, so write it
  // owner-only. `mode` is advisory on Windows, which has no POSIX bits, but it is
  // honoured on the platforms where the file is actually readable by other users.
  await fs.writeFile(runtimeConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  return {
    env: {
      ...input.env,
      XDG_CONFIG_HOME: runtimeConfigHome,
    },
    notes,
    cleanup: async () => {
      await fs.rm(runtimeConfigHome, { recursive: true, force: true });
    },
  };
}
