# Test audit: consolidate repeated owner fixtures and rendering

Date: 2026-10-12
Branch: `codex/test-audit-next`
Discovery baseline: `b4aee6ea18905690686fb318fa9cc6d4cc71a7e1`
Parent cleanup: [PR #15978](https://github.com/paperclipai/paperclip/pull/15978)

This follow-up removes **2,041 net test lines across five files**. Every
registered case and assertion remains. It changes no application source.
The seven complete owner/sibling files pass all **990 cases** before and after;
UI typecheck, token gates and diff checks pass. This is fixture compaction,
not a runtime speedup or another reduction in execution count.

The parent PR is handled in the original d9b0 worktree. This branch has a
separate managed checkout and dependency installation, based on the prior
cleanup commit. It does not modify the parent PR's files or report. After the
parent merges, replay only the commits after this discovery baseline onto
merged master, inherit its review fixes, and reverify the affected owners.
The earlier cleanup evidence lives in `2026-10-12-test-audit.md`.

## Measured change

| File | Before lines | After lines | Net removed | Cases retained |
| --- | ---: | ---: | ---: | ---: |
| server/src/__tests__/environment-runtime.test.ts | 8,110 | 7,223 | 887 | 162 |
| server/src/__tests__/execution-workspaces-service.test.ts | 4,751 | 4,638 | 113 | 67 |
| server/src/__tests__/company-portability.test.ts | 6,194 | 6,100 | 94 | 94 |
| ui/src/pages/IssueDetail.test.tsx | 6,652 | 6,338 | 314 | 141 |
| ui/src/components/IssueChatThread.test.tsx | 5,032 | 4,399 | 633 | 100 |
| **Changed owners** | **30,739** | **28,698** | **2,041** | **564** |

The remaining 426 validation cases are unchanged TaskChatThread (225) and
AppsConnect (201) siblings. Figures exclude this report. No case, timeout,
skip condition, filename, CI route or production seam is removed.

## Owner and keeper decisions

All nominated cases are retained. Each original case remains the primary
keeper of its regression assertions; helpers own only repeated inputs.

- Environment runtime: 71 repeated plugin/lease/worker/foreign-company
  expressions become synchronous file-local fixture builders. Complete
  identity, author, schema, readiness, capability, install-order, stale lease,
  fingerprint and RPC-budget variants remain defaults or explicit overrides.
  Preserve real persisted rows and the actual foreign-company rejection,
  orphan teardown/spool recovery and lease-reuse paths. Dynamic/spread rows
  and the named-constant secret provider stay inline.
- Execution workspaces: 19 repeated task/recovery/branch/runtime/agent inputs
  become synchronous builders. Real Git operations, active claimant/runtime
  rows, locked races, clean/dirty divergence and durable recovery assertions
  remain in their original cases.
- Company portability: 15 identical export invocations use one local helper;
  their distinct fixture data, redaction, permission, import, selected-file,
  logo and membership expectations remain explicit.
- IssueDetail: 98 identical root/provider render frames share one synchronous
  helper. It retains the same QueryClient and root. Four nondefault children
  remain explicit JSX; unsafe undefined/key/ref/spread shapes stay inline.
- IssueChatThread: 70 MemoryRouter/component frames share one synchronous
  helper with fresh original defaults. Supplied callback references, props,
  dynamic expression order, root identity and rerender/remount behavior remain.

TaskChatThread and AppsConnect already have useful fixtures or distinct
transport/identity behavior. A TaskChatThread prototype saved only ten lines
after helper overhead and was rejected. No further layer retirement was
supported in these owners; separate provider, authentication, lifecycle and
storage proof remains valuable.

## Preservation evidence

Original/candidate SHA-256 guards were validated before any checkout edit.
Proposals were prepared outside the checkout during baseline execution.
Independent reviewers checked both groups against the committed baseline.

Server: expand all 105 calls through the 16 actual helper bodies/defaults and
compare all three complete programs. Field order, nested schemas/capabilities,
types/casts, table rows, callbacks, hooks, 1,347 awaits and 1,201 expectation
calls are unchanged. Helpers add no Promise boundary, transaction, UUID,
clock read, receipt, assertion, RPC or reset. Objects and mocks remain fresh.

UI: independently expand all 98 + 70 actual render calls. The complete program
outside those checked expressions is unchanged, including types, callbacks,
actions, waits, timers, teardown and budgets. All 778 expectation calls and
200 declarations remain. Check every thread root identity and dynamic prop
evaluation order; check IssueDetail root/client bindings for shadowing.
Only unique JSX attribute order is normalized; key/ref/spread shapes are
excluded. No React component wrapper or hook is introduced.

Both independent reviews found no preservation blocker. No assertion was
moved or repaired, so no additional production mutation was needed. The
earlier parent PR's mutation proof is recorded in its report.

## Runtime verification and limits

- Complete baseline: seven files, 990 passed, zero failed/skipped.
- Complete candidate: the same seven files, 990 passed, zero failed/skipped.
- `pnpm --filter @paperclipai/ui typecheck`: pass.
- Token gates, palette synchronization and character synchronization: pass.
- `git diff --check`: pass.
- The new checkout used its own workspace-linked dependencies and built its
  own TypeScript runner/shared/plugin SDK prerequisites. No dependencies or
  source files were linked to the concurrently changing PR checkout.
- Full workspace typecheck/build and a complete default run have not been
  repeated for this follow-up branch. This is complete affected-owner/sibling
  proof; it is not yet a PR-ready handoff. The parent PR owns its separate
  full verification and merge. No wall-time speedup is attributed to this work.
