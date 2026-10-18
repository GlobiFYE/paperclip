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
// case holds (see `pipelineCaseHoldsExecutionWorkspaceSql`).
//
// `workspace_ref` is caller-editable (PATCH /cases/:caseId), so it is only a hint. A case
// reuses or holds a workspace only when one of its own scoped stage tasks is bound to that
// workspace: an automation issue link the server created, whose automation execution
// belongs to a stage of the case's pipeline that opts in to the case scope.
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  executionWorkspaces,
  issues,
  pipelineAutomationExecutions,
  pipelineCaseIssueLinks,
  pipelineCases,
  pipelineStages,
} from "@paperclipai/db";
import type { IssueExecutionWorkspaceSettings, PipelineCaseWorkspaceRef } from "@paperclipai/shared";
import { issueExecutionWorkspaceModeForPersistedWorkspace } from "./execution-workspace-policy.js";

type DbReader = Pick<Db, "select" | "update">;

const CLOSED_WORKSPACE_STATUSES = new Set(["archived", "cleanup_failed"]);

/**
 * True when a scoped stage task of the case (the `held_case` alias) is bound to the workspace.
 * Only server-created links count: an automation issue link whose automation execution
 * belongs to this case and to a stage of the case's pipeline whose automation opts in to
 * `executionWorkspaceScope: "case"` (the automation id matches `stageAutomation()` in
 * pipelines.ts). A manual issue link, a stage without the opt-in, or a hand-edited
 * workspace_ref does not tie a workspace to the case.
 */
function caseScopedStageTaskBoundSql(input: { companyId: string; workspaceId: string }): SQL<boolean> {
  return sql<boolean>`EXISTS (
    SELECT 1
    FROM ${pipelineCaseIssueLinks} held_link
    JOIN ${issues} held_issue
      ON held_issue.id = held_link.issue_id
      AND held_issue.company_id = ${input.companyId}
    JOIN ${pipelineAutomationExecutions} held_execution
      ON held_execution.id = held_link.automation_attempt_id
      AND held_execution.case_id = held_case.id
      AND held_execution.company_id = ${input.companyId}
    JOIN ${pipelineStages} held_stage
      ON held_stage.pipeline_id = held_case.pipeline_id
      AND held_stage.config -> 'onEnter' ->> 'executionWorkspaceScope' = 'case'
      AND COALESCE(held_stage.config -> 'onEnter' ->> 'id', held_stage.id::text || ':on_enter')
        = held_execution.automation_id
    WHERE held_link.company_id = ${input.companyId}
      AND held_link.case_id = held_case.id
      AND held_link.role = 'automation'
      AND held_issue.execution_workspace_id = ${input.workspaceId}
  )`;
}

async function caseStageTaskBoundToWorkspace(
  db: DbReader,
  input: { companyId: string; caseId: string; workspaceId: string },
) {
  const rows = await db
    .select({ bound: caseScopedStageTaskBoundSql(input) })
    .from(sql`${pipelineCases} held_case`)
    .where(sql`held_case.id = ${input.caseId} AND held_case.company_id = ${input.companyId}`)
    .limit(1);
  return rows[0]?.bound === true;
}

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
 *   `workspace_ref.sourceIssueId`, is reused, but only when a stage task of this case is
 *   bound to it. A ref to any other workspace (for example one set through the case update
 *   API) means a fresh workspace, and the caller records the new stage task.
 * - A workspace from another project than the stage task's project (including a project
 *   workspace for a project-free stage task) is not reused, and the case keeps its ref
 *   (`record: false`).
 * - A missing, archived or closed workspace, or a source issue that never ran, means a
 *   fresh workspace; the caller records the new stage task as the case's source issue.
 *
 * Child cases have their own `workspace_ref` (it is not copied from the parent), so a child
 * case gets its own workspace.
 */
export async function resolvePipelineCaseWorkspace(
  db: DbReader,
  input: { companyId: string; caseId: string; workspaceRef: unknown; projectId: string | null },
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
  if (!(await caseStageTaskBoundToWorkspace(db, {
    companyId: input.companyId,
    caseId: input.caseId,
    workspaceId: workspace.id,
  }))) {
    return { kind: "fresh", record: true };
  }
  // A project-free stage task must not land in a project workspace (and the reverse):
  // core rejects that run with source_scope_mismatch.
  if ((input.projectId ?? null) !== (workspace.projectId ?? null)) {
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
 * True while a pipeline case holds this workspace. All of these must hold:
 * - the case references it in workspace_ref (by id, or by its source issue before the id
 *   is recorded). The source issue match covers both directions: the workspace was
 *   realised for that issue (`source_issue_id`), or that issue was bound to an existing
 *   workspace (`execution_workspace_id`), in which case the workspace's own source issue
 *   differs. workspace_ref is caller-editable, so it only selects candidates;
 * - a scoped stage task of the case is bound to the workspace: an automation issue link
 *   the server created for a stage that opts in to `executionWorkspaceScope: "case"`
 *   (see `caseScopedStageTaskBoundSql`);
 * - the case is still open, or it is terminal but an issue bound to the workspace is
 *   still open.
 * Workspaces no case holds are unaffected.
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
        OR EXISTS (
          SELECT 1
          FROM ${issues} ref_issue
          WHERE ref_issue.company_id = ${workspace.companyId}
            AND ref_issue.id::text = held_case.workspace_ref ->> 'sourceIssueId'
            AND ref_issue.execution_workspace_id = ${workspace.id}
        )
      )
      AND ${caseScopedStageTaskBoundSql({ companyId: workspace.companyId, workspaceId: workspace.id })}
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
