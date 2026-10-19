# Costs, budgets, and spending controls — agent access

Product map: [Costs, budgets, and spending controls](../feature-map/budgets-costs.md).

Review date: 2026-10-12. Source commit: `f981fa3cc10cb8663a87dec60345fbff46d54d0a`.

This is a source-reviewed baseline of representative operations and known gaps.
Each capability needs operation-level review before its entire scope can be
qualified. No live agent execution is claimed. Follow the [map contract](../README.md)
for format, permission checks, evidence and maintenance.

## `cost-reporting`

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/companies/{companyId}/costs/summary`.
- `GET /api/companies/{companyId}/costs/by-agent`.

Agent access: `available` — REST / native call_api / CLI cost.

Policy: Reading costs uses company/resource cost policy. Budget policies and incident
resolution require a board actor.

Evidence: `source-only` — [implementation](../../server/src/routes/costs.ts#L346) at the
reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Cost visibility applies. Provider accounting imports and quota-window inspection
have additional board gates.

## `budgets`

Review: `baseline`.

API: `present` — task operations:

- `GET /api/issues/{id}/budget`.
- `PATCH /api/issues/{id}/budget` with an expected revision per changed metric.
- Task creation and `create_task` accept optional dollar/token caps atomically.
- Existing company/project/agent policies use the budget policy endpoints.

Agent access: `partial` — task reads/updates use REST, native call_api, and CLI
`cost budget task` / `task:update`; native get_task_context includes the summary.

Policy: Company and task read authorization applies. Board actors supply outer
funding and may remove caps. An active registered run owning a strict ancestor
may allocate another worker's descendant caps within remaining enclosing funds,
subject to task assignment authority. Workers cannot increase their own caps,
escape their funding branch, or certify missing runtime usage. Company/project/
agent policy changes and incident decisions remain board-only.

Evidence: `source-only` — [routes](../../server/src/routes/costs.ts),
[policy authority](../../server/src/services/task-budgets.ts), and
[database integration tests](../../server/src/__tests__/task-budgets.test.ts).
The database tests exercise allowed/denied actors; they are not an agent credential
acceptance claim.

Verification: `not-run` — read through an actual run, allocate a child's cap, reject self
funding and stale revisions, and verify persisted ancestry and enforcement.

Gaps: Live qualification is configuration-specific. Dollar caps require an
authoritative billed-cost receipt or proven included billing; token caps require
complete canonical usage. Unsupported and missing metering hold execution.

## `incidents`

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/companies/{companyId}/budgets/overview`.

Agent access: `available` — REST / native call_api for allowed visibility.

Policy: Reading costs uses company/resource cost policy. Budget policies and incident
resolution require a board actor.

Evidence: `source-only` — [implementation](../../server/src/routes/costs.ts#L346) at the
reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Inspection is supported; hard-stop or pause relief does not follow from seeing the
incident.

## `resolution`

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/companies/{companyId}/budget-incidents/{incidentId}/resolve`.

Agent access: `restricted` — Board resolution API; agent requests the authorized
person's action.

Policy: Reading costs uses company/resource cost policy. Budget policies and incident
resolution require a board actor.

Evidence: `source-only` — [implementation](../../server/src/routes/costs.ts#L346) at the
reviewed commit above.

Verification: `not-run` — assert the documented agent denial with an owned test fixture;
verify any listed agent request/result path separately. A delegated operation needs its
own policy and access review.

Gaps: A governance-policy decision is needed before delegating budget increases or
incident resolution.
