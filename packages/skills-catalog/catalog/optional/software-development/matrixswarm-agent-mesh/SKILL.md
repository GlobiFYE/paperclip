---
name: matrixswarm-agent-mesh
description: >
  Operator reference for MatrixSwarm, a self-hosted always-on agent mesh: routing matrix, 25 agent
  docs, and a JSON `matrix_directive` spawn format. Covers HA agents, intrusion detection,
  tripwires, alert relays, LLM oracle, and lifecycle reaping.
key: paperclipai/optional/software-development/matrixswarm-agent-mesh
recommendedForRoles:
  - platform
  - engineer
tags:
  - agent-mesh
  - monitoring
  - self-hosted
  - security
  - orchestration
trust: markdown_only
---

# MatrixSwarm agent mesh

Vendored from `C:\Users\Admin\matrixswarm\matrixswarm\docs` as `markdown_only`: 25 agent reference
docs plus 8 architecture/doctrine docs. Text is verbatim.

**What this is.** A design + operations reference for running a long-lived, self-hosted agent mesh
where agents are OS processes supervised by other agents, wired together by a central router. It
is genuinely useful for thinking about mesh topology, HA, and blast-radius containment.

**What this is not.** Not a Paperclip skill you can invoke to accomplish a task. Nothing here
executes, and MatrixSwarm is a separate Python service (`matrixswarm` package, Flask + websockets)
that must be deployed and configured independently. Read it for design patterns; wire your own
agents through Paperclip.

## The 25 agent docs (`agents/`)

**Core & command.** `matrix` (central brain + message router) · `commander` (live text dashboard of
agent status) · `matrix_https` (Flask API surface) · `matrix_websocket` (secure real-time transport).

**Watchdogs (HA).** `apache_watchdog` · `nginx_watchdog` · `mysql_watchdog` · `redis_watchdog` —
each monitors its service and restarts it. Pattern: a dedicated agent per service, restart on
failure.

**Lifecycle / containment.** `sentinel` (resurrects critical agents like Matrix) · `reaper`
(terminates other agents, patrols for kill orders) · `scavenger` (cleans directories of dead or
tombstoned agents) · `agent_doctor` (health-checks agents) · `tripwire_lite` (watches critical
filesystem paths) · `permissions_guardian`.

**Security monitoring.** `ghost_wire` (three-layer host IDS: `who` session tracking, real-time
command polling via an injected `PROMPT_COMMAND` matched against suspicious patterns, `inotify`
file-integrity monitoring) · `gatekeeper` (watches auth logs).

**Comms & relays.** `telegram_relay` · `email_check` (IMAP) · `email_send` (directory-of-JSON → SMTP)
· `google_calendar` (fetch + broadcast upcoming events) · `log_watcher`.

**Analysis & utilities.** `oracle` (calls an LLM API on behalf of other agents) · `load_range`
(system load + daily perf reports) · `storm_crow` (NWS severe-weather alerts) · `mr_blank`
(boilerplate template for a new custom agent).

## The 8 doctrine docs (`docs/`)

`ARCHITECTURE.md` (the largest, ~22 KB — start here) · `AGENTS.md` (agent index) ·
`TEAM_DEPLOYMENT_LOGIC.md` · `TUTORIALS.md` · `matrixswarm_runtime_doctrine.md` ·
`matrixswarm_encryption_system.md` · `matrixswarm_identity_and_trust_registration_protocol.md` ·
`crypto_alert_walkthrough.md`.

## The `matrix_directive` spawn format

Every agent doc configures itself through one JSON shape — worth copying even if you never deploy
MatrixSwarm:

```python
matrix_directive = {
    "universal_id": "matrix",
    "name": "matrix",
    "children": [
        {
            "universal_id": "ghostwire-1",
            "name": "ghost_wire",
            "config": {
                "command_patterns": ["sudo", "su", "wget", "curl"],
                "watch_paths": ["/var/www/html", "/etc/nginx/sites-enabled"]
            }
        }
    ]
}
```

Config keys are per-agent and documented in each doc (e.g. `tick_rate` in seconds,
`command_patterns`, `watch_paths`).

## Read this before trusting the index

`docs/AGENTS.md` lists **28** agents, but only **25** docs exist. Five are documented-but-absent and
have no vendored file: `forensic_detective`, `system_health`, `network_health`, `discord_relay`,
`blank`. (The index also points `blank` at `./agents/blank.md` while the shipped file is
`mr_blank.md`.) Treat the index as aspirational, not as a coverage guarantee.

## Platform caveat — this is Linux-targeted

The mechanisms assume a POSIX host: `who`, `inotify`, `PROMPT_COMMAND` injected into `.bashrc`,
`/etc/passwd`, `/var/www`, `/root/.ssh`. **This machine is Windows**, so the concrete commands do
not apply locally; the supervision *architecture* (one watchdog per service, sentinel/reaper for
lifecycle, identity + trust registration) transfers, the plumbing does not. Windows equivalents:
PowerShell event logs and `Get-FileHash` for integrity, Task Scheduler or a service manager for
restart policy, and the Synapse/WinEvent bridge for event capture.

## Deliberately not vendored

`matrixswarm/codex/**` (~50 files: `Birth_of_Matrix.md`, `Cookie_Ceremony.md`,
`Jabroni_Cascade.md`, `hive_creed.md`, `kill_chain_doctrine.md`, genesis/chain-of-trust lore, …)
is narrative/lore prose about the swarm's internal mythology, not operational instruction. It would
be padding in a skills catalog and was left out. The one exception is that the genuinely useful
*doctrine* documents were already published as proper docs in `docs/` and are included above.

## Provenance

Vendored 2026-09-26 from `C:\Users\Admin\matrixswarm\matrixswarm\docs`. Upstream: the MatrixSwarm
project (`matrixswarm` on PyPI). The agent docs carry a header noting they were architected with
the author's "designated AI construct, Gemini" and translated for human operators.
