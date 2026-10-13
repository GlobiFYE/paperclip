// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueRecoveryAction } from "@paperclipai/shared";
import { WorkspaceExportRecovery } from "./WorkspaceExportRecovery";
import { ApiError } from "../api/client";
const retry = vi.hoisted(() => vi.fn());
const resume = vi.hoisted(() => vi.fn());
vi.mock("../api/issues", () => ({ issuesApi: { retryWorkspaceExport: retry, resumeWorkspaceFinalization: resume } }));
const action = { id: "action", cause: "native_workspace_sync_out_retry_exhausted", status: "active", updatedAt: "2026-01-01T00:00:00Z", ownerType: "board", evidence: { runId: "run" }, wakePolicy: null } as unknown as IssueRecoveryAction;
describe("WorkspaceExportRecovery", () => {
  let root: Root, container: HTMLDivElement, client: QueryClient;
  const onQueued = vi.fn();
  beforeEach(() => {
    retry.mockReset().mockResolvedValue({ status: "queued" }); resume.mockReset(); onQueued.mockReset();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });
  async function mount(overrides: Partial<Parameters<typeof WorkspaceExportRecovery>[0]> = {}) {
    await act(async () => root.render(<QueryClientProvider client={client}><WorkspaceExportRecovery issueId="issue" action={action} canManage onQueued={onQueued} {...overrides} /></QueryClientProvider>));
  }
  async function enterNote() {
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Restored provider connectivity while preserving all saved files.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function submit() {
    await act(async () => container.querySelector("button")!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  it("requires explicit process-stop confirmation before resuming the exact saved result", async () => {
    resume.mockResolvedValue({ status: "queued" });
    await mount({ canConfirmOwnerStop: true, action: { ...action, cause: "native_workspace_finalization_owner_unverified",
      evidence: { runId: "run", owner: { token: "owner-token", hostname: "old-container", pid: 2, processStartedAt: "2026-10-10T00:02:55Z" } } } });
    expect(container.textContent).toContain("Finish saving the agent’s work");
    expect(container.textContent).toContain("Add shutdown evidence and confirm shutdown to continue.");
    await enterNote();
    expect(container.textContent).toContain("Confirm that the controller and all copyback processes stopped.");
    expect(container.querySelector<HTMLButtonElement>("button:not([role=checkbox])")!.disabled).toBe(true);
    await act(async () => container.querySelector<HTMLElement>('[role="checkbox"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>("button:not([role=checkbox])")!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(resume).toHaveBeenCalledWith("issue", { actionId: "action", runId: "run", ownerToken: "owner-token",
      controllerAndCopybackStopped: true, stopEvidence: "Restored provider connectivity while preserving all saved files." });
    expect(retry).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Recovery requested");
    expect(container.textContent).not.toContain("Finish saving the agent’s work");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("agent will not repeat its work");
  });
  it("requires a repair note and submits only the exact recorded run", async () => {
    await mount(); expect(container.querySelector("button")!.disabled).toBe(true);
    await enterNote(); await submit();
    expect(retry).toHaveBeenCalledWith("issue", { actionId: "action", runId: "run", repairNote: "Restored provider connectivity while preserving all saved files." });
    expect(onQueued).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("agent will not repeat its work");
  });
  it("offers repair again when a queued export publishes a new permanent failure", async () => {
    await mount(); await enterNote(); await submit();
    expect(container.querySelector("button")).toBeNull();
    await mount({ action: { ...action, updatedAt: "2026-01-01T00:01:00Z", wakePolicy: null } });
    expect(container.querySelector("button")?.textContent).toBe("Retry workspace export");
  });
  it("keeps unavailable-sandbox errors actionable inline", async () => {
    retry.mockRejectedValueOnce(new Error("Resume the retained sandbox before retrying.")); await mount();
    await enterNote(); await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Resume the retained sandbox");
  });
  it("requires fresh confirmation after a controller change while preserving shutdown evidence", async () => {
    resume.mockRejectedValueOnce(new ApiError("The recorded workspace owner is no longer current.", 409,
      { details: { code: "workspace_owner_recovery_stale" } }));
    await mount({ canConfirmOwnerStop: true, action: { ...action, cause: "native_workspace_finalization_owner_unverified",
      evidence: { runId: "run", owner: { token: "owner-token", hostname: "old-container" } } } });
    await enterNote();
    await act(async () => container.querySelector<HTMLElement>('[role="checkbox"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>("button:not([role=checkbox])")!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Refresh the task and verify its current controller");
    expect(container.querySelector("textarea")?.value).toBe("Restored provider connectivity while preserving all saved files.");
    expect(container.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector<HTMLButtonElement>("button:not([role=checkbox])")?.disabled).toBe(true);
  });
  it("ignores unrelated recovery notices without evidence", async () => {
    await mount({ action: { ...action, cause: "no_live_path", evidence: undefined } as unknown as IssueRecoveryAction });
    expect(container.textContent).toBe("");
  });
  it("does not offer the action without runtime access", async () => {
    await mount({ canManage: false }); expect(container.querySelector("button")).toBeNull();
  });
  it("keeps owner-stop confirmation read-only for ordinary runtime managers", async () => {
    await mount({ action: { ...action, cause: "native_workspace_finalization_owner_unverified",
      evidence: { runId: "run", owner: { token: "owner-token", hostname: "foreign-container", pid: 2 } } } });
    expect(container.textContent).toContain("company owner or administrator");
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(resume).not.toHaveBeenCalled();
  });
  it("offers saved-result export after transient retries are exhausted without claiming an unsafe link", async () => {
    await mount({ action: { ...action, cause: "native_workspace_sync_out_retry_exhausted" } });
    expect(container.querySelector("button")?.textContent).toBe("Retry workspace export");
    expect(container.textContent).toContain("export failure");
    expect(container.textContent).not.toContain("unsafe link");
    await enterNote(); await submit();
    expect(retry).toHaveBeenCalledWith("issue", expect.objectContaining({ runId: "run" }));
  });
  it("never asks users to repair historical unsafe exports", async () => {
    await mount({ action: { ...action, cause: "native_workspace_sync_out_unsafe_archive" } });
    expect(container.textContent).toBe("");
    expect(retry).not.toHaveBeenCalled();
  });
  it("does not offer a second retry while the same export is queued", async () => {
    await mount({ action: { ...action, wakePolicy: { kind: "resume_native_run" } } });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Recovery is queued"); expect(container.querySelector("button")).toBeNull();
  });
});
