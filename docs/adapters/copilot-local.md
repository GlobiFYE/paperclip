---
title: GitHub Copilot CLI
summary: GitHub Copilot CLI local adapter setup and configuration
---

The `copilot_local` adapter runs the GitHub Copilot CLI (`copilot`, npm package `@github/copilot`) locally. It runs headless with `copilot -p` and parses the JSONL event stream (`--output-format json`). It supports session persistence and structured output parsing.

## Prerequisites

- GitHub Copilot CLI installed (`copilot` command available):
  - `npm i -g @github/copilot`, or
  - Homebrew: `brew install copilot-cli`
- An active GitHub Copilot entitlement for the authenticated account
- Authentication configured via one of:
  - `copilot login` (device code or web flow; the token is stored in the OS keychain, with a plaintext fallback in `~/.copilot/config.json`)
  - `COPILOT_GITHUB_TOKEN` set in the adapter env or server shell. Use a fine-grained personal access token with the "Copilot Requests" permission. Classic `ghp_` tokens are not supported.
  - The CLI also honours `GH_TOKEN` and `GITHUB_TOKEN`, but this is not recommended in Paperclip because Paperclip reserves those variables for git remote access.

## Configuration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cwd` | string | Yes | Working directory for the agent process (absolute path; created automatically if missing when permissions allow) |
| `model` | string | No | Model id passed via `--model`. Defaults to `auto`. |
| `reasoningEffort` | string | No | Reasoning effort: `none` \| `minimal` \| `low` \| `medium` \| `high` \| `xhigh` \| `max`. Passed via `--reasoning-effort`. |
| `promptTemplate` | string | No | Prompt used for all runs |
| `instructionsFilePath` | string | No | Markdown instructions file prepended to the prompt |
| `allowAllPaths` | boolean | No | Toggle: pass `--allow-all-paths` so the agent can access files outside the working directory |
| `disableBuiltinMcps` | boolean | No | Toggle: pass `--disable-builtin-mcps` to drop the built-in `github-mcp-server` |
| `command` | string | No | CLI command override. Defaults to `copilot`. |
| `extraArgs` | string[] | No | Additional CLI arguments appended to every run |
| `env` | object | No | Environment variables (supports secret refs) |
| `timeoutSec` | number | No | Process timeout (0 = no timeout) |

## How Runs Work

Each heartbeat runs the CLI headless:

```
copilot -p "<prompt>" --output-format json --allow-all-tools --no-ask-user ...
```

- `-p` runs a single prompt non-interactively and exits.
- `--output-format json` emits one JSON event per line. The final line is always a `result` object carrying the exit code, session id, and usage (`premiumRequests`).
- `--allow-all-tools` is required for non-interactive mode; without it, write and shell permission requests are auto-denied.
- `--no-ask-user` removes the `ask_user` tool so the agent never blocks waiting for input.

## Session Persistence

The session is pinned with `--session-id <uuid>` on the first run, and resumed with `--resume=<id>` on later heartbeats so the agent retains context. The session id is taken from the final `result` line (the stream does not reliably include a `session.start` event).

If resume fails because the session no longer exists (`No session, task, or name matched ...`), the adapter clears the stored session and retries with a fresh one.

## Billing

Copilot usage is billed in premium requests (AI credits). Each model has a multiplier (for example `auto` gets a 10% discount, `claude-haiku-4.5` is 0.33, `claude-sonnet-4.6` is 9, `gpt-5.5` is 57). Usage is reported as unpriced credits: Paperclip records the premium-request count but no dollar cost. The count in `result.usage.premiumRequests` is cumulative per session, so the per-run figure is the difference from the previous run.

## Limits

- v1 supports the headless CLI lane only. There is no ACP engine.
- Local execution environment only.

## Troubleshooting

- **Authentication failure**: with no usable login the CLI exits 1 with empty stdout and `Error: No authentication information found.` on stderr. Run `copilot login` or set `COPILOT_GITHUB_TOKEN`. Note that an invalid `COPILOT_GITHUB_TOKEN` can silently fall back to a keychain login.
- **`No session, task, or name matched '<id>'`**: the stored session is gone. The adapter clears it and retries with a fresh session automatically.
- **CLI versions**: the Homebrew binary can have an older version built in and auto-load a newer downloaded package from its cache. Set `CI=1` to stop update downloads while keeping the cached newest version. Do not set `COPILOT_AUTO_UPDATE=false`: it downgrades to the bundled older version, which may lack flags such as `--usage-output-file`.
