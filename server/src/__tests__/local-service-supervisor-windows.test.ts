import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ExecFileCallback = (error: Error | null) => void;

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: execFileMock };
});

import { terminateLocalService } from "../services/local-service-supervisor.js";

const realPlatform = process.platform;
const TASKKILL_CALL = [
  expect.stringMatching(/[\\/]System32[\\/]taskkill\.exe$/i),
  ["/pid", "4242", "/T", "/F"],
  expect.objectContaining({ windowsHide: true }),
  expect.any(Function),
];

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

// taskkill succeeds (null) or fails (an Error), like execFile's callback.
function taskkillResult(error: Error | null, onCall?: () => void) {
  execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, callback: ExecFileCallback) => {
    onCall?.();
    callback(error);
    return {};
  });
}

// A fake service pid: alive for liveness probes (signal 0) until `alive` turns
// false, and accepting every real signal without touching a real process.
function fakeServiceProcess(state: { alive: boolean }, onSignal?: (signal: string | number | undefined) => void) {
  return vi.spyOn(process, "kill").mockImplementation(((_pid: number, signal?: string | number) => {
    if (signal === 0) {
      if (state.alive) return true;
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    }
    onSignal?.(signal);
    return true;
  }) as typeof process.kill);
}

const realSignals = (killSpy: ReturnType<typeof fakeServiceProcess>) =>
  killSpy.mock.calls.filter(([, signal]) => signal !== 0).map(([pid, signal]) => [pid, signal]);

describe("terminateLocalService on Windows", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  afterEach(() => {
    setPlatform(realPlatform);
    vi.restoreAllMocks();
  });

  it("ends the service tree with one taskkill instead of signaling only the pid", async () => {
    setPlatform("win32");
    const state = { alive: true };
    taskkillResult(null, () => (state.alive = false));
    const killSpy = fakeServiceProcess(state);

    await terminateLocalService({ pid: 4242, processGroupId: null }, { forceAfterMs: 50, verifyAfterMs: 50 });

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledWith(...TASKKILL_CALL);
    expect(realSignals(killSpy)).toEqual([]);
  });

  it("does not repeat the tree kill in the forced phase and falls back to SIGKILL", async () => {
    setPlatform("win32");
    const state = { alive: true };
    taskkillResult(null);
    const killSpy = fakeServiceProcess(state, (signal) => {
      if (signal === "SIGKILL") state.alive = false;
    });

    await terminateLocalService({ pid: 4242, processGroupId: null }, { forceAfterMs: 50, verifyAfterMs: 50 });

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(realSignals(killSpy)).toEqual([[4242, "SIGKILL"]]);
  });

  it("falls back to process.kill in both phases when taskkill ends nothing", async () => {
    setPlatform("win32");
    const state = { alive: true };
    taskkillResult(new Error("taskkill exited with code 128"));
    const killSpy = fakeServiceProcess(state, (signal) => {
      if (signal === "SIGKILL") state.alive = false;
    });

    await terminateLocalService({ pid: 4242, processGroupId: null }, { forceAfterMs: 50, verifyAfterMs: 50 });

    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(realSignals(killSpy)).toEqual([
      [4242, "SIGTERM"],
      [4242, "SIGKILL"],
    ]);
  });
});
