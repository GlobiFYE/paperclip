import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { companies, projects, projectWorkspaces, issues, executionWorkspaces, agents, heartbeatRuns, nativeRunFinalizations, workspaceRuntimeServices, createDb } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { resolveManagedProjectWorkspaceDir } from "../home-paths.js";
import { materializeManagedProjectWorkspace } from "../services/managed-repository-checkout.js";
import { materializeIsolatedRemoteWorkspaceSource } from "../services/isolated-remote-workspace-source.js";
import { realizeExecutionWorkspace, ensurePersistedExecutionWorkspaceAvailable } from "../services/workspace-runtime.js";
import { executionWorkspaceService } from "../services/execution-workspaces.js";
import { prepareProjectRepositoryWorkspaces } from "../services/heartbeat/workspaces.js";
import { expireReconstructableGitWorkspace } from "../services/git-workspace-expiration.js";

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.test",
  GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.test", GIT_TERMINAL_PROMPT: "0" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const exists = (target: string) => fs.lstat(target).then(() => true, () => false);

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;
describeEmbeddedPostgres("reconstructable Git expiration", () => {
  let db: ReturnType<typeof createDb>;
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let root: string;
  const previousHome = process.env.PAPERCLIP_HOME;
  const previousInstance = process.env.PAPERCLIP_INSTANCE_ID;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("git-cache-expiration-");
    db = createDb(database.connectionString);
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-git-expiration-"));
    process.env.PAPERCLIP_HOME = path.join(root, "home");
    process.env.PAPERCLIP_INSTANCE_ID = "default";
  });
  afterEach(async () => { vi.restoreAllMocks(); await db.execute(sql`TRUNCATE TABLE companies CASCADE`); });
  afterAll(async () => {
    if (previousHome === undefined) delete process.env.PAPERCLIP_HOME; else process.env.PAPERCLIP_HOME = previousHome;
    if (previousInstance === undefined) delete process.env.PAPERCLIP_INSTANCE_ID; else process.env.PAPERCLIP_INSTANCE_ID = previousInstance;
    await db.$client.end({ timeout: 1 }); await database.cleanup(); await fs.rm(root, { recursive: true, force: true });
  });

  async function fixture(managed = false, nested = false) {
    const companyId = randomUUID(), issueId = randomUUID(), workspaceId = randomUUID();
    const location = path.join(root, companyId), source = path.join(location, "author"), remote = path.join(location, "remote.git");
    await fs.mkdir(source, { recursive: true });
    git(source, "init", "--initial-branch=main");
    await fs.writeFile(path.join(source, "marker.txt"), "commit A\n");
    await fs.writeFile(path.join(source, ".gitignore"), "node_modules/\nprivate-notes/\n.claude/settings.local.json\n");
    git(source, "add", "."); git(source, "commit", "-m", "A");
    const commitA = git(source, "rev-parse", "HEAD");
    git(location, "clone", "--bare", source, remote); git(source, "remote", "add", "origin", remote);
    await db.insert(companies).values({ id: companyId, name: "Git expiration fixture", issuePrefix: `GC${companyId.slice(0, 6)}` });
    await db.insert(issues).values({ id: issueId, companyId, title: "Finished task", status: "done", completedAt: new Date(Date.now() - 48 * 3_600_000) });
    const repoUrl = pathToFileURL(remote).href;
    const projectId = managed ? randomUUID() : null;
    if (projectId) await db.insert(projects).values({ id: projectId, companyId, name: "Fixture project" });
    const baseCwd = managed
      ? (await materializeManagedProjectWorkspace(resolveManagedProjectWorkspaceDir({ companyId, projectId: projectId!, repoName: "remote" }), { repoUrl })).cwd
      : await materializeIsolatedRemoteWorkspaceSource({ companyId, issueId, repoUrl, resolveGitAuth: async () => null });
    const base = { baseCwd, source: "task_session" as const, projectId: null, workspaceId: null, repoUrl, repoRef: "origin/main" };
    const workspace = await realizeExecutionWorkspace({ base, issue: { id: issueId, identifier: "GC-1", title: "Fixture" }, agent: { id: null, name: "Fixture", companyId },
      config: { workspaceStrategy: { type: "git_worktree", branchTemplate: "fixture-task", worktreeParentDir: nested ? path.join(baseCwd, ".paperclip", "worktrees") : path.join(location, "worktrees"), baseRef: "origin/main" } }, skipHostProvision: true });
    await db.insert(executionWorkspaces).values({ id: workspaceId, companyId, projectId, sourceIssueId: issueId, mode: "isolated_workspace", strategyType: "git_worktree", name: "Fixture", status: "active",
      providerType: "local_fs", cwd: workspace.cwd, providerRef: workspace.cwd, repoUrl, baseRef: "origin/main", branchName: workspace.branchName,
      metadata: { createdByRuntime: workspace.branchCreatedByRuntime, gitBranchOwnershipVersion: 1, baseRefSha: workspace.baseRefSha,
        ...(managed ? {} : { isolatedRemoteSource: { schema: "paperclip.isolated-remote-source.v1", companyId, issueId, repoUrl } }) } });
    await db.update(issues).set({ executionWorkspaceId: workspaceId }).where(eq(issues.id, issueId));
    const row = () => db.select().from(executionWorkspaces).where(eq(executionWorkspaces.id, workspaceId)).then(rows => rows[0]!);
    const expire = async (options: Partial<Parameters<typeof expireReconstructableGitWorkspace>[2]> = {}) =>
      expireReconstructableGitWorkspace(db, await row(), { dryRun: false, expireBase: true, now: new Date(), ...options });
    const reopen = (company = companyId) => executionWorkspaceService(db).reopenClosedIsolatedExecutionWorkspaceForIssue({ workspaceId,
      issue: { id: issueId, companyId: company, projectId: null }, actor: { actorType: "user", agentId: null },
      authorizationActor: { type: "board", source: "local_implicit", isInstanceAdmin: true } });
    const advance = async () => {
      await fs.writeFile(path.join(source, "marker.txt"), "commit B\n"); git(source, "add", "."); git(source, "commit", "-m", "B"); git(source, "push", "origin", "main");
      return git(source, "rev-parse", "HEAD");
    };
    return { companyId, projectId, issueId, workspaceId, cwd: workspace.cwd, baseCwd, base, remote, source, commitA, row, expire, reopen, advance };
  }

  it("expires through the lifecycle worker and restores the recorded commit after upstream advances", async () => {
    const f = await fixture();
    await fs.mkdir(path.join(f.cwd, "node_modules")); await fs.writeFile(path.join(f.cwd, "node_modules", "cache"), "regenerable");
    await fs.symlink("cache", path.join(f.cwd, "node_modules", "cache-link"));
    expect(await f.expire({ dryRun: true })).toMatchObject({ candidate: true, expired: false, reclaimedBytes: 0, skipReason: null });
    expect(await exists(f.cwd)).toBe(true); expect((await f.row()).metadata?.gitCacheRestoration).toBeUndefined();
    await f.advance();
    const outcome = await executionWorkspaceService(db, { gitCacheExpirationEnabled: true, gitBaseExpirationEnabled: true }).sweepTerminalWorkspaces();
    expect(outcome.archived).toBe(1);
    expect(await exists(f.cwd)).toBe(false); expect(await exists(f.baseCwd)).toBe(false);
    expect((await f.row()).metadata?.gitCacheRestoration).toMatchObject({ commit: f.commitA });
    expect(await f.reopen()).toMatchObject({ ok: true, reopened: true });
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(f.commitA);
    expect(await fs.readFile(path.join(f.cwd, "marker.txt"), "utf8")).toBe("commit A\n");
    // The next heartbeat uses this runtime path before handing files to the agent.
    await ensurePersistedExecutionWorkspaceAvailable({ db, base: f.base,
      workspace: (await executionWorkspaceService(db).getStoredById(f.companyId, f.workspaceId))!,
      issue: { id: f.issueId, identifier: "GC-1", title: "Resumed task" },
      agent: { id: null, name: "Fixture", companyId: f.companyId }, skipHostProvision: true });
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(f.commitA);
    await fs.writeFile(path.join(f.cwd, "continued.txt"), "continued\n"); git(f.cwd, "add", "."); git(f.cwd, "commit", "-m", "Continued");
    const continued = git(f.cwd, "rev-parse", "HEAD");
    expect(await f.reopen()).toMatchObject({ ok: true, reopened: false });
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(continued);
    expect((await f.row()).metadata?.gitCacheRestoration).toMatchObject({ commit: f.commitA, restoredAt: expect.any(String) });
    git(f.baseCwd, "worktree", "remove", f.cwd);
    await db.update(executionWorkspaces).set({ status: "archived" }).where(eq(executionWorkspaces.id, f.workspaceId));
    expect(await f.reopen()).toMatchObject({ ok: true, reopened: true });
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(continued);
  });

  it("expires a worktree after an ordinary fetch and restores its older recorded commit", async () => {
    const f = await fixture();
    await f.advance();
    git(f.cwd, "fetch", "origin", "main");
    expect(await f.expire()).toMatchObject({ expired: true, baseExpired: true });
    expect(await f.reopen()).toMatchObject({ ok: true });
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(f.commitA);
  });

  async function nestedFixture() {
    const f = await fixture(true);
    const nestedSource = path.join(path.dirname(f.source), "nested-author");
    const nestedRemote = path.join(path.dirname(f.source), "nested.git");
    await fs.mkdir(nestedSource);
    git(nestedSource, "init", "--initial-branch=main");
    await fs.writeFile(path.join(nestedSource, "nested.txt"), "nested A\n");
    await fs.writeFile(path.join(nestedSource, ".gitignore"), ".claude/settings.local.json\n");
    git(nestedSource, "add", "."); git(nestedSource, "commit", "-m", "Nested A");
    const nestedA = git(nestedSource, "rev-parse", "HEAD");
    git(path.dirname(nestedSource), "clone", "--bare", nestedSource, nestedRemote);
    const [source] = await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: f.projectId!,
      name: "Nested repository", repoUrl: pathToFileURL(nestedRemote).href, repoRef: "main" }).returning();
    const preparation = { cwd: f.cwd, anchorRepoUrl: f.base.repoUrl, workspaces: [source!], resolveGitAuth: async () => null };
    const [nested] = await prepareProjectRepositoryWorkspaces(preparation);
    const settings = Buffer.from('{"permissions":{"allow":["Read(/user/path)"]},"env":{"LOCAL_SETTING":"preserve-me"}}\n');
    const settingsPath = path.join(f.cwd, ".claude/settings.local.json");
    await fs.mkdir(path.dirname(settingsPath));
    await fs.writeFile(settingsPath, settings, { mode: 0o600 });
    const nestedSettingsPath = path.join(nested!.cwd, ".claude/settings.local.json");
    await fs.mkdir(path.dirname(nestedSettingsPath));
    await fs.writeFile(nestedSettingsPath, settings, { mode: 0o640 });
    return { ...f, nestedSource, nestedRemote, nestedA, preparation, nested: nested!, settings, settingsPath, nestedSettingsPath };
  }

  it("restores nested checkout commits and local settings after upstream advances", async () => {
    const f = await nestedFixture();
    const { nestedSource, nestedRemote, nestedA, preparation, nested, settings, settingsPath } = f;
    await fs.writeFile(path.join(nestedSource, "nested.txt"), "nested B\n");
    git(nestedSource, "add", "."); git(nestedSource, "commit", "-m", "Nested B");
    git(nestedSource, "push", nestedRemote, "main");
    await f.advance();
    expect(await f.expire()).toMatchObject({ expired: true });
    expect(await exists(f.cwd)).toBe(false);
    expect(await f.reopen()).toMatchObject({ ok: true, reopened: true });
    await prepareProjectRepositoryWorkspaces(preparation);
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(f.commitA);
    expect(git(nested!.cwd, "rev-parse", "HEAD")).toBe(nestedA);
    expect(await fs.readFile(settingsPath)).toEqual(settings);
    expect((await fs.stat(settingsPath)).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(f.nestedSettingsPath)).toEqual(settings);
    expect((await fs.stat(f.nestedSettingsPath)).mode & 0o777).toBe(0o640);
    expect(JSON.stringify((await f.row()).metadata)).not.toContain("preserve-me");
    await fs.writeFile(path.join(nested.cwd, "continued.txt"), "nested C\n");
    git(nested.cwd, "add", "."); git(nested.cwd, "commit", "-m", "Nested continued");
    const continued = git(nested.cwd, "rev-parse", "HEAD");
    await fs.writeFile(settingsPath, "user changes after reopening\n");
    await ensurePersistedExecutionWorkspaceAvailable({ db, base: f.base,
      workspace: (await executionWorkspaceService(db).getStoredById(f.companyId, f.workspaceId))!,
      issue: { id: f.issueId, identifier: "GC-1", title: "Resumed task" },
      agent: { id: null, name: "Fixture", companyId: f.companyId }, skipHostProvision: true });
    await prepareProjectRepositoryWorkspaces(preparation);
    expect(git(nested.cwd, "rev-parse", "HEAD")).toBe(continued);
    expect(await fs.readFile(settingsPath, "utf8")).toBe("user changes after reopening\n");
  });

  it("restores saved contents before the provision command observes the workspace", async () => {
    const f = await nestedFixture();
    const probe = path.join(path.dirname(f.source), "provision-probe.cjs");
    const observed = path.join(path.dirname(f.source), "provision-observed.txt");
    await fs.writeFile(probe, `const fs = require('node:fs'); const cp = require('node:child_process');
      if (cp.execFileSync('git', ['-C', ${JSON.stringify(f.nested.cwd)}, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim() !== ${JSON.stringify(f.nestedA)}) throw Error('wrong nested commit');
      if (fs.readFileSync(${JSON.stringify(f.settingsPath)}).toString('base64') !== ${JSON.stringify(f.settings.toString('base64'))}) throw Error('wrong settings');
      fs.writeFileSync(${JSON.stringify(observed)}, 'restored before provision');`);
    const [primary] = await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: f.projectId!,
      name: "Primary repository", cwd: f.baseCwd, repoUrl: f.base.repoUrl, isPrimary: true }).returning();
    await db.update(issues).set({ projectId: f.projectId }).where(eq(issues.id, f.issueId));
    const row = await f.row();
    await db.update(executionWorkspaces).set({ projectWorkspaceId: primary!.id, metadata: { ...row.metadata,
      config: { provisionCommand: `node ${JSON.stringify(probe)}` } } }).where(eq(executionWorkspaces.id, f.workspaceId));
    expect((await f.expire()).expired).toBe(true);
    expect(await f.reopen()).toMatchObject({ ok: true });
    expect(await fs.readFile(observed, "utf8")).toBe("restored before provision");
  });

  it("resumes settings publication after linking but before temporary-file removal", async () => {
    const f = await nestedFixture();
    const settingsDirectory = await fs.realpath(path.dirname(f.settingsPath));
    expect((await f.expire()).expired).toBe(true);
    const originalRemove = fs.rm.bind(fs);
    const remove = vi.spyOn(fs, "rm").mockImplementation(async (target, options) => {
      if (path.dirname(String(target)) === settingsDirectory && String(target).includes(".settings-restore-")) throw new Error("interrupted_settings_publication");
      return originalRemove(target, options);
    });
    expect(await f.reopen()).toMatchObject({ ok: false, code: "rebuild_failed" });
    expect((await fs.stat(f.settingsPath)).nlink).toBe(2);
    remove.mockRestore();
    expect(await f.reopen()).toMatchObject({ ok: true });
    expect((await fs.stat(f.settingsPath)).nlink).toBe(1);
    expect(await fs.readFile(f.settingsPath)).toEqual(f.settings);
  });

  it("retains tracked local settings whose permissions Git cannot reproduce", async () => {
    const f = await nestedFixture();
    git(f.cwd, "add", "-f", ".claude/settings.local.json");
    git(f.cwd, "commit", "-m", "Tracked settings");
    git(f.cwd, "push", "origin", "HEAD:refs/heads/fixture-task");
    expect(await f.expire()).toMatchObject({ expired: false, skipReason: "tracked_local_settings" });
    expect((await fs.stat(f.settingsPath)).mode & 0o777).toBe(0o600);
  });

  it("restores a historical checkout after its project branch selection changes", async () => {
    const f = await nestedFixture();
    expect((await f.expire()).expired).toBe(true);
    await db.update(projectWorkspaces).set({ repoRef: "release" }).where(eq(projectWorkspaces.id, f.preparation.workspaces[0]!.id));
    expect(await f.reopen()).toMatchObject({ ok: true });
    expect(git(f.nested.cwd, "rev-parse", "HEAD")).toBe(f.nestedA);
  });

  it("retries a partial nested restoration when upstream returns", async () => {
    const f = await nestedFixture();
    expect((await f.expire()).expired).toBe(true);
    await fs.rename(f.nestedRemote, `${f.nestedRemote}.offline`);
    expect(await f.reopen()).toMatchObject({ ok: false, code: "rebuild_failed" });
    expect(await exists(f.cwd)).toBe(true);
    expect((await f.row()).metadata?.gitCacheRestoration).not.toHaveProperty("restoredAt");
    await fs.rename(`${f.nestedRemote}.offline`, f.nestedRemote);
    expect(await f.reopen()).toMatchObject({ ok: true });
    expect(git(f.nested.cwd, "rev-parse", "HEAD")).toBe(f.nestedA);
    expect(await fs.readFile(f.settingsPath)).toEqual(f.settings);
  });

  it.each(["settings", "checkout", "legacy_recipe"])("retains changed %s and permits ordinary reopening", async kind => {
    const f = await nestedFixture();
    if (kind === "legacy_recipe") {
      expect((await f.expire({ beforeDelete: async () => { throw new Error("stop_before_delete"); } })).expired).toBe(false);
      const row = await f.row();
      const recipe = { ...(row.metadata!.gitCacheRestoration as Record<string, unknown>) };
      delete recipe.contents;
      await db.update(executionWorkspaces).set({ metadata: { ...row.metadata, gitCacheRestoration: recipe } }).where(eq(executionWorkspaces.id, f.workspaceId));
    }
    const outcome = await f.expire({ beforeDelete: async () => {
      if (kind === "settings") await fs.writeFile(f.settingsPath, "new local settings\n");
      if (kind === "checkout") {
        await fs.writeFile(path.join(f.nested.cwd, "nested.txt"), "nested B\n");
        git(f.nested.cwd, "add", "."); git(f.nested.cwd, "commit", "-m", "Nested B");
        git(f.nested.cwd, "push", "origin", "main");
      }
    } });
    expect(outcome).toMatchObject({ expired: false, reclaimedBytes: 0 });
    expect(await exists(f.cwd)).toBe(true);
    expect(await f.reopen()).toMatchObject({ ok: true });
    expect(await fs.readFile(f.settingsPath, "utf8")).toBe(kind === "settings" ? "new local settings\n" : f.settings.toString());
    expect(await fs.readFile(path.join(f.nested.cwd, "nested.txt"), "utf8")).toBe(kind === "checkout" ? "nested B\n" : "nested A\n");
  });

  it("expires again after a reopened task consumes its fence and finishes", async () => {
    const f = await fixture();
    expect((await f.expire()).expired).toBe(true);
    expect(await f.reopen()).toMatchObject({ ok: true, reopened: true });
    await db.update(issues).set({ status: "in_progress", completedAt: null }).where(eq(issues.id, f.issueId));
    const worker = executionWorkspaceService(db, { gitCacheExpirationEnabled: true, gitBaseExpirationEnabled: true });
    await worker.sweepTerminalWorkspaces();
    expect((await f.row()).metadata?.reopenPendingConsumption).not.toBe(true);
    await fs.writeFile(path.join(f.cwd, "continued.txt"), "second task cycle\n");
    git(f.cwd, "add", "."); git(f.cwd, "commit", "-m", "Second task cycle");
    git(f.cwd, "push", "origin", "HEAD:refs/heads/continued");
    const continued = git(f.cwd, "rev-parse", "HEAD");
    await db.update(issues).set({ status: "done", completedAt: new Date(Date.now() - 48 * 3_600_000) }).where(eq(issues.id, f.issueId));
    expect((await worker.sweepTerminalWorkspaces()).archived).toBe(1);
    expect((await f.row()).metadata?.gitCacheRestoration).toMatchObject({ commit: continued });
    expect(await f.reopen()).toMatchObject({ ok: true, reopened: true });
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(continued);
  });

  it("prepares a restored workspace after adopting its renamed branch", async () => {
    const f = await fixture();
    await f.advance();
    expect((await f.expire()).expired).toBe(true);
    expect(await f.reopen()).toMatchObject({ ok: true });
    git(f.cwd, "branch", "-m", "renamed-task");
    await db.update(executionWorkspaces).set({ status: "idle" }).where(eq(executionWorkspaces.id, f.workspaceId));
    const svc = executionWorkspaceService(db);
    await svc.reconcileExecutionWorkspaceBranch(f.workspaceId, {
      mode: "forward", actor: { actorType: "user", actorId: "local-board", agentId: null, runId: null },
    });
    expect((await f.row()).metadata?.gitCacheRestoration).toMatchObject({
      branchName: "renamed-task", commit: f.commitA, restoredAt: expect.any(String),
    });
    await ensurePersistedExecutionWorkspaceAvailable({ db, base: f.base,
      workspace: (await svc.getStoredById(f.companyId, f.workspaceId))!,
      issue: { id: f.issueId, identifier: "GC-1", title: "Resumed task" },
      agent: { id: null, name: "Fixture", companyId: f.companyId }, skipHostProvision: true });
    expect(git(f.cwd, "branch", "--show-current")).toBe("renamed-task");
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(f.commitA);
  });

  it("preserves worktrees whose Git administration parent is a symlink", async () => {
    const f = await fixture();
    const adminParent = path.join(f.baseCwd, ".git", "worktrees");
    const external = path.join(root, `external-admin-${randomUUID()}`);
    const admin = git(f.cwd, "rev-parse", "--absolute-git-dir");
    await fs.writeFile(path.join(admin, "commondir"), `${path.join(f.baseCwd, ".git")}\n`);
    await fs.rename(adminParent, external);
    await fs.symlink(external, adminParent);
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(f.commitA);
    expect(await f.expire()).toMatchObject({ expired: false, skipReason: "unproven_worktree_admin" });
    expect(await exists(f.cwd)).toBe(true);
    expect(await fs.readdir(external)).not.toEqual([]);
    expect((await f.row()).metadata?.gitCacheRestoration).toBeUndefined();
  });

  it.each(["dirty", "untracked", "ignored", "local_commit", "stash", "unknown_git_file"])("preserves %s unique state", async kind => {
    const f = await fixture();
    if (kind === "dirty") await fs.writeFile(path.join(f.cwd, "marker.txt"), "unique changes");
    if (kind === "untracked") await fs.writeFile(path.join(f.cwd, "notes.txt"), "unique notes");
    if (kind === "ignored") { await fs.mkdir(path.join(f.cwd, "private-notes")); await fs.writeFile(path.join(f.cwd, "private-notes", "note"), "unique ignored"); }
    if (kind === "local_commit") { await fs.writeFile(path.join(f.cwd, "new.txt"), "unique commit"); git(f.cwd, "add", "."); git(f.cwd, "commit", "-m", "Unpushed"); }
    if (kind === "stash") { await fs.writeFile(path.join(f.cwd, "marker.txt"), "stash"); git(f.cwd, "stash"); }
    if (kind === "unknown_git_file") await fs.writeFile(path.join(git(f.cwd, "rev-parse", "--absolute-git-dir"), "unique-note"), "unique Git data");
    expect((await f.expire()).expired).toBe(false);
    expect(await exists(f.cwd)).toBe(true); expect(await exists(f.baseCwd)).toBe(true);
  });

  it("preserves live descendants and pending reopening", async () => {
    const f = await fixture();
    await db.insert(issues).values({ companyId: f.companyId, title: "Active child", status: "in_progress", parentId: f.issueId });
    expect((await f.expire()).expired).toBe(false);
    await db.delete(issues).where(eq(issues.parentId, f.issueId));
    const row = await f.row();
    await db.update(executionWorkspaces).set({ metadata: { ...row.metadata, reopenPendingConsumption: true } }).where(eq(executionWorkspaces.id, f.workspaceId));
    expect((await f.expire()).expired).toBe(false);
    expect(await exists(f.cwd)).toBe(true);
  });

  it("retries after interruption with the restoration recipe already committed", async () => {
    const f = await fixture();
    expect((await f.expire({ beforeDelete: async () => { throw new Error("interrupted_fixture"); } })).expired).toBe(false);
    expect((await f.row()).metadata?.gitCacheRestoration).toMatchObject({ commit: f.commitA });
    expect(await exists(f.cwd)).toBe(true);
    expect((await f.expire()).expired).toBe(true);
    expect(await f.reopen()).toMatchObject({ ok: true });
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(f.commitA);
  });

  it("fails restoration explicitly on upstream failure and rejects a different company", async () => {
    const f = await fixture();
    expect((await f.expire()).baseExpired).toBe(true);
    await fs.rename(f.remote, `${f.remote}.offline`);
    expect(await f.reopen()).toMatchObject({ ok: false, code: "rebuild_failed", message: "The saved workspace commit could not be restored. Check repository access and retry." });
    expect(await f.reopen(randomUUID())).toMatchObject({ ok: false, code: "not_reopenable" });
    expect(await exists(f.cwd)).toBe(false);
    await fs.rename(`${f.remote}.offline`, f.remote);
    expect(await f.reopen()).toMatchObject({ ok: true });
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(f.commitA);
  });
  it("serializes concurrent reopening after deletion and publishes one transition", async () => {
    const f = await fixture();
    let release!: () => void, entered!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const expiration = f.expire({ beforeDelete: async () => { entered(); await paused; } });
    await ready;
    const first = f.reopen(), second = f.reopen();
    release();
    expect((await expiration).expired).toBe(true);
    const results = await Promise.all([first, second]);
    expect(results, JSON.stringify(results)).toEqual(expect.arrayContaining([expect.objectContaining({ ok: true, reopened: true }), expect.objectContaining({ ok: true, reopened: false })]));
    expect(results.filter(result => result.ok && result.reopened)).toHaveLength(1);
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(f.commitA);
  });

  it("recovers interrupted trash removal before reopening", async () => {
    const f = await fixture();
    const originalRemove = fs.rm.bind(fs);
    const remove = vi.spyOn(fs, "rm").mockImplementation(async (target, options) => {
      if (String(target).includes(".expired-git-worktree-")) throw new Error("interrupted_trash_fixture");
      return originalRemove(target, options);
    });
    expect((await f.expire()).skipReason).toBe("interrupted_trash_fixture");
    expect(await exists(f.cwd)).toBe(false);
    expect((await f.row()).metadata?.gitCacheRestoration).toMatchObject({ commit: f.commitA });
    remove.mockRestore();
    expect(await f.reopen()).toMatchObject({ ok: true, reopened: true });
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(f.commitA);
  });

  it("preserves scheduled runs, unresolved recovery, and live previews", async () => {
    const f = await fixture();
    const agentId = randomUUID(), runId = randomUUID();
    await db.insert(agents).values({ id: agentId, companyId: f.companyId, name: "Fixture", role: "engineer", adapterType: "process" });
    await db.insert(heartbeatRuns).values({ id: runId, companyId: f.companyId, agentId, nativeIssueId: f.issueId, status: "scheduled_retry" });
    expect((await f.expire()).expired).toBe(false);
    await db.update(heartbeatRuns).set({ status: "failed", finishedAt: new Date() }).where(eq(heartbeatRuns.id, runId));
    await db.insert(nativeRunFinalizations).values({ runId, companyId: f.companyId, issueId: f.issueId, phase: "terminal_failure", recoveryState: "blocked" });
    expect((await f.expire()).expired).toBe(false);
    await db.delete(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, runId));
    await db.insert(workspaceRuntimeServices).values({ id: randomUUID(), companyId: f.companyId, executionWorkspaceId: f.workspaceId,
      scopeType: "execution_workspace", serviceName: "Preview", status: "running", lifecycle: "persistent", provider: "local" });
    expect((await f.expire()).expired).toBe(false);
    expect(await exists(f.cwd)).toBe(true);
  });

  it("skips deletion when authenticated upstream verification fails", async () => {
    const f = await fixture();
    await fs.rename(f.remote, `${f.remote}.offline`);
    expect((await f.expire()).expired).toBe(false);
    expect(await exists(f.cwd)).toBe(true);
    expect((await f.row()).metadata?.gitCacheRestoration).toBeUndefined();
  });

  it("keeps an unused base containing custom Git files", async () => {
    const f = await fixture();
    const note = path.join(f.baseCwd, ".git", "private-note");
    await fs.writeFile(note, "unique base metadata");
    const outcome = await f.expire();
    expect(outcome).toMatchObject({ expired: true, baseExpired: false, skipReason: "unknown_base_git_files" });
    expect(await fs.readFile(note, "utf8")).toBe("unique base metadata");
    expect(await f.reopen()).toMatchObject({ ok: true });
  });

  it("expires owned task worktrees while preserving their shared managed base", async () => {
    const f = await fixture(true, true);
    await f.advance();
    expect(await f.expire()).toMatchObject({ expired: true, baseExpired: false, skipReason: "shared_base_preserved" });
    expect(await exists(f.baseCwd)).toBe(true);
    expect(await f.reopen()).toMatchObject({ ok: true });
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(f.commitA);
  });

  it("expires an isolated base whose worktree was nested inside it", async () => {
    const f = await fixture(false, true);
    await fs.mkdir(path.join(f.baseCwd, ".git", "branches"), { recursive: true });
    expect(await f.expire()).toMatchObject({ expired: true, baseExpired: true });
    expect(await exists(f.baseCwd)).toBe(false);
    expect(await f.reopen()).toMatchObject({ ok: true });
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(f.commitA);
  });

  it.each(["file", "symlink"])("preserves a legacy branches directory with %s data", async kind => {
    const f = await fixture(false, true);
    const branches = path.join(f.baseCwd, ".git", "branches");
    await fs.mkdir(branches, { recursive: true });
    const note = path.join(branches, "saved-remote");
    await fs.writeFile(note, "unique legacy remote\n");
    if (kind === "symlink") {
      const target = path.join(root, `legacy-branches-${randomUUID()}`);
      await fs.rename(branches, target);
      await fs.symlink(target, branches);
    }
    expect(await f.expire()).toMatchObject({ expired: true, baseExpired: false, skipReason: "custom_git_metadata" });
    expect(await fs.readFile(note, "utf8")).toBe("unique legacy remote\n");
    expect(await f.expire({ dryRun: true })).toMatchObject({ candidate: true, expired: false, skipReason: "custom_git_metadata" });
    expect(await f.reopen()).toMatchObject({ ok: true });
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(f.commitA);
  });

});
