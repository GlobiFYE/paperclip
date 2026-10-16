import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertReproducibleGitFiles } from "../services/git-workspace-restoration.js";

const execFile = promisify(execFileCallback);

async function git(cwd: string, ...args: string[]) {
  const { stdout } = await execFile("git", ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com",
    "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", ...args]);
  return stdout;
}

async function write(file: string, content = "x\n") {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

// A bare upstream with one commit, ready to clone.
async function upstream(root: string, name: string, files: Record<string, string>) {
  const seed = path.join(root, `${name}-seed`);
  await fs.mkdir(seed, { recursive: true });
  await git(seed, "init", "-q");
  for (const [file, content] of Object.entries(files)) await write(path.join(seed, file), content);
  await git(seed, "add", "-A");
  await git(seed, "commit", "-q", "-m", "seed");
  const bare = path.join(root, `${name}.git`);
  await execFile("git", ["clone", "-q", "--bare", seed, bare]);
  return bare;
}

describe("assertReproducibleGitFiles with Paperclip-managed files", () => {
  let root: string;
  let work: string;
  let projectRemote: string;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-reproducible-")));
    const mainRemote = await upstream(root, "main", {
      "README.md": "main\n",
      ".gitignore": "node_modules/\n.claude/settings.local.json\nsecret.txt\n",
    });
    projectRemote = await upstream(root, "project", { "README.md": "project\n", ".gitignore": "node_modules/\n" });
    work = path.join(root, "work");
    await execFile("git", ["clone", "-q", mainRemote, work]);
    // Workspace preparation excludes the managed namespace through info/exclude.
    await fs.appendFile(path.join(work, ".git", "info", "exclude"), "\n/.paperclip-repositories/\n");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function managedCheckout(name = "project-d051a9c4e671") {
    const checkout = path.join(work, ".paperclip-repositories", name);
    await fs.mkdir(path.dirname(checkout), { recursive: true });
    await execFile("git", ["clone", "-q", projectRemote, checkout]);
    return checkout;
  }

  const expectUnique = (promise: Promise<unknown>) => expect(promise).rejects.toThrow("unique_ignored_files");

  it("accepts Paperclip's Claude settings file", async () => {
    await write(path.join(work, ".claude", "settings.local.json"), "{}\n");
    await expect(assertReproducibleGitFiles(work)).resolves.toBeDefined();
  });

  it("accepts a clean managed checkout, including its regenerable directories", async () => {
    const checkout = await managedCheckout();
    await write(path.join(checkout, "node_modules", "pkg", "index.js"));
    await write(path.join(work, "node_modules", "pkg", "index.js"));
    await expect(assertReproducibleGitFiles(work)).resolves.toBeDefined();
  });

  it("still rejects unknown ignored files", async () => {
    await write(path.join(work, "secret.txt"));
    await expectUnique(assertReproducibleGitFiles(work));
  });

  it("rejects a managed checkout with changed or untracked files", async () => {
    const checkout = await managedCheckout();
    await write(path.join(checkout, "README.md"), "edited\n");
    await expectUnique(assertReproducibleGitFiles(work));
    await git(checkout, "checkout", "-q", "--", "README.md");
    await write(path.join(checkout, "notes.txt"));
    await expectUnique(assertReproducibleGitFiles(work));
  });

  it("rejects a managed checkout with commits that are not on a remote", async () => {
    const checkout = await managedCheckout();
    await write(path.join(checkout, "change.txt"));
    await git(checkout, "add", "change.txt");
    await git(checkout, "commit", "-q", "-m", "local work");
    await expectUnique(assertReproducibleGitFiles(work));
    // The same commit on a detached HEAD, with the branch moved back, is still unique.
    await git(checkout, "checkout", "-q", "--detach");
    await git(checkout, "branch", "-f", "main", "origin/main");
    await expectUnique(assertReproducibleGitFiles(work));
  });

  it("rejects a managed checkout with a stash or an operation in progress", async () => {
    const checkout = await managedCheckout();
    await write(path.join(checkout, "README.md"), "stashed\n");
    await git(checkout, "stash", "-q");
    await expectUnique(assertReproducibleGitFiles(work));
    await git(checkout, "stash", "drop", "-q");
    await write(path.join(checkout, ".git", "MERGE_HEAD"), `${(await git(checkout, "rev-parse", "HEAD")).trim()}\n`);
    await expectUnique(assertReproducibleGitFiles(work));
  });

  it("rejects a managed checkout with unknown ignored files", async () => {
    const checkout = await managedCheckout();
    await fs.appendFile(path.join(checkout, ".git", "info", "exclude"), "\nlocal.env\n");
    await write(path.join(checkout, "local.env"));
    await expectUnique(assertReproducibleGitFiles(work));
  });

  it("never treats task repositories or plain directories as reproducible", async () => {
    await managedCheckout("task-repo-0123456789abcdef01234567");
    await expectUnique(assertReproducibleGitFiles(work));
    await fs.rm(path.join(work, ".paperclip-repositories"), { recursive: true });
    await write(path.join(work, ".paperclip-repositories", "project-d051a9c4e671", "README.md"));
    await expectUnique(assertReproducibleGitFiles(work));
  });
});
