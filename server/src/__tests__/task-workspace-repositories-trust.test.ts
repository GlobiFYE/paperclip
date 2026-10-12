import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from "node:fs/promises";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { agents, authUsers, companies, companyMemberships, createDb, executionWorkspaceRepositoryRoots, executionWorkspaceRepositoryAccess, executionWorkspaceRepositories, executionWorkspaces,
  heartbeatRuns, issueAccessGrants, issues, projects, projectWorkspaces, projectAccessMembers, principalPermissionGrants, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
import { assertExecutionWorkspaceRootReadAccess, assertExecutionWorkspaceRootWriteAccess, assertIsolatedWorkspaceSourceReadAccess, retainIsolatedWorkspaceSourceAccess, executionWorkspaceRepositoryService } from "../services/execution-workspace-repositories.js";
import { executionWorkspaceService } from "../services/execution-workspaces.js";
import { projectService } from "../services/projects.js";
import { buildNativeExecutionInput } from "../services/native-runtime/native-execution-input.js";
import { nativeRuntimeContextFixture } from "../services/native-runtime/runtime-context.test-fixture.js";
import { buildGitAuthInvocation } from "../services/git-credentials.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const acquisition = vi.hoisted(() => ({ managedAuth: vi.fn(), materialize: vi.fn(), catalog: vi.fn() }));
vi.mock("../services/tool-access.js", () => ({ toolAccessService: () => ({ listProjectRepositories: acquisition.catalog }) }));
vi.mock("../services/git-credentials.js", async (original) => ({
  ...await original<typeof import("../services/git-credentials.js")>(),
  createGitRemoteAuthProvider: () => acquisition.managedAuth,
}));
vi.mock("../services/managed-repository-checkout.js", async (original) => ({
  ...await original<typeof import("../services/managed-repository-checkout.js")>(),
  materializeManagedProjectWorkspace: acquisition.materialize,
}));

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("task repository trust authority", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let root: string;
  beforeAll(async () => {
    vi.stubEnv("PAPERCLIP_ISSUE_PRIVACY_MODE", "enforce");
    database = await startEmbeddedPostgresTestDatabase("paperclip-repository-trust-");
    db = createDb(database.connectionString);
    root = await mkdtemp(path.join(tmpdir(), "paperclip-repository-trust-"));
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });
  afterAll(async () => { vi.unstubAllEnvs(); await database?.cleanup(); if (root) await rm(root, { recursive: true, force: true }); });

  async function fixture() {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    const userId = randomUUID(), cwd = path.join(root, issueId);
    await mkdir(cwd);
    await db.insert(companies).values({ id: companyId, name: "Repository trust", issuePrefix: `R${companyId.slice(0, 6).toUpperCase()}` });
    await db.insert(authUsers).values({ id: userId, name: "Sponsor", email: `${userId}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(agents).values({ id: agentId, companyId, name: "Chat worker", adapterType: "process", status: "idle" });
    await db.insert(companyMemberships).values([
      { companyId, principalType: "user", principalId: userId, membershipRole: "operator", status: "active" },
      { companyId, principalType: "agent", principalId: agentId, membershipRole: "member", status: "active" },
    ]);
    const [workspace] = await db.insert(executionWorkspaces).values({ companyId, name: "Task files", cwd,
      mode: "isolated_workspace", strategyType: "task_directory" }).returning();
    await db.insert(issues).values({ id: issueId, companyId, title: "Unlinked chat work", assigneeAgentId: agentId,
      executionWorkspaceId: workspace.id });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "running", responsibleUserId: userId,
      contextSnapshot: { issueId } });
    await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));
    acquisition.catalog.mockResolvedValue({ repositories: [{ id: "private-repo", fullName: "sponsor/private", private: true,
      url: "https://github.com/sponsor/private", connections: ["sponsor-github"] }] });
    acquisition.managedAuth.mockRejectedValue(new Error("Managed credentials must not be acquired"));
    const actor = { type: "agent" as const, source: "agent_jwt" as const, companyId, agentId, runId, onBehalfOfUserId: userId };
    const policy = { trustPreset: "low_trust_review" as const, authorizationPolicy: {
      trustPreset: "low_trust_review" as const, trustBoundary: { mode: "low_trust_review" as const, companyId, rootIssueId: issueId },
    } };
    const service = executionWorkspaceRepositoryService(db);
    const request = (repository: { kind: "catalog"; id: string } | { kind: "url"; url: string }, requestKey = randomUUID()) =>
      service.request({ companyId, issueId, actor, request: { repository, requestKey } });
    const admission = { companyId, issueId, workspaceId: workspace.id, cwd, agentId, runId, responsibleUserId: userId };
    return { companyId, agentId, issueId, runId, userId, workspace, policy, service, actor, request, admission };
  }

  async function lowTrustPeer(f: Awaited<ReturnType<typeof fixture>>, cwd = f.admission.cwd) {
    const [workspace] = await db.insert(executionWorkspaces).values({ companyId: f.companyId, name: "Low-trust alias",
      cwd, mode: "isolated_workspace", strategyType: "task_directory" }).returning();
    const issueId = randomUUID(), runId = randomUUID();
    await db.insert(issues).values({ id: issueId, companyId: f.companyId, title: "Low-trust peer",
      assigneeAgentId: f.agentId, executionWorkspaceId: workspace.id });
    const policy = { ...f.policy, authorizationPolicy: { ...f.policy.authorizationPolicy,
      trustBoundary: { ...f.policy.authorizationPolicy.trustBoundary, rootIssueId: issueId } } };
    await db.insert(heartbeatRuns).values({ id: runId, companyId: f.companyId, agentId: f.agentId, status: "running",
      responsibleUserId: f.userId, contextSnapshot: { issueId, executionPolicy: policy } });
    return { workspace, admission: { ...f.admission, cwd, issueId, runId, workspaceId: workspace.id }, actor: { ...f.actor, runId } };
  }

  async function standardPeer(f: Awaited<ReturnType<typeof fixture>>) {
    const userId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name: "Other sponsor", email: `${userId}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(agents).values({ id: agentId, companyId: f.companyId, name: "Other worker", adapterType: "process" });
    await db.insert(companyMemberships).values([
      { companyId: f.companyId, principalType: "user", principalId: userId, membershipRole: "member", status: "active" },
      { companyId: f.companyId, principalType: "agent", principalId: agentId, membershipRole: "member", status: "active" },
    ]);
    const [workspace] = await db.insert(executionWorkspaces).values({ companyId: f.companyId, name: "Other task files", cwd: f.admission.cwd,
      mode: "shared_workspace", strategyType: "operator_directory" }).returning();
    await db.insert(issues).values({ id: issueId, companyId: f.companyId, title: "Other task", assigneeAgentId: agentId, executionWorkspaceId: workspace.id });
    await db.insert(heartbeatRuns).values({ id: runId, companyId: f.companyId, agentId, responsibleUserId: userId, status: "running", contextSnapshot: { issueId } });
    return { userId, agentId, issueId, runId, workspace,
      actor: { ...f.actor, agentId, runId, onBehalfOfUserId: userId },
      admission: { ...f.admission, agentId, runId, issueId, workspaceId: workspace.id, responsibleUserId: userId } };
  }
  async function privateTask(f: Awaited<ReturnType<typeof fixture>>) {
    await db.update(issues).set({ visibility: "private", privacyRootIssueId: f.issueId, responsibleUserId: f.userId }).where(eq(issues.id, f.issueId));
  }
  async function grantPeer(f: Awaited<ReturnType<typeof fixture>>, peer: Awaited<ReturnType<typeof standardPeer>>) {
    return db.insert(issueAccessGrants).values([
      { issueId: f.issueId, subjectType: "agent", subjectId: peer.agentId, source: "explicit", grantedByUserId: f.userId },
      { issueId: f.issueId, subjectType: "user", subjectId: peer.userId, source: "explicit", grantedByUserId: f.userId },
    ]).returning();
  }
  async function localPrivateClone(f: Awaited<ReturnType<typeof fixture>>, beforePublish?: () => Promise<void>) {
    const source = path.join(root, `${f.issueId}-privacy-source`);
    await mkdir(source);
    const exec = promisify(execFileCallback);
    await exec("git", ["init", "--initial-branch=main", source]);
    await writeFile(path.join(source, "private.txt"), "Private task edits\n");
    await exec("git", ["-C", source, "add", "."]);
    await exec("git", ["-C", source, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "source"]);
    const actual = await vi.importActual<typeof import("../services/managed-repository-checkout.js")>("../services/managed-repository-checkout.js");
    acquisition.materialize.mockImplementationOnce((cwd, input) => actual.materializeManagedProjectWorkspace(cwd, { ...input, localSource: source,
      beforePublish: async cloneCwd => { await beforePublish?.(); await input.beforePublish(cloneCwd); } }));
  }

  it.each([
    { owner: "configured", direction: "descendant" }, { owner: "configured", direction: "ancestor" },
    { owner: "execution", direction: "descendant" }, { owner: "execution", direction: "ancestor" },
  ])("authorizes newly overlapping private $owner $direction owners before selection, admission and publication", async ({ owner, direction }) => {
    const f = await fixture();
    const child = path.join(f.admission.cwd, "private");
    await mkdir(child);
    const privateCwd = direction === "descendant" ? child : f.admission.cwd;
    if (direction === "ancestor") {
      f.admission.cwd = child;
      await db.update(executionWorkspaces).set({ cwd: child }).where(eq(executionWorkspaces.id, f.workspace.id));
    }
    await f.service.prepareForAdmission(f.admission); // A retained reader cannot hide later nested owners.
    let grant: () => Promise<unknown>;
    let detach: () => Promise<unknown>;
    if (owner === "configured") {
      const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Nested private source", visibility: "private" }).returning();
      const [source] = await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: project.id, name: "Private files", cwd: privateCwd }).returning();
      grant = () => db.insert(projectAccessMembers).values([
        { companyId: f.companyId, projectId: project.id, subjectType: "agent", subjectId: f.agentId },
        { companyId: f.companyId, projectId: project.id, subjectType: "user", subjectId: f.userId },
      ]);
      detach = async () => {
        await db.delete(projectWorkspaces).where(eq(projectWorkspaces.id, source.id));
        await db.delete(projectAccessMembers).where(eq(projectAccessMembers.projectId, project.id));
      };
    } else {
      const peer = await standardPeer(f);
      await db.update(executionWorkspaces).set({ cwd: privateCwd }).where(eq(executionWorkspaces.id, peer.workspace.id));
      await db.update(issues).set({ visibility: "private", privacyRootIssueId: peer.issueId, responsibleUserId: peer.userId }).where(eq(issues.id, peer.issueId));
      grant = () => db.insert(issueAccessGrants).values([
        { issueId: peer.issueId, subjectType: "agent", subjectId: f.agentId, source: "explicit", grantedByUserId: peer.userId },
        { issueId: peer.issueId, subjectType: "user", subjectId: f.userId, source: "explicit", grantedByUserId: peer.userId },
      ]);
      detach = async () => {
        const moved = path.join(root, `${peer.issueId}-moved`); await mkdir(moved);
        await executionWorkspaceService(db).update(peer.workspace.id, { cwd: moved });
        await db.delete(issueAccessGrants).where(eq(issueAccessGrants.issueId, peer.issueId));
      };
    }
    await writeFile(path.join(privateCwd, "private.txt"), "Nested private files\n");
    const read = () => assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: f.admission.cwd, actor: f.actor, sourceWorkspaceId: f.workspace.id });
    const select = () => executionWorkspaceService(db).selectTaskWorkspace({ companyId: f.companyId, issueId: f.issueId, actor: f.actor,
      selection: { kind: "existing", workspaceId: f.workspace.id }, expectedBindingRevision: 0, requestKey: randomUUID() });
    await expect(read()).rejects.toThrow(/source project|workspace access|authorization boundary/);
    await expect(select()).rejects.toThrow(/source project|workspace access|authorization boundary/);
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/source project|workspace access|authorization boundary/);
    await expect(f.service.guardForPublication(f.admission)).rejects.toThrow(/source project|workspace access|authorization boundary/);
    await grant();
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
    await expect(read()).resolves.toBeUndefined();
    await detach();
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/source project|workspace access|authorization boundary/);
    await expect(read()).rejects.toThrow(/source project|workspace access|authorization boundary/);
  });

  it("does not confuse sibling component prefixes with overlapping roots", async () => {
    const f = await fixture();
    const sibling = `${f.admission.cwd}er`; await mkdir(sibling);
    const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Unrelated private source", visibility: "private" }).returning();
    await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: project.id, name: "Sibling", cwd: sibling });
    await db.insert(executionWorkspaceRepositoryAccess).values({ companyId: f.companyId, rootKey: createHash("sha256").update(await realpath(sibling)).digest("hex"),
      canonicalCwd: await realpath(sibling), kind: "project_source", scopeId: project.id });
    await db.insert(executionWorkspaceRepositoryRoots).values({ companyId: f.companyId, rootKey: createHash("sha256").update(await realpath(sibling)).digest("hex"),
      canonicalCwd: await realpath(sibling), mode: "anonymous_only" });
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
    await expect(f.request({ kind: "catalog", id: "private-repo" })).resolves.toMatchObject({ kind: "requires_next_admission" });
  });

  it.each([
    { mode: "managed", direction: "ancestor" }, { mode: "managed", direction: "descendant" },
    { mode: "anonymous_only", direction: "ancestor" }, { mode: "anonymous_only", direction: "descendant" },
  ] as const)("fences $mode root policy against opposite-mode $direction acquisition", async ({ mode, direction }) => {
    const f = await fixture();
    const child = path.join(f.admission.cwd, "nested"); await mkdir(child);
    const existingRoot = direction === "ancestor" ? child : f.admission.cwd;
    if (direction === "descendant") {
      f.admission.cwd = child;
      await db.update(executionWorkspaces).set({ cwd: child }).where(eq(executionWorkspaces.id, f.workspace.id));
    }
    const canonicalCwd = await realpath(existingRoot);
    await db.insert(executionWorkspaceRepositoryRoots).values({ companyId: f.companyId, canonicalCwd,
      rootKey: createHash("sha256").update(canonicalCwd).digest("hex"), mode });
    if (mode === "managed") {
      await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: f.issueId, executionPolicy: f.policy } }).where(eq(heartbeatRuns.id, f.runId));
      await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/anonymous public URLs only/);
    } else await expect(f.request({ kind: "catalog", id: "private-repo" })).rejects.toThrow(/anonymous public URLs only/);
    expect(await f.service.list(f.companyId, f.workspace.id)).toEqual([]);
    expect(acquisition.materialize).not.toHaveBeenCalled();
  });

  it("reauthorizes a nested private publication against an already-admitted parent reader", async () => {
    const f = await fixture();
    await f.service.prepareForAdmission(f.admission);
    const peer = await standardPeer(f), child = path.join(f.admission.cwd, "private"); await mkdir(child);
    peer.admission.cwd = child;
    await db.update(executionWorkspaces).set({ cwd: child }).where(eq(executionWorkspaces.id, peer.workspace.id));
    await db.update(issues).set({ visibility: "private", privacyRootIssueId: peer.issueId, responsibleUserId: peer.userId }).where(eq(issues.id, peer.issueId));
    const request = () => f.service.request({ companyId: f.companyId, issueId: peer.issueId, actor: peer.actor,
      request: { repository: { kind: "url", url: "https://github.com/public/nested" }, requestKey: randomUUID() } });
    await expect(request()).rejects.toThrow(/workspace access|authorization boundary/);
    await db.insert(issueAccessGrants).values([
      { issueId: peer.issueId, subjectType: "agent", subjectId: f.agentId, source: "explicit", grantedByUserId: peer.userId },
      { issueId: peer.issueId, subjectType: "user", subjectId: f.userId, source: "explicit", grantedByUserId: peer.userId },
    ]);
    const receipt = await request();
    await localPrivateClone({ ...f, issueId: peer.issueId }, async () => {
      await db.delete(issueAccessGrants).where(eq(issueAccessGrants.issueId, peer.issueId));
    });
    await expect(f.service.prepareForAdmission(peer.admission)).rejects.toThrow(/workspace access|authorization boundary/);
    await expect(fs.lstat(path.join(child, receipt.repository.relativePath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(acquisition.materialize).toHaveBeenCalledOnce();
  });

  it.each(["subdirectory", "linked_worktree", "nested_target"] as const)("retains private Git owner provenance copied through a %s without requiring source write grants", async sourceKind => {
    const f = await fixture(), exec = promisify(execFileCallback);
    const privateCwd = path.join(f.admission.cwd, "private"), publicCwd = path.join(f.admission.cwd, "public");
    await mkdir(privateCwd); await mkdir(publicCwd);
    await writeFile(path.join(privateCwd, "secret.txt"), "Copied private Git bytes\n");
    await writeFile(path.join(publicCwd, "readme.txt"), "Public nested configuration\n");
    await exec("git", ["init", "--initial-branch=main", f.admission.cwd]);
    await exec("git", ["-C", f.admission.cwd, "add", "."]);
    await exec("git", ["-C", f.admission.cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "source"]);
    const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Private copied source", visibility: "private",
      executionWorkspacePolicy: { authorizationPolicy: { assignmentPolicy: { mode: "protected" } } } }).returning();
    await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: project.id, name: "Private nested files", cwd: privateCwd });
    if (sourceKind === "nested_target") {
      const [outer] = await db.insert(projects).values({ companyId: f.companyId, name: "Protected ancestor source",
        executionWorkspacePolicy: { authorizationPolicy: { assignmentPolicy: { mode: "protected" } } } }).returning();
      await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: outer.id, name: "Ancestor source", cwd: f.admission.cwd });
    }
    let sourceCwd = publicCwd;
    if (sourceKind === "linked_worktree") {
      sourceCwd = path.join(root, `${f.issueId}-linked`);
      await exec("git", ["-C", f.admission.cwd, "worktree", "add", "-b", "linked", sourceCwd]);
    }
    await expect(assertIsolatedWorkspaceSourceReadAccess(db, { companyId: f.companyId, sourceCwd, actor: f.actor })).rejects.toThrow(/source project/);
    await db.insert(projectAccessMembers).values([
      { companyId: f.companyId, projectId: project.id, subjectType: "agent", subjectId: f.agentId },
      { companyId: f.companyId, projectId: project.id, subjectType: "user", subjectId: f.userId },
    ]);
    const captured = await assertIsolatedWorkspaceSourceReadAccess(db, { companyId: f.companyId, sourceCwd, actor: f.actor });
    expect(captured.projectIds).toContain(project.id);
    const targetCwd = sourceKind === "nested_target" ? path.join(f.admission.cwd, ".paperclip", "worktrees", "copy") : path.join(root, `${f.issueId}-copy`);
    await retainIsolatedWorkspaceSourceAccess(db, { companyId: f.companyId, sourceCwd, targetCwd, actor: f.actor, captured });
    await expect(fs.lstat(targetCwd)).rejects.toMatchObject({ code: "ENOENT" });
    if (sourceKind === "nested_target") {
      await expect(assertExecutionWorkspaceRootWriteAccess(db, { companyId: f.companyId, cwd: targetCwd,
        actor: f.actor, issueId: f.issueId })).rejects.toThrow(/protected|assignment grant/);
    }
    await exec("git", ["-C", f.admission.cwd, "worktree", "add", "-b", "copy", targetCwd]);
    await retainIsolatedWorkspaceSourceAccess(db, { companyId: f.companyId, sourceCwd, targetCwd, actor: f.actor, captured, phase: "verified" });
    const [target] = await db.insert(executionWorkspaces).values({ companyId: f.companyId, name: "Isolated copy", cwd: targetCwd,
      mode: "isolated_workspace", strategyType: "git_worktree" }).returning();
    await db.update(issues).set({ executionWorkspaceId: target.id }).where(eq(issues.id, f.issueId));
    await expect(f.service.prepareForAdmission({ ...f.admission, workspaceId: target.id, cwd: targetCwd })).resolves.toEqual([]);
    expect(await readFile(path.join(targetCwd, "private", "secret.txt"), "utf8")).toBe("Copied private Git bytes\n");
    if (sourceKind === "nested_target") {
      await fs.rename(path.join(targetCwd, ".git"), path.join(targetCwd, ".saved-git"));
      await expect(assertExecutionWorkspaceRootWriteAccess(db, { companyId: f.companyId, cwd: targetCwd,
        actor: f.actor, issueId: f.issueId })).rejects.toThrow(/protected|assignment grant/);
      await fs.rename(path.join(targetCwd, ".saved-git"), path.join(targetCwd, ".git"));
    }
    await db.delete(projectAccessMembers).where(eq(projectAccessMembers.projectId, project.id));
    await expect(assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: targetCwd, actor: f.actor, sourceWorkspaceId: target.id })).rejects.toThrow(/source project/);
  });

  it.each(["file_uri", "absolute_path", "materialized_copy"] as const)("authorizes URL-only private configured owners before a public local clone (%s)", async transport => {
    const f = await fixture(), exec = promisify(execFileCallback);
    const sourceCwd = path.join(root, `${f.issueId}-url-only-source`); await mkdir(sourceCwd);
    await exec("git", ["init", "--initial-branch=main", sourceCwd]);
    await writeFile(path.join(sourceCwd, "secret.txt"), "Private URL source\n");
    await exec("git", ["-C", sourceCwd, "add", "."]);
    await exec("git", ["-C", sourceCwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "source"]);
    const repoUrl = transport === "absolute_path" ? sourceCwd : `file://${sourceCwd}`;
    const [privateProject] = await db.insert(projects).values({ companyId: f.companyId, name: "Private URL owner", visibility: "private" }).returning();
    const privateCopy = transport === "materialized_copy" ? path.join(root, `${f.issueId}-independent-private`) : null;
    if (privateCopy) await exec("git", ["clone", repoUrl, privateCopy]);
    const [privateSource] = await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: privateProject.id,
      name: "URL-only private source", cwd: privateCopy, repoUrl }).returning();
    const [publicProject] = await db.insert(projects).values({ companyId: f.companyId, name: "Public URL selection" }).returning();
    await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: publicProject.id, name: "Same URL", cwd: null, repoUrl });
    await db.update(issues).set({ projectId: publicProject.id }).where(eq(issues.id, f.issueId));
    const sourceInput = { companyId: f.companyId, sourceCwd, actor: f.actor, copyKind: "repository" as const };
    if (privateCopy) {
      const captured = await assertIsolatedWorkspaceSourceReadAccess(db, sourceInput);
      expect(captured.projectIds).not.toContain(privateProject.id);
      return; // A private materialized copy does not privatize its public origin.
    }
    await expect(assertIsolatedWorkspaceSourceReadAccess(db, sourceInput)).rejects.toThrow(/source project/);
    const before = await db.select().from(executionWorkspaceRepositoryAccess).where(eq(executionWorkspaceRepositoryAccess.companyId, f.companyId));
    expect(before).toEqual([]);
    // Move the URL before any admission or copy registration: the mutation must
    // preserve the old physical source policy even without execution rows.
    await projectService(db, { captureWorkspaceUpdates: false }).updateWorkspace(privateProject.id, privateSource.id,
      { repoUrl: "https://github.com/example/moved" });
    await expect(assertIsolatedWorkspaceSourceReadAccess(db, sourceInput)).rejects.toThrow(/source project/);
    await db.insert(projectAccessMembers).values([
      { companyId: f.companyId, projectId: privateProject.id, subjectType: "agent", subjectId: f.agentId },
      { companyId: f.companyId, projectId: privateProject.id, subjectType: "user", subjectId: f.userId },
    ]);
    const captured = await assertIsolatedWorkspaceSourceReadAccess(db, sourceInput);
    const targetCwd = path.join(root, `${f.issueId}-url-copy`);
    await retainIsolatedWorkspaceSourceAccess(db, { ...sourceInput, targetCwd, captured, issueId: f.issueId });
    await exec("git", ["clone", repoUrl, targetCwd]);
    await db.delete(projectAccessMembers).where(eq(projectAccessMembers.projectId, privateProject.id));
    await expect(assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: targetCwd, actor: f.actor })).rejects.toThrow(/source project/);
    expect(await readFile(path.join(targetCwd, "secret.txt"), "utf8")).toBe("Private URL source\n");
  });

  it.each(["checkout", "bare", "protected_ancestor"] as const)("guards unbound local repository staging and publication without worktree authority (%s)", async scenario => {
    const f = await fixture(), exec = promisify(execFileCallback);
    const checkout = path.join(root, `${f.issueId}-local-origin`); await mkdir(checkout);
    await exec("git", ["init", "--initial-branch=main", checkout]);
    await writeFile(path.join(checkout, "secret.txt"), "Committed private bytes\n");
    await exec("git", ["-C", checkout, "add", "."]);
    await exec("git", ["-C", checkout, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "private source"]);
    const sourceCwd = scenario === "bare" ? path.join(root, `${f.issueId}-bare.git`) : checkout;
    if (scenario === "bare") await exec("git", ["clone", "--bare", checkout, sourceCwd]);
    const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Private local origin", visibility: "private",
      executionWorkspacePolicy: { authorizationPolicy: { assignmentPolicy: { mode: "protected" } } } }).returning();
    await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: project.id, name: "Local source owner", cwd: sourceCwd });
    const sourceInput = { companyId: f.companyId, sourceCwd, actor: f.actor, copyKind: "repository" as const };
    await expect(assertIsolatedWorkspaceSourceReadAccess(db, sourceInput)).rejects.toThrow(/source project/);
    await db.insert(projectAccessMembers).values([
      { companyId: f.companyId, projectId: project.id, subjectType: "agent", subjectId: f.agentId },
      { companyId: f.companyId, projectId: project.id, subjectType: "user", subjectId: f.userId },
    ]);
    const captured = await assertIsolatedWorkspaceSourceReadAccess(db, sourceInput);
    const stage = scenario === "protected_ancestor" ? path.join(sourceCwd, "clone-staging") : path.join(root, `${f.issueId}-staging`);
    const input = { ...sourceInput, targetCwd: stage, captured, issueId: f.issueId, phase: "verified" as const };
    if (scenario === "protected_ancestor") {
      await expect(retainIsolatedWorkspaceSourceAccess(db, input)).rejects.toThrow(/protected|assignment grant/);
      await expect(fs.lstat(stage)).rejects.toMatchObject({ code: "ENOENT" });
    } else {
      await retainIsolatedWorkspaceSourceAccess(db, input);
      await exec("git", ["clone", sourceCwd, stage]);
      const target = path.join(root, `${f.issueId}-published-local`);
      await retainIsolatedWorkspaceSourceAccess(db, { ...input, targetCwd: target });
      await fs.rename(stage, target);
      await db.delete(projectAccessMembers).where(eq(projectAccessMembers.projectId, project.id));
      await expect(retainIsolatedWorkspaceSourceAccess(db, { ...input, targetCwd: target })).rejects.toThrow(/source project/);
      await expect(assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: target, actor: f.actor })).rejects.toThrow(/source project/);
      expect(await readFile(path.join(target, "secret.txt"), "utf8")).toBe("Committed private bytes\n");
    }
    const entries = await db.select().from(executionWorkspaceRepositoryAccess).where(eq(executionWorkspaceRepositoryAccess.companyId, f.companyId));
    expect(entries.some(entry => entry.kind === "isolated_project_source" && entry.scopeId === project.id)).toBe(true);
    expect(entries.some(entry => entry.kind === "isolated_copy")).toBe(false);
  });

  it.each(["url", "catalog"] as const)("rejects independent local-file acquisition through %s before a receipt or clone", async kind => {
    const f = await fixture();
    const url = `file://${f.admission.cwd}`;
    if (kind === "catalog") acquisition.catalog.mockResolvedValue({ repositories: [{ id: "private-repo", fullName: "private/local", url, connections: ["fixture"] }] });
    await expect(f.request(kind === "url" ? { kind, url } : { kind, id: "private-repo" })).rejects.toThrow(/HTTPS GitHub/);
    expect(await f.service.list(f.companyId, f.workspace.id)).toEqual([]);
    expect(acquisition.materialize).not.toHaveBeenCalled();
  });

  it.each(["grant_revoked", "source_detached", "retained_reader"] as const)("retains configured sibling source privacy on the task root (%s)", async scenario => {
    const f = await fixture(), exec = promisify(execFileCallback);
    const sourceCwd = path.join(root, `${f.issueId}-configured-source`);
    await mkdir(sourceCwd);
    const privateCwd = path.join(sourceCwd, "private"); await mkdir(privateCwd);
    await writeFile(path.join(privateCwd, "secret.txt"), "Private configured bytes\n");
    await exec("git", ["init", "--initial-branch=main", sourceCwd]);
    await exec("git", ["-C", sourceCwd, "add", "."]);
    await exec("git", ["-C", sourceCwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "source"]);
    const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Private sibling source", visibility: "private",
      executionWorkspacePolicy: { authorizationPolicy: { assignmentPolicy: { mode: "protected" } } } }).returning();
    const [configuration] = await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: project.id, name: "Private subtree", cwd: privateCwd }).returning();
    const input = { ...f.admission, sourceCwd };
    const peer = scenario === "retained_reader" ? await standardPeer(f) : null;
    if (peer) await f.service.prepareForAdmission(peer.admission);
    await expect(f.service.prepareConfiguredRepositorySource(input)).rejects.toThrow(/source project/);
    await db.insert(projectAccessMembers).values([
      { companyId: f.companyId, projectId: project.id, subjectType: "agent", subjectId: f.agentId },
      { companyId: f.companyId, projectId: project.id, subjectType: "user", subjectId: f.userId },
    ]);
    if (peer) {
      await expect(f.service.prepareConfiguredRepositorySource(input)).rejects.toThrow(/source project/);
    } else {
      const beforePublish = await f.service.prepareConfiguredRepositorySource(input);
      const destination = path.join(f.admission.cwd, ".paperclip-repositories", "configured-source");
      await exec("git", ["clone", sourceCwd, destination]);
      await expect(beforePublish()).resolves.toBeUndefined();
      if (scenario === "source_detached") await db.delete(projectWorkspaces).where(eq(projectWorkspaces.id, configuration.id));
      await db.delete(projectAccessMembers).where(eq(projectAccessMembers.projectId, project.id));
      await expect(beforePublish()).rejects.toThrow(/source project/);
      await expect(assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: f.admission.cwd, actor: f.actor })).rejects.toThrow(/source project/);
      expect(await readFile(path.join(destination, "private", "secret.txt"), "utf8")).toBe("Private configured bytes\n");
    }
    const entries = await db.select().from(executionWorkspaceRepositoryAccess).where(eq(executionWorkspaceRepositoryAccess.companyId, f.companyId));
    expect(entries.some(entry => entry.kind === "isolated_project_source" && entry.scopeId === project.id)).toBe(true);
    expect(entries.some(entry => entry.kind === "isolated_copy")).toBe(false);
    expect(entries.filter(entry => entry.kind === "reader")).toHaveLength(peer ? 1 : 0);
  });

  it.each(["upgrade", "interrupted_creation", "unrelated_owner"] as const)("validates a registered dirty worktree without completed copy proof after %s", async scenario => {
    const f = await fixture(), exec = promisify(execFileCallback);
    const git = async (...args: string[]) => (await exec("git", ["-C", f.admission.cwd, ...args])).stdout;
    await exec("git", ["init", "--initial-branch=main", f.admission.cwd]);
    await writeFile(path.join(f.admission.cwd, "tracked.txt"), "Original source\n");
    await git("add", ".");
    await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "source");
    const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Protected legacy source", visibility: "private",
      executionWorkspacePolicy: { authorizationPolicy: { assignmentPolicy: { mode: "protected" } } } }).returning();
    await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: project.id, name: "Source", cwd: f.admission.cwd });
    await db.insert(projectAccessMembers).values([
      { companyId: f.companyId, projectId: project.id, subjectType: "agent", subjectId: f.agentId },
      { companyId: f.companyId, projectId: project.id, subjectType: "user", subjectId: f.userId },
    ]);
    const captured = await assertIsolatedWorkspaceSourceReadAccess(db, { companyId: f.companyId, sourceCwd: f.admission.cwd, actor: f.actor });
    const targetCwd = path.join(f.admission.cwd, ".paperclip", "worktrees", "legacy");
    const input = { companyId: f.companyId, sourceCwd: f.admission.cwd, targetCwd, actor: f.actor, issueId: f.issueId, captured };
    if (scenario === "interrupted_creation") await retainIsolatedWorkspaceSourceAccess(db, input);
    if (scenario === "unrelated_owner") {
      const unrelated = path.join(root, `${f.issueId}-unrelated-git`);
      await exec("git", ["init", "--initial-branch=main", unrelated]);
      await exec("git", ["-C", unrelated, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--allow-empty", "-m", "unrelated"]);
      await exec("git", ["-C", unrelated, "worktree", "add", "-b", "legacy", targetCwd]);
    } else await git("worktree", "add", "-b", "legacy", targetCwd);
    await writeFile(path.join(targetCwd, "tracked.txt"), "Keep dirty edit\n");
    await writeFile(path.join(targetCwd, "untracked.txt"), "Keep untracked work\n");
    const before = await db.select().from(executionWorkspaceRepositoryAccess).where(eq(executionWorkspaceRepositoryAccess.companyId, f.companyId));
    expect(before.some(entry => entry.kind === "isolated_copy")).toBe(false);
    const gitState = await exec("git", ["-C", targetCwd, "status", "--porcelain"]);
    const head = await exec("git", ["-C", targetCwd, "rev-parse", "HEAD"]);
    if (scenario === "unrelated_owner") {
      await expect(retainIsolatedWorkspaceSourceAccess(db, input)).rejects.toThrow(/protected|assignment grant/);
      await expect(assertExecutionWorkspaceRootWriteAccess(db, { companyId: f.companyId, cwd: targetCwd, actor: f.actor, issueId: f.issueId })).rejects.toThrow(/protected|assignment grant/);
    } else {
      await expect(retainIsolatedWorkspaceSourceAccess(db, input)).resolves.toBeUndefined();
      await expect(assertExecutionWorkspaceRootWriteAccess(db, { companyId: f.companyId, cwd: targetCwd, actor: f.actor, issueId: f.issueId })).resolves.toBeUndefined();
    }
    const after = await db.select().from(executionWorkspaceRepositoryAccess).where(eq(executionWorkspaceRepositoryAccess.companyId, f.companyId));
    expect(after.some(entry => entry.kind === "isolated_copy" && entry.scopeId === project.id)).toBe(scenario !== "unrelated_owner");
    expect((await exec("git", ["-C", targetCwd, "status", "--porcelain"])).stdout).toBe(gitState.stdout);
    expect((await exec("git", ["-C", targetCwd, "rev-parse", "HEAD"])).stdout).toBe(head.stdout);
    expect(await readFile(path.join(targetCwd, "tracked.txt"), "utf8")).toBe("Keep dirty edit\n");
    expect(await readFile(path.join(targetCwd, "untracked.txt"), "utf8")).toBe("Keep untracked work\n");
  });

  it("does not let an unmaterialized copy intent authorize writes to an existing source folder", async () => {
    const f = await fixture(), exec = promisify(execFileCallback);
    const targetCwd = path.join(f.admission.cwd, "tracked-private-folder");
    await mkdir(targetCwd);
    await writeFile(path.join(targetCwd, "existing.txt"), "Protected original bytes\n");
    await exec("git", ["init", "--initial-branch=main", f.admission.cwd]);
    await exec("git", ["-C", f.admission.cwd, "add", "."]);
    await exec("git", ["-C", f.admission.cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "source"]);
    const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Protected original source", visibility: "private",
      executionWorkspacePolicy: { authorizationPolicy: { assignmentPolicy: { mode: "protected" } } } }).returning();
    await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: project.id, name: "Original files", cwd: f.admission.cwd });
    await db.insert(projectAccessMembers).values([
      { companyId: f.companyId, projectId: project.id, subjectType: "agent", subjectId: f.agentId },
      { companyId: f.companyId, projectId: project.id, subjectType: "user", subjectId: f.userId },
    ]);
    const writeInput = { companyId: f.companyId, cwd: targetCwd, actor: f.actor, issueId: f.issueId };
    await expect(assertExecutionWorkspaceRootWriteAccess(db, writeInput)).rejects.toThrow(/protected|assignment grant/);
    const captured = await assertIsolatedWorkspaceSourceReadAccess(db, { companyId: f.companyId, sourceCwd: f.admission.cwd, actor: f.actor });
    await expect(retainIsolatedWorkspaceSourceAccess(db, { companyId: f.companyId, sourceCwd: f.admission.cwd, targetCwd,
      actor: f.actor, issueId: f.issueId, captured })).rejects.toThrow(/protected|assignment grant/);
    await expect(fs.lstat(path.join(targetCwd, ".git"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(targetCwd, "existing.txt"), "utf8")).toBe("Protected original bytes\n");
    await expect(assertExecutionWorkspaceRootWriteAccess(db, writeInput)).rejects.toThrow(/protected|assignment grant/);
  });

  it("does not verify a missing or ordinary empty directory as an isolated copy", async () => {
    const f = await fixture(), exec = promisify(execFileCallback);
    await exec("git", ["init", "--initial-branch=main", f.admission.cwd]);
    await writeFile(path.join(f.admission.cwd, "source.txt"), "Source\n");
    await exec("git", ["-C", f.admission.cwd, "add", "."]);
    await exec("git", ["-C", f.admission.cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "source"]);
    const captured = await assertIsolatedWorkspaceSourceReadAccess(db, { companyId: f.companyId, sourceCwd: f.admission.cwd, actor: f.actor });
    const targetCwd = path.join(root, `${f.issueId}-never-materialized`);
    const input = { companyId: f.companyId, sourceCwd: f.admission.cwd, targetCwd, actor: f.actor, captured, phase: "verified" as const };
    await expect(retainIsolatedWorkspaceSourceAccess(db, input)).rejects.toThrow(/not a verified Git worktree/);
    await mkdir(targetCwd);
    await expect(retainIsolatedWorkspaceSourceAccess(db, input)).rejects.toThrow(/not a verified Git worktree/);
    const entries = await db.select().from(executionWorkspaceRepositoryAccess).where(eq(executionWorkspaceRepositoryAccess.companyId, f.companyId));
    expect(entries.some(entry => entry.kind === "isolated_copy")).toBe(false);
  });

  it.each(["exact", "descendant"] as const)("requires write authority for a protected %s target before copying", async relation => {
    const f = await fixture(), exec = promisify(execFileCallback);
    await exec("git", ["init", "--initial-branch=main", f.admission.cwd]);
    await writeFile(path.join(f.admission.cwd, "source.txt"), "Source bytes\n");
    await exec("git", ["-C", f.admission.cwd, "add", "."]);
    await exec("git", ["-C", f.admission.cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "source"]);
    const targetCwd = path.join(root, `${f.issueId}-protected-target`);
    const protectedCwd = relation === "exact" ? targetCwd : path.join(targetCwd, "private");
    await mkdir(protectedCwd, { recursive: true });
    const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Protected target",
      executionWorkspacePolicy: { authorizationPolicy: { assignmentPolicy: { mode: "protected" } } } }).returning();
    await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: project.id, name: "Target owner", cwd: protectedCwd });
    const captured = await assertIsolatedWorkspaceSourceReadAccess(db, { companyId: f.companyId, sourceCwd: f.admission.cwd, actor: f.actor });
    await expect(retainIsolatedWorkspaceSourceAccess(db, { companyId: f.companyId, sourceCwd: f.admission.cwd, targetCwd,
      actor: f.actor, issueId: f.issueId, captured })).rejects.toThrow(/protected|assignment grant/);
    await expect(fs.lstat(path.join(targetCwd, "source.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    const owners = await db.select().from(executionWorkspaceRepositoryAccess).where(eq(executionWorkspaceRepositoryAccess.companyId, f.companyId));
    expect(owners).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "isolated_source", scopeId: f.workspace.id })]));
  });

  it("excludes available lexical descendants whose canonical roots are unrelated", async () => {
    const f = await fixture();
    const unrelated = path.join(root, `${f.issueId}-unrelated`); await mkdir(unrelated);
    const alias = path.join(f.admission.cwd, "link"); await symlink(unrelated, alias);
    const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Unrelated private owner", visibility: "private" }).returning();
    await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: project.id, name: "Unrelated alias", cwd: alias });
    const [workspace] = await db.insert(executionWorkspaces).values({ companyId: f.companyId, projectId: project.id, name: "Unrelated alias", cwd: alias,
      mode: "shared_workspace", strategyType: "project_primary" }).returning();
    await db.insert(executionWorkspaceRepositories).values({ companyId: f.companyId, requestedByIssueId: f.issueId, executionWorkspaceId: workspace.id,
      repositoryIdentity: "https://github.com/private/unrelated", repoUrl: "https://github.com/private/unrelated", relativePath: "unused",
      requestedRef: "HEAD", requestKey: randomUUID() });
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
  });

  it.each(["revoked", "deleted_source", "deleted_owner", "retained_reader"] as const)("protects already-copied bytes when post-copy authorization fails (%s)", async failure => {
    const f = await fixture(), exec = promisify(execFileCallback);
    await exec("git", ["init", "--initial-branch=main", f.admission.cwd]);
    await writeFile(path.join(f.admission.cwd, "secret.txt"), "Failed copy still private\n");
    await exec("git", ["-C", f.admission.cwd, "add", "."]);
    await exec("git", ["-C", f.admission.cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "source"]);
    const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Failed private copy", visibility: "private" }).returning();
    await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: project.id, name: "Private source", cwd: f.admission.cwd });
    await db.insert(projectAccessMembers).values([
      { companyId: f.companyId, projectId: project.id, subjectType: "agent", subjectId: f.agentId },
      { companyId: f.companyId, projectId: project.id, subjectType: "user", subjectId: f.userId },
    ]);
    const captured = await assertIsolatedWorkspaceSourceReadAccess(db, { companyId: f.companyId, sourceCwd: f.admission.cwd, actor: f.actor });
    const targetCwd = path.join(root, `${f.issueId}-failed-copy`);
    if (failure === "retained_reader") {
      await mkdir(targetCwd);
      const peer = await standardPeer(f);
      await db.update(executionWorkspaces).set({ cwd: targetCwd }).where(eq(executionWorkspaces.id, peer.workspace.id));
      await f.service.prepareForAdmission({ ...peer.admission, cwd: targetCwd });
      await expect(retainIsolatedWorkspaceSourceAccess(db, { companyId: f.companyId, sourceCwd: f.admission.cwd, targetCwd,
        actor: f.actor, captured })).rejects.toThrow(/source project/);
      await expect(fs.lstat(path.join(targetCwd, "secret.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      return;
    }
    await exec("git", ["-C", f.admission.cwd, "worktree", "add", "-b", "failed-copy", targetCwd]);
    if (failure === "revoked") await db.delete(projectAccessMembers).where(eq(projectAccessMembers.projectId, project.id));
    if (failure === "deleted_owner") await db.delete(projects).where(eq(projects.id, project.id));
    if (failure === "deleted_source") await rm(f.admission.cwd, { recursive: true });
    await expect(retainIsolatedWorkspaceSourceAccess(db, { companyId: f.companyId, sourceCwd: f.admission.cwd, targetCwd, actor: f.actor, captured })).rejects.toThrow();
    const canonicalCwd = await realpath(targetCwd);
    const owners = await db.select().from(executionWorkspaceRepositoryAccess).where(eq(executionWorkspaceRepositoryAccess.rootKey, createHash("sha256").update(canonicalCwd).digest("hex")));
    expect(owners).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "isolated_project_source", scopeId: project.id })]));
    const peer = await standardPeer(f);
    await expect(assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: targetCwd, actor: peer.actor })).rejects.toThrow(/source project/);
    expect(await readFile(path.join(targetCwd, "secret.txt"), "utf8")).toBe("Failed copy still private\n");
  });

  it.each(["empty", "different_identity", "unreadable_alias", "loop_alias", "anonymous_private_edits", "authorized_peer"] as const)(
    "authorizes every physical repository source for a standard reader with %s", async scenario => {
      const f = await fixture(), peer = await standardPeer(f);
      if (scenario === "different_identity") await f.service.request({ companyId: f.companyId, issueId: peer.issueId, actor: peer.actor,
        request: { repository: { kind: "url", url: "https://github.com/public/other" }, requestKey: randomUUID() } });
      await privateTask(f);
      const intent = await f.request(scenario === "anonymous_private_edits" ? { kind: "url", url: "https://github.com/public/source" } : { kind: "catalog", id: "private-repo" });
      await localPrivateClone(f);
      const [prepared] = await f.service.prepareForAdmission(f.admission);
      expect(await readFile(path.join(prepared.cwd, "private.txt"), "utf8")).toBe("Private task edits\n");
      if (scenario === "unreadable_alias" || scenario === "loop_alias") {
        const alias = path.join(root, `${f.issueId}-private-alias`);
        await symlink(scenario === "loop_alias" ? alias : f.admission.cwd, alias);
        await db.update(executionWorkspaces).set({ cwd: alias }).where(eq(executionWorkspaces.id, f.workspace.id));
        // Published path evidence must also bootstrap provenance for old rows.
        await db.delete(executionWorkspaceRepositoryAccess).where(eq(executionWorkspaceRepositoryAccess.companyId, f.companyId));
        const actual = fs.realpath.bind(fs);
        vi.spyOn(fs, "realpath").mockImplementation(async pathname => {
          if (scenario === "unreadable_alias" && String(pathname) === alias) throw Object.assign(new Error("Private alias unavailable"), { code: "EACCES" });
          return actual(pathname);
        });
      }
      if (scenario === "authorized_peer") {
        await grantPeer(f, peer);
        await expect(f.service.prepareForAdmission(peer.admission)).resolves.toEqual([]);
      } else await expect(f.service.prepareForAdmission(peer.admission)).rejects.toThrow(/workspace access|authorization boundary/);
      expect((await f.service.list(f.companyId, f.workspace.id))[0].id).toBe(intent.operationId);
      expect(acquisition.materialize).toHaveBeenCalledOnce();
    },
  );

  it.each(["retained", "legacy", "known_origin_removed"] as const)("keeps independent copies of the same repository separate (%s provenance)", async provenance => {
    const f = await fixture(), peer = await standardPeer(f);
    const peerCwd = path.join(root, peer.issueId);
    await mkdir(peerCwd);
    await db.update(executionWorkspaces).set({ cwd: peerCwd }).where(eq(executionWorkspaces.id, peer.workspace.id));
    peer.admission.cwd = peerCwd;
    await privateTask(f);
    const repository = { kind: "url" as const, url: "https://github.com/public/source" };
    await f.request(repository);
    await localPrivateClone(f);
    const [privateCheckout] = await f.service.prepareForAdmission(f.admission);
    await f.service.request({ companyId: f.companyId, issueId: peer.issueId, actor: peer.actor,
      request: { repository, requestKey: randomUUID() } });
    await localPrivateClone({ ...f, issueId: peer.issueId });
    const [peerCheckout] = await f.service.prepareForAdmission(peer.admission);
    expect(peerCheckout.cwd).not.toBe(privateCheckout.cwd);
    expect(await readFile(path.join(peerCheckout.cwd, "private.txt"), "utf8")).toBe("Private task edits\n");
    if (provenance === "legacy") await db.delete(executionWorkspaceRepositoryAccess).where(eq(executionWorkspaceRepositoryAccess.companyId, f.companyId));
    if (provenance === "known_origin_removed") await rm(f.admission.cwd, { recursive: true });
    const actual = await vi.importActual<typeof import("../services/managed-repository-checkout.js")>("../services/managed-repository-checkout.js");
    acquisition.materialize.mockImplementationOnce(actual.materializeManagedProjectWorkspace);
    await expect(f.service.prepareForAdmission(peer.admission)).resolves.toHaveLength(1);
    const beforeRead = await db.select().from(executionWorkspaceRepositoryAccess).where(eq(executionWorkspaceRepositoryAccess.companyId, f.companyId));
    await expect(assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: peerCwd,
      sourceWorkspaceId: peer.workspace.id, actor: peer.actor })).resolves.toBeUndefined();
    await expect(assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: f.admission.cwd,
      sourceWorkspaceId: f.workspace.id, actor: peer.actor })).rejects.toThrow(/workspace access|authorization boundary/);
    expect(await db.select().from(executionWorkspaceRepositoryAccess).where(eq(executionWorkspaceRepositoryAccess.companyId, f.companyId))).toEqual(beforeRead);
  });

  it.each(["update", "archive"] as const)("preserves legacy private publishers before %s moves their workspace away from shared files", async operation => {
    const f = await fixture(), peer = await standardPeer(f);
    const repository = { kind: "url" as const, url: "https://github.com/public/legacy-shared" };
    await f.service.request({ companyId: f.companyId, issueId: peer.issueId, actor: peer.actor,
      request: { repository, requestKey: randomUUID() } });
    await privateTask(f);
    const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Private legacy source", visibility: "private" }).returning();
    await db.insert(projectAccessMembers).values([
      { companyId: f.companyId, projectId: project.id, subjectType: "agent", subjectId: f.agentId },
      { companyId: f.companyId, projectId: project.id, subjectType: "user", subjectId: f.userId },
    ]);
    await db.update(executionWorkspaces).set({ projectId: project.id, sourceIssueId: f.issueId }).where(eq(executionWorkspaces.id, f.workspace.id));
    await f.request(repository);
    await localPrivateClone(f);
    const [checkout] = await f.service.prepareForAdmission(f.admission);
    expect(await readFile(path.join(checkout.cwd, "private.txt"), "utf8")).toBe("Private task edits\n");
    // Both receipts/files predate provenance registration. The move itself
    // must preserve the old owner before its available cwd becomes unrelated.
    await db.delete(executionWorkspaceRepositoryAccess).where(eq(executionWorkspaceRepositoryAccess.companyId, f.companyId));
    const moved = path.join(root, `${f.issueId}-legacy-moved`);
    await mkdir(moved);
    const patch = { cwd: moved, projectId: null, sourceIssueId: null, metadata: {} };
    const svc = executionWorkspaceService(db);
    if (operation === "archive") {
      const result = await svc.archiveWorkspaceUnderLifecycleLock({ id: f.workspace.id, patch, closedAt: new Date() });
      expect(result?.outcome).toBe("archived");
      if (result?.outcome === "archived") {
        expect(result.capturedGeneration).toBeGreaterThan(0);
        expect(result.workspace.status).toBe("archived");
        expect(result.workspace.metadata?._issuePrivacySources).toHaveProperty(f.issueId);
      }
    } else await svc.update(f.workspace.id, patch);
    await db.update(issues).set({ executionWorkspaceId: null }).where(eq(issues.id, f.issueId));
    await expect(assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: peer.admission.cwd,
      sourceWorkspaceId: peer.workspace.id, actor: peer.actor })).rejects.toThrow(/workspace access|authorization boundary|source project/);
    await expect(f.service.prepareForAdmission(peer.admission)).rejects.toThrow(/workspace access|authorization boundary|source project/);
    const retained = await db.select().from(executionWorkspaceRepositoryAccess).where(eq(executionWorkspaceRepositoryAccess.companyId, f.companyId));
    expect(retained.some(entry => entry.kind === "source" && entry.scopeId === f.workspace.id)).toBe(true);
    expect(retained.some(entry => entry.kind === "project_source" && entry.scopeId === project.id)).toBe(true);
    expect(retained.some(entry => entry.kind === "repository" || entry.kind === "reader")).toBe(false);
    expect(await readFile(path.join(checkout.cwd, "private.txt"), "utf8")).toBe("Private task edits\n");
  });

  it("requires the admitted actor's write grant for a projectless alias of a protected configured root", async () => {
    const f = await fixture();
    await db.update(companyMemberships).set({ membershipRole: "member" }).where(eq(companyMemberships.principalId, f.userId));
    const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Protected shared root",
      executionWorkspacePolicy: { authorizationPolicy: { assignmentPolicy: { mode: "protected" } } } }).returning();
    const alias = path.join(root, `${f.issueId}-protected-alias`);
    await symlink(f.admission.cwd, alias);
    const [source] = await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: project.id, name: "Protected source", cwd: alias }).returning();
    const read = () => assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: f.admission.cwd,
      sourceWorkspaceId: f.workspace.id, actor: f.actor });
    await expect(read()).resolves.toBeUndefined();
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/protected|not authorized/);
    await expect(f.request({ kind: "url", url: "https://github.com/public/writable" })).rejects.toThrow(/protected|not authorized/);
    await db.insert(principalPermissionGrants).values({ companyId: f.companyId, principalType: "agent", principalId: f.agentId,
      permissionKey: "tasks:assign_scope", scope: { projectId: project.id, assigneeAgentId: f.agentId } });
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/Responsible user.*not authorized/);
    const [grant] = await db.insert(principalPermissionGrants).values({ companyId: f.companyId, principalType: "user", principalId: f.userId,
      permissionKey: "tasks:assign_scope", scope: { projectId: project.id, assigneeAgentId: f.agentId } }).returning();
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
    await expect(f.service.guardForPublication(f.admission)).resolves.toBeUndefined();
    await db.delete(projectWorkspaces).where(eq(projectWorkspaces.id, source.id));
    await db.delete(principalPermissionGrants).where(eq(principalPermissionGrants.id, grant.id));
    await expect(read()).resolves.toBeUndefined();
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/Responsible user.*not authorized/);
    await expect(f.service.guardForPublication(f.admission)).rejects.toThrow(/Responsible user.*not authorized/);
  });

  it("keeps genuine isolated Git copies read-only against their protected source project", async () => {
    const f = await fixture();
    const sourceRoot = path.join(root, `${f.issueId}-isolated-source`);
    await mkdir(sourceRoot);
    const exec = promisify(execFileCallback);
    await exec("git", ["init", "--initial-branch=main", sourceRoot]);
    await writeFile(path.join(sourceRoot, "README.md"), "Protected source\n");
    await exec("git", ["-C", sourceRoot, "add", "."]);
    await exec("git", ["-C", sourceRoot, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "source"]);
    await exec("git", ["-C", sourceRoot, "worktree", "add", "-b", "isolated-task", f.admission.cwd]);
    const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Protected copy source",
      executionWorkspacePolicy: { authorizationPolicy: { assignmentPolicy: { mode: "protected" } } } }).returning();
    const [source] = await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: project.id, name: "Original", cwd: sourceRoot }).returning();
    await db.update(executionWorkspaces).set({ projectId: project.id, projectWorkspaceId: source.id, strategyType: "git_worktree" }).where(eq(executionWorkspaces.id, f.workspace.id));
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
    await expect(f.service.guardForPublication(f.admission)).resolves.toBeUndefined();
    // Physical configured ownership overrides a misleading isolation label.
    await db.update(projectWorkspaces).set({ cwd: f.admission.cwd }).where(eq(projectWorkspaces.id, source.id));
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/protected|not authorized/);
  });

  it.each(["move", "delete"] as const)("retains protected shared execution-source write scope after %s", async change => {
    const f = await fixture(), source = await standardPeer(f);
    const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Protected execution owner",
      executionWorkspacePolicy: { authorizationPolicy: { assignmentPolicy: { mode: "protected" } } } }).returning();
    await db.update(executionWorkspaces).set({ projectId: project.id }).where(eq(executionWorkspaces.id, source.workspace.id));
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/protected|not authorized/);
    const grants = await db.insert(principalPermissionGrants).values([
      { companyId: f.companyId, principalType: "agent", principalId: f.agentId, permissionKey: "tasks:assign_scope", scope: { projectId: project.id, assigneeAgentId: f.agentId } },
      { companyId: f.companyId, principalType: "user", principalId: f.userId, permissionKey: "tasks:assign_scope", scope: { projectId: project.id, assigneeAgentId: f.agentId } },
    ]).returning();
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
    if (change === "move") {
      const moved = path.join(root, `${source.issueId}-shared-moved`);
      await mkdir(moved);
      await executionWorkspaceService(db).update(source.workspace.id, { cwd: moved, projectId: null });
    } else await db.delete(executionWorkspaces).where(eq(executionWorkspaces.id, source.workspace.id));
    for (const grant of grants) await db.delete(principalPermissionGrants).where(eq(principalPermissionGrants.id, grant.id));
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/protected|not authorized|workspace access/);
  });

  it("does not require historical readers to retain write grants for another authorized writer", async () => {
    const f = await fixture(), peer = await standardPeer(f);
    const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Shared source writers",
      executionWorkspacePolicy: { authorizationPolicy: { assignmentPolicy: { mode: "protected" } } } }).returning();
    await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: project.id, name: "Shared", cwd: f.admission.cwd });
    const prior = await db.insert(principalPermissionGrants).values([
      { companyId: f.companyId, principalType: "agent", principalId: f.agentId, permissionKey: "tasks:assign_scope", scope: { projectId: project.id, assigneeAgentId: f.agentId } },
      { companyId: f.companyId, principalType: "user", principalId: f.userId, permissionKey: "tasks:assign_scope", scope: { projectId: project.id, assigneeAgentId: f.agentId } },
    ]).returning();
    await f.service.prepareForAdmission(f.admission);
    await db.insert(principalPermissionGrants).values([
      { companyId: f.companyId, principalType: "agent", principalId: peer.agentId, permissionKey: "tasks:assign_scope", scope: { projectId: project.id, assigneeAgentId: peer.agentId } },
      { companyId: f.companyId, principalType: "user", principalId: peer.userId, permissionKey: "tasks:assign_scope", scope: { projectId: project.id, assigneeAgentId: peer.agentId } },
    ]);
    for (const grant of prior) await db.delete(principalPermissionGrants).where(eq(principalPermissionGrants.id, grant.id));
    await expect(f.service.prepareForAdmission(peer.admission)).resolves.toEqual([]);
    await expect(f.service.guardForPublication(peer.admission)).resolves.toBeUndefined();
  });

  it("checks configured private aliases against both admitted agent and responsible user before capture and publication", async () => {
    const f = await fixture();
    const alias = path.join(root, `${f.issueId}-configured-alias`);
    await symlink(f.admission.cwd, alias);
    const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Private configured files", visibility: "private" }).returning();
    const [configured] = await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: project.id, name: "Configured alias", cwd: alias }).returning();
    await writeFile(path.join(f.admission.cwd, "private-configured.txt"), "Private configured project bytes\n");
    await db.insert(projectAccessMembers).values({ companyId: f.companyId, projectId: project.id, subjectType: "agent", subjectId: f.agentId });
    await expect(assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: f.admission.cwd,
      sourceWorkspaceId: f.workspace.id, actor: f.actor })).rejects.toThrow(/source project/);
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/source project/);
    expect(await db.select().from(executionWorkspaceRepositoryAccess).where(eq(executionWorkspaceRepositoryAccess.companyId, f.companyId))).toEqual([]);
    const [grant] = await db.insert(projectAccessMembers).values({ companyId: f.companyId, projectId: project.id,
      subjectType: "user", subjectId: f.userId }).returning();
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
    await expect(f.service.guardForPublication(f.admission)).resolves.toBeUndefined();
    const moved = path.join(root, `${f.issueId}-configured-moved`);
    await mkdir(moved);
    await db.update(projectWorkspaces).set({ cwd: moved }).where(eq(projectWorkspaces.id, configured.id));
    await db.delete(projectAccessMembers).where(eq(projectAccessMembers.id, grant.id));
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/source project/);
    await expect(f.service.guardForPublication(f.admission)).rejects.toThrow(/source project/);
    await expect(assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: f.admission.cwd,
      sourceWorkspaceId: f.workspace.id, actor: f.actor })).rejects.toThrow(/source project/);
    await db.insert(projectAccessMembers).values({ companyId: f.companyId, projectId: project.id, subjectType: "user", subjectId: f.userId });
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
    await db.delete(projectWorkspaces).where(eq(projectWorkspaces.id, configured.id));
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
    await expect(assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: f.admission.cwd,
      sourceWorkspaceId: f.workspace.id, actor: f.actor })).resolves.toBeUndefined();
    await db.delete(projects).where(eq(projects.id, project.id));
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/source project/);
    await expect(assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: f.admission.cwd,
      sourceWorkspaceId: f.workspace.id, actor: f.actor })).rejects.toThrow(/source project/);
    expect(acquisition.materialize).not.toHaveBeenCalled();
  });

  it("retains execution-source project privacy after its workspace project pointer is cleared", async () => {
    const f = await fixture();
    const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Execution source owner", visibility: "private" }).returning();
    await db.update(executionWorkspaces).set({ projectId: project.id }).where(eq(executionWorkspaces.id, f.workspace.id));
    await db.insert(projectAccessMembers).values({ companyId: f.companyId, projectId: project.id, subjectType: "agent", subjectId: f.agentId });
    const [grant] = await db.insert(projectAccessMembers).values({ companyId: f.companyId, projectId: project.id, subjectType: "user", subjectId: f.userId }).returning();
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
    await db.update(executionWorkspaces).set({ projectId: null }).where(eq(executionWorkspaces.id, f.workspace.id));
    await db.delete(projectAccessMembers).where(eq(projectAccessMembers.id, grant.id));
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/source project/);
    await expect(assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: f.admission.cwd,
      sourceWorkspaceId: f.workspace.id, actor: f.actor })).rejects.toThrow(/source project/);
    await db.insert(projectAccessMembers).values({ companyId: f.companyId, projectId: project.id, subjectType: "user", subjectId: f.userId });
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
    await db.delete(projects).where(eq(projects.id, project.id));
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/source project/);
    await expect(f.service.guardForPublication(f.admission)).rejects.toThrow(/source project/);
  });

  it.each(["configured", "execution"] as const)("ignores an unrelated %s workspace symlink loop", async kind => {
    const f = await fixture();
    const loop = path.join(root, `${f.issueId}-unrelated-loop`);
    await symlink(loop, loop);
    if (kind === "configured") {
      const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Unavailable unrelated project", visibility: "private" }).returning();
      await db.insert(projectWorkspaces).values({ companyId: f.companyId, projectId: project.id, name: "Loop", cwd: loop });
    } else {
      await db.insert(executionWorkspaces).values({ companyId: f.companyId, name: "Unrelated loop", cwd: loop, mode: "isolated_workspace", strategyType: "task_directory" });
    }
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
    await expect(assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: f.admission.cwd,
      sourceWorkspaceId: f.workspace.id, actor: f.actor })).resolves.toBeUndefined();
  });

  it("rejects an unusable selected root without releasing a retained private source", async () => {
    const f = await fixture();
    await privateTask(f);
    await f.service.prepareForAdmission(f.admission);
    const peer = await standardPeer(f);
    const loop = path.join(root, `${f.issueId}-selected-loop`);
    await symlink(loop, loop);
    await db.update(executionWorkspaces).set({ cwd: loop }).where(eq(executionWorkspaces.id, f.workspace.id));
    await expect(f.service.prepareForAdmission({ ...f.admission, cwd: loop })).rejects.toThrow(/ELOOP/);
    await expect(assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: loop,
      sourceWorkspaceId: f.workspace.id, actor: f.actor })).rejects.toThrow(/ELOOP/);
    await expect(f.service.prepareForAdmission(peer.admission)).rejects.toThrow(/workspace access|authorization boundary/);
    await expect(assertExecutionWorkspaceRootReadAccess(db, { companyId: f.companyId, cwd: peer.admission.cwd,
      sourceWorkspaceId: peer.workspace.id, actor: peer.actor })).rejects.toThrow(/workspace access|authorization boundary/);
  });

  it("rechecks retained own-workspace privacy without adding an empty-admission membership gate", async () => {
    const f = await fixture();
    await db.delete(companyMemberships).where(eq(companyMemberships.companyId, f.companyId));
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
    await expect(executionWorkspaceRepositoryService(db).prepareForAdmission(f.admission)).resolves.toEqual([]);
    const [privateSource] = await db.insert(issues).values({ companyId: f.companyId, title: "Other private writer", visibility: "private",
      executionWorkspaceId: f.workspace.id }).returning();
    await db.update(issues).set({ executionWorkspaceId: null }).where(eq(issues.id, privateSource.id));
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/workspace access/);
  });

  it("does not publish managed bytes to a retained low-trust reader even with private source grants", async () => {
    const f = await fixture(), peer = await standardPeer(f);
    await db.update(issues).set({ visibility: "private", privacyRootIssueId: peer.issueId, responsibleUserId: peer.userId,
      parentId: f.issueId }).where(eq(issues.id, peer.issueId));
    await db.insert(issueAccessGrants).values([
      { issueId: peer.issueId, subjectType: "agent", subjectId: f.agentId, source: "explicit", grantedByUserId: peer.userId },
      { issueId: peer.issueId, subjectType: "user", subjectId: f.userId, source: "explicit", grantedByUserId: peer.userId },
    ]);
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: f.issueId, executionPolicy: f.policy } }).where(eq(heartbeatRuns.id, f.runId));
    await expect(f.service.request({ companyId: f.companyId, issueId: peer.issueId, actor: peer.actor,
      request: { repository: { kind: "catalog", id: "private-repo" }, requestKey: randomUUID() } })).rejects.toThrow(/anonymous public URLs only|trusted task/);
    expect(await f.service.list(f.companyId, peer.workspace.id)).toEqual([]);
    expect(acquisition.materialize).not.toHaveBeenCalled();
  });

  it("retains private direct files from an admitted workspace with no repository inventory", async () => {
    const f = await fixture(), peer = await standardPeer(f);
    await privateTask(f);
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
    await writeFile(path.join(f.admission.cwd, "private-direct.txt"), "Private direct task output");
    await db.update(executionWorkspaces).set({ cwd: path.join(root, "moved-direct-source"), metadata: {} }).where(eq(executionWorkspaces.id, f.workspace.id));
    await expect(f.service.prepareForAdmission(peer.admission)).rejects.toThrow(/workspace access|authorization boundary/);
    await grantPeer(f, peer);
    await expect(f.service.prepareForAdmission(peer.admission)).resolves.toEqual([]);
    expect(await readFile(path.join(f.admission.cwd, "private-direct.txt"), "utf8")).toBe("Private direct task output");
    expect(acquisition.materialize).not.toHaveBeenCalled();
  });

  it("blocks a future private source after an empty standard reader was admitted and moved", async () => {
    const f = await fixture(), peer = await standardPeer(f);
    await expect(f.service.prepareForAdmission(peer.admission)).resolves.toEqual([]);
    await db.update(executionWorkspaces).set({ cwd: path.join(root, "moved-standard-reader"), metadata: {}, status: "archived" }).where(eq(executionWorkspaces.id, peer.workspace.id));
    await privateTask(f);
    await expect(executionWorkspaceRepositoryService(db).request({ companyId: f.companyId, issueId: f.issueId, actor: f.actor,
      request: { repository: { kind: "catalog", id: "private-repo" }, requestKey: randomUUID() } })).rejects.toThrow(/workspace access|authorization boundary/);
    expect(await f.service.list(f.companyId, f.workspace.id)).toEqual([]);
    expect(acquisition.materialize).not.toHaveBeenCalled();
  });

  it("rechecks configured-source publication against retained readers after grant revocation", async () => {
    const f = await fixture(), peer = await standardPeer(f);
    await privateTask(f);
    const grants = await grantPeer(f, peer);
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
    await expect(f.service.prepareForAdmission(peer.admission)).resolves.toEqual([]);
    await expect(f.service.guardForPublication(f.admission)).resolves.toBeUndefined();
    await db.update(issueAccessGrants).set({ revokedAt: new Date() }).where(eq(issueAccessGrants.id, grants[0].id));
    await expect(f.service.guardForPublication(f.admission)).rejects.toThrow(/workspace access|authorization boundary/);
    await expect(f.service.guardForPublication({ ...f.admission, workspaceId: peer.workspace.id })).rejects.toThrow(/publication binding/);
    expect(acquisition.materialize).not.toHaveBeenCalled();
    expect(acquisition.catalog).not.toHaveBeenCalled();
  });

  it("fences pending private clones and rechecks granted readers before actual publication", async () => {
    const f = await fixture(), peer = await standardPeer(f);
    await privateTask(f);
    const intent = await f.request({ kind: "catalog", id: "private-repo" });
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const staged = new Promise<void>(resolve => { started = resolve; });
    await localPrivateClone(f, async () => { started(); await gate; });
    const preparation = f.service.prepareForAdmission(f.admission);
    const outcome = preparation.then(value => ({ value, error: null }), error => ({ value: null, error }));
    try {
      await Promise.race([staged, outcome.then(() => { throw new Error("Clone ended before publication barrier"); })]);
      await expect(f.service.prepareForAdmission(peer.admission)).rejects.toThrow(/workspace access|authorization boundary/);
      await grantPeer(f, peer);
      await expect(f.service.prepareForAdmission(peer.admission)).resolves.toEqual([]);
      await db.update(issueAccessGrants).set({ revokedAt: new Date() }).where(eq(issueAccessGrants.issueId, f.issueId));
    } finally { release(); }
    expect((await outcome).error).toBeTruthy();
    expect(await fs.lstat(path.join(f.admission.cwd, intent.repository.relativePath)).catch(() => null)).toBeNull();
  });

  it.each(["agent", "issue", "project", "workspace_source_project", "run"] as const)(
    "rejects catalog acquisition from raw %s low-trust policy", async source => {
      const f = await fixture();
      if (source === "agent") await db.update(agents).set({ permissions: f.policy }).where(eq(agents.id, f.agentId));
      if (source === "issue") await db.update(issues).set({ executionPolicy: f.policy }).where(eq(issues.id, f.issueId));
      if (source === "run") await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: f.issueId, executionPolicy: f.policy } }).where(eq(heartbeatRuns.id, f.runId));
      if (source === "project" || source === "workspace_source_project") {
        const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Restricted", executionWorkspacePolicy: f.policy }).returning();
        if (source === "project") await db.update(issues).set({ projectId: project.id }).where(eq(issues.id, f.issueId));
        else {
          await db.update(projects).set({ executionWorkspacePolicy: { ...f.policy, authorizationPolicy: { ...f.policy.authorizationPolicy,
            trustBoundary: { ...f.policy.authorizationPolicy.trustBoundary, projectIds: [project.id] } } } }).where(eq(projects.id, project.id));
          await db.update(executionWorkspaces).set({ projectId: project.id, strategyType: "git_worktree" }).where(eq(executionWorkspaces.id, f.workspace.id));
        }
      }
      await expect(f.request({ kind: "catalog", id: "private-repo" })).rejects.toThrow(/anonymous public URLs only|trusted task/);
      expect(await db.select().from(executionWorkspaceRepositories).where(eq(executionWorkspaceRepositories.companyId, f.companyId))).toHaveLength(0);
      expect(acquisition.managedAuth).not.toHaveBeenCalled();
    },
  );

  it.each(["agent", "issue", "project", "workspace_source_project", "run"] as const)(
    "rejects public acquisition from raw %s policy even with full-auto provider permissions", async source => {
      const f = await fixture();
      await db.update(agents).set({ adapterConfig: { provider: "codex", codexPermissionMode: "never" },
        ...(source === "agent" ? { permissions: f.policy } : {}) }).where(eq(agents.id, f.agentId));
      if (source === "issue") await db.update(issues).set({ executionPolicy: f.policy }).where(eq(issues.id, f.issueId));
      if (source === "run") {
        await db.update(issues).set({ executionPolicy: {} }).where(eq(issues.id, f.issueId));
        await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: f.issueId, executionPolicy: f.policy } }).where(eq(heartbeatRuns.id, f.runId));
      }
      if (source === "project" || source === "workspace_source_project") {
        const [project] = await db.insert(projects).values({ companyId: f.companyId, name: "Restricted", executionWorkspacePolicy: f.policy }).returning();
        if (source === "project") await db.update(issues).set({ projectId: project.id }).where(eq(issues.id, f.issueId));
        else {
          await db.update(projects).set({ executionWorkspacePolicy: { ...f.policy, authorizationPolicy: { ...f.policy.authorizationPolicy,
            trustBoundary: { ...f.policy.authorizationPolicy.trustBoundary, projectIds: [project.id] } } } }).where(eq(projects.id, project.id));
          await db.update(executionWorkspaces).set({ projectId: project.id, strategyType: "git_worktree" }).where(eq(executionWorkspaces.id, f.workspace.id));
        }
      }
      for (const url of ["https://github.com/public/example", "https://github.com/sponsor/private"]) {
        await expect(f.request({ kind: "url", url })).rejects.toThrow(/trusted task/);
      }
      expect(await f.service.list(f.companyId, f.workspace.id)).toEqual([]);
      expect(acquisition.materialize).not.toHaveBeenCalled();
      expect(acquisition.managedAuth).not.toHaveBeenCalled();
    });

  it.each(["pending", "preparing"] as const)("blocks %s public acquisition after trust is downgraded", async state => {
    const f = await fixture();
    const receipt = await f.request({ kind: "url", url: "https://github.com/public/example" });
    await db.update(executionWorkspaceRepositories).set({ state }).where(eq(executionWorkspaceRepositories.id, receipt.operationId));
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: f.issueId, executionPolicy: f.policy } }).where(eq(heartbeatRuns.id, f.runId));
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/trusted task/);
    expect((await f.service.list(f.companyId, f.workspace.id))[0].state).toBe(state);
    expect(acquisition.materialize).not.toHaveBeenCalled();
    expect(acquisition.managedAuth).not.toHaveBeenCalled();
  });

  it("rejects an unsponsored request even when the caller supplies a sponsor actor", async () => {
    const f = await fixture();
    await db.update(heartbeatRuns).set({ responsibleUserId: null }).where(eq(heartbeatRuns.id, f.runId));
    await expect(f.request({ kind: "url", url: "https://github.com/public/example" })).rejects.toThrow(/responsible user/);
    expect(await f.service.list(f.companyId, f.workspace.id)).toEqual([]);
    await expect(f.service.prepareForAdmission({ ...f.admission, responsibleUserId: null })).resolves.toEqual([]);
    expect(acquisition.materialize).not.toHaveBeenCalled();
  });

  it.each(["pending", "ready"] as const)("blocks a %s managed receipt after the run becomes low trust", async state => {
    const f = await fixture();
    const receipt = await f.request({ kind: "catalog", id: "private-repo" });
    await db.update(executionWorkspaceRepositories).set({ state, pinnedCommit: state === "ready" ? "a".repeat(40) : null })
      .where(eq(executionWorkspaceRepositories.id, receipt.operationId));
    const checkout = path.join(f.admission.cwd, receipt.repository.relativePath);
    if (state === "ready") { await mkdir(checkout, { recursive: true }); await writeFile(path.join(checkout, "private.txt"), "retained private bytes"); }
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: f.issueId, executionPolicy: f.policy } }).where(eq(heartbeatRuns.id, f.runId));
    await expect(f.request({ kind: "url", url: receipt.repository.repoUrl })).rejects.toThrow(/anonymous public URLs only|trusted task/);
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/anonymous public URLs only|trusted task/);
    expect(acquisition.materialize).not.toHaveBeenCalled();
    expect(acquisition.managedAuth).not.toHaveBeenCalled();
    if (state === "ready") expect(await readFile(path.join(checkout, "private.txt"), "utf8")).toBe("retained private bytes");
  });

  it.each([
    { status: "active", closedAt: new Date() },
    { status: "idle", closedAt: new Date() },
    { status: "archived", closedAt: null },
    { status: "in_review", closedAt: null },
  ])("rejects repository requests for unavailable $status workspaces (closed=$closedAt)", async lifecycle => {
    const f = await fixture();
    await db.update(executionWorkspaces).set(lifecycle).where(eq(executionWorkspaces.id, f.workspace.id));
    await expect(f.request({ kind: "url", url: "https://github.com/public/example" })).rejects.toThrow("Execution workspace is unavailable");
    expect(await f.service.list(f.companyId, f.workspace.id)).toEqual([]);
    expect(acquisition.materialize).not.toHaveBeenCalled();
  });

  it.each(["sponsored", "local_board", "routine"] as const)("prepares public Git from an idle workspace for a trusted %s task and reuses verified bytes after trust downgrade", async principal => {
    const f = await fixture();
    await db.update(executionWorkspaces).set({ status: "idle" }).where(eq(executionWorkspaces.id, f.workspace.id));
    if (principal === "local_board") await db.update(heartbeatRuns).set({ responsibleUserId: "local-board" }).where(eq(heartbeatRuns.id, f.runId));
    const receipt = await f.request({ kind: "url", url: "https://github.com/public/example" });
    const responsibleUserId = principal === "local_board" ? "local-board" : principal === "routine" ? null : f.userId;
    await db.update(heartbeatRuns).set({ responsibleUserId }).where(eq(heartbeatRuns.id, f.runId));
    const admission = { ...f.admission, responsibleUserId };
    const source = path.join(root, `${f.issueId}-public-source`);
    await mkdir(source);
    const exec = promisify(execFileCallback);
    await exec("git", ["init", "--initial-branch=main", source]);
    await writeFile(path.join(source, "public.txt"), "Public fixture bytes\n");
    await exec("git", ["-C", source, "add", "."]);
    await exec("git", ["-C", source, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "public source"]);
    const actual = await vi.importActual<typeof import("../services/managed-repository-checkout.js")>("../services/managed-repository-checkout.js");
    acquisition.materialize.mockImplementationOnce(async (cwd, input) => {
      const auth = await input.resolveGitAuth(input.repoUrl);
      expect(auth.env).toMatchObject({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" });
      expect(auth.configArgs).toEqual(buildGitAuthInvocation({ token: "", source: "managed_connection", secretName: null }).configArgs);
      const result = await actual.materializeManagedProjectWorkspace(cwd, { ...input, localSource: source });
      await exec("git", ["-C", cwd, "remote", "set-url", "origin", input.repoUrl]);
      return result;
    });
    const [prepared] = await f.service.prepareForAdmission(admission);
    expect(prepared.id).toBe(receipt.operationId);
    expect(await readFile(path.join(prepared.cwd, "public.txt"), "utf8")).toBe("Public fixture bytes\n");
    expect(acquisition.managedAuth).not.toHaveBeenCalled();
    await writeFile(path.join(prepared.cwd, "committed.txt"), "Later task commit\n");
    await exec("git", ["-C", prepared.cwd, "add", "committed.txt"]);
    await exec("git", ["-C", prepared.cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "task changes"]);
    const editedHead = (await exec("git", ["-C", prepared.cwd, "rev-parse", "HEAD"])).stdout.trim();
    expect(editedHead).not.toBe(prepared.pinnedCommit);
    await writeFile(path.join(prepared.cwd, "dirty.txt"), "Uncommitted task bytes\n");
    acquisition.materialize.mockClear();
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: f.issueId, executionPolicy: f.policy } }).where(eq(heartbeatRuns.id, f.runId));
    await expect(f.service.prepareForAdmission(admission)).resolves.toEqual([prepared]);
    await expect(f.service.reserveForRecovery(admission)).resolves.toBeUndefined();
    expect(acquisition.materialize).not.toHaveBeenCalled();
    expect(await readFile(path.join(prepared.cwd, "public.txt"), "utf8")).toBe("Public fixture bytes\n");
    expect((await exec("git", ["-C", prepared.cwd, "rev-parse", "HEAD"])).stdout.trim()).toBe(editedHead);
    expect(await readFile(path.join(prepared.cwd, "dirty.txt"), "utf8")).toBe("Uncommitted task bytes\n");
    await rm(prepared.cwd, { recursive: true });
    await expect(f.service.prepareForAdmission(admission)).rejects.toThrow(/trusted task/);
    expect(acquisition.materialize).not.toHaveBeenCalled();
  });

  it("reauthorizes a public clone before publication after trust changes during Git", async () => {
    const f = await fixture();
    const receipt = await f.request({ kind: "url", url: "https://github.com/public/example" });
    await localPrivateClone(f, async () => {
      await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: f.issueId, executionPolicy: f.policy } }).where(eq(heartbeatRuns.id, f.runId));
    });
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow(/trusted task/);
    await expect(fs.lstat(path.join(f.admission.cwd, receipt.repository.relativePath))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await f.service.list(f.companyId, f.workspace.id))[0]).toMatchObject({ pinnedCommit: null, state: "needs_repair" });
    expect(acquisition.materialize).toHaveBeenCalledOnce();
    expect(acquisition.managedAuth).not.toHaveBeenCalled();
  });

  it.each(["same_repository", "different_repository", "empty_inventory", "unpinned_publication", "pending_intent"] as const)(
    "rejects managed peer bytes in the same physical root with %s", async scenario => {
      const f = await fixture();
      const managed = await f.request({ kind: "catalog", id: "private-repo" });
      const checkout = path.join(f.admission.cwd, managed.repository.relativePath);
      if (scenario !== "pending_intent") {
        await mkdir(path.join(checkout, ".git"), { recursive: true });
        await writeFile(path.join(checkout, "private.txt"), "Private peer bytes");
      } else {
        // A legacy pending intent has neither a root-policy row nor published bytes.
        await db.delete(executionWorkspaceRepositoryRoots).where(eq(executionWorkspaceRepositoryRoots.companyId, f.companyId));
      }
      if (scenario !== "unpinned_publication" && scenario !== "pending_intent") await db.update(executionWorkspaceRepositories)
        .set({ state: "ready", pinnedCommit: "b".repeat(40) }).where(eq(executionWorkspaceRepositories.id, managed.operationId));
      const [peer] = await db.insert(executionWorkspaces).values({ companyId: f.companyId, name: "Same physical folder",
        cwd: f.admission.cwd, mode: "isolated_workspace", strategyType: "task_directory" }).returning();
      const issueId = randomUUID(), runId = randomUUID();
      await db.insert(issues).values({ id: issueId, companyId: f.companyId, title: "Low-trust peer", assigneeAgentId: f.agentId,
        executionWorkspaceId: peer.id });
      const policy = { ...f.policy, authorizationPolicy: { ...f.policy.authorizationPolicy,
        trustBoundary: { ...f.policy.authorizationPolicy.trustBoundary, rootIssueId: issueId } } };
      await db.insert(heartbeatRuns).values({ id: runId, companyId: f.companyId, agentId: f.agentId, status: "running",
        responsibleUserId: f.userId, contextSnapshot: { issueId, executionPolicy: policy } });
      await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));
      if (scenario !== "empty_inventory") await expect(f.service.request({ companyId: f.companyId, issueId, actor: { ...f.actor, runId },
        request: { requestKey: randomUUID(), repository: { kind: "url", url: scenario === "same_repository" ? managed.repository.repoUrl : "https://github.com/public/other" } } }))
        .rejects.toThrow(/anonymous public URLs only|trusted task/);
      await expect(f.service.prepareForAdmission({ ...f.admission, issueId, runId, workspaceId: peer.id })).rejects.toThrow(/anonymous public URLs only|trusted task/);
      expect(acquisition.materialize).not.toHaveBeenCalled();
      expect(acquisition.managedAuth).not.toHaveBeenCalled();
      if (scenario !== "pending_intent") expect(await readFile(path.join(checkout, "private.txt"), "utf8")).toBe("Private peer bytes");
    },
  );

  it.each([
    { marker: "valid", reserved: false }, { marker: "malformed", reserved: false }, { marker: "symlink", reserved: false },
    { marker: "valid", reserved: true }, { marker: "malformed", reserved: true }, { marker: "symlink", reserved: true },
  ])("rejects readable private publication behind an unreadable alias ($marker marker, reserved=$reserved)", async ({ marker, reserved }) => {
    const f = await fixture();
    const receipt = await f.request({ kind: "catalog", id: "private-repo" });
    // Emulate a pre-fence managed publication and, optionally, a reservation
    // created by the older unreadable-alias bug.
    await db.delete(executionWorkspaceRepositoryRoots).where(eq(executionWorkspaceRepositoryRoots.companyId, f.companyId));
    const checkout = path.join(f.admission.cwd, receipt.repository.relativePath);
    await mkdir(checkout, { recursive: true });
    const exec = promisify(execFileCallback);
    await exec("git", ["init", "--initial-branch=main", checkout]);
    await writeFile(path.join(checkout, "private.txt"), "Private published bytes must never enter low-trust capture\n");
    await exec("git", ["-C", checkout, "add", "."]);
    await exec("git", ["-C", checkout, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "private source"]);
    const pin = (await exec("git", ["-C", checkout, "rev-parse", "HEAD"])).stdout.trim();
    const owner = path.join(checkout, ".git", "paperclip-workspace-owner.json");
    const ownerJson = JSON.stringify({ version: 1, repositoryId: receipt.operationId, pinnedCommit: pin });
    if (marker === "symlink") {
      const target = path.join(root, `${f.issueId}-untrusted-owner`);
      await writeFile(target, ownerJson);
      await symlink(target, owner);
    } else await writeFile(owner, marker === "valid" ? ownerJson : "{unverifiable owner");
    await db.update(executionWorkspaceRepositories).set({ state: "ready", pinnedCommit: pin }).where(eq(executionWorkspaceRepositories.id, receipt.operationId));
    const aliasParent = path.join(root, `${f.issueId}-unreadable`);
    await mkdir(aliasParent);
    const alias = path.join(aliasParent, "workspace");
    await symlink(f.admission.cwd, alias);
    await db.update(executionWorkspaces).set({ cwd: alias }).where(eq(executionWorkspaces.id, f.workspace.id));
    const peer = await lowTrustPeer(f);
    const canonicalCwd = await realpath(f.admission.cwd);
    if (reserved) await db.insert(executionWorkspaceRepositoryRoots).values({ companyId: f.companyId, canonicalCwd,
      rootKey: createHash("sha256").update(canonicalCwd).digest("hex"), mode: "anonymous_only" });
    const actual = fs.realpath.bind(fs);
    vi.spyOn(fs, "realpath").mockImplementation(async pathname => {
      if (String(pathname).startsWith(aliasParent)) throw Object.assign(new Error("Unreadable legacy alias"), { code: "EACCES" });
      return actual(pathname);
    });
    await expect(f.service.prepareForAdmission(peer.admission)).rejects.toThrow(/anonymous public URLs only|trusted task/);
    await expect(f.service.request({ companyId: f.companyId, issueId: peer.admission.issueId, actor: peer.actor,
      request: { repository: { kind: "url", url: "https://github.com/public/unrelated" }, requestKey: randomUUID() } }))
      .rejects.toThrow(/anonymous public URLs only|trusted task/);
    expect(await f.service.list(f.companyId, peer.workspace.id)).toEqual([]);
    expect(acquisition.materialize).not.toHaveBeenCalled();
    expect(acquisition.managedAuth).not.toHaveBeenCalled();
    expect(await readFile(path.join(checkout, "private.txt"), "utf8")).toContain("Private published bytes");
  });

  it.each(["standard", "retained_low_trust", "current_low_trust"] as const)("recovers an exact legacy run-ID binding with %s trust", async trust => {
    const f = await fixture();
    const execution = buildNativeExecutionInput({
      companyId: f.companyId, runId: f.runId, agentId: f.agentId,
      issue: { id: f.issueId, identifier: "LEG-1", title: "Legacy recovery", description: null, workMode: "standard" },
      taskPrompt: "Continue", normalizedSessionId: randomUUID(), provider: "codex",
      workspace: { id: f.runId, cwd: f.admission.cwd, repoUrl: null, repoRef: null, branchName: null },
      completionContract: { id: randomUUID(), sha256: `sha256:${"a".repeat(64)}`, schemaVersion: "paperclip.run-result.v1", contract: { revision: "1", objective: "Recover", criteria: [{ id: "objective", requirement: "Keep the admitted folder" }] } },
      runtimeContext: nativeRuntimeContextFixture(),
    });
    await db.update(heartbeatRuns).set({ runtimeMode: "native", runnerProfileJson: { nativeExecutionInput: execution },
      contextSnapshot: { issueId: f.issueId, ...(trust === "retained_low_trust" ? { executionPolicy: f.policy } : {}) } }).where(eq(heartbeatRuns.id, f.runId));
    if (trust === "current_low_trust") await db.update(agents).set({ permissions: f.policy }).where(eq(agents.id, f.agentId));
    await expect(f.service.reserveForRecovery({ ...f.admission, workspaceId: f.runId })).resolves.toBeUndefined();
    const reservations = await db.select().from(executionWorkspaceRepositoryRoots).where(eq(executionWorkspaceRepositoryRoots.companyId, f.companyId));
    expect(reservations).toHaveLength(trust === "standard" ? 0 : 1);
    if (trust !== "standard") expect(reservations[0].mode).toBe("anonymous_only");
    await expect(f.service.reserveForRecovery({ ...f.admission, workspaceId: randomUUID() })).rejects.toThrow(/recovery identity/);
    execution.binding.agentId = randomUUID();
    await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: execution } }).where(eq(heartbeatRuns.id, f.runId));
    await expect(f.service.reserveForRecovery({ ...f.admission, workspaceId: f.runId })).rejects.toThrow(/recovery identity/);
    expect(acquisition.materialize).not.toHaveBeenCalled();
  });

  it.each(["ENOTDIR", "EACCES"] as const)("ignores unrelated unavailable legacy managed paths (%s) while preserving anonymous roots", async code => {
    const f = await fixture();
    await f.request({ kind: "catalog", id: "private-repo" });
    await db.delete(executionWorkspaceRepositoryRoots).where(eq(executionWorkspaceRepositoryRoots.companyId, f.companyId));
    const peerRoot = path.join(root, `${f.issueId}-anonymous`);
    await mkdir(peerRoot);
    const peer = await lowTrustPeer(f, peerRoot);
    const unavailableParent = path.join(root, `${f.issueId}-unavailable`);
    await writeFile(unavailableParent, "Archived directory replaced by a file");
    const unavailableCwd = path.join(unavailableParent, "checkout");
    await db.update(executionWorkspaces).set({ cwd: unavailableCwd, status: "archived" }).where(eq(executionWorkspaces.id, f.workspace.id));
    if (code === "EACCES") {
      const actual = fs.realpath.bind(fs);
      vi.spyOn(fs, "realpath").mockImplementation(async pathname => {
        if (String(pathname).startsWith(unavailableParent)) throw Object.assign(new Error("fixture access denied"), { code: "EACCES" });
        return actual(pathname);
      });
    }
    await expect(f.service.prepareForAdmission(peer.admission)).resolves.toEqual([]);
    // Rechecking current owners must still tolerate an unrelated unavailable path.
    vi.restoreAllMocks();
    const actual = fs.realpath.bind(fs);
    vi.spyOn(fs, "realpath").mockImplementation(async pathname => {
      if (String(pathname) === unavailableCwd) throw Object.assign(new Error("Historical path remains unavailable"), { code: "EACCES" });
      return actual(pathname);
    });
    await expect(executionWorkspaceRepositoryService(db).prepareForAdmission(peer.admission)).resolves.toEqual([]);
  });

  it("still rejects a legacy pending managed receipt through a canonical path alias", async () => {
    const f = await fixture();
    await f.request({ kind: "catalog", id: "private-repo" });
    await db.delete(executionWorkspaceRepositoryRoots).where(eq(executionWorkspaceRepositoryRoots.companyId, f.companyId));
    const alias = path.join(root, `${f.issueId}-legacy-alias`);
    await symlink(f.admission.cwd, alias);
    await db.update(executionWorkspaces).set({ cwd: alias }).where(eq(executionWorkspaces.id, f.workspace.id));
    const peer = await lowTrustPeer(f);
    await expect(f.service.prepareForAdmission(peer.admission)).rejects.toThrow(/anonymous public URLs only|trusted task/);
  });

  it("reserves a legacy low-trust recovery folder after its task binding moves", async () => {
    const f = await fixture();
    const peer = await lowTrustPeer(f);
    await db.update(issues).set({ parentId: peer.admission.issueId }).where(eq(issues.id, f.issueId));
    await db.update(issues).set({ executionWorkspaceId: null }).where(eq(issues.id, peer.admission.issueId));
    await db.update(executionWorkspaces).set({ cwd: path.join(root, "moved-recovery"), metadata: {}, status: "archived" })
      .where(eq(executionWorkspaces.id, peer.workspace.id));
    await f.service.reserveForRecovery(peer.admission);
    await expect(executionWorkspaceRepositoryService(db).request({ companyId: f.companyId, issueId: f.issueId, actor: f.actor,
      request: { repository: { kind: "catalog", id: "private-repo" }, requestKey: randomUUID() } }))
      .rejects.toThrow(/anonymous public URLs only|trusted task/);
    const [reservation] = await db.select().from(executionWorkspaceRepositoryRoots).where(eq(executionWorkspaceRepositoryRoots.companyId, f.companyId));
    expect(reservation).toMatchObject({ canonicalCwd: await realpath(f.admission.cwd), mode: "anonymous_only" });
    expect(acquisition.materialize).not.toHaveBeenCalled();
    expect(acquisition.managedAuth).not.toHaveBeenCalled();
  });

  it("reserves a legacy managed recovery folder before a low-trust peer resumes", async () => {
    const f = await fixture();
    await f.request({ kind: "catalog", id: "private-repo" });
    await db.delete(executionWorkspaceRepositoryRoots).where(eq(executionWorkspaceRepositoryRoots.companyId, f.companyId));
    const peer = await lowTrustPeer(f);
    await f.service.reserveForRecovery(f.admission);
    await db.update(executionWorkspaces).set({ cwd: path.join(root, "moved-managed-recovery") }).where(eq(executionWorkspaces.id, f.workspace.id));
    await expect(executionWorkspaceRepositoryService(db).reserveForRecovery(peer.admission)).rejects.toThrow(/anonymous public URLs only|trusted task/);
    expect(acquisition.materialize).not.toHaveBeenCalled();
  });

  it("serializes a managed request against anonymous admission through physical aliases", async () => {
    const f = await fixture();
    const alias = path.join(root, `${f.issueId}-alias`);
    await symlink(f.admission.cwd, alias);
    const peer = await lowTrustPeer(f, alias);
    await db.update(issues).set({ parentId: peer.admission.issueId }).where(eq(issues.id, f.issueId));
    const outcomes = await Promise.allSettled([
      f.service.prepareForAdmission(peer.admission),
      f.request({ kind: "catalog", id: "private-repo" }),
    ]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
    const [reservation] = await db.select().from(executionWorkspaceRepositoryRoots).where(eq(executionWorkspaceRepositoryRoots.companyId, f.companyId));
    expect(reservation.mode).toBe(outcomes[0].status === "fulfilled" ? "anonymous_only" : "managed");
    const restarted = executionWorkspaceRepositoryService(db);
    if (reservation.mode === "anonymous_only") {
      await expect(f.request({ kind: "catalog", id: "private-repo" })).rejects.toThrow(/anonymous public URLs only|trusted task/);
      await expect(restarted.prepareForAdmission(peer.admission)).resolves.toEqual([]);
    } else await expect(restarted.prepareForAdmission(peer.admission)).rejects.toThrow(/anonymous public URLs only|trusted task/);
    expect(acquisition.materialize).not.toHaveBeenCalled();
  });

  it("keeps anonymous root ownership across workspace moves and blocks future catalog promotion", async () => {
    const f = await fixture();
    // A standard task's initially anonymous intent may later appear in its catalog.
    const pending = await f.request({ kind: "url", url: "https://github.com/public/later-catalog" });
    const peer = await lowTrustPeer(f);
    // This source task belongs to the reader's trusted task subtree.
    await db.update(issues).set({ parentId: peer.admission.issueId }).where(eq(issues.id, f.issueId));
    await f.service.prepareForAdmission(peer.admission);
    await db.update(executionWorkspaces).set({ cwd: path.join(root, "moved-anonymous-workspace"), metadata: {}, status: "archived" })
      .where(eq(executionWorkspaces.id, peer.workspace.id));
    const restarted = executionWorkspaceRepositoryService(db);
    await expect(restarted.request({ companyId: f.companyId, issueId: f.issueId, actor: f.actor,
      request: { repository: { kind: "catalog", id: "private-repo" }, requestKey: randomUUID() } })).rejects.toThrow(/anonymous public URLs only|trusted task/);
    acquisition.catalog.mockResolvedValue({ repositories: [{ id: "later", fullName: "public/later-catalog", private: true,
      url: pending.repository.repoUrl, connections: ["sponsor-github"] }] });
    await expect(restarted.prepareForAdmission(f.admission)).rejects.toThrow(/anonymous public URLs only|trusted task/);
    expect(acquisition.managedAuth).not.toHaveBeenCalled();
    expect(acquisition.materialize).not.toHaveBeenCalled();
    expect((await db.select().from(executionWorkspaceRepositories).where(eq(executionWorkspaceRepositories.id, pending.operationId)))[0].catalogRepositoryId).toBeNull();
  });

  it("rejects anonymous admission while a managed clone is waiting to publish", async () => {
    const f = await fixture();
    const receipt = await f.request({ kind: "catalog", id: "private-repo" });
    const peer = await lowTrustPeer(f);
    const source = path.join(root, `${f.issueId}-private-source`);
    await mkdir(source);
    const exec = promisify(execFileCallback);
    await exec("git", ["init", "--initial-branch=main", source]);
    await writeFile(path.join(source, "private.txt"), "Private fixture bytes\n");
    await exec("git", ["-C", source, "add", "."]);
    await exec("git", ["-C", source, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "private source"]);
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const staged = new Promise<void>(resolve => { started = resolve; });
    const actual = await vi.importActual<typeof import("../services/managed-repository-checkout.js")>("../services/managed-repository-checkout.js");
    acquisition.materialize.mockImplementationOnce(async (cwd, input) => {
      const result = await actual.materializeManagedProjectWorkspace(cwd, { ...input, localSource: source,
        beforePublish: async cloneCwd => {
          await input.beforePublish(cloneCwd);
          started();
          await gate;
        } });
      await exec("git", ["-C", cwd, "remote", "set-url", "origin", input.repoUrl]);
      return result;
    });
    const preparation = f.service.prepareForAdmission(f.admission);
    try {
      await Promise.race([staged, preparation.then(() => { throw new Error("Managed preparation finished before publication barrier"); })]);
      const [pending] = await db.select().from(executionWorkspaceRepositories).where(eq(executionWorkspaceRepositories.id, receipt.operationId));
      expect(pending).toMatchObject({ state: "preparing", pinnedCommit: null });
      // The reservation remains anchored to the physical root even if ordinary
      // metadata/placement maintenance changes the originating workspace row.
      await db.update(executionWorkspaces).set({ cwd: path.join(root, "moved-managed-workspace"), metadata: {} }).where(eq(executionWorkspaces.id, f.workspace.id));
      await expect(executionWorkspaceRepositoryService(db).prepareForAdmission(peer.admission)).rejects.toThrow(/anonymous public URLs only|trusted task/);
    } finally { release(); }
    const [prepared] = await preparation;
    expect(await readFile(path.join(prepared.cwd, "private.txt"), "utf8")).toBe("Private fixture bytes\n");
    await expect(executionWorkspaceRepositoryService(db).prepareForAdmission(peer.admission)).rejects.toThrow(/anonymous public URLs only|trusted task/);
  });

  it("retains previous run trust without confusing a board request's reassigned agent", async () => {
    const f = await fixture();
    const [replacement] = await db.insert(agents).values({ companyId: f.companyId, name: "Replacement", adapterType: "process" }).returning();
    await db.update(issues).set({ assigneeAgentId: replacement.id }).where(eq(issues.id, f.issueId));
    await db.update(heartbeatRuns).set({ status: "succeeded", contextSnapshot: { taskId: f.issueId } }).where(eq(heartbeatRuns.id, f.runId));
    const request = () => f.service.request({ companyId: f.companyId, issueId: f.issueId,
      actor: { type: "board", source: "local_implicit", userId: "local-board" },
      request: { requestKey: randomUUID(), repository: { kind: "catalog", id: "private-repo" } } });
    await expect(request()).resolves.toMatchObject({ kind: "requires_next_admission" });
    await db.update(heartbeatRuns).set({ contextSnapshot: { taskId: f.issueId, executionPolicy: f.policy } }).where(eq(heartbeatRuns.id, f.runId));
    await expect(request()).rejects.toThrow(/anonymous public URLs only|trusted task/);
  });

  it("preserves standard empty-inventory admission without repository mutation authority", async () => {
    const f = await fixture();
    await db.delete(companyMemberships).where(eq(companyMemberships.companyId, f.companyId));
    await expect(f.service.prepareForAdmission(f.admission)).resolves.toEqual([]);
    expect(acquisition.catalog).not.toHaveBeenCalled();
    expect(acquisition.materialize).not.toHaveBeenCalled();
    // Adding an acquisition still requires the full authorization intersection.
    await db.insert(executionWorkspaceRepositories).values({ companyId: f.companyId, executionWorkspaceId: f.workspace.id,
      requestedByIssueId: f.issueId, repositoryIdentity: "https://github.com/public/example", repoUrl: "https://github.com/public/example",
      relativePath: ".paperclip-repositories/unused", requestedRef: "HEAD", requestKey: "requires-authority", requestKeys: ["requires-authority"] });
    await expect(f.service.prepareForAdmission(f.admission)).rejects.toThrow();
    expect(acquisition.materialize).not.toHaveBeenCalled();
  });

  it("keeps low-trust empty-inventory admission free of acquisition-only filesystem and membership requirements", async () => {
    const f = await fixture();
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: f.issueId, executionPolicy: f.policy } }).where(eq(heartbeatRuns.id, f.runId));
    await db.delete(companyMemberships).where(eq(companyMemberships.companyId, f.companyId));
    await expect(f.service.prepareForAdmission({ ...f.admission, cwd: path.join(root, "not-materialized") })).resolves.toEqual([]);
    expect(acquisition.catalog).not.toHaveBeenCalled();
    expect(acquisition.materialize).not.toHaveBeenCalled();
  });

  it("rejects admission without the persisted task run before materialization", async () => {
    const f = await fixture();
    await f.request({ kind: "catalog", id: "private-repo" });
    await expect(f.service.prepareForAdmission({ ...f.admission, runId: randomUUID() })).rejects.toThrow(/run identity/);
    expect(acquisition.materialize).not.toHaveBeenCalled();
  });
});
