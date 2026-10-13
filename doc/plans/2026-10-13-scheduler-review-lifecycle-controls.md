# Scheduler review follow-up: lifecycle controls and settings contracts

## Findings addressed

The full repository CI exposed strict server and UI settings fixtures that did not include the opt-in scheduler flag. The feature-module checker also rejected importing the database implementation from application ports. Independent review found that parked wakes were missing from dependency-ready deduplication and cancellation selectors.

## Changes

- Keep the strict settings assertion and typed UI fixture; add the default-false scheduler field and an opt-in persistence regression.
- Parameterize the application writer/use case by an opaque transaction type. Keep the concrete database type in the adapter layer. Do not add a boundary-check exemption.
- Include `agent_runnable` in both dependency-ready idempotency sets, active/queued execution-path checks and disposition-repair reads. Preserve company, blocked-cycle and legacy-key rules; cancelled work is not an in-flight dependency wake.
- Include parked work in company, agent, project and subtree cancellation. Preserve existing budget enforcement/cutoff checks, scope isolation and null-run guards. Recheck pending status and null run on the agent cancellation write so a concurrently claimed run is not silently cancelled only at its wake row.
- Expand the dedicated verification workflow to cover these affected contracts and UI typechecking, not just the scheduler module.

## Evidence and limits

Local isolated PostgreSQL tests passed for repeated dependency-ready recovery, all three budget scopes, cutoff preservation, agent stop/resume and subtree isolation. Pure settings and dependency-key tests also passed. These tests use fresh databases and a simulated provider; no production data, tokens or external model calls are used.

The limited local source archive did not include CLI sources required by the repository-wide boundary checker. Its missing-source error is not a PASS. The complete-checkout hosted workflow remains the gate for module boundaries, frozen-lockfile tests, server build/typecheck and UI typecheck on the published SHA.

The prior scheduler-only workflow passed 63 tests but did not cover these cross-cutting contracts. Broader upstream checks, independent review, production PostgreSQL/runtime compatibility, backup/rollback and rollout approval remain separate gates. No production deployment is implied by this document.
