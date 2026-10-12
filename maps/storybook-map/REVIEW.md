# Initial Storybook review — 2026-10-12

Source baseline: `f0e12c851971a21f7aadf0835b016bfaf2067314`.
Scope: complete source inventory and initial classification, with targeted source
comparison and browser checks. This is not full state parity, full interaction
coverage, or production acceptance for all stories.

## Inventory and organization

There is one Storybook, already centralized under `ui/storybook/`. Its 223 story
files are split between 176 files at the stories root and 47 nested files. The
existing sidebar has 51 top-level groups. A bulk file move would add churn without
fixing the main problem: product meaning, provenance, and review status were not
recorded consistently.

The downstream catalog gives each file a primary feature home and related stable
capability IDs. The generated index includes all 171 upstream capabilities across
35 feature areas. The existing Overview story now provides searchable feature
navigation into the actual built story index. Existing sidebar titles remain
stable to preserve links and snapshot identity.

| Dimension | Initial classification |
| --- | --- |
| Product alignment | 18 current subjects, 4 proposals, 5 historical suites, 8 mixed suites, 188 requiring deeper parity review |
| Rendered subject | 199 production, 8 prototype, 11 mixed, 5 guides |
| Data boundary | 217 fixture-based, 1 separate fixture server, 5 static guides |

A production subject can have unreviewed state parity. A current subject can still
have untested loading, error, permission, or backend behavior. The catalog's notes
and source references qualify these labels; none are a substitute for live proof.

## Corrections and retained history

- **Question dismissal and send:** the local interaction-above-composer harness
  kept a pending badge for dismissed questions and left the question open after
  a normal send. Production `TaskChatThread` excludes questions from
  `pendingReminderInputs` and dismisses the selected question on send. The harness
  now matches those rules. Added question-dismiss and confirmation-reopen cases;
  corrected the send case's stale editor selector. The story still does not prove
  persisted dismissal or history behavior.
- **Fast response helpers:** `empty`, `configured`, and `result` were exported
  fixtures which Storybook also treated as stories. Their IDs collided with
  `Empty`, `Configured`, and `Result`. Explicit exclusion removes the false exports
  while retaining the real stories and imported fixtures. Browser review also
  exposed a missing explicit `onConnectionChange` spy after the production view
  began calling it on mount; added that fixture callback.
- **Chat provenance:** the main chat wrapper combines production conversation/task
  pages with a local landing view. The separate first-created-agent chat-entry
  design is historical; current primary-agent examples are its replacement.
- **Historical designs retained:** GitHub chat, old agent onboarding, connect-model
  tiles, paused composer, and chat-entry remain available with their purpose and
  replacement references. Local proposals are labeled rather than deleted.
- **Prototype folder is not a verdict:** some files re-export production subjects;
  others implement local compositions. Static import traversal found no obvious
  orphan prototype TS/TSX module. This is not proof that each is still useful.
- **Contributor guidance:** replaced the old Overview's manual coverage claims,
  corrected the interaction-authoring skill's obsolete story path, and updated the
  prototype README's catalog source count to match the shipped five sources.

## Verification

Environment: local macOS, headless Chromium, built Storybook 10.6.0, fixture data.
The following nine `play` cases reached Storybook's `storyFinished: success` event
without a browser page exception. These results establish story interactions only.

| Story ID | Subject / assertion |
| --- | --- |
| `composer-interaction-above-composer--ask-user-questions-and-send` | Production card/composer in local harness; normal send dismisses question without a pending badge |
| `composer-interaction-above-composer--dismiss-question-without-pending-badge` | Production card/composer; dismiss leaves editable composer without pending badge |
| `composer-interaction-above-composer--dismiss-confirmation-keeps-pending-badge` | Production card/composer; dismiss retains confirmation badge and reopening works |
| `composer-new-task--empty` | Production composer wrapper; existing play assertions |
| `design-explorations-agent-chat-sidebar-components--add-and-reopen-chat` | Production sidebar; fixture add/reopen assertions |
| `assistant-connections-consent--choose-organization` | Production consent surface; fixture organization selection assertions |
| `historical-github-chat-prototypes--standard-trust-warning` | Historical prototype; existing trust-warning assertions, not current GitHub acceptance |
| `design-previews-recovery-notice--retry-request-failed` | Production recovery notice; fixture failure-state assertions |
| `composer-mobile-assignee-picker--picker-open` | Production picker; existing open-picker assertions |

Additional manual browser checks passed: search the guide for `steering/queue`,
follow its link to the real queued-message story, dismiss a question, then reload
and verify that the fixture resets to an open question. Screenshots were inspected
locally and are not committed as new regression baselines.

Built-index comparison: all 2,208 prior story IDs remain; only the two new dismissal
regressions were added (2,210 total). Catalog validation, eight checker tests,
feature-map validation, both skill validators, token gates, workspace typecheck,
and workspace build passed. Fast-response settings `empty`, `configured`, and
`result` subsequently reached `storyFinished: success` with no page exceptions
following the explicit callback fix. These three cases are render checks, not save
or backend-persistence tests. The UI Vitest project passed all 8,176 tests in 728
files. The full `pnpm test:run` reported a 15-second timeout in the unchanged backend
case `connects advertised Workspace gmail.read without mutating definitions in
authenticated`. That exact case passed standalone without changing expectations
or timeouts. The remaining broad run was stopped after this failure; a complete
repository suite pass is not established.

Automated review found missing directly rendered subjects in the initial dependency
list. Expanded the catalog across affected suites, including relative production
imports, all direct non-primitive subjects in local wrappers, and the primitives
that foundation stories demonstrate. Explanatory review guides keep their separate
guide classification. This records change detection, not new parity
acceptance. Added a real CSF parser regression for nested discovery, include/exclude
rules, stable explicit IDs, and play counts.

## Remaining review work

1. Review the 188 unreviewed suites by capability and production subject. Compare
   state transitions, payloads, errors, gates, and reset behavior before promoting
   a suite. Start with large route wrappers and shared fixture dependencies.
2. Shared preview mocks can fall through to the original fetch; some route harnesses
   return empty arrays for unmatched APIs. These can hide missing fixtures. Audit
   affected endpoints per feature rather than treating a render as API coverage.
3. The managed-accounts test-drive story needs the separately owned local API/DB
   fixture at port 4310. Its upstream providers are simulated. It was not exercised
   against an unknown existing service.
4. Screenshot comparison is blocked: the existing baseline manifest has zero
   snapshots and no published archive. Keep using the established Linux baseline
   workflow when its baseline is published. Do not bless new baselines as part of
   catalog cleanup.
5. Review fingerprints track declared sources, including feature recipes and local
   support; they do not traverse every production dependency. Add missing subjects
   when a review discovers them. Shared setup changes require reviewing callers.

Use `maintain-storybook` to correct drift and `review-storybook` to record separate
source, render, interaction, visual-comparison, and production evidence. Both skills
consume the feature map; neither changes its upstream contract.
