---
name: prime-agent-skills
description: >
  Twelve agent skills vendored from the Prime Agent self-improving RLM harness
  (skills/*.md): agent family messaging and observation, context compaction,
  exact-string edits, persistent goals, harness refinement, RLM heartbeats,
  skill authoring, generic MCP tool calls, and image attachment.
key: paperclipai/optional/software-development/prime-agent-skills
recommendedForRoles:
  - engineer
  - researcher
  - platform
tags:
  - prime-agent
  - rlm
  - agents
  - skills
  - context-management
  - mcp
---

# Prime Agent Skill Pack

A vendored, markdown-only snapshot of the twelve skills in
`C:\Users\Admin\prime-agent\packages\coding-agent\skills`. The files in
`skills/` are the durable curated copy.

Prime Agent is an RL-trained coding-agent host, not an MCP server — it
*consumes* MCP connections (`packages/ai/src/mcp.ts`). It integrates as a
catalog skill, not a tool gateway. See `tier1-integration-runtime` for the
verified split.

**Only the instruction layer is vendored.** Upstream, nine of these twelve skills
ship a Python kernel under `skills/<name>/src/` plus a `pyproject.toml`; those
executables are deliberately *not* vendored, so this entry stays
`markdown_only` and install stays audit-gated. Read the markdown, then call
the kernel yourself if you have a Python env.

## Agent family: read the roster before you send

| File | Rule | Reach for it when |
| --- | --- | --- |
| `skills/agent-observe.md` | Read-only roster of parent, siblings, and direct children, with bounded recent-message previews. | Before any inter-agent send, so you address a real reachable session. |
| `skills/agent-message.md` | Send to parent/siblings/children through the daemon. The daemon derives sender identity from the session — never include a `from` field. | Handing work to a sibling or following up on a child's result. |

`agent-observe` first is not optional politeness. `agent-message` resolves
receivers by `receiver_role` + `receiver_name`, so an unobserved name is a
silent no-op, not an error.

## Context and task state

| File | Rule | Reach for it when |
| --- | --- | --- |
| `skills/compact.md` | Check context usage and summarize the conversation so the session keeps working instead of stopping early. | Context is filling up **and** substantial work remains. Compacting mid-task loses state. |
| `skills/goal.md` | Read goal status and budget, start a goal when the user explicitly asks, mark complete only when fully achieved. | The user asked for a goal, or a goal is active. |
| `skills/refine.md` | Trigger continual harness refinement when a repeated failure or reusable tactic should persist. Returns immediately; refinement runs at turn end. | You have just worked around the same failure twice. |

## Doing the work

| File | Rule | Reach for it when |
| --- | --- | --- |
| `skills/edit.md` | Replace an *exact, unique* string in an existing file. | Targeted single-occurrence edits, instead of rewriting whole files. |
| `skills/attach-image.md` | Load an on-disk image (PNG, JPEG, GIF, WebP) into context so the model can see it. Requires a vision-capable model and errors clearly otherwise. | Screenshots, diagrams, charts, scanned pages. |
| `skills/mcp.md` | Use external MCP services generically: browse the service catalog, inspect the user's connections, discover live tool schemas, call tools on any connection. | Working against Notion, Linear, Slack, or any other connected service. |

`mcp.md` is the generic path — it replaces writing a per-service package. Read
the live tool schema before calling; connections are user-scoped and a schema
you guessed will fail.

## Authoring and long-running loops

| File | Rule | Reach for it when |
| --- | --- | --- |
| `skills/skill-creator.md` | Create, validate, and install Prime Agent skills, both markdown and Python-backed. See `skills/skill-creator-references/python-skills.md`. | Turning a workflow into a reusable skill, or asking where skills live. |
| `skills/rlm-heartbeat.md` | Manage agent-owned RLM heartbeats from the Python REPL. | The user asks to start, create, or schedule a heartbeat. |
| `skills/prime-intellect.md` | Prime Intellect products via the `prime` CLI and Python SDKs. Detail in `skills/prime-intellect-references/`: `environments.md`, `sandboxes.md`, `compute.md`, `inference.md`. | Tasks involving Prime Intellect, verifiers, RL environments, evals, training, or rented GPUs. |

## Honest expectations

- **Three of the twelve are self-contained instruction** (`mcp`, `prime-intellect`,
  `skill-creator`) and the other nine need the Python kernel (next bullet).
- `websearch` additionally needs a Serper API key wired through `/login` → MCP
  Connections → Serper. `prime-intellect` needs a Prime Intellect account token.
  Both fail cleanly without credentials rather than degrading silently.
- The nine Python-backed skills (`agent-message`, `agent-observe`, `attach-image`,
  `compact`, `edit`, `goal`, `refine`, `rlm-heartbeat`, `websearch`) call into a
  live REPL kernel and a local daemon. Read the markdown for the contract; do
  not assume the kernel exists in your own runtime.
- Prime Agent's harness is a WSL-partitioned worker. It is an **eval-gated
  writer** — it provisions only through the approved issue→ship path and is
  never hot-wired into a production queue.

## Provenance

Upstream: `https://github.com/PrimeIntellect-ai/prime-agent` ("Prime Agent: A
Self-Improving RLM Harness", arXiv 2608.23552), vendored from the local mirror
at `C:\Users\Admin\prime-agent`. Do not re-vendor individual files as separate
catalog entries — add new upstream skills to `skills/` and extend the tables
above. Upstream test fixtures under
`packages/coding-agent/test/fixtures/skills-*` are deliberately negative test
cases (`invalid-yaml`, `name-mismatch`, `missing-description`) and must never be
vendored.
