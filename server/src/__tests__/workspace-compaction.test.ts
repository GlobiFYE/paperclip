import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  WORKSPACE_COMPACTION_TRASH_DIR,
  deleteWorkspaceCompactionTrash,
  findRegenerableWorkspaceDirs,
  isLinkedGitWorktree,
  moveWorkspaceDirsToTrash,
  purgeStaleWorkspaceCompactionTrash,
  restoreWorkspaceDirsFromTrash,
} from "../services/workspace-compaction.ts";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function git(cwd: string, args: string[]) {
  return (await execFileAsync("git", ["-C", cwd, ...args], { cwd })).stdout.trim();
}

async function write(filePath: string, contents = "x\n") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
}

async function createRepoWithWorktree(gitignore: string[]) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-compaction-unit-")));
  tempDirs.push(root);
  const repoRoot = path.join(root, "repo");
  await fs.mkdir(repoRoot);
  await git(repoRoot, ["init", "-b", "main"]);
  await git(repoRoot, ["config", "user.name", "Paperclip Test"]);
  await git(repoRoot, ["config", "user.email", "test@paperclip.local"]);
  await write(path.join(repoRoot, ".gitignore"), `${gitignore.join("\n")}\n`);
  await git(repoRoot, ["add", ".gitignore"]);
  await git(repoRoot, ["commit", "-m", "Initial commit"]);
  const worktreePath = path.join(root, "worktrees", "PAP-1-task");
  await git(repoRoot, ["worktree", "add", "-b", "PAP-1-task", worktreePath, "main"]);
  return { root, repoRoot, worktreePath };
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe("findRegenerableWorkspaceDirs", () => {
  it("returns only ignored, untracked directories with a regenerable name", async () => {
    const { worktreePath } = await createRepoWithWorktree([
      "node_modules/", "dist/", ".turbo/", ".env", "local-data/", ".paperclip/", "coverage/",
    ]);
    await write(path.join(worktreePath, "node_modules/a/index.js"));
    await write(path.join(worktreePath, "packages/ui/node_modules/b/index.js"));
    await write(path.join(worktreePath, "packages/ui/dist/ui.js"));
    await write(path.join(worktreePath, ".turbo/cache"));
    // Ignored, but not a regenerable name: data and secrets stay.
    await write(path.join(worktreePath, ".env"));
    await write(path.join(worktreePath, "local-data/state.json"));
    // A regenerable name that Git does not ignore is source.
    await write(path.join(worktreePath, "build/keep.txt"));
    // The worktree instance data is never scanned.
    await write(path.join(worktreePath, ".paperclip/node_modules/c/index.js"));
    // An ignored directory with a force-added tracked file is source.
    await write(path.join(worktreePath, "coverage/baseline.json"));
    await git(worktreePath, ["add", "-f", "coverage/baseline.json"]);

    expect((await findRegenerableWorkspaceDirs(worktreePath)).sort()).toEqual([
      ".turbo",
      "node_modules",
      "packages/ui/dist",
      "packages/ui/node_modules",
    ]);
  });

  it("does not follow or return a symlinked directory", async () => {
    const { root, worktreePath } = await createRepoWithWorktree(["node_modules"]);
    const outside = path.join(root, "shared-store");
    await write(path.join(outside, "node_modules/pkg/index.js"));
    await fs.symlink(path.join(outside, "node_modules"), path.join(worktreePath, "node_modules"));
    await fs.symlink(outside, path.join(worktreePath, "linked"));

    expect(await findRegenerableWorkspaceDirs(worktreePath)).toEqual([]);
  });

  it("returns nothing when no directory qualifies", async () => {
    const { worktreePath } = await createRepoWithWorktree(["node_modules/"]);
    await write(path.join(worktreePath, "src/index.ts"));
    expect(await findRegenerableWorkspaceDirs(worktreePath)).toEqual([]);
  });
});

describe("isLinkedGitWorktree", () => {
  it("accepts a linked worktree and rejects a main checkout", async () => {
    const { repoRoot, worktreePath } = await createRepoWithWorktree([]);
    expect(await isLinkedGitWorktree(worktreePath)).toBe(true);
    expect(await isLinkedGitWorktree(repoRoot)).toBe(false);
  });
});

describe("compaction trash", () => {
  it("moves directories beside the worktree and restores them unchanged", async () => {
    const { worktreePath } = await createRepoWithWorktree(["node_modules/", "dist/"]);
    await write(path.join(worktreePath, "node_modules/a/index.js"), "dependency\n");
    await write(path.join(worktreePath, "packages/ui/dist/ui.js"), "bundle\n");

    const move = await moveWorkspaceDirsToTrash(worktreePath, ["node_modules", "packages/ui/dist", "missing"]);
    expect(move.moved.map((entry) => entry.relativePath)).toEqual(["node_modules", "packages/ui/dist"]);
    expect(path.dirname(path.dirname(move.trashDir))).toBe(path.dirname(worktreePath));
    expect(path.basename(path.dirname(move.trashDir))).toBe(WORKSPACE_COMPACTION_TRASH_DIR);
    await expect(fs.access(path.join(worktreePath, "node_modules"))).rejects.toThrow();

    await restoreWorkspaceDirsFromTrash(worktreePath, move);
    expect(await fs.readFile(path.join(worktreePath, "node_modules/a/index.js"), "utf8")).toBe("dependency\n");
    expect(await fs.readFile(path.join(worktreePath, "packages/ui/dist/ui.js"), "utf8")).toBe("bundle\n");
    await deleteWorkspaceCompactionTrash(move.trashDir);
    await expect(fs.access(move.trashDir)).rejects.toThrow();
  });

  it("keeps a directory something recreated instead of overwriting it on restore", async () => {
    const { worktreePath } = await createRepoWithWorktree(["node_modules/"]);
    await write(path.join(worktreePath, "node_modules/a/index.js"), "old\n");
    const move = await moveWorkspaceDirsToTrash(worktreePath, ["node_modules"]);
    await write(path.join(worktreePath, "node_modules/a/index.js"), "reinstalled\n");

    await restoreWorkspaceDirsFromTrash(worktreePath, move);
    expect(await fs.readFile(path.join(worktreePath, "node_modules/a/index.js"), "utf8")).toBe("reinstalled\n");
  });

  it("purges only trash older than the threshold", async () => {
    const { worktreePath } = await createRepoWithWorktree([]);
    const parent = path.dirname(worktreePath);
    const stale = path.join(parent, WORKSPACE_COMPACTION_TRASH_DIR, "stale");
    const fresh = path.join(parent, WORKSPACE_COMPACTION_TRASH_DIR, "fresh");
    await write(path.join(stale, "0/file"));
    await write(path.join(fresh, "0/file"));
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(stale, twoHoursAgo, twoHoursAgo);

    await purgeStaleWorkspaceCompactionTrash(parent, 60 * 60 * 1000);
    await expect(fs.access(stale)).rejects.toThrow();
    await expect(fs.access(fresh)).resolves.toBeUndefined();
  });
});
