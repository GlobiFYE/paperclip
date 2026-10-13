# Recovery — agent access

Product map: [Recovery](../feature-map/recovery.md).

Review date: 2026-10-12. Source commit: `58e16dbddfc9c8d0cf60867f9d9847f0feda055b`.
Native REST transport reconciled in this change; see the
[shared transport contract](README.md#native-rest-transport).

This is a source-reviewed baseline of representative operations and known gaps.
Each capability needs operation-level review before its entire scope can be
qualified. No live agent execution is claimed. Follow the [map contract](../README.md)
for format, permission checks, evidence and maintenance.

## `diagnosis`

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/issues/{id}/diagnostics/blockers`.
- `GET /api/issues/{id}/recovery-actions`.

Agent access: `available` — REST / native call_api; CLI issue diagnostics.

Policy: Task/run visibility, run ownership and source/action policy; workspace export
retry and some operator controls require board.

Evidence: `source-only` — [implementation](../../server/src/routes/issues.ts#L9478) at
the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Diagnostics expose recorded cause and boundaries; source-backed reading does not
prove successful recovery.

## `bounded-continuation`

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/issues/{id}/recovery-actions/resolve`.

Agent access: `partial` — Eligible agent REST / native `call_api` / CLI under
source-bound recovery authority.

Policy: Task/run visibility, run ownership and source/action policy; workspace export
retry and some operator controls require board.

Evidence: `source-only` — [implementation](../../server/src/routes/issues.ts#L9478) at
the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Eligible resolutions use native `call_api`. The route retains owner and
management authority, active-run/source-trust checks, board-only outcomes and
reconciliation controls.

## `source-action`

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/issues/{id}/recovery-actions/resolve`.

Agent access: `partial` — Eligible agent REST / native `call_api` / CLI; source-bound
recovery state.

Policy: Task/run visibility, run ownership and source/action policy; workspace export
retry and some operator controls require board.

Evidence: `source-only` — [implementation](../../server/src/routes/issues.ts#L9478) at
the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Permitted resolutions use native `call_api` under existing eligibility
and ownership checks. Source/action policy determines whether continuation is allowed.

## `exhaustion`

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/issues/{id}/recovery-actions`.
- `GET /api/heartbeat-runs/{runId}`.

Agent access: `partial` — REST / native call_api reads; operator escalation flow.

Policy: Task/run visibility, run ownership and source/action policy; workspace export
retry and some operator controls require board.

Evidence: `source-only` — [implementation](../../server/src/routes/issues.ts#L9478) at
the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Reading exhaustion is supported. Continuing past the recorded gate requires the
specified owner/action.

## `workspace`

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/issues/{id}/recovery-actions/retry-workspace-export`.
- `POST /api/execution-workspaces/{id}/reconcile-branch`.

Agent access: `restricted` — Board/runtime management APIs; agent reads diagnosis and
performs permitted workspace work.

Policy: Task/run visibility, run ownership and source/action policy; workspace export
retry and some operator controls require board.

Evidence: `source-only` — [implementation](../../server/src/routes/issues.ts#L9478) at
the reviewed commit above.

Verification: `not-run` — assert the documented agent denial with an owned test fixture;
verify any listed agent request/result path separately. A delegated operation needs its
own policy and access review.

Gaps: Export retry and branch reconciliation require board runtime:manage at
their HTTP routes. Native `call_api` preserves these denials.

## `unknown-outcome`

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/chat-endpoints/{endpointId}/publications/{publicationId}/resolve`.

Agent access: `restricted` — Board provider-outcome resolution; agent may inspect
assigned provider tools.

Policy: Task/run visibility, run ownership and source/action policy; workspace export
retry and some operator controls require board.

Evidence: `source-only` — [implementation](../../server/src/routes/issues.ts#L9478) at
the reviewed commit above.

Verification: `not-run` — assert the documented agent denial with an owned test fixture;
verify any listed agent request/result path separately. A delegated operation needs its
own policy and access review.

Gaps: Uncertain-side-effect resolution is operator/source-specific; do not replay to
obtain apparent parity.

## `user-continuation`

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/issues/{id}/comments`.

Agent access: `partial` — User comment API and server-owned wake reconsideration; native
agent consumes bound wake.

Policy: Task/run visibility, run ownership and source/action policy; workspace export
retry and some operator controls require board.

Evidence: `source-only` — [implementation](../../server/src/routes/issues.ts#L9478) at
the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Receiving the continuation is supported; impersonating a saved user message or
retry control is not.

## `reconnect`

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/companies/{companyId}/events/ws`.
- `GET /api/issues/{id}`.

Agent access: `partial` — Existing event protocol; REST refresh of persisted task state.

Policy: Task/run visibility, run ownership and source/action policy; workspace export
retry and some operator controls require board.

Evidence: `source-only` — [implementation](../../server/src/routes/issues.ts#L9478) at
the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Streaming reconnect needs its protocol client. Polling/read APIs remain available;
replay is not proof of a fresh successful action.
