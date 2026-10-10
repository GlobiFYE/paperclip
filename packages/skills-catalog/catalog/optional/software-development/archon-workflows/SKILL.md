---
name: archon-workflows
description: >
  Archon engineering workflow pack: 7 project skills (CLI operation, Playwright automation,
  release cutting and smoke tests, rulecheck, issue triage, Docker extension) plus 13 review
  agents (code review, silent-failure hunting, docs impact, type design). Delegates
  implementation to isolated runs.
key: paperclipai/optional/software-development/archon-workflows
recommendedForRoles:
  - engineer
  - platform
  - reviewer
tags:
  - archon
  - release
  - code-review
  - browser-testing
  - triage
trust: markdown_only
---

# Archon workflows and review agents

Vendored from `C:\Users\Admin\Archon\.claude` (7 skills, 13 agents) as `markdown_only`
instruction. Nothing here executes; the pack is prompts, checklists, and reference tables.

## Layout

| Path | What it is |
| --- | --- |
| `skills/archon-cli.md` | Drive the Archon CLI: run workflows, manage runs, author workflows |
| `skills/playwright-cli.md` | Browser automation + Playwright test authoring via `playwright-cli` |
| `skills/release.md` | Cut a patch/minor/major release: changelog, version bump, PR to main |
| `skills/test-release.md` | Smoke-test a *released* binary through a real install path |
| `skills/rulecheck.md` | Autonomous rule-adherence sweep, fix, validate, open a PR |
| `skills/triage.md` | Apply type/effort/priority/area labels to GitHub issues |
| `skills/docker-extend.md` | Personalize a Docker env via `Dockerfile.user` + compose override |
| `skills/*-refs/**` | Per-skill reference trees (workflow authoring, node reference, variables, manage/debug runs, prompting mistakes, Playwright attributes/storage-state/tracing/mocking, rulecheck rules + workshop) |
| `agents/*.md` | 13 standalone review/triage/research agent prompts |

## Agent index (13)

**Review quality.** `code-reviewer` (guideline compliance, bugs, quality, after writing code and
before commits/PRs) · `code-simplifier` (clarity/maintainability with *exact* behavior preserved) ·
`silent-failure-hunter` (swallowed errors, bad fallbacks, inadequate error handling — zero tolerance).

**Understanding the code.** `codebase-analyst` (proactive: *how* it works, data flow, `file:line`
citations) · `codebase-explorer` (where things live *and* how they're implemented) ·
`codebase` orientation differs: analyst = mechanism, explorer = location + mechanism.

**Change-quality gates.** `pr-test-analyzer` (behavioral coverage, not line metrics; finds critical
gaps) · `docs-impact` (stale docs, removed feature references, missing entries for new user-facing
features) · `comment-analyzer` (are comments accurate and worth keeping after generation) ·
`type-design-analyzer` (encapsulation, invariant expression, enforcement quality on new/changed types).

**Verification + autonomous loops.** `sdk-verifier` (TypeScript Agent SDK config correctness vs docs) ·
`rulecheck-agent` (scan violations, fix in an isolated worktree, validate, open a PR, update memory) ·
`triage-agent` (fetch issues, read code for context, apply labels via hooks).

**Research.** `web-researcher` (post-training-data docs/APIs/best practices; searches, fetches,
synthesizes with sources).

## Tool availability on this machine (verified 2026-09-26)

Skills are not uniformly runnable. Check before promising an execution:

| Skill | Needs | Present |
| --- | --- | --- |
| `triage` | `gh` | **yes** |
| `release` | `git`, `gh`, repo scripts | **yes** |
| `archon-cli` | `archon` CLI | **no** — read the docs; do not claim you can run it |
| `playwright-cli` | `playwright-cli` | **no** |
| `docker-extend` | `docker` | **no** |
| `test-release` | built release binaries | **no** — needs a release first |
| `rulecheck` | `rulecheck-agent` + git worktree | partial — `git` yes, agent is prompt-only |

The **13 agents are fully usable as prompts** — they need no external binary, only the repo
under review. `triage` and `release` are the two skills runnable end-to-end here.

## Using an agent

Agents are prompts, not tools. Paste the agent file's body as the system/task prompt, then give it
the target files or PR. Each carries its own frontmatter (`name`, `description`, and often
`tools`/`model`) — respect any `tools:` restriction it declares.

## Two skills that fork context

`rulecheck` and `triage` declare `disable-model-invocation: true` plus `agent:` and (for `triage`)
`context: fork`. That means they must be invoked explicitly and run in an isolated subagent context
— which is the point: `triage` reads many issue bodies and should not pollute the main
conversation. If you are running these inline, say so, because their isolation guarantee is lost.

## Provenance

Vendored 2026-09-26 from `C:\Users\Admin\Archon\.claude\skills` and `...\agents`. Upstream repo:
`https://github.com/coleam00/Archon`. Text is unmodified; only the entrypoint filenames were
flattened (`<skill>/SKILL.md` → `skills/<skill>.md`) because the catalog builder rejects a nested
`SKILL.md`. The `*-refs/**` trees are verbatim.
