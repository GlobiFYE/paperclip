import { useEffect, type ReactNode } from "react";
import type { IssueRecoveryAction } from "@paperclipai/shared";
import { expect, userEvent, within } from "storybook/test";

export const issueId = "00000000-0000-4000-8000-000000000824";
export const stopEvidence = "The deployment platform confirms that previous-controller-7d4f and all its workspace-copyback processes exited. The saved workspace is retained.";

export const recoveryAction: IssueRecoveryAction = {
  id: "00000000-0000-4000-8000-000000000825",
  companyId: "company-storybook", sourceIssueId: issueId, recoveryIssueId: null,
  kind: "active_run_watchdog", status: "escalated", ownerType: "board",
  ownerAgentId: null, ownerUserId: null, previousOwnerAgentId: null, returnOwnerAgentId: null,
  cause: "native_workspace_finalization_owner_unverified", fingerprint: "storybook-saved-result",
  evidence: { runId: "00000000-0000-4000-8000-000000000826", owner: {
    token: "00000000-0000-4000-8000-000000000827", hostname: "previous-controller-7d4f",
    pid: 2, processStartedAt: "2026-10-10T00:02:55.560Z",
    controllerBootId: "00000000-0000-4000-8000-000000000828",
  } },
  nextAction: "Verify the previous controller and its workspace-copyback processes have stopped. Resume workspace finalization without another provider turn.",
  wakePolicy: null, monitorPolicy: null, attemptCount: 1, maxAttempts: 1,
  timeoutAt: null, lastAttemptAt: "2026-10-10T00:10:00.000Z",
  outcome: null, resolutionNote: null, resolvedAt: null,
  createdAt: "2026-10-10T00:10:00.000Z", updatedAt: "2026-10-10T00:10:00.000Z",
};

export const queuedAction: IssueRecoveryAction = {
  ...recoveryAction, evidence: { ...recoveryAction.evidence, workspaceOwnerStop: {
    owner: recoveryAction.evidence.owner, stopEvidence,
    resultId: "00000000-0000-4000-8000-000000000829", actorId: "user-board",
    confirmedAt: "2026-10-10T00:15:00.000Z",
  } },
  nextAction: "Workspace finalization is queued for the saved result. The agent will not repeat its work.",
};

export type ResponseState = "success" | "pending" | "conflict";

/** Only this fixture's recovery POST is simulated; no live task is contacted. */
export function RecoveryApiFixture({ response = "success", children }: { response?: ResponseState; children: ReactNode }) {
  useEffect(() => {
    const originalFetch = window.fetch;
    const fixtureFetch: typeof window.fetch = async (input, init) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(rawUrl, window.location.origin).pathname !== `/api/issues/${issueId}/recovery-actions/resume-workspace-finalization`) {
        return originalFetch(input, init);
      }
      if (response === "pending") return new Promise<Response>(() => {});
      await new Promise(resolve => window.setTimeout(resolve, 600));
      if (response === "conflict") return Response.json({ error: "The recorded workspace owner is no longer current. Refresh the task and inspect its run." }, { status: 409 });
      return Response.json({ runId: recoveryAction.evidence.runId, resultId: "00000000-0000-4000-8000-000000000829", status: "queued" }, { status: 202 });
    };
    window.fetch = fixtureFetch;
    return () => { if (window.fetch === fixtureFetch) window.fetch = originalFetch; };
  }, [response]);
  return children;
}

export async function confirmStopped(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const button = canvas.getByRole("button", { name: "Resume saved result" });
  await expect(button).toBeDisabled();
  await userEvent.type(canvas.getByRole("textbox", { name: "Deployment stop evidence" }), stopEvidence);
  await expect(button).toBeDisabled();
  await userEvent.click(canvas.getByRole("checkbox"));
  await expect(button).toBeEnabled();
  return { canvas, button };
}
