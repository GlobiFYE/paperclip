# Test audit: first cleanup and next boundaries

Date: 2026-10-12
Baseline: `fb21a3f30a`
Reference: [OpenClaw test audit](https://github.com/openclaw/openclaw/blob/main/.agents/skills/test-audit/SKILL.md)

The first cleanup removes 146 net test lines and seven synthetic test cases.
The retained HTTP proof catches all three injected side effects. All 138
focused cases, workspace typecheck, build, and token gates pass. The full
repository test suite remains unverified after a bounded local attempt.

## Scope and findings

This is a repository inventory and a small evidence-backed cleanup, not a review
of every test. The baseline has 2,816 tracked `*.test.*` / `*.spec.*` files:
1,038 server, 725 UI, 697 packages, 216 test harnesses, 66 CLI, 50 scripts,
21 GitHub tooling, and 3 skill tooling files. These include opt-in suites;
the count does not describe the default Vitest run alone.

A text scan found 382 files that combine file reads with containment/matching
assertions: 156 packages, 133 server, 42 harnesses, 18 UI, 13 CLI, 13 scripts,
6 GitHub tooling, and 1 skill tooling file. The scan also matches fixture reads
and executable checks. **382 is a review queue, not a deletion estimate.**

The useful question is which independent regression a test catches that the
retained owner proof misses. File reads, snapshots, mocks, and slow tests are
not sufficient reasons to remove a test.

## Applied decisions

| Candidate | Decision and retained proof |
| --- | --- |
| `server/src/__tests__/issue-interactions-read-only-contract.test.ts`: route source check | Remove the file after adding terminal-expiry and activity-write assertions to the existing real HTTP read-path test in `issue-thread-interaction-routes.test.ts`. Check both `in_review` and `done`, the JSON response, listing, and absence of recovery. |
| Same file: two whitespace rows, three forbidden-name rows, two missing-boundary rows | Remove all seven synthetic cases. They test a local regex/assertion helper against hand-written route strings, not production behavior. Removing the helper removes their purpose. |
| Retry cases in `ui/src/api/chatEndpoints.test.ts` and `agents.test.ts` | Consolidate under `agents.test.ts`, the production API owner. Preserve the exact company-scoped request, ordinary and durable receipts, distinct stopped-successor errors, deferred dispatch, legacy receipts, both skipped-wake forms, and single-dispatch checks. |
| Slack manifest replay in `ui/src/pages/apps/chat/chat-ui-contract.test.ts` | Remove duplicate scope/event assertions already pinned by the shared owner snapshots. Move the unique agent-view, bot presence, and app-home assertions to the existing shared manifest test. Keep the UI's manifest integration checks. |
| Same UI file: sanitizer implementation substrings | Remove the checks for `replaceAll` and `encodeURIComponent`. Keep the UI integration assertions and `chat-setup-error.test.ts`, which exercises raw, escaped, encoded, and malformed UTF-16 secrets. |
| Same UI file: v8 wireframe generator/import strings | Remove the design-plan implementation checks. Keep the shipped GitHub setup assertions, wizard behavior suite, and PEM file/late-read tests. Design generator version names are not a product contract. |

The source-only route test originated in #10414; its synthetic parser cases
arrived in #13038, alongside the real HTTP test. The UI retry coverage came from
#13038 and #13765. The current chat source-check owner was last changed in
#15416. None of the removed support code has a production caller.

Change size before this report: **146 net test lines removed**, one test file
retired, seven fewer executed cases across the affected route suites, and zero
production lines changed. No runtime speedup is claimed: cold transforms,
prerequisite builds, and a baseline timeout prevent a fair wall-time comparison.

## Preservation evidence

- UI baseline: 48 cases pass across the two API files, chat UI source contract,
  chooser routing, and setup-error suite. The shared manifest has four cases.
- After cleanup: those six UI/shared suites pass, 52 cases total.
- Route baseline: the eight source-check cases pass; 84 of 85 HTTP cases pass.
  The unchanged standard-work plan-confirmation case times out at 15 seconds
  during the full file run. Isolating it with the original read-path case passes
  both. This does not establish a flake repair; its test and timeout remain intact.
- Three temporary mutations add historical expiry, terminal expiry, or an
  activity write to the production GET handler. Each makes the retained HTTP
  test fail at its side-effect assertion. Production source is restored byte
  for byte after every mutation, including failure cleanup.
- UI token gates and `git diff --check` pass.

- Final complete HTTP route file: all 86 cases pass. Together with the 52
  UI/shared cases, focused validation passes 138 cases.
- `pnpm -r typecheck` and `pnpm build` pass.
- `pnpm test:run` was started, then interrupted after about five minutes while
  still running its first general-server file, the 75,178-line chat integration
  suite. It exited 130; there is no full-suite pass or failure conclusion.
  The default runner has 158 separately serialized suites after its general
  lanes. A complete run remains a prerequisite for claiming a PR-ready handoff.

## Next review boundaries

1. Remaining `chat-ui-contract.test.ts` assertions: exact retry call syntax,
   tabs, lifecycle handlers, and provider fields. Replace them only after
   rendered tests exercise the selected run, navigation, error, or credential
   outcome. Provider guidance and permission bytes need independent proof.
2. Component-only helper exports: `shouldRenderComposerHandoffPreview`,
   `replaceResolvedInteraction`, and model-transition helpers. Their direct
   tests currently protect distinct behavior. The existing rendered suites do
   not cover every assertion, so deletion is not yet justified.
3. Server source guards: compare each with its route/service owner before
   pruning. Authentication ordering and company boundaries deserve particular
   care; a source guard can protect routes missing a behavioral negative case.

Retain protocol-schema cross-checks, package/build metadata, migration replay,
dependency singleton checks, provider permission snapshots, and theme contrast
tests. They compare independent contracts or outcomes. The telemetry README
guard is also retained; changing that path requires its own strict review.

For another batch, pin a fresh baseline, assign one production boundary,
record every deletion's keeper first, and prove the keeper catches the relevant
mutation. Do not optimize for test counts or remove baseline failures for green.
