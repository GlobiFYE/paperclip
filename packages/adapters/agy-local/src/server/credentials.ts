import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { withDirectoryMergeLock } from "@paperclipai/adapter-utils/workspace-restore-merge";

export interface AgyCredentialReadinessInput {
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  configuredApiKey?: string | null;
}

export interface AgyCredentialReadiness {
  ready: boolean;
  authMode: "subscription" | "api" | "none";
  tokenPath?: string | null;
  detail?: string | null;
}

/**
 * Searches for the Antigravity CLI OAuth token file across standard locations:
 * - $ANTIGRAVITY_CLI_HOME/antigravity-oauth-token
 * - $GEMINI_CLI_HOME/antigravity-oauth-token
 * - ~/.gemini/antigravity-cli/antigravity-oauth-token
 * - ~/.gemini/antigravity/antigravity-oauth-token
 */
export function resolveAgyOAuthTokenPath(
  homedir: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const candidatePaths = [
    env.ANTIGRAVITY_CLI_HOME ? path.join(env.ANTIGRAVITY_CLI_HOME, "antigravity-oauth-token") : null,
    env.GEMINI_CLI_HOME ? path.join(env.GEMINI_CLI_HOME, "antigravity-oauth-token") : null,
    path.join(homedir, ".gemini", "antigravity-cli", "antigravity-oauth-token"),
    path.join(homedir, ".gemini", "antigravity", "antigravity-oauth-token"),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidatePaths) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore filesystem access errors
    }
  }
  return null;
}

/**
 * Parses and validates raw content from an Antigravity OAuth token file.
 */
export function parseAgyOAuthToken(content: string): {
  valid: boolean;
  payload: any;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  isExpired: boolean;
  expiryMs: number | null;
} {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") {
      return { valid: false, payload: null, accessToken: null, refreshToken: null, idToken: null, isExpired: false, expiryMs: null };
    }

    const tokenObj = typeof parsed.token === "object" && parsed.token !== null ? parsed.token : null;
    const accessToken =
      (tokenObj && typeof tokenObj.access_token === "string" && tokenObj.access_token.length > 0)
        ? tokenObj.access_token
        : typeof parsed.access_token === "string" && parsed.access_token.length > 0
          ? parsed.access_token
          : typeof parsed.token === "string" && parsed.token.length > 0
            ? parsed.token
            : null;

    const refreshToken =
      (tokenObj && typeof tokenObj.refresh_token === "string" && tokenObj.refresh_token.length > 0)
        ? tokenObj.refresh_token
        : typeof parsed.refresh_token === "string" && parsed.refresh_token.length > 0
          ? parsed.refresh_token
          : null;

    const idToken =
      (tokenObj && typeof tokenObj.id_token === "string" && tokenObj.id_token.length > 0)
        ? tokenObj.id_token
        : typeof parsed.id_token === "string" && parsed.id_token.length > 0
          ? parsed.id_token
          : null;

    const expiryStr = (tokenObj && typeof tokenObj.expiry === "string")
      ? tokenObj.expiry
      : typeof parsed.expiry === "string"
        ? parsed.expiry
        : typeof parsed.expires_at === "string"
          ? parsed.expires_at
          : null;

    let isExpired = false;
    let expiryMs: number | null = null;
    if (expiryStr) {
      const ms = new Date(expiryStr).getTime();
      if (!Number.isNaN(ms)) {
        expiryMs = ms;
        if (ms <= Date.now()) {
          isExpired = true;
        }
      }
    }

    const hasTokens = Boolean(accessToken || refreshToken || idToken);
    const valid = hasTokens && (!isExpired || Boolean(refreshToken));

    return {
      valid,
      payload: parsed,
      accessToken,
      refreshToken,
      idToken,
      isExpired,
      expiryMs,
    };
  } catch {
    const trimmed = content.trim();
    return {
      valid: trimmed.length > 0,
      payload: trimmed,
      accessToken: trimmed || null,
      refreshToken: null,
      idToken: null,
      isExpired: false,
      expiryMs: null,
    };
  }
}

/**
 * Validates whether the OAuth token file exists, is non-empty, and contains a valid token.
 */
export function hasUsableAgyOAuthToken(tokenPath: string): boolean {
  try {
    if (!fs.existsSync(tokenPath)) return false;
    const stat = fs.statSync(tokenPath);
    if (stat.size === 0) return false;
    const content = fs.readFileSync(tokenPath, "utf8");
    return parseAgyOAuthToken(content).valid;
  } catch {
    return false;
  }
}

/**
 * Resolves the path to the Antigravity settings.json file.
 */
export function resolveAgySettingsPath(
  homedir: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const dir =
    env.ANTIGRAVITY_CLI_HOME ||
    env.GEMINI_CLI_HOME ||
    path.join(homedir, ".gemini", "antigravity-cli");
  return path.join(dir, "settings.json");
}

/**
 * Guarantees that settings.json exists at ~/.gemini/antigravity-cli/settings.json
 * (or $ANTIGRAVITY_CLI_HOME / $GEMINI_CLI_HOME) with { "modelProvider": "gemini" }
 * so agy uses the configured GEMINI_API_KEY.
 */
export async function ensureAgyApiKeySettings(
  homedir: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const settingsPath = resolveAgySettingsPath(homedir, env);
  const dir = path.dirname(settingsPath);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });

  let settings: Record<string, unknown> = {};
  try {
    const raw = await fs.promises.readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      settings = parsed;
    }
  } catch {
    // Missing or invalid JSON; start fresh
  }

  if (settings.modelProvider !== "gemini") {
    settings.modelProvider = "gemini";
    await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", {
      mode: 0o600,
    });
  }

  return settingsPath;
}

/**
 * Checks whether Antigravity credentials are ready to use.
 * Checks for:
 * 1. Explicitly configured API key
 * 2. Environment API keys (GEMINI_API_KEY, AGY_API_KEY, ANTIGRAVITY_API_KEY)
 * 3. Local OAuth token in ~/.gemini/antigravity-cli (or alternate homes)
 */
export function evaluateAgyCredentialReadiness(
  input: AgyCredentialReadinessInput = {},
): AgyCredentialReadiness {
  const env = input.env ?? process.env;
  const homedir = input.homedir ?? os.homedir();

  const explicitKey = (input.configuredApiKey ?? "").trim();
  if (explicitKey.length > 0) {
    return { ready: true, authMode: "api", detail: "configured_api_key" };
  }

  const envKey = (env.GEMINI_API_KEY || env.AGY_API_KEY || env.ANTIGRAVITY_API_KEY || "").trim();
  if (envKey.length > 0) {
    return { ready: true, authMode: "api", detail: "env_api_key" };
  }

  const tokenPath = resolveAgyOAuthTokenPath(homedir, env);
  if (tokenPath && hasUsableAgyOAuthToken(tokenPath)) {
    return {
      ready: true,
      authMode: "subscription",
      tokenPath,
      detail: "oauth_token_file",
    };
  }

  return { ready: false, authMode: "none", detail: "missing_credentials" };
}

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const parsed = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort account identity for a parsed Antigravity token: the id_token
 * subject (or email) when present, else an account identifier carried in
 * the token payload itself. Null when the token carries no identity claim.
 */
export function agyTokenAccountIdentity(
  parsed: ReturnType<typeof parseAgyOAuthToken>,
): string | null {
  if (parsed.idToken) {
    const claims = decodeJwtClaims(parsed.idToken);
    const sub = claims?.sub;
    if (typeof sub === "string" && sub.length > 0) return `sub:${sub}`;
    const email = claims?.email;
    if (typeof email === "string" && email.length > 0) return `email:${email.toLowerCase()}`;
  }
  const payload = parsed.payload;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const tokenObj =
      typeof record.token === "object" && record.token !== null
        ? (record.token as Record<string, unknown>)
        : record;
    for (const key of ["account_id", "user_id", "sub", "email"]) {
      const value = tokenObj[key];
      if (typeof value === "string" && value.length > 0) return `${key}:${value}`;
    }
  }
  return null;
}

/**
 * True only when the source token provably belongs to the same account /
 * grant as the destination token: matching account identity, or the same
 * refresh token (a refresh of one grant keeps its refresh token; another
 * account's grant cannot share it).
 */
export function isSameAgyAccount(
  source: ReturnType<typeof parseAgyOAuthToken>,
  dest: ReturnType<typeof parseAgyOAuthToken>,
): boolean {
  const sourceIdentity = agyTokenAccountIdentity(source);
  const destIdentity = agyTokenAccountIdentity(dest);
  if (sourceIdentity && destIdentity) return sourceIdentity === destIdentity;
  if (source.refreshToken && dest.refreshToken) {
    return source.refreshToken === dest.refreshToken;
  }
  return false;
}

/**
  * Exit code 10: Replace destination credential with source.
  * Exit code 20: Keep destination credential.
  *
  * The sandbox copy only wins when it is a verified refresh of the SAME
  * account as the host credential: a later expiry alone proves nothing,
  * and non-JSON token content carries no identity at all, so neither may
  * replace a working host login.
  */
export async function decideAgyAuthMerge(
  sourcePath: string,
  destinationPath: string,
): Promise<number> {
  try {
    const sourceContent = await fs.promises.readFile(sourcePath, "utf8");
    const source = parseAgyOAuthToken(sourceContent);
    if (!source.valid) return 20;

    let destContent: string | null = null;
    try {
      destContent = await fs.promises.readFile(destinationPath, "utf8");
    } catch {
      return 10;
    }

    const dest = parseAgyOAuthToken(destContent);
    if (!dest.valid) return 10;

    // parseAgyOAuthToken's non-JSON fallback yields a string payload; such
    // content cannot prove which account it belongs to.
    if (typeof source.payload === "string") return 20;
    if (!isSameAgyAccount(source, dest)) return 20;

    if (source.expiryMs && dest.expiryMs) {
      if (source.expiryMs > dest.expiryMs) return 10;
      if (source.expiryMs < dest.expiryMs) return 20;
    }

    if (source.accessToken !== dest.accessToken || source.refreshToken !== dest.refreshToken) {
      return 10;
    }

    return 20;
  } catch {
    return 20;
  }
}

export interface StageAgyHomeForSyncOptions {
  homedir?: string;
  env?: NodeJS.ProcessEnv;
  runId?: string;
}

/**
 * Stages credentials (antigravity-oauth-token) and configuration (settings.json)
 * into a private temporary directory suitable for syncing into a sandbox execution target.
 */
export async function stageAgyHomeForSync(
  options: StageAgyHomeForSyncOptions = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const homedir = options.homedir ?? os.homedir();
  const prefix = options.runId
    ? `paperclip-agy-home-sync-${options.runId}-`
    : "paperclip-agy-home-sync-";
  const stagedDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.promises.chmod(stagedDir, 0o700).catch(() => {});

  const tokenPath = resolveAgyOAuthTokenPath(homedir, env);
  if (tokenPath && hasUsableAgyOAuthToken(tokenPath)) {
    try {
      const content = await fs.promises.readFile(tokenPath, "utf8");
      await fs.promises.writeFile(
        path.join(stagedDir, "antigravity-oauth-token"),
        content,
        { mode: 0o600 },
      );
    } catch {
      // Ignore read/write failures
    }
  }

  const settingsPath = resolveAgySettingsPath(homedir, env);
  let settingsCopied = false;
  try {
    if (fs.existsSync(settingsPath)) {
      const content = await fs.promises.readFile(settingsPath, "utf8");
      await fs.promises.writeFile(
        path.join(stagedDir, "settings.json"),
        content,
        { mode: 0o600 },
      );
      settingsCopied = true;
    }
  } catch {
    // Fall through to API key check
  }

  if (!settingsCopied) {
    const hasApiKey = Boolean(
      env.GEMINI_API_KEY || env.AGY_API_KEY || env.ANTIGRAVITY_API_KEY,
    );
    if (hasApiKey) {
      await fs.promises.writeFile(
        path.join(stagedDir, "settings.json"),
        JSON.stringify({ modelProvider: "gemini" }, null, 2) + "\n",
        { mode: 0o600 },
      );
    }
  }

  return stagedDir;
}

export type CopyBackAgyAuthOutcome = "copied" | "kept-host";

export interface CopyBackAgyAuthInput {
  readSandboxAuth: () => Promise<Buffer>;
  hostTokenPath: string;
  log: (line: string) => void | Promise<void>;
  env?: NodeJS.ProcessEnv;
}

/**
 * Guards, locks, and atomically installs a strictly-newer sandbox Antigravity
 * OAuth token onto the host credential at teardown.
 */
export async function copyBackAgyAuth(
  input: CopyBackAgyAuthInput,
): Promise<CopyBackAgyAuthOutcome> {
  const { readSandboxAuth, hostTokenPath, log, env = process.env } = input;

  let sandboxAuthBytes: Buffer;
  try {
    sandboxAuthBytes = await readSandboxAuth();
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
      return "kept-host";
    }
    throw error;
  }

  let resolvedHostTokenPath = hostTokenPath;
  try {
    if (fs.existsSync(hostTokenPath)) {
      resolvedHostTokenPath = await fs.promises.realpath(hostTokenPath);
    }
  } catch {
    // keep hostTokenPath
  }

  const hostDir = path.dirname(resolvedHostTokenPath);
  await fs.promises.mkdir(hostDir, { recursive: true, mode: 0o700 });

  return await withDirectoryMergeLock(
    hostDir,
    async () => {
      const stagedTempPath = path.join(
        hostDir,
        `.antigravity-oauth-token.copyback-${process.pid}-${randomUUID()}.tmp`,
      );
      const handle = await fs.promises.open(stagedTempPath, "wx", 0o600);
      try {
        await handle.writeFile(sandboxAuthBytes);
        await handle.close();

        const decision = await decideAgyAuthMerge(stagedTempPath, resolvedHostTokenPath);
        if (decision === 10) {
          await fs.promises.rename(stagedTempPath, resolvedHostTokenPath);
          await log(
            "[paperclip] Antigravity auth copy-out: updated host credential from sandbox.",
          );
          return "copied";
        }

        await log(
          "[paperclip] Antigravity auth copy-out: host credential is newer or equivalent; kept host.",
        );
        return "kept-host";
      } finally {
        await handle.close().catch(() => undefined);
        await fs.promises.rm(stagedTempPath, { force: true }).catch(() => undefined);
      }
    },
    env,
  );
}
