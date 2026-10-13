// One execution workspace per pipeline case (opt-in per stage automation).
//
// A stage automation with `executionWorkspaceScope: "case"` makes every stage task of a
// case share one execution workspace (one worktree and branch per case), instead of the
// default of one isolated workspace per stage task. The case records the workspace in
// `pipeline_cases.workspace_ref`:
//
//   { sourceIssueId }                        first scoped stage task created; its workspace is
//                                            realised when that task first runs
//   { sourceIssueId, executionWorkspaceId }  workspace known; later stage tasks reuse it
//
// The next scoped stage entry resolves `executionWorkspaceId` from the source issue, so no
// heartbeat hook is needed. The terminal-workspace reaper keeps a workspace that an open
// case references (see `pipelineCaseHoldsExecutionWorkspaceSql`).
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { executionWorkspaces, issues, pipelineCases } from "@paperclipai/db";
import type { IssueExecutionWorkspaceSettings, PipelineCaseWorkspaceRef } from "@paperclipai/shared";
import { issueExecutionWorkspaceModeForPersistedWorkspace } from "./execution-workspace-policy.js";

type DbReader = Pick<Db, "select" | "update">;

const CLOSED_WORKSPACE_STATUSES = new Set(["archived", "cleanup_failed"]);

function readId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function readPipelineCaseWorkspaceRef(value: unknown): PipelineCaseWorkspaceRef & Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export type PipelineCaseWorkspaceResolution =
  | {
      /** Reuse the case's live workspace for this stage task. */
      kind: "reuse";
      executionWorkspaceId: string;
      workspaceMode: string | null;
      /** New workspace_ref to persist (null when unchanged). */
      nextRef: Record<string, unknown> | null;
    }
  | {
      /** No usable case workspace: the stage task gets its own; record it afterwards. */
      kind: "fresh";
      record: boolean;
    };

/**
 * Decide which workspace a scoped stage task of this case uses.
 *
 * - A live workspace in `workspace_ref.executionWorkspaceId`, or the workspace of
 *   `workspace_ref.sourceIssueId`, is reused.
 * - A workspace from another project than the stage task's project is not reused, and the
 *   case keeps its ref (`record: false`).
 * - A missing, archived or closed workspace, or a source issue that never ran, means a
 *   fresh workspace; the caller records the new stage task as the case's source issue.
 *
 * Child cases have their own `workspace_ref` (it is not copied from the parent), so a child
 * case gets its own workspace.
 */
export async function resolvePipelineCaseWorkspace(
  db: DbReader,
  input: { companyId: string; workspaceRef: unknown; projectId: string | null },
): Promise<PipelineCaseWorkspaceResolution> {
  const ref = readPipelineCaseWorkspaceRef(input.workspaceRef);
  let workspaceId = readId(ref.executionWorkspaceId);
  const sourceIssueId = readId(ref.sourceIssueId);
  if (!workspaceId && sourceIssueId) {
    workspaceId = await db
      .select({ executionWorkspaceId: issues.executionWorkspaceId })
      .from(issues)
      .where(and(eq(issues.id, sourceIssueId), eq(issues.companyId, input.companyId)))
      .then((rows) => rows[0]?.executionWorkspaceId ?? null);
  }
  if (!workspaceId) return { kind: "fresh", record: true };

  const workspace = await db
    .select({
      id: executionWorkspaces.id,
      projectId: executionWorkspaces.projectId,
      mode: executionWorkspaces.mode,
      status: executionWorkspaces.status,
      closedAt: executionWorkspaces.closedAt,
    })
    .from(executionWorkspaces)
    .where(and(eq(executionWorkspaces.id, workspaceId), eq(executionWorkspaces.companyId, input.companyId)))
    .then((rows) => rows[0] ?? null);
  if (!workspace || workspace.closedAt || CLOSED_WORKSPACE_STATUSES.has(workspace.status)) {
    return { kind: "fresh", record: true };
  }
  if (input.projectId && workspace.projectId !== input.projectId) {
    return { kind: "fresh", record: false };
  }
  return {
    kind: "reuse",
    executionWorkspaceId: workspace.id,
    workspaceMode: workspace.mode,
    nextRef: readId(ref.executionWorkspaceId) === workspace.id ? null : { ...ref, executionWorkspaceId: workspace.id },
  };
}

/** Issue workspace fields that bind a stage task to the case's workspace. */
export function pipelineCaseWorkspaceIssueBinding(
  resolution: Extract<PipelineCaseWorkspaceResolution, { kind: "reuse" }>,
  baseSettings: IssueExecutionWorkspaceSettings | null,
) {
  return {
    executionWorkspaceId: resolution.executionWorkspaceId,
    executionWorkspacePreference: "reuse_existing" as const,
    executionWorkspaceSettings: {
      ...(baseSettings ?? {}),
      mode: issueExecutionWorkspaceModeForPersistedWorkspace(resolution.workspaceMode),
    } as IssueExecutionWorkspaceSettings,
  };
}

/** workspace_ref after a fresh scoped stage task: that task's workspace becomes the case's. */
export function pipelineCaseWorkspaceRefForSourceIssue(previous: unknown, sourceIssueId: string) {
  const {
    executionWorkspaceId: _executionWorkspaceId,
    sourceIssueId: _sourceIssueId,
    path: _path,
    ...rest
  } = readPipelineCaseWorkspaceRef(previous);
  return { ...rest, sourceIssueId };
}

/** Workspace-ref only: no version bump and no case event, like a workspaceRef-only patch. */
export async function writePipelineCaseWorkspaceRef(
  db: DbReader,
  input: { companyId: string; caseId: string; workspaceRef: Record<string, unknown> },
) {
  await db
    .update(pipelineCases)
    .set({ workspaceRef: input.workspaceRef as PipelineCaseWorkspaceRef, updatedAt: new Date() })
    .where(and(eq(pipelineCases.id, input.caseId), eq(pipelineCases.companyId, input.companyId)));
}

/**
 * True while a pipeline case holds this workspace: a case references it in workspace_ref
 * (by id, or by its source issue before the id is recorded) and the case is still open,
 * or the case is terminal but an issue bound to the workspace is still open.
 * Workspaces no case references are unaffected.
 */
export function pipelineCaseHoldsExecutionWorkspaceSql(workspace: {
  id: string;
  companyId: string;
  sourceIssueId: string | null;
}): SQL<boolean> {
  const sourceIssueMatch = workspace.sourceIssueId
    ? sql`OR held_case.workspace_ref ->> 'sourceIssueId' = ${workspace.sourceIssueId}`
    : sql``;
  // Parenthesised so `NOT ${...}` negates the whole predicate.
  return sql<boolean>`(EXISTS (
    SELECT 1
    FROM ${pipelineCases} held_case
    WHERE held_case.company_id = ${workspace.companyId}
      AND (
        held_case.workspace_ref ->> 'executionWorkspaceId' = ${workspace.id}
        ${sourceIssueMatch}
      )
      AND (
        (held_case.terminal_kind IS NULL AND held_case.retired_at IS NULL)
        OR EXISTS (
          SELECT 1
          FROM ${issues} bound_issue
          WHERE bound_issue.company_id = ${workspace.companyId}
            AND bound_issue.execution_workspace_id = ${workspace.id}
            AND bound_issue.status NOT IN ('done', 'cancelled')
        )
      )
  ))`;
}

export async function pipelineCaseHoldsExecutionWorkspace(
  db: DbReader,
  workspace: { id: string; companyId: string; sourceIssueId: string | null },
) {
  const rows = await db
    .select({ held: pipelineCaseHoldsExecutionWorkspaceSql(workspace) })
    .from(executionWorkspaces)
    .where(eq(executionWorkspaces.id, workspace.id))
    .limit(1);
  return rows[0]?.held === true;
}
