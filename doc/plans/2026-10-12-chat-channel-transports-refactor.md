# Chat channel transport workflows, batch three

Base: `a2ac5c27157ab033a2e0e2731b1b8e35bf20e7b9`. The preceding stack
(#15976, #15979, #15981, #15985, #15987) is merged. The original service is
29,897 lines / 1,170,080 bytes. This batch creates five stacked PRs; merging is
separate work.

| Order / boundary | Destination | Approximate lines moved / net reduction | Inputs and outputs | State and effects | Verification |
| --- | --- | --- | --- | --- | --- |
| 1. Slack session status | `chat-channels/slack/session-status.ts` | 342 / 330 | Endpoint lookup, credential lease, runtime fence, publication run identity, credentials and fetch; return processed count | Claim and settle existing durable status actions. Keep selected revision, attempt ownership and live test barrier. No worker or new state. | Existing public-service status, restart, rate-limit, concurrent selection, stop and Idle cases before/after. |
| 2. Slack accepted-file receipts | `chat-channels/slack/file-receipts.ts` | 900 / 840 | Runtime/credential authorization, publication eligibility and endpoint lookup; record/recover accepted upload receipts | Preserve same-attempt leases, exact receipt identities, publication links and transaction boundaries. Keep generic publication transport shared. | Existing upload recovery, competing retry deadline, revoked reach and no-duplicate-upload cases before/after. |
| 3. Telegram publication drafts | `chat-channels/telegram/publication-drafts.ts` | 394 / 370 | Current runtime and callback fence, source publication authority; reserve draft or handle stopped generation | Preserve runtime map identity, stop scope, draft revision and transactional invalidation. Keep maintenance and shared publication admission in their existing owners. | Existing durable private draft Stop, stale generation and publication recovery cases before/after. |
| 4. Photon incoming events and responses | `chat-channels/imessage-photon/events.ts` | 870 / 820 | Endpoint/runtime callbacks, principal authorization, question delivery and shared inbound admission | Preserve receiver sequence/lease checks, native interaction binding, transaction ordering and deferred publication. No receiver/startup ownership move. | Existing Photon public-service integration suite before/after. |
| 5. Teams file-transfer workflow | `chat-channels/microsoft-teams/file-transfers.ts` | 1,400 / 1,250 | Source proof, runtime/credential fence, principal authorization, publication hydration; consent and transfer protocol | Keep authority proof and transfer protocol together. Preserve map lifetimes, scheduling cooldowns, no-wait locks and cleanup ownership. | Existing Teams current file authority, consent, composed Board transfer and stale-runtime cases before/after. |

Use named, typed contracts and channel folders. Keep shared message admission,
provider startup/shutdown, generic publication transport and shared authorization
in the service. Do not introduce a mutable context bag or a runtime import back
to the service. Reconsider a candidate if its actual dependency contract proves
too broad.

For each slice, inspect its execution path and callers, run baseline tests, move
mechanically, compare normalized syntax, rerun the same public entry-point tests,
and check server types and module boundaries. Finish CI and current-head review
before opening the next PR. Run broad local gates once at the cumulative handoff.
Record failures and skipped groups accurately; a retry does not erase a failed
run. Fixtures exercise assembled services and persistence, not live providers.

The starting service function is 27,835 lines. Its 212 nested functions span
27,146 lines; 51 wiring/state/API statements span 435 lines. Imports span 423
lines. The largest shared function remains `processMessage` at 2,166 lines.
Remap these measurements after the fifth extraction and stop at five PRs.

## Slice 1: Slack session status

- Service: 29,897 lines / 1,170,080 bytes → 29,553 lines / 1,156,944 bytes.
- Destination: 408 lines / 15,730 bytes. The durable claim, provider status call
  and conditional settlement remain in one function. No state or worker moves.
- All six selected public-service cases passed before and after. They exercise
  restart/rate-limit recovery, stale selection, Stop and publication-driven Idle.
  Server typecheck, module boundaries, whitespace and normalized syntax parity
  passed. The selection hook remains live through an options getter.
- Next: accepted-file receipt recovery. Keep the generic outbound publication
  link writer shared and pass it as a typed callback to the Slack module.
