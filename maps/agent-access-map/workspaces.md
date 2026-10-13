# Execution workspaces, services, and files — agent access

Product map: [Execution workspaces, services, and files](../feature-map/workspaces.md).

Review date: 2026-10-12. Source commit: `58e16dbddfc9c8d0cf60867f9d9847f0feda055b`.
Native REST transport reconciled in this change; see the
[shared transport contract](README.md#native-rest-transport).

This is a source-reviewed baseline of representative operations and known gaps.
Each capability needs operation-level review before its entire scope can be
qualified. No live agent execution is claimed. Follow the [map contract](../README.md)
for format, permission checks, evidence and maintenance.

## `binding`

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/issues/{id}/heartbeat-context`.
- `GET /api/execution-workspaces/{id}`.

Agent access: `available` — Native get_task_context / REST / CLI / MCP workspace read.

Policy: Company/project/workspace visibility and runtime authority; active run, trust
preset and task ownership where required.

Evidence: `source-only` —
[implementation](../../server/src/routes/workspace-runtime-service-authz.ts#L76) at the
reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Run/task context identifies its actual realized workspace; record existence is not
a running service.

## `provisioning`

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/execution-workspaces/{id}`.
- `GET /api/execution-workspaces/{id}/workspace-operations`.

Agent access: `partial` — REST / native call_api reads; task/project assignment triggers
server provisioning.

Policy: Company/project/workspace visibility and runtime authority; active run, trust
preset and task ownership where required.

Evidence: `source-only` —
[implementation](../../server/src/routes/workspace-runtime-service-authz.ts#L76) at the
reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Observing readiness exists. Creating host commands or arbitrary provision targets
is a separate protected operation.

## `services`

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/execution-workspaces/{id}/runtime-services/{action}`.

Agent access: `available` — Authorized agent REST / native `call_api` / CLI runtime
service controls and existing stdio MCP controls.

Policy: Company/project/workspace visibility and runtime authority; active run, trust
preset and task ownership where required.

Evidence: `source-only` —
[implementation](../../server/src/routes/workspace-runtime-service-authz.ts#L76) at the
reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: No dedicated production control_workspace_service binding. Generic native
calls retain runtime trust and workspace/task scope checks. Optional MCP availability
must be recorded.

## `files-git`

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/issues/{issueId}/file-resources/content`.
- `GET /api/issues/{issueId}/file-resources/list`.

Agent access: `partial` — Authorized workspace filesystem tools; Dot workspace bridge
when enabled; board file-resource HTTP UI.

Policy: Company/project/workspace visibility and runtime authority; active run, trust
preset and task ownership where required.

Evidence: `source-only` —
[implementation](../../server/src/routes/workspace-runtime-service-authz.ts#L76) at the
reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Files panel HTTP requires board. Agents can use their admitted workspace file
tools; remote/Dot scope and Git command availability differ.

## `closure`

Review: `baseline`.

API: `present` — representative operation IDs:

- `PATCH /api/execution-workspaces/{id}`.
- `GET /api/execution-workspaces/{id}/close-readiness`.
- `POST /api/execution-workspaces/{id}/reconcile-branch`.

Agent access: `partial` — REST / native fallback for permitted update; CLI workspace;
reconcile-branch requires board.

Policy: Company/project/workspace visibility and runtime authority; active run, trust
preset and task ownership where required.

Evidence: `source-only` —
[implementation](../../server/src/routes/workspace-runtime-service-authz.ts#L76) at the
reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Closure/readiness exists; not every workspace can be reopened, and branch
reconciliation has a board boundary.
