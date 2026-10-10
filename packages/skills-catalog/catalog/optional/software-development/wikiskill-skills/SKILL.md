---
name: wikiskill-skills
description: >
  Eight agent-discipline skills vendored from WikiSkill (skills/*.md): verify writes by
  read-back, treat empty search as unproven, apply specs literally, distinguish launch
  failure from agent behavior, and gate self-evolution on measurable gain.
key: paperclipai/optional/software-development/wikiskill-skills
recommendedForRoles:
  - engineer
  - researcher
  - reviewer
  - product-manager
tags:
  - verification
  - discipline
  - search
  - specs
  - traces
  - self-improvement
  - wikiskill
---

# WikiSkill Discipline Pack

A vendored snapshot of the eight skills in `C:\Users\Admin\wikiskill\skills`.
The files in `skills/` are the durable curated copy.

wikiskill has **no MCP server**. It integrates as a catalog skill, not a tool
gateway — see `tier1-integration-runtime` for the verified split.

## The five discipline skills (read these first)

These are cheap, high-yield rules about not fooling yourself. Load the one that
matches the situation you are in.

| File | Rule | Reach for it when |
| --- | --- | --- |
| `skills/verify-output-readback.md` | After `write_file`, re-read the deliverable and re-check the last format clauses before declaring done. | Any time you are about to say "finished" or "written". |
| `skills/search-miss-binary.md` | Search tools silently skip binary-detected files; an empty result is not proof of absence. Confirm with `grep -a` / `file` / `xxd`. | Any "not found" conclusion from a search. |
| `skills/spec-literal-execution.md` | Apply only the spec clauses literally — no aggregation, dedup, or cleanup transforms. Each input record maps to its own output line. | Grading, exact-match, or transform specs. |
| `skills/trace-harness-launch-failure.md` | Empty session traces mean the harness never launched, not that the agent misbehaved. Check `api_call_count` / `tool_call_count` and `stdout.txt` first. | Debugging an empty or suspicious agent trace. |
| `skills/script-exec-blocked.md` | If the sandbox approval policy blocks `execute_code` / `python3 -c`, stop retrying both runners; use `read_file` / `write_file` plus explicit transforms. | Any blocked code-execution attempt. |

## The three evolution-loop skills

These drive a real feedback loop instead of ad-hoc lesson writing.

| File | Role in the loop |
| --- | --- |
| `skills/wikiskill-maintainer.md` | Consolidate raw execution traces into the persistent wiki. |
| `skills/wikiskill-proposer.md` | Read wiki patterns + traces, diagnose root causes, propose a skill change. |
| `skills/wikiskill-evolve.md` | Run the loop end to end: `init` → `evolve` → `status`, gated on `R_val > R_best`, with git rollback on rejection. |

The gate is the point: a candidate skill is committed only when it measurably
beats the incumbent on the validation split, and rejected proposals stay visible
in `wiki/skill-impact.md`.

## Running the loop

```bash
wikiskill init myws                  # workspace + auto-graded bench
wikiskill evolve myws --iters 3      # maintain -> propose -> gate
wikiskill status myws                # baseline, r_best, skill state
wikiskill compare wsA wsB --iters 5  # paired exact-binomial comparison
wikiskill transfer src dst           # copy accepted skills to another workspace
```

Read `runs/state.json` for scores, `wiki/log.md` for every decision, and
`wiki/patterns/` for the distilled failure patterns that fed it.

## Honest expectations

- A weak proposer model can produce `no_action` iterations. That is the gate
  working, not a failure.
- Each iteration costs roughly $0.09 on free-tier models; bound it with
  `--max-turns` and an explicit budget.
- The Hermes backend is the reference; `--backend claude` uses Claude Code as the
  worker. All backends read the same `SKILL.md` format, so accepted skills
  transfer between them.

## Provenance

Upstream: `https://github.com/ashutoshsinghpr7/wikiskill`, MIT licensed,
vendored from the local mirror at `C:\Users\Admin\wikiskill`. The evolution loop
follows arXiv 2608.27454. Do not re-vendor individual files as separate catalog
entries — add new upstream skills to `skills/` and extend the table above.
