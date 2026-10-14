import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Directory names that hold regenerable output: installed dependencies, build
// output, and tool caches. Compaction removes a directory only when its name is
// in this set, Git ignores it, and it holds no tracked file. Removing one leaves
// the worktree in the same state as a freshly created worktree, so whatever
// produced it the first time (the workspace provision command, or the agent)
// produces it again when the task resumes.
export const REGENERABLE_WORKSPACE_DIR_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "storybook-static",
  "target",
  ".cache",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".svelte-kit",
  ".turbo",
  ".vite",
]);

// Compaction never descends into these directories. `.paperclip` holds the
// worktree's own Paperclip instance data, which is not regenerable.
const PROTECTED_WORKSPACE_DIR_NAMES: ReadonlySet<string> = new Set([".git", ".paperclip"]);

// Moved directories wait here before deletion. The trash sits beside the
// worktree so the move is a same-filesystem rename, which is atomic and fast.
// A branch name cannot start with ".", so the name never collides with a
// worktree directory.
export const WORKSPACE_COMPACTION_TRASH_DIR = ".paperclip-compaction-trash";

const MAX_WALK_DEPTH = 12;

async function runGitStdout(args: string[], cwd: string, input?: string) {
  const child = execFileAsync("git", ["-C", cwd, ...args], { cwd, maxBuffer: 64 * 1024 * 1024 });
  if (input !== undefined) {
    child.child.stdin?.end(input);
  }
  return (await child).stdout;
}

async function runGitCheckIgnore(cwd: string, paths: string[]) {
  // `git check-ignore` exits 1 when no path is ignored. That is a normal
  // answer, not a failure.
  try {
    return await runGitStdout(["check-ignore", "--stdin", "-z"], cwd, paths.map((p) => `${p}\0`).join(""));
  } catch (error) {
    const exitCode = (error as { code?: unknown }).code;
    if (exitCode === 1) return "";
    throw error;
  }
}

function splitNul(output: string) {
  return output.split("\0").filter((entry) => entry.length > 0);
}

// Returns true only for a linked Git worktree: its `.git` entry is a file that
// points at the main repository. A main checkout has a `.git` directory, and
// compaction never touches one.
export async function isLinkedGitWorktree(worktreePath: string) {
  const stat = await fs.lstat(path.join(worktreePath, ".git")).catch(() => null);
  return stat?.isFile() === true;
}

// Lists the regenerable directories in a worktree, as paths relative to the
// worktree root. Symlinks are never followed or returned.
export async function findRegenerableWorkspaceDirs(worktreePath: string): Promise<string[]> {
  const candidates: string[] = [];

  async function visit(relativeDir: string, depth: number) {
    if (depth > MAX_WALK_DEPTH) return;
    const entries = await fs.readdir(path.join(worktreePath, relativeDir), { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (PROTECTED_WORKSPACE_DIR_NAMES.has(entry.name)) continue;
      const relativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;
      if (REGENERABLE_WORKSPACE_DIR_NAMES.has(entry.name)) {
        candidates.push(relativePath);
        continue;
      }
      await visit(relativePath, depth + 1);
    }
  }

  await visit("", 0);
  if (candidates.length === 0) return [];

  const ignored = new Set(splitNul(await runGitCheckIgnore(worktreePath, candidates)));
  const ignoredCandidates = candidates.filter((candidate) => ignored.has(candidate));
  if (ignoredCandidates.length === 0) return [];

  // A directory that holds a tracked file is source, even when its name looks
  // like build output.
  const tracked = splitNul(await runGitStdout(["ls-files", "-z", "--", ...ignoredCandidates], worktreePath));
  return ignoredCandidates.filter((candidate) =>
    !tracked.some((trackedPath) => trackedPath === candidate || trackedPath.startsWith(`${candidate}/`)));
}

export type MovedWorkspaceDir = { relativePath: string; trashPath: string };

export type WorkspaceCompactionMove = {
  trashDir: string;
  moved: MovedWorkspaceDir[];
};

// Moves each directory into a fresh trash directory beside the worktree. Each
// move is one rename, so the whole step is fast enough to run while the caller
// holds the workspace lifecycle lock. A path that is no longer a real
// directory, or that sits on another filesystem, is left in place.
export async function moveWorkspaceDirsToTrash(
  worktreePath: string,
  relativePaths: string[],
): Promise<WorkspaceCompactionMove> {
  const trashDir = path.join(
    path.dirname(worktreePath),
    WORKSPACE_COMPACTION_TRASH_DIR,
    `${path.basename(worktreePath)}-${Date.now()}-${randomUUID().slice(0, 8)}`,
  );
  await fs.mkdir(trashDir, { recursive: true });
  const moved: MovedWorkspaceDir[] = [];
  for (const [index, relativePath] of relativePaths.entries()) {
    const sourcePath = path.join(worktreePath, relativePath);
    const stat = await fs.lstat(sourcePath).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const trashPath = path.join(trashDir, String(index));
    try {
      await fs.rename(sourcePath, trashPath);
      moved.push({ relativePath, trashPath });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EXDEV") continue;
      await restoreWorkspaceDirsFromTrash(worktreePath, { trashDir, moved });
      throw error;
    }
  }
  return { trashDir, moved };
}

// Puts moved directories back. A path that something recreated in the meantime
// keeps the new copy, and the moved copy stays in the trash for deletion.
export async function restoreWorkspaceDirsFromTrash(worktreePath: string, move: WorkspaceCompactionMove) {
  for (const entry of [...move.moved].reverse()) {
    const targetPath = path.join(worktreePath, entry.relativePath);
    const occupied = await fs.lstat(targetPath).then(() => true, () => false);
    if (occupied) continue;
    await fs.rename(entry.trashPath, targetPath);
  }
}

export async function deleteWorkspaceCompactionTrash(trashDir: string) {
  await fs.rm(trashDir, { recursive: true, force: true });
}

// Deletes trash directories that a crash or restart left behind. A trash entry
// younger than `olderThanMs` may belong to a compaction in progress, so it stays.
export async function purgeStaleWorkspaceCompactionTrash(worktreeParentDir: string, olderThanMs: number) {
  const trashRoot = path.join(worktreeParentDir, WORKSPACE_COMPACTION_TRASH_DIR);
  const entries = await fs.readdir(trashRoot, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - olderThanMs;
  for (const entry of entries) {
    const entryPath = path.join(trashRoot, entry.name);
    const stat = await fs.lstat(entryPath).catch(() => null);
    if (!stat || stat.mtimeMs > cutoff) continue;
    await fs.rm(entryPath, { recursive: true, force: true }).catch(() => {});
  }
}
