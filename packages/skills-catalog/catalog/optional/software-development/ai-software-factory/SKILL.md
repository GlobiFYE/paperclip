---
name: ai-software-factory
description: >
  Constitution and failure log for a lights-out "AI software factory": issues in, validated code
  out. Covers unattended-merge hazards, holdout/regression verification, and merge authorization.
  NOT runnable here: it drives the Archon SDLC CLI, which is not installed on this host.
key: paperclipai/optional/software-development/ai-software-factory
recommendedForRoles:
  - engineer
  - platform
  - product-manager
tags:
  - unattended-automation
  - verification
  - merge-authorization
  - regression-testing
  - ai-pipeline
trust: markdown_only
---

# AI software factory

Vendored from `C:\Users\Admin\ai-software-factory` as `markdown_only`: the portable constitution
(14 files) plus the failure log. Text is verbatim.

> A repo that takes work in as an issue and ships validated code out, with nobody at the keyboard.
> … The automation is the easy half. Being able to trust a merge nobody read is the hard half,
> and most of what is in here exists for that. — `README.md`

**The central design bet**: you cannot make an unattended agent fast or clever enough to be safe.
You make it *legible* — scope in one human-owned file, gates owned by shared workflows, and
every assertion backed by observable evidence.

## `docs/incidents.md` — the reason to vendor this

96 KB, the highest-value file in the pack: a post-mortem catalogue where *every rule is a scar*.
"Read it if you are about to 'simplify' something. Most of what looks like paranoia here is a
scar." Representative entries:

- **The merge that armed a revert in your checkout, every single time** — after an unattended
  merge the index and working tree still held the *pre-merge* commit, so any later `git add -A &&
  git commit` committed a revert. A `git add -A` 74 seconds post-merge wiped a feature and 106
  lines of tests; the push succeeded and nothing errored. Misdiagnosed as operator habit until the
  same desync recurred with "my hands nowhere near it."
- **The node that was blamed for a bug two nodes upstream** — misattributed root cause.
- **The fix that was applied twice and never landed.**
- **The mutation that escaped, and the property that was too weak** — mutation testing passing
  without the property actually being exercised.
- **Every rung green, one rung never shown to fail** — a verification ladder with an untested rung.
- **The gap that was stated instead of faked** · **The hold that was only a sentence** (a holdout
  asserted in prose, never enforced) · **The empty answer that was read as a negative answer**.
- **The staleness check that called an unanswered question "current."**
- **Two laps for one issue, stopped by a lock that happened to still be held** (lock race).
- **The machinery that had a harness for everything except itself.**

## The constitution (`template/`)

| File | Role |
| --- | --- |
| `MISSION.md` | **The one file nobody can write for you.** Human-owned, on the protected list. Compresses the spec to the part an agent must *obey*; must change in the same commit as the product, or the factory faithfully builds the old scope and nothing warns you. `factory doctor` refuses to run while `<angle-brackets>` remain. |
| `FACTORY_RULES.md` | Project constraints + irreversible-action requirements. Explicitly **not** a private merge policy: shared workflow gates own authorization, and no autonomy dial or locally-written receipt may bypass a gate. |
| `factory/WORKFLOW_POLICY.md` | How the shared SDLC workflows consume project inputs: scope/backlog bootstrap (first ticket = smallest runnable core path, naming an exact start argv + port placeholder, health path, build-identity path, state path, test command, PR CI check), and the state→GitHub-label mapping. |
| `factory/RUNTIME_HOST.md` | Owning ordinary app environments without ever choosing a stage, retrying an agent, evaluating a scenario, or authorizing a merge. Foreground lifetime, `FACTORY_RUNTIME_URL`/`FACTORY_RUNTIME_TOKEN`, and cleanup that *fails the command* if it does not complete. |
| `harness/END-TO-END.md` | Runtime scenarios written as observable journeys, each with an explicit **"What would make this fail."** |
| `.factory/holdout/HOLDOUT.md` | Composed independent scenarios on a **fresh environment** running the actual candidate. No factory helper enforces a private holdout boundary. |
| `factory/MIGRATION.md` | The migration contract: all agent execution runs as Archon command nodes; provider subprocesses and factory-owned stage dispatchers are forbidden. |
| `FACTORY.md` | Operational entry point: which gates own decisions, what to record after testing (tested source SHA, candidate, native run IDs, coverage, fresh-environment evidence, unresolved limits). |

## Runbooks (`docs/`, `README.md`)

`README.md` (19 KB — install prompt, requirements, what the installer does) · `first-hour.md`
(the ordered first hour, ending with "watch one small issue go to a PR before enabling scheduling")
· `server-cheat-sheet.md` (17 KB — every prompt in order for a headless server; only the two
logins need a human) · `derivation.md` (ownership decision: what was retired and why) ·
`migration.md` (pointer to the canonical contract).

## Not runnable on this machine

This factory is a *harness around the Archon SDLC CLI* — `archon-lifecycle`, `archon-ship`,
`archon-deliver`, `archon-regress`, `archon-backlog`, `factory/consumer.py`. Requirements:

| Need | Status here |
| --- | --- |
| `archon` CLI | **absent** — see the `archon-workflows` entry in this catalog |
| `uv` | absent (required by the installer) |
| `gh` with `workflow` scope | `gh` present; workflow scope unverified |
| `bun` | **present** |
| Python 3.10+ | **present** |

So: **read this for design, do not claim you can run a factory here.** Pairs directly with the
`archon-workflows` catalog entry, which carries the Archon prompts this factory orchestrates.

## Honest scope note

`bin/` (factory.py, install.py, audit.py, sync-to.py, selfcheck-mutations.py and their tests) was
**not** vendored — it is executable Python, and this entry is `markdown_only`. The constitution and
the failure log are the transferable parts; the installer is not. Upstream:
`https://github.com/coleam00/ai-software-factory`.

## Provenance

Vendored 2026-09-26 from `C:\Users\Admin\ai-software-factory` (`README.md`, `docs/`, `template/`).
Note that all AI work in that project runs through
[`coleam00/Archon`](https://github.com/coleam00/Archon)'s SDLC pack.
