# Decisions: Confirm all

Implemented against frozen Plan G on 2026-10-12. The button uses the current
filtered active desk, including rows below the incremental rendering window.
Snoozed, dismissed, archived and aging shelves are excluded. Full approvals and
issue interactions are loaded before planning, with one interaction request per
issue and at most four concurrent reads. A failed read makes that item ineligible.

The dialog freezes the planner's actions and individually required items when it
opens. Every write re-reads the full record and compares its fingerprint. Writes
are sequential, failures do not stop later items, and the final counts stay on the
Decisions page. Existing endpoints do not accept an expected record version, so
the read/write race cannot be eliminated by this UI change.

## Eligibility and deviations from the requested scope

- Only pending `hire_agent` approvals qualify among approvals.
- `DecisionOption.style = "default"` is presentation, not a recommended answer.
  Ordinary decision options have no recommendation/default-answer flag and stay
  individual. No server contract is changed.
- Recovered `ask_user_questions.payload.questionSet` does preserve explicit
  `options[].recommended` flags. Every stored question must match that canonical
  presentation and have a recommendation. A single choice requires exactly one
  flag; multiple choices use the explicitly flagged set. These question schemas
  have no min/max selection fields. Free-text answers, missing recommendations,
  mismatched presentations and ambiguous single choices are excluded. Legacy
  questions without `questionSet` stay individual. Answers must also fit the
  existing respond endpoint's limit of 20 questions.
- **Confirmation target/subtype allowlist: empty.** The creator audit below found
  no discriminator that establishes a simple low-risk owner confirmation.
  Consequently both confirmation kinds stay individual, even when checkbox
  defaults satisfy their bounds. This is the conservative deviation required by
  G-04; enabling them needs an audited server-owned simple-confirmation subtype,
  which is outside this work order's server-change scope. Untargeted cards are
  not a safe substitute: they can carry merge consent.

## Confirmation creator audit

All source paths are relative to this checkout. Searches covered both literal
confirmation kinds and the dynamic interaction creation entry points in
`server/src`. Read, resolution, publication, continuation and hydration sites do
not establish additional safe creation subtypes.

| Creator | Target key / payload | Disposition |
| --- | --- | --- |
| `services/tool-gateway.ts`, tool-action creation | `tool-action:<id>`; `toolAction` | Governed tool execution; excluded |
| `services/tool-gateway.ts`, user authorization creation/reopening | `connection:<uid>:user:<id>` | Connection authorization; excluded even without enrichment |
| `services/tool-access.ts`, OAuth interaction creation/reopening | `connection:<uid>:user:<id>` | Connection authorization; excluded |
| `services/secret-proposals.ts`, secret-binding creation | `secretProposal` (no target required) | Governed secret binding; excluded |
| `services/native-runtime/status-decision-committer.ts`, `bind_reviewer` | `native_completion_review` | Completion review verdict; excluded |
| `services/native-runtime/native-session-executor.ts`, provider plan synchronization | `issue_document` / `plan` | Plan review; excluded |
| `services/native-runtime/paperclip-runner-tool-authority.ts`, `request_human_input` | Caller-supplied target, or inferred `issue_document` / `plan`; supports both confirmation kinds | No guaranteed safe subtype; excluded |
| `routes/issues.ts`, POST interactions | Caller-supplied target or none; both confirmation kinds | Generic creation; excluded |
| `services/plugin-host-services.ts`, `createInteraction` | Plugin-supplied interaction | Generic creation; excluded |
| `services/issue-thread-interactions.ts`, `create` | Validates/inserts generic inputs above; both confirmation kinds | No additional safe subtype |

Other governed uses reinforce why generic cards cannot be allowlisted:
`services/issue-thread-interactions.ts` recognizes merge consent from confirmation
prose/PR references, including cards without a target. `services/change-consent-gate.ts`
consumes confirmations for `agent:<id>:instructions`, `agent:<id>:profile`,
`skill:<id>`, `skills:import:<source>`, `skills:scan-projects` and their legacy
`reflection-coach:*` aliases. These are mutation consent, not simple yes/no input.
The onboarding and agent-conversation instructions also create revision-bound
`plan` reviews through the generic APIs.

Full-payload validation rejects `toolAction`, `secretProposal`,
`connectionAuthorization` and `effectiveResolverPolicySource = governed_action`
before any schema parser could strip fields. Unknown confirmation keys and
untargeted confirmations are excluded, rather than inferred from summaries.

## Question controls and verification

Single-choice questions and decisions use native radio inputs. Multi-choice
questions retain checkboxes, and free-text choices retain their text inputs.
Explicit recovered recommendation flags are labeled “Recommended”; no flag is
inferred from an option's position or wording. Decisions require “Confirm choice”
after selection; destructive choices retain their separate typed confirmation.

Focused verification files:

- `ui/src/lib/bulk-confirm.test.ts`
- `ui/src/components/BulkConfirm.test.tsx` (Testing Library via existing `storybook/test`)
- `ui/src/components/DecisionCard.test.tsx`
- `ui/src/components/DecisionResolver.test.tsx`
- `ui/src/components/IssueThreadInteractionCard.test.tsx`
- `ui/src/pages/WhatNeedsMe.test.tsx`
- `ui/src/components/task-chat/TaskChatInteractionCard.test.tsx`

No new dependencies, server changes or schema migrations are required.

Verification in this checkout: all seven focused suites passed (141 tests), the
UI typecheck passed, and `pnpm check:token-gates` passed. These used Node 24.14.0
and cached pnpm 10.10.0 with a temporary user configuration disabling automatic
package-manager switching; no repository configuration was changed. The exact
requested `pnpm -r typecheck` was attempted first but could not fetch/verify the
pinned pnpm 9.15.4. The cached-manager retry reached the database migration check
and stopped at a sandbox-denied `tsx` IPC socket (`listen EPERM`). Workspace-wide
typecheck is therefore **not proven**. A browser layout check at 390 px was not
run; keyboard radio selection, modal cancellation/focus restoration and the
scrollable token-based dialog are covered by the implementation and DOM tests.
