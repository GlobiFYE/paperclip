import { promises as fs } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({ closing: false, workers: [] as Array<{
  directory: string;
  emit(event: string, value: unknown): boolean;
}> }));

vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return { Worker: class extends EventEmitter {
    directory: string;
    constructor(_source: unknown, options: { env: { TMPDIR: string } }) {
      super();
      this.directory = options.env.TMPDIR;
      control.workers.push(this);
      if (control.closing) queueMicrotask(() => {
        this.emit("message", { error: { name: "Error", message: "cleanup" } });
        this.emit("exit", 0);
      });
    }
    async terminate() { return 0; }
  } };
});

import { runSnapshotThread } from "./workspace-snapshot-thread.js";

afterEach(() => { vi.restoreAllMocks(); control.workers.length = 0; control.closing = false; });

it("holds the third worker until a failed capture's complete cleanup releases capacity", async () => {
  const rm = fs.rm.bind(fs);
  let releaseCleanup!: () => void;
  const cleanupGate = new Promise<void>(resolve => { releaseCleanup = resolve; });
  let cleaning = false;
  vi.spyOn(fs, "rm").mockImplementation(async (...args: Parameters<typeof fs.rm>) => {
    if (args[0] === control.workers[0]?.directory) {
      cleaning = true;
      await cleanupGate;
    }
    return await rm(...args);
  });
  const jobs = Array.from({ length: 3 }, () =>
    runSnapshotThread({ rootDir: "/unused" }).then(() => null, error => error));
  const fail = (worker: typeof control.workers[number]) => {
    worker.emit("message", { error: { name: "Error", message: "failed", code: "EACCES" } });
    worker.emit("exit", 0);
  };
  try {
    await vi.waitFor(() => expect(control.workers).toHaveLength(2));
    fail(control.workers[0]!);
    await vi.waitFor(() => expect(cleaning).toBe(true));
    expect(control.workers).toHaveLength(2);
    expect((await fs.stat(control.workers[0]!.directory)).isDirectory()).toBe(true);
    releaseCleanup();
    expect(await jobs[0]).toMatchObject({ code: "EACCES" });
    await vi.waitFor(() => expect(control.workers).toHaveLength(3));
    await expect(fs.stat(control.workers[0]!.directory)).rejects.toMatchObject({ code: "ENOENT" });
    fail(control.workers[1]!);
    fail(control.workers[2]!);
    expect(await jobs[1]).toMatchObject({ code: "EACCES" });
    expect(await jobs[2]).toMatchObject({ code: "EACCES" });
    for (const worker of control.workers) {
      await expect(fs.stat(worker.directory)).rejects.toMatchObject({ code: "ENOENT" });
    }
  } finally {
    control.closing = true;
    releaseCleanup();
    for (const worker of control.workers) fail(worker);
    await Promise.all(jobs);
  }
});
