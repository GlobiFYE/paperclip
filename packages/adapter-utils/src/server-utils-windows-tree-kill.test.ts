import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ExecFileCallback = (error: Error | null) => void;

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: execFileMock };
});

import { killWindowsProcessTree, signalRunningProcess } from "./server-utils.js";

const realPlatform = process.platform;
const TASKKILL = expect.stringMatching(/[\\/]System32[\\/]taskkill\.exe$/i);

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

// taskkill succeeds (null) or fails (an Error), like execFile's callback.
function taskkillResult(error: Error | null) {
  execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, callback: ExecFileCallback) => {
    callback(error);
    return {};
  });
}

function fakeChild(state: { exitCode?: number | null; signalCode?: NodeJS.Signals | null } = {}) {
  const kill = vi.fn(() => true);
  const child = {
    pid: 4242,
    exitCode: state.exitCode ?? null,
    signalCode: state.signalCode ?? null,
    kill,
  } as unknown as ChildProcess;
  return { child, kill };
}

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe("Windows process-tree termination", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  afterEach(() => {
    setPlatform(realPlatform);
  });

  it("ends the whole tree with taskkill on the first signal and skips child.kill", async () => {
    setPlatform("win32");
    taskkillResult(null);
    const { child, kill } = fakeChild();

    expect(signalRunningProcess({ child, processGroupId: null }, "SIGTERM")).toBe("tree");
    await flushPromises();

    expect(execFileMock).toHaveBeenCalledWith(
      TASKKILL,
      ["/pid", "4242", "/T", "/F"],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    );
    expect(kill).not.toHaveBeenCalled();
  });

  it("falls back to child.kill when taskkill ends nothing and the child is still alive", async () => {
    setPlatform("win32");
    taskkillResult(new Error("taskkill exited with code 128"));
    const { child, kill } = fakeChild();

    signalRunningProcess({ child, processGroupId: null }, "SIGKILL");
    await flushPromises();

    expect(kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("does not fall back when the child exits before taskkill reports a failure", async () => {
    setPlatform("win32");
    let finishTaskkill: ExecFileCallback = () => {};
    execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, callback: ExecFileCallback) => {
      finishTaskkill = callback;
      return {};
    });
    const { child, kill } = fakeChild();

    signalRunningProcess({ child, processGroupId: null }, "SIGTERM");
    (child as { exitCode: number | null }).exitCode = 0;
    finishTaskkill(new Error("taskkill exited with code 128"));
    await flushPromises();

    expect(kill).not.toHaveBeenCalled();
  });

  it.each([
    ["an exit code", { exitCode: 1 }],
    ["a signal", { signalCode: "SIGTERM" as const }],
  ])("never targets the pid of a child that already ended with %s", (_label, state) => {
    // Node releases the process handle when it records exitCode/signalCode, so
    // the pid may already belong to an unrelated process.
    setPlatform("win32");
    const { child, kill } = fakeChild(state);

    expect(signalRunningProcess({ child, processGroupId: null }, "SIGKILL")).toBeNull();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });

  it("does not use taskkill outside Windows", () => {
    setPlatform("linux");
    const { child, kill } = fakeChild();

    expect(signalRunningProcess({ child, processGroupId: null }, "SIGTERM")).toBe("child");
    expect(execFileMock).not.toHaveBeenCalled();
    expect(kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("resolves false for invalid pids without starting taskkill", async () => {
    await expect(killWindowsProcessTree(0)).resolves.toBe(false);
    await expect(killWindowsProcessTree(-1)).resolves.toBe(false);
    await expect(killWindowsProcessTree(1.5)).resolves.toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
