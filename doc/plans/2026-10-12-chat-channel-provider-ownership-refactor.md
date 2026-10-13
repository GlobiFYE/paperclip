# Chat channel provider ownership refactor

Date: 2026-10-12. Batch five starts at `4b958ecbd8f33a7782fe6f29ec825f80f636b833`.

The user requested another stack of about ten PRs. Put provider-specific code in
the provider's existing folder. Preserve behavior and build each PR on the previous
verified extraction. This batch does not authorize merging the new stack.

The starting service is 21,460 lines and 862,284 bytes. The previous ten PRs are
merged. Common admission, runtime ownership, and publication scheduling stay in
the service. In particular, the receiver lease currently serves both Discord and
Photon; its Discord names do not make it a Discord-only boundary.

| Order | Responsibility and destination under `server/src/services/chat-channels/` | Approximate source lines | Contract and state | Risks and verification |
| --- | --- | ---: | --- | --- |
| 1 | Credential verification: provider `credentials.ts` files | 250 | Credentials, fetch, timeout; return verified bot identity. Photon inspection retains its error translation. | Preserve scope/event checks and immutable identity. Existing configuration, credential, and Photon tests. |
| 2 | Inventory discovery: `slack/inventory.ts`, `github/inventory.ts`, `discord/inventory.ts` | 120 | Credential input and prepared inventory result. Slack label hydration uses the same endpoint reader. | Preserve GitHub installation discovery and canonical repository IDs; same public resource tests. |
| 3 | GitHub secret rotation: `github/setup-secret.ts` | 278 | Endpoint reader, credential lease, credential storage, runtime invalidation, and audit. | Keep lease checks, commit recovery, and audit ordering intact; real database rotation/race tests. |
| 4 | Teams file delivery: `microsoft-teams/file-delivery.ts` | 360 | Transfer protocol and consent callback; shared runtime readers and retry cooldown. Maintenance state remains per service. | Preserve exact transfer authority, unknown outcomes, consent races, and live shutdown state; assembled file-delivery tests. |
| 5 | Native slash callbacks: `slack/commands.ts`, `telegram/commands.ts` | 340 | Provider command callbacks use shared admission and durable effects. Dispatcher retains callback admission. | Preserve synthetic Telegram media/time, Slack acknowledgment, identity linking, and duplicate receipts. |
| 6 | Telegram attachment failure: `telegram/attachment-failure.ts` | 106 | Accepted inbound delivery and attachment result; return whether it settled. | Keep comment/action/delivery writes atomic and avoid waking an agent with no usable content. |
| 7 | GitHub publication preparation and settlement: `github/publication-policy.ts` | 235 | Current source proof, explicit operator classifier, receipt cleanup, and task URL getter. | Preserve prepared-text receipts and governed-tool fallback suppression; publication/review integration tests. |
| 8 | Slack task tool authority: `slack/task-authority.ts` | 170 | Register resolver with current endpoint/credential and inbound authorization readers; return unregister callback. | Preserve lock order, responsible-user authority, company scope, and shutdown cleanup; existing Slack tool tests. |
| 9 | GitHub App setup: `github/app-setup.ts` | 180 | App persistence, repository refresh, registration/wizard assembly, and cloud ingress registration. | Preserve live origins, credential leases, ingress fences, and unregister ownership; setup and wizard integration tests. |
| 10 | GitHub installation lifecycle: `github/installation-lifecycle.ts` | 430 | Admitted lifecycle delivery, locked credential lease, identity/inventory readers; explicit runtime outcomes and failure notification. | Keep claim/retry ownership in the shared coordinator. Preserve failure notification before throwing; deletion/reinstall/race tests. |

These estimates include code that stays behind as dispatch and typed wiring. Each
slice must be reassessed before implementation. Do not introduce an untyped context
bag, copy mutable live values, or change algorithms to meet a line-count target.

Run existing public-path tests before production edits and after each extraction.
Compare moved declarations and retained statements with normalized TypeScript
syntax; review every deliberate dispatch substitution. Run server typecheck and
module boundaries for each slice, and repository typecheck, full tests, and build
once at the final handoff. Record failures and omitted checks without claiming they
passed. Local fixtures prove assembled application behavior, not live third-party
execution. Use the same managed checkout for dependency preflight and builds.

Every PR uses the repository template and points to its preceding stack branch.
Check current-head Greptile feedback and CI before completing each slice. Update
this plan with evidence and a fresh map after the batch.
