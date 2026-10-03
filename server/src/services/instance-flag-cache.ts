import type { Db } from "@paperclipai/db";

/**
 * Small TTL cache for per-call-site instance-flag reads.
 *
 * Attention-surface queries ask "is this instance's lot view on?" several
 * times per request (feed, badges, dashboard, timeline). Reading the
 * instance-settings row every time would add a DB round-trip per call site,
 * so resolved boolean flags are cached per `Db` handle per flag key for a
 * short TTL. `instanceSettingsService.updateExperimental` invalidates the
 * cache on every experimental write, so a PATCH takes effect immediately; the
 * TTL only covers direct row edits.
 */

const INSTANCE_FLAG_CACHE_TTL_MS = 30_000;

type FlagReader = () => Promise<Record<string, unknown>>;

interface CachedFlag {
  value: boolean;
  expiresAt: number;
}

// Keyed per Db handle, then per flag key — several distinct flags
// (enableLotView, enableFocusDashboard, ...) read through the same handle.
let flagCache = new WeakMap<object, Map<string, CachedFlag>>();

export async function getCachedInstanceExperimentalFlag(
  db: Db,
  key: string,
  readExperimental: FlagReader,
): Promise<boolean> {
  const now = Date.now();
  let perKey = flagCache.get(db);
  const cached = perKey?.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  let value = false;
  try {
    const experimental = await readExperimental();
    value = experimental[key] === true;
  } catch {
    // Fail closed: an unreadable settings row means no experimental feature
    // is armed, which is also the default-off posture.
    value = false;
  }
  if (!perKey) {
    perKey = new Map();
    flagCache.set(db, perKey);
  }
  perKey.set(key, { value, expiresAt: now + INSTANCE_FLAG_CACHE_TTL_MS });
  return value;
}

export function invalidateInstanceFlagCache(): void {
  // WeakMap has no clear(); swap in a fresh map so prior entries are dropped.
  flagCache = new WeakMap();
}
