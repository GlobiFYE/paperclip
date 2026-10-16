import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterRuntimeMcpServer } from "@paperclipai/adapter-utils";

export interface AgyMcpServerConfig {
  url: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  [key: string]: unknown;
}

export interface AgyMcpConfigFile {
  mcpServers?: Record<string, AgyMcpServerConfig>;
  [key: string]: unknown;
}

export interface WriteAgyMcpConfigInput {
  homedir?: string;
  env?: NodeJS.ProcessEnv;
  servers: AdapterRuntimeMcpServer[];
  runId?: string;
}

export interface WriteAgyMcpConfigResult {
  configPath: string;
  injectedServerNames: string[];
  sweptStaleServerNames: string[];
  cleanup: () => Promise<void>;
}

/**
 * Resolves the path to the Antigravity mcp_config.json file.
 * Defaults to $HOME/.gemini/config/mcp_config.json.
 */
export function resolveAgyMcpConfigPath(
  homedir?: string,
  env?: NodeJS.ProcessEnv,
): string {
  const baseHome = env?.HOME || homedir || process.env.HOME || os.homedir();
  return path.join(baseHome, ".gemini", "config", "mcp_config.json");
}

/**
 * Normalizes an MCP server name to prevent naming collisions while preserving readability.
 */
export function resolveUniqueMcpServerName(
  server: AdapterRuntimeMcpServer,
  existingNames: Set<string>,
): string {
  let name = server.name.trim() || "paperclip-tool";
  if (existingNames.has(name)) {
    const connSuffix = server.connectionId ? `-${server.connectionId.slice(0, 8)}` : "";
    name = `${name}${connSuffix}`;
  }
  let suffix = 2;
  const baseName = name;
  while (existingNames.has(name)) {
    name = `${baseName}-${suffix}`;
    suffix += 1;
  }
  return name;
}

const MCP_CONFIG_LOCK_TIMEOUT_MS = 10_000;
const MCP_CONFIG_LOCK_STALE_MS = 60_000;
const MCP_CONFIG_LOCK_POLL_MS = 50;

/**
 * Serializes read-modify-write cycles on the single global mcp_config.json
 * shared by every agy run on the host. Uses an atomic mkdir lock with a
 * staleness break so a hard-killed holder cannot wedge later runs.
 */
async function withAgyMcpConfigLock<T>(configPath: string, fn: () => Promise<T>): Promise<T> {
  const lockDir = `${configPath}.paperclip-lock`;
  const deadline = Date.now() + MCP_CONFIG_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await fs.mkdir(lockDir);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        const stat = await fs.stat(lockDir);
        if (Date.now() - stat.mtimeMs > MCP_CONFIG_LOCK_STALE_MS) {
          await fs.rm(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        // Lock vanished between mkdir and stat; retry immediately.
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for the Antigravity MCP config lock at ${lockDir}`);
      }
      await new Promise((resolve) => setTimeout(resolve, MCP_CONFIG_LOCK_POLL_MS));
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Writes the config via a same-directory temp file + rename so readers never see a partial file. */
async function writeAgyMcpConfigFileAtomic(configPath: string, config: AgyMcpConfigFile): Promise<void> {
  const tmpPath = `${configPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await fs.writeFile(tmpPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    await fs.rename(tmpPath, configPath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw err;
  }
}

/**
 * True when an existing entry has exactly the shape this writer injects
 * (a URL, optionally with headers) — used to tell Paperclip-managed entries
 * apart from the user's own servers, which may use command/args/env.
 */
function isPaperclipInjectedEntry(value: unknown): value is AgyMcpServerConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length > 0 && keys.every((key) => key === "url" || key === "headers");
}

function sameInjectedEntry(a: AgyMcpServerConfig, b: AgyMcpServerConfig): boolean {
  if (!isPaperclipInjectedEntry(a)) return false;
  return a.url === b.url && JSON.stringify(a.headers ?? null) === JSON.stringify(b.headers ?? null);
}

async function readAgyMcpConfig(configPath: string): Promise<{ fileExisted: boolean; config: AgyMcpConfigFile }> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { fileExisted: false, config: {} };
    }
    throw err;
  }
  if (raw.trim().length === 0) {
    // An empty file has no contents to preserve; treat it as an empty config.
    return { fileExisted: true, config: {} };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(
      `Refusing to modify the Antigravity MCP config at ${configPath}: it exists but is not valid JSON, so its contents cannot be preserved.`,
    );
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error(
      `Refusing to modify the Antigravity MCP config at ${configPath}: it exists but is not a JSON object, so its contents cannot be preserved.`,
    );
  }
  return { fileExisted: true, config: json as AgyMcpConfigFile };
}

function extractServers(config: AgyMcpConfigFile): Record<string, AgyMcpServerConfig> {
  return config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)
    ? { ...config.mcpServers }
    : {};
}

/**
 * Writes Paperclip-managed MCP servers to Antigravity's mcp_config.json,
 * preserving existing user-configured servers, and returns a cleanup function
 * that safely removes only the injected servers after the run.
 *
 * The file is global to the host, so the whole read-modify-write runs under a
 * lock and lands via an atomic rename. Before injecting, entries left behind
 * by earlier Paperclip runs (e.g. a run that was hard-killed before its
 * cleanup could run) are swept when they sit in a current server's naming
 * space and still carry the injected shape; the user's own servers are never
 * swept. If the existing file cannot be parsed, the write refuses to proceed
 * instead of discarding the user's configuration.
 */
export async function writePaperclipAgyMcpConfig(
  input: WriteAgyMcpConfigInput,
): Promise<WriteAgyMcpConfigResult> {
  const configPath = resolveAgyMcpConfigPath(input.homedir, input.env);
  const configDir = path.dirname(configPath);
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });

  return withAgyMcpConfigLock(configPath, async () => {
    const { config: parsedConfig } = await readAgyMcpConfig(configPath);
    const existingServers = extractServers(parsedConfig);

    // Sweep leftovers from earlier Paperclip runs before injecting, so a
    // hard-killed run's token-bearing entries do not linger indefinitely or
    // force this run's servers onto suffixed names. An entry counts as a
    // leftover only when its name belongs to one of the servers being
    // injected now (exact name or the suffixed variants the unique-name
    // resolver produces) and its value still has the injected shape.
    const sweptStaleServerNames: string[] = [];
    const incomingBaseNames = input.servers
      .map((server) => server.name.trim() || "paperclip-tool")
      .filter((name, index, all) => all.indexOf(name) === index);
    for (const existingName of Object.keys(existingServers)) {
      const inIncomingNamespace = incomingBaseNames.some(
        (base) => existingName === base || existingName.startsWith(`${base}-`),
      );
      if (inIncomingNamespace && isPaperclipInjectedEntry(existingServers[existingName])) {
        delete existingServers[existingName];
        sweptStaleServerNames.push(existingName);
      }
    }

    const existingNames = new Set(Object.keys(existingServers));
    const injectedServerNames: string[] = [];
    const injectedServers: Record<string, AgyMcpServerConfig> = {};

    for (const server of input.servers) {
      const uniqueName = resolveUniqueMcpServerName(server, existingNames);
      existingNames.add(uniqueName);
      injectedServerNames.push(uniqueName);

      const serverConfig: AgyMcpServerConfig = {
        url: server.url,
        ...(server.token ? { headers: { Authorization: `Bearer ${server.token}` } } : {}),
      };
      existingServers[uniqueName] = serverConfig;
      injectedServers[uniqueName] = serverConfig;
    }

    const updatedConfig: AgyMcpConfigFile = {
      ...parsedConfig,
      mcpServers: existingServers,
    };

    await writeAgyMcpConfigFileAtomic(configPath, updatedConfig);

    const cleanup = async (): Promise<void> => {
      try {
        await withAgyMcpConfigLock(configPath, async () => {
          let current: { fileExisted: boolean; config: AgyMcpConfigFile };
          try {
            current = await readAgyMcpConfig(configPath);
          } catch {
            // Missing or no longer parseable: nothing safe to remove.
            return;
          }
          if (!current.fileExisted) return;

          const currentServers = extractServers(current.config);
          let removedAny = false;
          for (const injectedName of injectedServerNames) {
            const currentEntry = currentServers[injectedName];
            // Only remove the entry if it is still exactly what this run
            // wrote. A later run may have swept and re-injected the same
            // name with a fresher token; that entry belongs to that run.
            if (currentEntry && sameInjectedEntry(currentEntry, injectedServers[injectedName])) {
              delete currentServers[injectedName];
              removedAny = true;
            }
          }
          if (!removedAny) return;

          const remainingServerKeys = Object.keys(currentServers);
          const onlyMcpServersKey = Object.keys(current.config).every((key) => key === "mcpServers");
          if (remainingServerKeys.length === 0 && onlyMcpServersKey) {
            // Nothing left worth keeping: no servers, and no other settings
            // in the file. This also covers the file having been created by
            // an overlapping Paperclip run rather than this one.
            await fs.rm(configPath, { force: true }).catch(() => undefined);
          } else {
            const cleanedConfig = {
              ...current.config,
              mcpServers: currentServers,
            };
            await writeAgyMcpConfigFileAtomic(configPath, cleanedConfig);
          }
        });
      } catch {
        // Ignore cleanup errors on missing or inaccessible files
      }
    };

    return {
      configPath,
      injectedServerNames,
      sweptStaleServerNames,
      cleanup,
    };
  });
}
export interface StageAgyMcpConfigInput {
  servers: AdapterRuntimeMcpServer[];
  runId?: string;
  homedir?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Stages Paperclip-managed MCP configuration into a private temporary directory
 * suitable for syncing into a sandbox execution target.
 */
export async function stageAgyMcpConfigForSync(
  input: StageAgyMcpConfigInput,
): Promise<string> {
  const prefix = input.runId
    ? `paperclip-agy-mcp-sync-${input.runId}-`
    : "paperclip-agy-mcp-sync-";
  const stagedDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.chmod(stagedDir, 0o700).catch(() => {});

  const hostConfigPath = resolveAgyMcpConfigPath(input.homedir, input.env);
  let parsedConfig: AgyMcpConfigFile = {};

  try {
    const raw = await fs.readFile(hostConfigPath, "utf8");
    if (raw.trim().length > 0) {
      const json = JSON.parse(raw);
      if (json && typeof json === "object" && !Array.isArray(json)) {
        parsedConfig = json;
      }
    }
  } catch {
    // Missing or invalid config on host; start fresh
  }

  const existingServers: Record<string, AgyMcpServerConfig> =
    parsedConfig.mcpServers && typeof parsedConfig.mcpServers === "object" && !Array.isArray(parsedConfig.mcpServers)
      ? { ...parsedConfig.mcpServers }
      : {};

  const existingNames = new Set(Object.keys(existingServers));

  for (const server of input.servers) {
    const uniqueName = resolveUniqueMcpServerName(server, existingNames);
    existingNames.add(uniqueName);

    const serverConfig: AgyMcpServerConfig = {
      url: server.url,
      ...(server.token ? { headers: { Authorization: `Bearer ${server.token}` } } : {}),
    };
    existingServers[uniqueName] = serverConfig;
  }

  const updatedConfig: AgyMcpConfigFile = {
    ...parsedConfig,
    mcpServers: existingServers,
  };

  await fs.writeFile(
    path.join(stagedDir, "mcp_config.json"),
    JSON.stringify(updatedConfig, null, 2) + "\n",
    { mode: 0o600 },
  );

  return stagedDir;
}
