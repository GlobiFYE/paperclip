# Chat channel callback and delivery boundaries, batch four

Base: 4b766b872993045a2e787404f0475503683e5ded. Batch three (#15995, #15996, #15999, #16001, #16002)
is merged. The service starts at 26,461 lines / 1,046,711 bytes.
This batch may create up to ten stacked PRs. Merging the new batch is separate work.

| Order / boundary | Destination | Approx. moved / net lines | Contract and state | Risks and existing verification |
| --- | --- | --- | --- | --- |
| 1. Slack callback verification | `slack/callback-verification.ts` | 250 / 230 | Pure signature/workspace/URL inspection plus signed URL verification; explicit vault lookup, URL getter, scheduling and registration callbacks | Preserve signing-secret-only setup, original request, TLS/proxy evidence and workspace checks. Signed verification and callback health cases before/after. |
| 2. Discord Gateway events | `discord/gateway-events.ts` | 200 / 185 | Runtime fence and lease-owner predicates, endpoint lookup and lifecycle callback; original per-runtime event queue and sequence | Preserve stale-owner fencing, event order, transient guild recovery and terminal revocation. Gateway lifecycle cases before/after. |
| 3. Discord root threads | `discord/root-threads.ts` | 500 / 460 | Credential lease, current principal authority, runtime, message admission and conversation drain callbacks | Preserve uncertain thread creation, restart reconciliation, no duplicate starter and pause/credential serialization. Root-thread public-service cases. |
| 4. Receipt reactions | `receipt-reactions.ts` and Slack error classifier beside Slack messages | 545 / 500 | Durable reaction claim/transport/settlement with runtime and credential fences; no scheduling owner moves | Preserve retries, legacy GitHub receipts, terminal-removal supersession and same-attempt settlement. Receipt recovery cases before/after. |
| 5. Inbound reactions | `reactions.ts` | 800 / 740 | Conversation lookup/locks, reaction admission and deferred replay together; current principal/runtime callbacks | Preserve exact event dedupe, completed generation links, bounded replay age and no task wakeup. Reaction race/restart/authorization cases. |
| 6. Inbound attachments | `inbound-attachments.ts` | 600 / 550 | Existing storage and issue service, retained source authorization and live options; return same attachment results | Preserve size limits, source authority around I/O, omissions and text delivery. Provider attachment/restart/stale-authority cases. |
| 7. Outbound attachments | `outbound-attachments.ts`; provider Markdown wrappers beside provider messages | 245 / 220 | Metadata validation and bounded integrity-checked hydration; existing storage object. Keep public hydration export compatible | Preserve stream cleanup, deadlines, byte/digest checks and retry classification. Hydration and publication attachment cases. |
| 8. Provider effects | `provider-effects.ts` | 950 / 850 | Durable reply claim, authorization, transport and settlement; endpoint/runtime/credential/principal callbacks | Preserve uncertain-delivery quarantine, credential fence and transaction ordering. Native callback, task-control and reply recovery cases. Put Telegram-only authority under `telegram/` if its contract is narrow. |
| 9. Conversation and activity reads | `activity.ts` | 540 / 520 | Endpoint lookup and read-only Teams conflict projection; return existing API models | Preserve company/endpoint joins, mixed-source cursor ties, replay eligibility and read-only GETs. Activity, file receipt projection and conversation-state cases. |
| 10. Setup probes | `setup-probes.ts` | 280 / 250 | Credential lease, current identity/principal authority, provider fetch, endpoint projection and live activation hook | Preserve real-message requirement, generation and linked-user activation. Setup-test, reconnect and authorization cases. |

Each slice must earn its place after reading its complete path and callers.
Reassess before implementation; stop short of ten if the remaining contracts are
not cohesive. Keep provider-specific code in channel folders and common durable
workflows in the shared chat-channels directory.

Receiver lease ownership stays shared: the existing Discord-named owner is also
used by Photon. Shared lifecycle/application admission, queue-drain ownership,
worker scheduling, and the largest action/message handlers remain in the service.
Do not hide their dependencies in a mutable context object. Preserve live option
hooks, runtime-map identity, partial-failure cleanup, and initialization order.

Run relevant existing public-service tests before and after each mechanical move.
Compare moved declarations and remaining statements with normalized syntax, then
run server types, module boundaries and whitespace checks. Finish CI and a fresh
5/5 review before opening the next PR. Run cumulative repository gates at handoff.
Retain failures and skipped/unrun coverage even when an isolated retry passes.
Use fixture-backed assembled service/database tests; do not claim live provider
execution. Remap LOC/bytes and the remaining orchestration after the batch.

## Slice 1: Slack callback verification

- Service: 26,461 lines / 1,046,711 bytes → 26,201 lines / 1,035,260 bytes.
- Destination: 299 lines / 13,038 bytes. Eight declarations move without body
  changes. Three existing setup types move unchanged into `runtime-types.ts`.
- The verification factory initializes after Slack registration. It receives the
  same registration object, credential resolver, live URL getter and scheduler.
  Signature/workspace/URL helpers remain callable by shared webhook orchestration.
- Nine public-service cases passed before and after on the updated master base.
  Server typecheck, module boundaries, whitespace and normalized syntax parity
  passed. Coverage includes signed URL verification, account notification,
  workspace rejection, callback surfaces, TLS termination and Cloud host evidence.
- Next: Discord Gateway event sequencing and health transitions. Keep shared
  receiver lease ownership and runtime-map lifetime in the service.
