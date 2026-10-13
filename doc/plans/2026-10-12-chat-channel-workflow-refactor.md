# Chat channel workflow refactor

The user authorized six hours of sustained work starting at 2026-10-13 02:14 UTC,
with a target of fewer than 8,000 lines in `server/src/services/chat-channels.ts`.
The starting commit is `7eaa9cfa9ce04398a5eb0211a86aacaaa01959dd`: 19,153 lines,
762,442 bytes. The preceding ten PRs are reviewed and green, but not yet merged.
The user authorizes publishing and merging reviewed changes to paperclipai/paperclip.

The previous plan prioritized too many small helper cuts. This plan prioritizes
complete workflows, provider ownership, and meaningful reductions per PR. Shared
transactions and admission policy belong in shared workflow modules. Provider
transport, envelope checks, setup, and native interactions belong in provider
folders. Do not put shared code in one provider's folder or use a mutable context
bag to move the entire service unchanged.

| Priority | Responsibility and destination | Estimated net reduction | Contract and state | Risk and verification |
| --- | --- | ---: | --- | --- |
| 1 | Native interaction callbacks and continuation: `interactions/`, `telegram/confirmation-actions.ts`, `discord/question-forms.ts` | 2,900 | Current actor/runtime/destination readers; durable token and interaction transactions; deferred wakeups. | Preserve token replay, audit order, provider acknowledgement, post-commit recovery, and live fault barriers. Existing public service, HTTP and real-database interaction tests before and after. |
| 2 | Endpoint configuration and provider setup: provider `setup.ts`, shared credential persistence/configuration | 1,600–2,200 | Credential lease and current endpoint; provider registration outcome; stable native identity. | Preserve fail-closed persistence, webhook/receiver ownership, partial setup cleanup, and credential rotation races. Existing setup and runtime tests. |
| 3 | Message admission and provider policy: shared intake workflow, GitHub message policy, provider envelope projections | 2,400–3,000 | Delivery claim and conversation/task admission; explicit provider policy results; per-service message provenance. | Preserve row locks, deduplication, author authority, task generations, attachments, and GitHub automatic/explicit admission. Existing real-database ingress and replay tests. |
| 4 | Durable delivery and lifecycle: shared queue, provider lifecycle inputs | 1,700–2,000 | Conversation leases, replay decode, ordered drains, mutation reconciliation; shared live receipt state. | Preserve stale lease exclusion, event order, deletion/edit races, deferred startup and shutdown. Existing concurrency and lifecycle tests. |
| 5 | Outbound publication: provider delivery modules and shared publication worker | 2,700–3,400 | Current-source authorization; exact transport parts; attempts, unknown outcomes, completion receipts and cleanup. | Preserve no duplicate sends, ambiguous acceptance, credential fencing, file recovery, concurrency and current task-control completion. Existing assembled publication and file tests. |
| 6, if needed | Operator recovery and endpoint projections | 800–1,200 | Explicit replay/resolution and company-scoped board calls. | Preserve retry audit, current policy and authorization. Existing operator-resolution integration tests. |

The estimates are not a PR quota. Inspect every full execution path before moving
it. Increase size only where a cohesive responsibility has a narrow contract.
After every reviewed slice, remap the remaining file and report the measured size.

For each slice: run a behavioral baseline before editing production; retain
existing bodies and SQL; compare normalized AST and statement order; run server
typecheck, module boundaries and public-path tests. Review all intentional callback
and dispatch substitutions. Preserve live option reads with getters or callbacks.
Keep per-service state per service and shared cache/lease ownership shared.

Open one PR per cohesive extraction with the full repository template. Verify its
current-head review and all CI gates before opening the next extraction. Build each
on its immediate predecessor. Run repository-wide typecheck, tests and build once
at the final handoff; investigate and disclose any failures or unreached coverage.
The earlier batch recorded local timing/host cleanup failures; green CI and passing
focused retries do not erase that evidence. No timeout or assertion weakening.

Public application fixtures prove assembled service/HTTP/database behavior. They
do not prove live third-party execution. Use only owned fixture data and processes.

## First extraction

The native interaction workflow reduces the service from 19,153 to 16,117 lines
and from 762,442 to 656,146 bytes. Telegram owns confirmation resolution and
settlement. Discord owns correction draft retention and accepted-answer cleanup.
Shared callbacks retain token/source/actor checks and atomic question resolution.
Shared continuation work retains durable wakeup recovery. SDK state persistence
has a direct module import and retains the public compatibility export.

The same 62 public-path interaction cases pass before and after. Seven supporting
suites pass all 70 cases. Server typecheck and module boundaries pass. AST checks
cover nine moved declarations, three provider bodies, and retained service order.
Fault barriers remain live getters. No assertion or timeout changed.

## Second extraction

Endpoint configuration and provider setup reduce the service to 14,241 lines and
580,227 bytes. Shared modules own endpoint records, credential identity/persistence,
and the credential-leased configuration state machine. Channel folders own Telegram
registration, GitHub repair, Speko tool installation, Photon configuration and
inspection, and Slack setup projection. Registration dependencies remain live.

All 1,278 chat cases passed on the first PR before this move. The final setup wiring
passes 268 selected integration cases, server typecheck, and module boundaries.
AST checks cover 25 declarations and nine provider bodies. One final test attempt
could not start PostgreSQL because this Mac exhausted IPC slots; after reclaiming
one unused zero-attachment segment with a dead creator, the same suite passed.

## Third extraction

The publication workflow reduces the service to 11,198 lines and 462,108 bytes.
Authorization, durable preparation, transport, failures, attempt ownership, task
control completion, and bounded endpoint scheduling now have named modules.
Photon owns prompt and reply delivery. Discord and Telegram own durable Markdown
attachment preparation. Shared native splitting remains shared across providers.

The same 301 public-path publication cases pass before and after. Eight supporting
suites pass all 185 cases. Server typecheck, module boundaries, and AST checks pass.
The AST audit covers 26 declarations, three provider bodies, and retained service
order. Shared endpoint lanes and Teams cooldowns retain their original maps;
shutdown and publication wake listeners stay live. Early callback registration
uses typed forwarding functions instead of reading factories before initialization.
