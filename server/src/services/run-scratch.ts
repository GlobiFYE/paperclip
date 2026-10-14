import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

export const HEARTBEAT_RUN_SCRATCH_MARKER = ".paperclip-run-scratch.json";

/**
 * Optional operator override for the root directory under which run scratch
 * directories are created. When unset, the root is derived from the process
 * temp dir but hardened against inherited-temp pollution (see
 * `resolveRunScratchRoot`).
 */
export const RUN_SCRATCH_ROOT_ENV_KEY = "PAPERCLIP_RUN_SCRATCH_ROOT";

export interface HeartbeatRunScratchMetadata {
  version: 1;
  companyId: string;
  agentId: string;
  runId: string;
  issueId: string | null;
  issueIdentifier: string | null;
  createdAt: string;
}

export interface HeartbeatRunScratch {
  dir: string;
  markerPath: string;
  metadata: HeartbeatRunScratchMetadata;
}

export interface HeartbeatRunScratchEnvResult {
  env: Record<string, string>;
  tempKeysApplied: string[];
}

export type HeartbeatRunScratchCleanupResult =
  | { removed: true; dir: string }
  | { removed: false; dir: string; reason: "missing" | "unmarked" | "owner_mismatch" | "process_group_alive" };

const TEMP_ENV_KEYS = ["TMPDIR", "TEMP", "TMP"] as const;
const ISSUE_SEGMENT_MAX_CHARS = 32;

function sanitizePathSegment(value: string | null | undefined, fallback: string): string {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ISSUE_SEGMENT_MAX_CHARS)
    .replace(/[.-]+$/g, "");
  return normalized || fallback;
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * True when any path segment of `candidate` is itself a run scratch directory.
 * Run scratch dirs are created as `paperclip-run-<issue>-<run>-XXXX`, so a
 * nested scratch root would appear as a `paperclip-run-*` segment.
 */
function hasRunScratchSegment(candidate: string): boolean {
  return path
    .normalize(candidate)
    .split(path.sep)
    .some((segment) => segment.startsWith("paperclip-run-"));
}

function stableRootFromCandidate(candidate: string): string {
  let resolved = path.resolve(candidate);
  try {
    resolved = fsSync.realpathSync(resolved);
  } catch {
    // The candidate may not exist yet (an explicit PAPERCLIP_RUN_SCRATCH_ROOT).
    // Path-level walk-up below is enough to escape a nested scratch dir.
  }
  for (;;) {
    if (!hasRunScratchSegment(resolved)) return resolved;
    const parent = path.dirname(resolved);
    if (parent === resolved) return resolved;
    resolved = parent;
  }
}

let cachedRunScratchRoot: string | null = null;

/**
 * Stable root for run scratch directories.
 *
 * Never trusts the inherited parent temp dir blindly: the server can be
 * relaunched from inside a run (or by a supervisor carrying a run's env) with
 * `TMPDIR` pointing into *another run's* scratch directory. Creating scratch
 * there nests run scratch inside run scratch, and the parent run's cleanup
 * removes the child's directory out from under it (`ENOENT ... mkdtemp`, the
 * TOP-529 incident). The root therefore (a) honours `PAPERCLIP_RUN_SCRATCH_ROOT`
 * when set, and (b) otherwise derives from the process temp dir but walks up
 * out of any `paperclip-run-*` directory first. The result is cached per
 * process so all runs in one server share a root.
 */
export function resolveRunScratchRoot(): string {
  if (cachedRunScratchRoot) return cachedRunScratchRoot;
  const override = process.env[RUN_SCRATCH_ROOT_ENV_KEY]?.trim();
  if (override && override.length > 0) {
    // An explicit operator override is authoritative; the nested-scratch
    // walk-up only guards the derived temp root.
    let resolved = path.resolve(override);
    try {
      resolved = fsSync.realpathSync(resolved);
    } catch {
      // Not created yet; prepareHeartbeatRunScratch mkdirs it recursively.
    }
    cachedRunScratchRoot = resolved;
    return cachedRunScratchRoot;
  }
  cachedRunScratchRoot = stableRootFromCandidate(os.tmpdir());
  return cachedRunScratchRoot;
}

/** Test seam: forget the cached root (e.g. after changing temp env vars). */
export function resetRunScratchRootForTests(): void {
  cachedRunScratchRoot = null;
}

async function readMarker(markerPath: string): Promise<HeartbeatRunScratchMetadata | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(markerPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    if (
      rec.version !== 1 ||
      typeof rec.companyId !== "string" ||
      typeof rec.agentId !== "string" ||
      typeof rec.runId !== "string" ||
      typeof rec.createdAt !== "string"
    ) {
      return null;
    }
    return {
      version: 1,
      companyId: rec.companyId,
      agentId: rec.agentId,
      runId: rec.runId,
      issueId: typeof rec.issueId === "string" ? rec.issueId : null,
      issueIdentifier: typeof rec.issueIdentifier === "string" ? rec.issueIdentifier : null,
      createdAt: rec.createdAt,
    };
  } catch {
    return null;
  }
}

export async function prepareHeartbeatRunScratch(input: {
  companyId: string;
  agentId: string;
  runId: string;
  issueId?: string | null;
  issueIdentifier?: string | null;
  now?: Date;
  /** Test seam: explicit scratch root instead of `resolveRunScratchRoot()`. */
  rootDir?: string;
}): Promise<HeartbeatRunScratch> {
  const issueSegment = sanitizePathSegment(input.issueIdentifier, "unassigned");
  const runSegment = sanitizePathSegment(input.runId.slice(0, 12), "run");
  const root = input.rootDir
    ? stableRootFromCandidate(input.rootDir)
    : resolveRunScratchRoot();
  // The root can be missing after a temp purge or an operator override;
  // mkdtemp alone would then fail with ENOENT for every dispatch.
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, `paperclip-run-${issueSegment}-${runSegment}-`));
  const markerPath = path.join(dir, HEARTBEAT_RUN_SCRATCH_MARKER);
  const metadata: HeartbeatRunScratchMetadata = {
    version: 1,
    companyId: input.companyId,
    agentId: input.agentId,
    runId: input.runId,
    issueId: input.issueId ?? null,
    issueIdentifier: input.issueIdentifier ?? null,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  await fs.writeFile(markerPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  return { dir, markerPath, metadata };
}

export function buildHeartbeatRunScratchEnv(
  existingEnv: Record<string, unknown>,
  scratch: HeartbeatRunScratch,
): HeartbeatRunScratchEnvResult {
  const env: Record<string, string> = {
    PAPERCLIP_RUN_SCRATCH_DIR: scratch.dir,
    PAPERCLIP_TASK_SCRATCH_DIR: scratch.dir,
    PAPERCLIP_SCRATCH_DIR: scratch.dir,
    PAPERCLIP_TMPDIR: scratch.dir,
  };
  // The run scratch is always authoritative for the child's temp dirs. An
  // inherited TMPDIR may point into another run's scratch directory (the
  // parent removes it on cleanup), so keeping it would leak the nesting bug
  // into every subprocess of the run (TOP-529). Tools that need a different
  // temp location can still use the PAPERCLIP_RUN_SCRATCH_DIR contract.
  const tempKeysApplied: string[] = [];
  for (const key of TEMP_ENV_KEYS) {
    if (existingEnv[key] === scratch.dir) continue;
    env[key] = scratch.dir;
    tempKeysApplied.push(key);
  }
  return { env, tempKeysApplied };
}

export async function cleanupHeartbeatRunScratch(input: {
  scratch: HeartbeatRunScratch;
  processGroupId?: number | null;
  isProcessGroupAlive?: (processGroupId: number | null | undefined) => boolean;
}): Promise<HeartbeatRunScratchCleanupResult> {
  const tmpRoot = path.resolve(resolveRunScratchRoot());
  const dir = path.resolve(input.scratch.dir);
  if (!isPathInside(tmpRoot, dir) || !path.basename(dir).startsWith("paperclip-run-")) {
    return { removed: false, dir, reason: "unmarked" };
  }
  try {
    const stats = await fs.stat(dir);
    if (!stats.isDirectory()) return { removed: false, dir, reason: "missing" };
  } catch {
    return { removed: false, dir, reason: "missing" };
  }

  const marker = await readMarker(path.join(dir, HEARTBEAT_RUN_SCRATCH_MARKER));
  if (!marker) return { removed: false, dir, reason: "unmarked" };
  if (
    marker.companyId !== input.scratch.metadata.companyId ||
    marker.agentId !== input.scratch.metadata.agentId ||
    marker.runId !== input.scratch.metadata.runId
  ) {
    return { removed: false, dir, reason: "owner_mismatch" };
  }
  if (input.isProcessGroupAlive?.(input.processGroupId) === true) {
    return { removed: false, dir, reason: "process_group_alive" };
  }

  await fs.rm(dir, { recursive: true, force: true });
  return { removed: true, dir };
}
