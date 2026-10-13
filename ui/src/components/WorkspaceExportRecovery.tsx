import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { IssueRecoveryAction } from "@paperclipai/shared";
import { isNativeWorkspaceExportRepairCause } from "@paperclipai/shared";
import { issuesApi } from "../api/issues";
import { ApiError } from "../api/client";
import { asObject, cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { Textarea } from "./ui/textarea";

function controllerChanged(error: unknown) {
  return error instanceof ApiError && asObject(asObject(error.body).details).code === "workspace_owner_recovery_stale";
}

/** Copyback repair preserves the accepted result and never wakes the provider. */
export function WorkspaceExportRecovery({ issueId, action, canManage, canConfirmOwnerStop = false, onQueued, className }: {
  className?: string;
  issueId: string; action: IssueRecoveryAction | null; canManage: boolean; onQueued: () => void;
  canConfirmOwnerStop?: boolean;
}) {
  const noteId = useId();
  const confirmationId = useId();
  const helpId = useId();
  const [stopped, setStopped] = useState(false);
  const ownerRecovery = action?.cause === "native_workspace_finalization_owner_unverified";
  const owner = action?.evidence?.owner as { token?: string; hostname?: string; pid?: number; processStartedAt?: string } | undefined;
  const [repairNote, setRepairNote] = useState("");
  const [queuedActionVersion, setQueuedActionVersion] = useState<string | null>(null);
  const retry = useMutation({
    mutationFn: () => ownerRecovery ? issuesApi.resumeWorkspaceFinalization(issueId, {
      actionId: action!.id, runId: action!.evidence.runId as string, ownerToken: owner!.token!,
      controllerAndCopybackStopped: true, stopEvidence: repairNote.trim(),
    }) : issuesApi.retryWorkspaceExport(issueId, {
      actionId: action!.id, runId: action!.evidence.runId as string, repairNote: repairNote.trim(),
    }),
    onSuccess: () => { setQueuedActionVersion(String(action!.updatedAt)); onQueued(); },
    onError: error => { if (ownerRecovery && controllerChanged(error)) setStopped(false); },
  });
  if (!action || (!ownerRecovery && !isNativeWorkspaceExportRepairCause(action.cause)) || action.ownerType !== "board"
    || !["active", "escalated"].includes(action.status) || typeof action.evidence.runId !== "string") return null;
  if (ownerRecovery && typeof owner?.token !== "string") return null;
  const queued = !!action.evidence.workspaceOwnerStop || queuedActionVersion === String(action.updatedAt) || action.wakePolicy?.kind === "resume_native_run";
  const noteReady = repairNote.trim().length >= 20;
  const canSubmit = noteReady && (!ownerRecovery || stopped);
  const errorMessage = controllerChanged(retry.error)
    ? "This task changed during verification. Refresh the task and verify its current controller before trying again."
    : retry.error instanceof Error ? retry.error.message : "Could not request recovery. Refresh the task and inspect its run.";
  const guidance = !noteReady
    ? repairNote.trim() ? `Add more detail to the ${ownerRecovery ? "shutdown evidence" : "repair note"} (at least 20 characters).`
      : ownerRecovery ? "Add shutdown evidence and confirm shutdown to continue." : "Describe the repair to continue."
    : ownerRecovery && !stopped ? "Confirm that the controller and all copyback processes stopped." : "";
  return <section aria-label={ownerRecovery ? "Workspace finalization recovery" : "Workspace export repair"} className={cn("task-context-notice flex flex-col gap-3", className)}>
    <div className="flex flex-col gap-1">
      <p className="font-medium">{queued ? "Recovery requested" : "Finish saving the agent’s work"}</p>
      {queued ? <p role="status" className="text-muted-foreground">Recovery is queued for the saved result. The agent will not repeat its work.</p>
        : <p className="text-muted-foreground">The agent’s result is saved, but its workspace files still need to be copied back.</p>}
    </div>
    {!queued && <>
      {ownerRecovery ? <>
        <p>Use the deployment platform to verify that <span className="wrap-anywhere font-mono">{owner?.hostname}</span> and all its workspace-copyback processes have stopped. Keep the saved workspace intact.</p>
        <details className="text-muted-foreground">
          <summary className="cursor-pointer text-xs">Controller details</summary>
          <dl className="flex flex-col gap-1 py-2 text-xs">
            <dt>Controller</dt><dd className="min-w-0 wrap-anywhere font-mono">{owner?.hostname}</dd>
            <dt>Process ID</dt><dd className="font-mono">{owner?.pid}</dd>
            <dt>Started</dt><dd className="min-w-0 wrap-anywhere font-mono"><time dateTime={owner?.processStartedAt}>{owner?.processStartedAt}</time></dd>
          </dl>
        </details>
      </> : <p>Resolve the export failure and preserve the saved files in the retained sandbox before retrying.</p>}
      {canManage && (!ownerRecovery || canConfirmOwnerStop) ? <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={noteId}>{ownerRecovery ? "Shutdown evidence" : "Repair performed"}</Label>
          <Textarea id={noteId} value={repairNote} onChange={event => setRepairNote(event.target.value)} maxLength={12_000}
            className="text-base sm:text-sm" aria-describedby={helpId}
            placeholder={ownerRecovery ? "Deployment event or log confirming that this controller and its copyback processes stopped…" : "What did you repair, and how did you preserve the saved files?"} disabled={retry.isPending} />
        </div>
        {ownerRecovery && <div className="flex items-start gap-2">
          <Checkbox id={confirmationId} checked={stopped} onCheckedChange={value => setStopped(value === true)} disabled={retry.isPending} />
          <Label htmlFor={confirmationId} className="min-w-0 leading-normal">I verified that this controller and all its copyback processes have stopped.</Label>
        </div>}
        {retry.isError && <p role="alert" className="text-destructive">{errorMessage}</p>}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p id={helpId} className="min-w-0 text-xs text-muted-foreground">{retry.isPending ? "Requesting recovery for the saved result…" : guidance}</p>
          <Button className="self-end" onClick={() => retry.mutate()} disabled={retry.isPending || !canSubmit} aria-describedby={helpId}>
            {retry.isPending ? "Requesting…" : ownerRecovery ? "Resume saved result" : "Retry workspace export"}
          </Button>
        </div>
      </div> : <p className="text-muted-foreground">{ownerRecovery ? "A company owner or administrator must verify shutdown and resume this workspace." : "A board member with runtime access can recover this workspace."}</p>}
    </>}
  </section>;
}
