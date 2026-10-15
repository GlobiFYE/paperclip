import { and, eq } from "drizzle-orm";
import { environmentLeases, heartbeatRuns, issues, nativeRunFinalizations, type Db } from "@paperclipai/db";
import { recordRequiredWorkspaceRestoreFailure } from "../legacy-execution-recovery.js";
import { hasRequiredWorkspaceRecovery } from "../workspace-restore-recovery-state.js";
import { logActivity } from "../activity-log.js";
import { readNativeWorkspaceSyncReference } from "./native-workspace-sync.js";
import { NativeWorkspaceFinalizationBusyError } from "./native-workspace-finalization-ownership.js";

export async function preserveNativeFailedWorkspace(db: Db, selected: typeof heartbeatRuns.$inferSelect, options: { allowPreterminal?: boolean } = {}) {
  if (readNativeWorkspaceSyncReference(selected.runnerProfileJson?.nativeWorkspaceSync)?.state !== "prepared") return;
  const issueId = selected.nativeIssueId ?? selected.issueId ?? selected.contextSnapshot?.issueId;
  if (typeof issueId !== "string") return;
  return db.transaction(async tx => {
    const [task] = await tx.select({ id: issues.id }).from(issues).where(and(
      eq(issues.id, issueId), eq(issues.companyId, selected.companyId),
    )).for("update");
    if (!task) return;
    const [coordinator] = await tx.select().from(nativeRunFinalizations).where(and(
      eq(nativeRunFinalizations.runId, selected.id), eq(nativeRunFinalizations.companyId, selected.companyId),
      eq(nativeRunFinalizations.issueId, issueId),
    )).for("update");
    if (coordinator?.leaseOwner) throw new NativeWorkspaceFinalizationBusyError();
    if (!coordinator || coordinator.resultId
      || !(options.allowPreterminal ? ["observed", "terminal_failure"] : ["terminal_failure"]).includes(coordinator.phase)) return;
    const [run] = await tx.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.id, selected.id), eq(heartbeatRuns.companyId, selected.companyId),
    )).for("update");
    if (!run || run.runtimeMode !== "native" || (!options.allowPreterminal && run.status !== "failed")
      || hasRequiredWorkspaceRecovery(run.resultJson)) return;
    const reference = readNativeWorkspaceSyncReference(run.runnerProfileJson?.nativeWorkspaceSync);
    if (!reference || reference.state !== "prepared") return;
    const [source] = await tx.select().from(environmentLeases).where(and(
      eq(environmentLeases.id, reference.leaseId), eq(environmentLeases.companyId, run.companyId),
      eq(environmentLeases.heartbeatRunId, run.id), eq(environmentLeases.providerLeaseId, reference.providerLeaseId),
    )).limit(1);
    if (!source || source.issueId !== issueId || source.metadata?.remoteCwd !== reference.remoteCwd
      || (source.executionWorkspaceId && source.executionWorkspaceId !== reference.workspaceId)) return;
    const retained = await recordRequiredWorkspaceRestoreFailure(tx as unknown as Db, run, { workspaceRestoreFailure: "restore_failed" }, source);
    if (!retained || !hasRequiredWorkspaceRecovery(retained.resultJson)) return;
    await logActivity(tx as unknown as Db, {
      companyId: run.companyId, actorType: "system", actorId: "native-workspace-recovery",
      action: "issue.workspace_recovery_required", entityType: "issue",
      entityId: issueId,
      agentId: run.agentId, runId: run.id,
      details: { runId: run.id, leaseId: source.id, reason: "native_execution_failed_before_workspace_export" },
    });
    return retained;
  });
}
