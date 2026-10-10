---
name: tier1-integration-runtime
description: >
  Runbook for the Tier 1 integration subservices installed for the Paperclip
  control plane: repo locations, toolchains, install/build/verify/run commands,
  and how each connects back (MCP subservice, catalog content, or eval-gated
  worker).
key: paperclipai/optional/software-development/tier1-integration-runtime
recommendedForRoles:
  - engineer
  - platform
  - product-manager
tags:
  - tier1
  - mcp
  - subservice
  - runbook
  - integrations
requires:
  - git
---

# Tier 1 Integration Runtime

All Tier 1 repos are mirrored from `E:\GitHub` into `C:\Users\Admin\<repo>`
(excluding `.git`). Source-checkouts remain in `E:\GitHub`.

The MCP column was re-verified against the files actually on disk on
2026-10-09. Two Tier 1 repos ship launchable MCP servers and **both are wired and
callable** (`graphiti`, `wikiskill`). `contextgraph` ships MCP *source* that cannot
be built on this host. Everything else is a prompt/agent/skill library and
integrates as a Paperclip **catalog skill**, not as a tool gateway.

Earlier revisions of this runbook dated 2026-09-25 said `wikiskill` had "no MCP
server". That was true then and is now false: wikiskill shipped
`wikiskill/mcp_server.py` with the console entrypoint `wikiskill-mcp` (declared in
its `pyproject.toml`), and that server is registered and callable. The same
sentence's verdict for `contextgraph` and `matrixswarm` still holds.

## Installed Subservices

| Repo | Type | Toolchain | Install / Verify | Run |
| --- | --- | --- | --- | --- |
| graphiti | temporal KG builder + **MCP server** (Python) | uv venv `C:\Users\Admin\graphiti\.venv` | editable install; `import graphiti_core` | stdio MCP: `python -m graphiti_mcp_server` from `mcp_server\src` (see below) |
| contextgraph | MCP memory (Rust) | cargo 1.98.1 | `cargo build --release -p context-graph-mcp` — **BLOCKED**, needs CUDA `nvcc` | source-only; no binary built on this host |
| Archon | workflow executor (bun monorepo) | bun 1.4.2 | `bun install` in `C:\Users\Admin\Archon` | per `packages/*` scripts |
| ai-software-factory | ship pipeline (Python) | python 3.12 (uv) | `python bin/factory.py init --source <archon>` | on-demand issue → ship |
| prime-agent | coding agent host (Node) | node 26.8.1 | `npm ci` in `C:\Users\Admin\prime-agent` | WSL-partitioned worker |
| wikiskill | skill/wiki loop (Python) + **MCP server** (stdio) | uv venv `C:\Users\Admin\wikiskill\.venv` | editable install; `import wikiskill` | `wikiskill` CLI + 8 markdown skills in `skills\`; **also a wired MCP server** — `wikiskill-mcp` (see below) |
| matrixswarm | multi-agent coordination (Python) | uv venv `C:\Users\Admin\matrixswarm\.venv` | editable install; `import matrixswarm` | Python library — **no MCP server** |
| Serendipity | agent OS skill (Deno) | deno 2.9.7 | `deno check src/main.ts` green | `deno task start` |
| 610ClaudeSubagents | content catalog | none | vendored as `claude-subagents-catalog` | browse `agents/*.md` |
| AIEngineer | content catalog | none | dedup with 610 (do not double-vendor) | fell-into catalog above |
| Roo-Code | VS Code worker (roo-cline) | node 20.18.1 (vscode ^1.84) | `npm install` in `C:\Users\Admin\Roo-Code` | eval-gated headless via `evals/` — an MCP *client*, not a server |

## MCP Reality (verified 2026-10-09: file inspection + live governed tool calls)

Two Tier 1 repos are runnable MCP servers, and **both are wired, board-approved,
and callable end-to-end**:

- **graphiti** — package `mcp-server` at `C:\Users\Admin\graphiti\mcp_server`,
  entry point `mcp_server\src\graphiti_mcp_server.py`, stdio transport example
  at `mcp_server\config\mcp_config_stdio_example.json`. Note the module path is
  `graphiti_mcp_server`, **not** `graphiti_core.mcp_server`.
  Connection `1ff8416f-85e3-481f-860e-4c08ff8114dd`.
- **wikiskill** — module `wikiskill\mcp_server.py`, console entrypoint
  `wikiskill-mcp` (`pyproject.toml`: `wikiskill-mcp = "wikiskill.mcp_server:main"`),
  stdio transport, policy from `C:\Users\Admin\wikiskill\wikiskill-mcp.json`.
  Connection `f40ec0c5-e2a4-4f2d-ac1b-dca849e154d3`. Serves **9 tools**
  (list/status/read/grade/run/evolve/transfer skills + workspaces).

  Its config sets `allow_execution: false`, which deliberately disables
  `wikiskill_run_task` and `wikiskill_evolve` while leaving the read and grading
  tools callable. That is the intended posture, not a defect.

Everything else is either MCP *source that cannot build here*, or a library:

- **contextgraph** — crate `crates/context-graph-mcp` exists, but
  `target\release` contains **no binaries**. Installing CUDA would **not** fix
  this: the repo requires **CUDA 13.1+** and targets **sm_120 / RTX 5090**
  (`context-graph-graph/src/lib.rs:63`), while this host is a **GTX 1050 /
  sm_61** on driver CUDA **11.6**. Two `compile_error!` guards
  (`context-graph-embeddings/src/lib.rs:46`, `context-graph-graph/src/lib.rs:56`)
  forbid a CPU fallback outright. Only `context-graph-core` builds here, and it
  checks clean. Status: **install-blocked**, not merely uninstalled.
- **Roo-Code / Archon / prime-agent** — these *consume* MCP servers
  (`useMcpToolTool.ts`, `mcp-servers.md`, `packages/ai/src/mcp.ts`). They are
  not servers and cannot be registered as gateways. Archon is the subtle case:
  its `buildArchonMcpServer` uses the Claude Agent SDK's `createSdkMcpServer()`,
  which registers tools **in process** for the agent loop. That is a tool host,
  not a transport server, so there is nothing to register.
- **matrixswarm / ai-software-factory / Serendipity / 610 / AIEngineer** — no
  MCP surface at all. Integrate as catalog skills.

### A graphiti timeout is not an outage signal

Re-verified 2026-10-09. A `tool_timeout` from graphiti does **not** mean the
integration is down. Measured on a healthy host that same run — Neo4j bolt
`7687` accepting, two `java` processes up:

- `wikiskill_list_workspaces` -> succeeded immediately, no deferral.
- `get_status` -> timed out twice against that same healthy Neo4j.

Cause is client-side startup, not the database. Warm stdio startup measures
~5.3s against `DEFAULT_TOOL_TIMEOUT_MS = 10_000`, so the margin is thin and calls
defer intermittently; `sentence_transformers` is *not* on the startup path.
Re-issue the call rather than restarting anything.

Neo4j durability remains **logon-scoped, not machine-level** (`HKCU\...\Run` +
Startup entry; `neo4j.bat install-service` needs elevation). A preflight
(`neo4j_preflight.py`) self-starts the database when bolt is closed, but a cold
boot takes ~12s and will still exceed the first call's budget.

## Verified State

- `graphiti_core` and `wikiskill` import cleanly in their venvs; `matrixswarm`
  imports too but ships no MCP entrypoint.
- `Serendipity` type-checks under `deno check src/main.ts`.
- `context-graph-mcp` / `context-graph-cli` release build **fails** on this host
  (`cudarc` build.rs needs `nvcc`); `target\release` has no `context-graph-mcp.exe`.
- `Archon` installs with `bun install` (workspaces `packages/*`).
- `graphiti` installs editable after adding the missing `httpx` dependency.
  **Runtime is live**: Neo4j Community 5.26.4 runs locally (Bolt `localhost:7687`,
  HTTP `7474`, JDK 21 at `C:\Users\Admin\jdk\jdk-21.0.12.1+1`), and the
  `Neo4jDriver` write+readback proof passed
  (`graphiti_db_layer=GREEN`).
- `graphiti` LLM + embedder tiers run against a local **Ollama** OpenAI-compatible
  endpoint (`http://127.0.0.1:11434/v1`) — no hosted keys required.
- `prime-agent` installs via `npm ci`. Its only npm lifecycle script is
  `prepare: husky`; the `install:*` names are custom scripts, not hooks, so the
  "blocked install scripts" premise is false. All 4 packages build.
- `Roo-Code` installs via `npm install`. It compiles and completes a real
  activation cycle with no unhandled errors — it simply is not connectable: an
  MCP **client** that hard-depends on the VS Code extension host, with no `bin`
  to spawn.

## Per-Project Verdict

The honest disposition of all 11 Tier 1 repos, so nobody re-derives it:

| Project | Verdict | Why |
| --- | --- | --- |
| graphiti | **wired** | real MCP server; connection `1ff8416f-…`, callable |
| wikiskill | **wired** | real MCP server; connection `f40ec0c5-…`, callable, read/grade only |
| 610ClaudeSubagents | **wired as catalog content** | `claude-subagents-catalog`, 622 files / 610 agent definitions |
| AIEngineer | **wired as catalog content** | `ai-engineer-playbooks`; its *agent* content is deliberately not double-vendored |
| contextgraph | **install-blocked** | needs CUDA 13.1+ / sm_120; host is sm_61 / CUDA 11.6 |
| prime-agent | **deliberately not wired** | MCP client; would need a CLI/RPC shape, not a gateway |
| Roo-Code | **deliberately not wired** | VS Code extension, MCP client, no `bin` |
| matrixswarm | **deliberately not wired** | no MCP surface; only an mTLS/WSS mesh |
| Serendipity | **deliberately not wired** | no MCP surface; Deno web app. **No catalog skill either** |
| ai-software-factory | **deliberately not wired** | Python CLI scripts, no packaging, no server |
| Archon | **deliberately not wired** | `createSdkMcpServer()` is in-process, not a transport server |

Serendipity is the one project with **no representation in either lane** — it is
neither wired nor vendored as a catalog skill.

## Connecting Back to Paperclip

There are exactly two integration shapes, and picking the wrong one is the most
common mistake here.

**1. Library / prompt pack → catalog skill (no gateway).**
The agent loads the markdown on demand. This is how **8 of the 11** Tier 1 repos
reach Paperclip — the remaining three are the two wired MCP servers plus
contextgraph, which is install-blocked. Drop content into
`packages/skills-catalog/catalog/optional/<category>/<slug>/SKILL.md`, validate
with `scripts/validate-catalog.ts`, emit with `build:manifest`. Existing Tier 1
entries under `optional/software-development/`: `tier1-integration-runtime` (this
runbook), `claude-subagents-catalog` (the 610 library, 622 files),
`wikiskill-skills` (wikiskill's 8 skills), `ai-engineer-playbooks`,
`ai-software-factory`, `archon-workflows`, `matrixswarm-agent-mesh`, and
`prime-agent-skills`.

`GET /api/skills/catalog` currently serves **25** skills (10 bundled + 15
optional). There are **24** `SKILL.md` files on disk; the 25-vs-24 gap is
`last30days`, which the server resolves from the published package via
`require.resolve` ahead of the dev catalog root. That is expected, not a defect.

**2. Real MCP server → governed tool gateway.**
Register a command-backed gateway (`toolMcpGateways`) or expose it on
`remote_http` and add a `toolConnections` row — same pattern as
`paperclip-google-sheets-mcp-server` in `server/src/services/tool-gateway.ts`.
Registration is governed: per the `prepare-mcp-integration` playbook each
connection needs cited research, a content PR, and exact-revision board approval
before a connector PR lands. Never hot-wire into the dev server.

A connection is only callable by an agent when **all three** layers exist:

1. **identity grant** — created automatically by `createConnection`
2. **agent install** — the connection must appear in that agent's
   `installedConnections`
3. **permitted tools** — the agent's effective profile must allow tools from it

`usableConnectionForAgent` (`server/src/services/connection-intents.ts:202`)
requires all three. Layer 1 alone is **not** callable, which is why registering a
server proves nothing on its own.

`graphiti` gateway wiring:

- command: `C:\Users\Admin\graphiti\.venv\Scripts\python.exe`
- args: `-m graphiti_mcp_server`
- working directory: `C:\Users\Admin\graphiti\mcp_server\src`
- environment: `CONFIG_FILE` pointing at a config derived from
  `mcp_server\config\mcp_config_stdio_example.json`, with
  `NEO4J_*` pointing at the local Neo4j and the OpenAI-compatible block pointing
  at `http://127.0.0.1:11434/v1`.
- requires the local Neo4j console to be running first (see the Neo4j how-to).

`wikiskill` gateway wiring:

- command: `C:\Users\Admin\wikiskill\.venv\Scripts\python.exe`
- args: `-m wikiskill.mcp_server`
- config: `C:\Users\Admin\wikiskill\wikiskill-mcp.json`
  (`workspaces_root=C:/Users/Admin/wikiskill/workspaces`, `allow_execution=false`)
- re-registration is idempotent: `register-wikiskill-mcp.cmd` at the repo root
  creates layers 1–3 and reuses a duplicate `templateId` on 409.

  Note the gateway spawns with **no working directory**, which is why
  `wikiskill\mcp_server.py` reads its config by absolute path and re-points fd 1
  away from stdout before the stdio transport claims it. Any wrapper you write
  must preserve both behaviours.

Auditing a governed call: `GET /api/tool-gateway/audit/agent` is agent-scoped
and returns your own rows. The board-only `GET /api/tool-gateway/audit` returns
403 to agents. Note `companyId` on the agent route is a **query parameter**, not
a path segment.

`kv-demo-mcp-server` is the standalone Streamable HTTP reference (default
port 8848, `/mcp`).

Eval-gated writers (Roo-Code headless, prime-agent) provision only through
the approved issue→ship path; never hot-wire them into production queues.

See `claude-subagents-catalog` for the vendored agent library, and the ONE-198
integration map for the full Tier 1 plan document.

## Provenance

The MCP verdicts here were re-verified on 2026-10-09 against files on disk plus
live governed tool calls, not restated from the earlier 2026-09-25 inspection.
Sources: ONE-233 (graphiti + wikiskill wired end-to-end), ONE-234 (prime-agent,
Roo-Code, contextgraph), ONE-235 (matrixswarm, Serendipity, ai-software-factory,
Archon). The 25-skill count was read live from `GET /api/skills/catalog`.

Boundaries when editing this file: documentation only. Do not read the Neo4j
password into it or write it back out from any committed file.