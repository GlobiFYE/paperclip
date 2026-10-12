import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import type { Db } from "@paperclipai/db";

const summarySweep = vi.hoisted(() => vi.fn(async () => ({ candidates: 0, generated: 0, failed: 0, skipped: 0 })));
vi.mock("./deliverable-summary.js", async original => ({
  ...await original<typeof import("./deliverable-summary.js")>(), processPendingDeliverableSummaries: summarySweep,
}));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("creates only the deliverable interval and skips other startup work in isolated mode", async () => {
  vi.stubEnv("PAPERCLIP_ONLY_DELIVERABLE_SWEEP", "1");
  vi.useFakeTimers();
  const intervals = vi.spyOn(globalThis, "setInterval");
  // Construction must not query the copied DB to start background services.
  const queryAccess = vi.fn();
  const db = new Proxy({}, { get: queryAccess }) as Db;
  const app = await createApp(db, {
    uiMode: "none", serverPort: 3300, bindHost: "127.0.0.1", deploymentMode: "local_trusted",
    deploymentExposure: "private", allowedHostnames: [], authReady: false, companyDeletionEnabled: false,
    storageService: {} as Parameters<typeof createApp>[1]["storageService"],
    decisionServiceOptions: {} as Parameters<typeof createApp>[1]["decisionServiceOptions"],
    feedbackExportService: { flushPendingFeedbackTraces: vi.fn() },
  });
  try {
    await app.locals.bundledPluginsStartup;
    expect(queryAccess).not.toHaveBeenCalled();
    expect(intervals).toHaveBeenCalledTimes(1);
    expect(intervals.mock.calls[0][1]).toBe(60000);
    expect(summarySweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(summarySweep).toHaveBeenCalledTimes(2);
  } finally { await app.locals.paperclipShutdown(); }
});
