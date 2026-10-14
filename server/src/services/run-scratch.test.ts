import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HEARTBEAT_RUN_SCRATCH_MARKER,
  RUN_SCRATCH_ROOT_ENV_KEY,
  buildHeartbeatRunScratchEnv,
  cleanupHeartbeatRunScratch,
  prepareHeartbeatRunScratch,
  resetRunScratchRootForTests,
  resolveRunScratchRoot,
  type HeartbeatRunScratch,
} from "./run-scratch.js";

const cleanupDirs = new Set<string>();

async function trackScratch(scratch: HeartbeatRunScratch) {
  cleanupDirs.add(scratch.dir);
  return scratch;
}

afterEach(async () => {
  await Promise.all(
    Array.from(cleanupDirs, (dir) =>
      fs.rm(dir, { recursive: true, force: true }).catch(() => undefined),
    ),
  );
  cleanupDirs.clear();
});

describe("heartbeat run scratch cleanup", () => {
  it("removes only a marked run-owned scratch directory", async () => {
    const scratch = await trackScratch(await prepareHeartbeatRunScratch({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "run-1",
      issueId: "issue-1",
      issueIdentifier: "PAP-13071",
      now: new Date("2026-07-08T00:00:00.000Z"),
    }));
    await fs.writeFile(path.join(scratch.dir, "tool-cache.txt"), "cache");

    const result = await cleanupHeartbeatRunScratch({ scratch });

    expect(result).toEqual({ removed: true, dir: scratch.dir });
    await expect(fs.stat(scratch.dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves paperclip-named directories without the ownership marker", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-run-unmarked-"));
    cleanupDirs.add(dir);
    const scratch: HeartbeatRunScratch = {
      dir,
      markerPath: path.join(dir, HEARTBEAT_RUN_SCRATCH_MARKER),
      metadata: {
        version: 1,
        companyId: "company-1",
        agentId: "agent-1",
        runId: "run-1",
        issueId: null,
        issueIdentifier: null,
        createdAt: new Date("2026-07-08T00:00:00.000Z").toISOString(),
      },
    };

    const result = await cleanupHeartbeatRunScratch({ scratch });

    expect(result).toEqual({ removed: false, dir, reason: "unmarked" });
    await expect(fs.stat(dir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it("preserves marked scratch when the marker owner does not match the run", async () => {
    const scratch = await trackScratch(await prepareHeartbeatRunScratch({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "run-1",
    }));
    const mismatched = {
      ...scratch,
      metadata: {
        ...scratch.metadata,
        runId: "run-2",
      },
    };

    const result = await cleanupHeartbeatRunScratch({ scratch: mismatched });

    expect(result).toEqual({ removed: false, dir: scratch.dir, reason: "owner_mismatch" });
    await expect(fs.stat(scratch.dir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it("skips cleanup while the run process group is still alive", async () => {
    const scratch = await trackScratch(await prepareHeartbeatRunScratch({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "run-1",
    }));

    const result = await cleanupHeartbeatRunScratch({
      scratch,
      processGroupId: 123,
      isProcessGroupAlive: () => true,
    });

    expect(result).toEqual({ removed: false, dir: scratch.dir, reason: "process_group_alive" });
    await expect(fs.stat(scratch.dir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it("makes the run scratch authoritative for child temp dirs", async () => {
    const scratch = await trackScratch(await prepareHeartbeatRunScratch({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "run-1",
    }));

    const result = buildHeartbeatRunScratchEnv({ TMPDIR: "/custom/tmp" }, scratch);

    expect(result.env.PAPERCLIP_RUN_SCRATCH_DIR).toBe(scratch.dir);
    expect(result.env.PAPERCLIP_TASK_SCRATCH_DIR).toBe(scratch.dir);
    expect(result.env.PAPERCLIP_SCRATCH_DIR).toBe(scratch.dir);
    expect(result.env.PAPERCLIP_TMPDIR).toBe(scratch.dir);
    expect(result.env.TMPDIR).toBe(scratch.dir);
    expect(result.env.TEMP).toBe(scratch.dir);
    expect(result.env.TMP).toBe(scratch.dir);
    expect(result.tempKeysApplied).toEqual(["TMPDIR", "TEMP", "TMP"]);
  });

  it("does not re-apply temp keys that already point at the run scratch", async () => {
    const scratch = await trackScratch(await prepareHeartbeatRunScratch({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "run-1",
    }));

    const result = buildHeartbeatRunScratchEnv(
      { TMPDIR: scratch.dir, TEMP: "", TMP: undefined },
      scratch,
    );

    // The env builder returns only the delta merged over the spawn env, so a
    // key that already points at the scratch dir is not re-emitted.
    expect(result.env.TMPDIR).toBeUndefined();
    expect(result.tempKeysApplied).toEqual(["TEMP", "TMP"]);
  });
});

describe("run scratch root resolution", () => {
  afterEach(() => {
    delete process.env[RUN_SCRATCH_ROOT_ENV_KEY];
    resetRunScratchRootForTests();
  });

  it("walks up out of an inherited temp dir that is itself a run scratch dir", async () => {
    // Simulates the TOP-529 incident: the server is relaunched with TMPDIR
    // pointing into another run's scratch dir, which that run later removes.
    const outerScratch = await trackScratch(await prepareHeartbeatRunScratch({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "outer-run",
      rootDir: os.tmpdir(),
    }));
    const previousTmpDir = process.env.TMPDIR;
    process.env.TMPDIR = outerScratch.dir;
    resetRunScratchRootForTests();
    try {
      const root = resolveRunScratchRoot();
      expect(path.basename(root).startsWith("paperclip-run-")).toBe(false);
      expect(root).toBe(path.dirname(path.resolve(outerScratch.dir)));

      const scratch = await trackScratch(await prepareHeartbeatRunScratch({
        companyId: "company-1",
        agentId: "agent-1",
        runId: "run-439",
        issueIdentifier: "TOP-439",
      }));
      expect(scratch.dir.startsWith(root + path.sep)).toBe(true);
      expect(scratch.dir.startsWith(outerScratch.dir)).toBe(false);

      // The outer run's cleanup must not take the inner scratch with it, and
      // the inner scratch must still clean up on its own.
      await fs.rm(outerScratch.dir, { recursive: true, force: true });
      await expect(fs.stat(scratch.dir)).resolves.toBeTruthy();
      await expect(cleanupHeartbeatRunScratch({ scratch })).resolves.toEqual({
        removed: true,
        dir: scratch.dir,
      });
    } finally {
      if (previousTmpDir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpDir;
      resetRunScratchRootForTests();
    }
  });

  it("honours an explicit PAPERCLIP_RUN_SCRATCH_ROOT and creates it when missing", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-run-root-override-"));
    cleanupDirs.add(base);
    const root = path.join(base, "scratch-root", "not-created-yet");
    process.env[RUN_SCRATCH_ROOT_ENV_KEY] = root;
    resetRunScratchRootForTests();

    const scratch = await trackScratch(await prepareHeartbeatRunScratch({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "run-1",
    }));

    expect(resolveRunScratchRoot()).toBe(root);
    expect(scratch.dir.startsWith(root + path.sep)).toBe(true);
  });
});
