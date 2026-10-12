# Test audit: remove redundant proof and repeated fixtures

Date: 2026-10-12
Baseline: `fb21a3f30a`
Reference: [OpenClaw test audit](https://github.com/openclaw/openclaw/blob/main/.agents/skills/test-audit/SKILL.md)

The combined cleanup removes **6,678 net test/support lines, 41 unused
production lines, and 1,003 registered cases**. Four obsolete ACPX
characterization files are retired. Unique contracts remain in their current
owners. Complete owner/sibling validation passes 2,817 cases, and the entire
chat integration suite passes all 1,237 cases. Workspace typecheck, build, and
token gates pass. This is a reviewed subset of the repository, not an
exhaustive review or a complete default-suite run.

## Aggressive follow-up

The follow-up baseline is `3951d69f9b`, which contains the small first pass.
`origin/master` was refreshed and remained at `fb21a3f30a`. Three read-only
auditors examined adapter lifecycle, native execution, and UI ownership.
Proposals were prepared outside the checkout while baseline tests ran, then
applied with original-source SHA-256 guards.

| Owner batch | Net test/support lines removed | Production lines removed | Net registered cases removed |
| --- | ---: | ---: | ---: |
| ACPX characterization layer | 3,283 | 0 | 44 |
| Chat database read fixtures | 1,612 | 0 | 0 |
| Native executor, resume, and runner API | 802 | 0 | 943 |
| UI fixture consolidation and obsolete compatibility | 698 | 41 | 7 |
| Exact workspace/Daytona duplicate cases | 137 | 0 | 2 |
| Initial pass | 146 | 0 | 7 |
| **Total** | **6,678** | **41** | **1,003** |

These figures exclude documentation. Savings are measured from the Git diff,
not formatting estimates. The case counts include migrated/table-expanded
keepers, not just deleted declarations. No wall-time speedup is attributed to
the change: baseline and candidate runs had different cache and machine load.

### Retired layers and their keepers

- ACPX: remove startup, turn, settlement, and composed-run characterization
  suites (3,643 gross lines). They copied the engine harness for #11461's
  refactor; #11576 completed the coordinator extraction. The current
  `execute.test.ts`, fault matrix, sequence, cancellation, session-store, and
  workspace teardown suites own their remaining proof. Unique Stop-phase
  regressions from #14990 remain, with actual callback/gate observations.
  Preserve bridge credential isolation, current prompt/turn inputs, fingerprint
  dimensions, retry order, close/cancel policy, bridge-stop before sync-back,
  lease release, and native restore/last-finalize assertions in those keepers.
- Chat: replace 607 repeated real database query chains with 22 typed,
  file-local query owners. Every table, column, parameter, caller await,
  ordering, limit, polling loop, action, and assertion remains. Independent
  expansion of the helpers produces a normalized AST identical to the entire
  original program. All 1,237 integration cases execute before and after.
- Native: consolidate repeated scoped-runtime fixtures while retaining every
  executor declaration and parameter row, including 1,010 complete assertion
  chains. Replace six copied historical catalog constructors with independently
  checked immutable digests in the existing resume table. Restore the valid
  context before testing changed agent identity so that the negative cannot
  pass through an earlier, unrelated instruction mismatch.
- Runner API: remove the second identical REST-route matrix. Baseline
  collection executes 943 rows twice; the keeper executes each same row once.
  The full file changes from 1,994 to 1,051 passing cases. No catalog entries
  or public route/actor/response contract are removed.
- UI: remove five exact duplicate cases and two tests of an internal legacy
  workspace API with no production callers or published source export. Both
  shipped workspace pages use the retained `sections` interface. Consolidate
  Secrets rendering, fresh Daytona capabilities, and four literal runtime
  status rows without changing their actions, waits, or outcomes. Two AWS
  error negatives now actually receive the sensitive provider details they
  assert are absent.
- Workspace/Daytona: remove a second byte-equivalent worktree dependency case
  and an overlapping-execute case whose body duplicated the retained lease
  tombstone test. All other provisioning and teardown guards remain.

### Preservation review and final proof

Independent reviewers checked each of the four large owner proposals against
its original tests and production callers. Review caught and repaired lost
existing-file overwrite proof and a prompt guard that could accept
`String(undefined)`. Both fingerprints in the dimension matrix and the exact
session-key keeper now also require nonempty strings. No remaining preservation
blocker was found.

Three additional production mutations were caught at assertions: dropping the
runtime prompt, skipping existing-file writes during native restore, and
spreading unsafe secret-provider details into the UI. Every production file was
restored byte for byte. The two AWS negative cases fail on the unsafe-details
mutation. All four focused controls pass after restoration. The earlier HTTP
mutation proof remains below.

- Complete affected owners and siblings: **22 files, 2,817 cases pass**.
- Complete chat integration: **1,237 cases pass**, both baseline and candidate.
- ACPX baseline: 335 cases pass; native/UI baseline: 939 pass; runner API
  baseline: 1,994 pass. Additional workspace/Daytona/UI baseline records 508
  passes and 10 pending cases with a failed workspace file but no failed case.
  That baseline inconsistency is not claimed repaired; the complete retained
  workspace file subsequently passes all 175 cases with built prerequisites.
- `pnpm -r typecheck`, `pnpm build`, token gates, and diff whitespace checks pass.
- The full default repository suite remains unverified. The completed tests
  above are full files at the affected owners; they are not a claim that all
  repository tests ran. A full default run remains required for a PR-ready
  handoff.

## Initial pass evidence

### Scope and findings

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

### Applied decisions

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

### Preservation evidence

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

### Next review boundaries

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
