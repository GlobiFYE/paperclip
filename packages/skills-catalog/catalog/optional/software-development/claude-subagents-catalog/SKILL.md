---
name: claude-subagents-catalog
description: >
  Browse and deploy a ready-to-use Claude subagent from the vendored 610-agent
  library (catalog/agents/*.md), with chaining, flow strategies, prompt
  templates, industry playbooks, and troubleshooting guides.
key: paperclipai/optional/software-development/claude-subagents-catalog
recommendedForRoles:
  - engineer
  - researcher
  - product-manager
tags:
  - agents
  - subagents
  - claude
  - catalog
  - prompts
  - playbooks
  - chaining
---

# Claude Subagents Catalog

A vendored snapshot of the 610-subagent library plus the framework guides that
explain how to combine, chain, and operate them. The repo source is
`C:\Users\Admin\610ClaudeSubagents`; the files in this skill are the durable
curated copy.

## Browse the Library

- `agents/` — 610 individual subagent definitions (`agents/<name>.md`). Pick a
  name that matches the missing capability; each file is a self-contained
  agent prompt.
- `agents-quickref.md` — fast table-of-contents and one-line capability map.
- `agent-chaining-patterns.md` — how to hand off results between subagents.
- `swarm-combinations.md` — multi-specialist configurations.
- `flowstrats.md` — routing strategy selection.
- `industry-playbooks.md` — vertical playbooks (finance, support, ecommerce...).
- `prompt-templates.md` — reusable prompt scaffolds.
- `custom-agent-builder-guide.md` — write your own subagent.
- `troubleshooting.md` — degraded/hallucinating subagent recovery.
- `tutorial.md` — end-to-end walkthrough.
- `workflow-automation-scripts.md` — automation glue examples.

## Deploy a Subagent

The library defines Claude Code-style `#/` subagent skills. To deploy one into
an agent process, copy the chosen `agents/<name>.md` content into the agent's
working skill file, scoped to a minimal role statement: do not merge multiple
agents into one file unless their skills truly overlap.

## Deduplication Boundary (AIEngineer)

`C:\Users\Admin\AIEngineer` wraps most of this library in a one-shot
"AI engineer at a company" persona. Do not vendor AIEngineer as a second
catalog entry; mine new capabilities from it only when they are absent here.
See `tier1-integration-runtime` for the ownership notes.