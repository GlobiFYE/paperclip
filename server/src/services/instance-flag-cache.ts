import type { Db } from "@paperclipai/db";

/**
 * Small TTL cache for per-call-site instance-setting reads.
 *
 * Attention-surface queries ask "is this instance's lot view on?" (and, for
 * the ADHD edition, "how many focus lanes may be active?") several times per
 * request (feed, badges, dashboard, timeline). Reading the instance-settings
 * row every time would add a DB round-trip per call site, so resolved values
 * are cached per `Db` handle per key for a short TTL.
 * `instanceSettingsService.updateExperimental` invalidates the cache on
 * every experimental write, so a PATCH takes effect immediately; the TTL only
 * covers direct row edits.
 */

const INSTANCE_FLAG_CACHE_TTL_MS = 30_000;

type SettingReader = () => Promise<Record<string, unknown>>;

interface CachedSetting {
  value: unknown;
  expiresAt: number;
}

// Keyed per Db handle, then per setting key — several distinct keys
// (enableLotView, enableFocusDashboard, focusLaneProjectLimit, ...) read
// through the same handle.
let settingCache = new WeakMap<object, Map<string, CachedSetting>>();

/**
 * Read one experimental-settings key through the per-Db TTL cache. The raw
 * stored value is reduced through `resolve` (which also enforces the
 * fail-closed posture: an unreadable settings row resolves to the caller's
 * default, never to an armed value).
 */
async function getCachedInstanceExperimentalSettingValue(
  db: Db,
  key: string,
  readExperimental: SettingReader,
  resolve: (experimental: Record<string, unknown>) => unknown,
): Promise<unknown> {
  const now = Date.now();
  let perKey = settingCache.get(db);
  const cached = perKey?.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  let value: unknown;
  try {
    value = resolve(await readExperimental());
  } catch {
    // Fail closed: the resolver's default (false for flags, the schema
    // default for numeric settings) also covers an unreadable settings row.
    value = resolve({});
  }
  if (!perKey) {
    perKey = new Map();
    settingCache.set(db, perKey);
  }
  perKey.set(key, { value, expiresAt: now + INSTANCE_FLAG_CACHE_TTL_MS });
  return value;
}

export async function getCachedInstanceExperimentalFlag(
  db: Db,
  key: string,
  readExperimental: SettingReader,
): Promise<boolean> {
  const value = await getCachedInstanceExperimentalSettingValue(
    db,
    key,
    readExperimental,
    (experimental) => experimental[key] === true,
  );
  return value === true;
}

/**
 * Read a numeric experimental setting through the same per-Db TTL map. Any
 * non-integer or out-of-schema value (including a read failure) fails closed
 * to `fallback` — for `focusLaneProjectLimit` that is the schema default 1,
 * so an unreadable row degrades to classic single-active-lane behavior.
 */
export async function getCachedInstanceExperimentalInt(
  db: Db,
  key: string,
  readExperimental: SettingReader,
  fallback: number,
): Promise<number> {
  const value = await getCachedInstanceExperimentalSettingValue(
    db,
    key,
    readExperimental,
    (experimental) => {
      const raw = experimental[key];
      return typeof raw === "number" && Number.isInteger(raw) ? raw : fallback;
    },
  );
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

export function invalidateInstanceFlagCache(): void {
  // WeakMap has no clear(); swap in a fresh map so prior entries are dropped.
  settingCache = new WeakMap();
}
