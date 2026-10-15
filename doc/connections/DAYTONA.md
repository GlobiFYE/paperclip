# Daytona workspace diagnostics

Daytona uses the normal Apps connection, selected personal/company credential,
agent installation, action policy, gateway, revocation and audit paths. The API
key stays in the instance vault. It is never exported to an agent or borrowed
from the sandbox provider environment or another connection.

Sign-in tokens are never reused as resource tokens; id.paperclip.ing never
stores resource tokens; no connections hub on the ID service.

## Connect and test

Choose **Connectors → Daytona → Add key**, select access, and enter a Daytona
organization API key. No write/delete scope is required for these reads. An
optional organization ID under Advanced pins the credential's organization.
The server verifies the key with `GET /api-keys/current`; setup discovers the
bundled diagnostic catalog. Use the saved connection's ordinary Permissions
screen to select agents, change action policies, and test an action.

This is a native REST adapter behind the existing connection gateway, following
the Railway bridge pattern. Daytona documents a CLI/stdio MCP server with much
broader execution capabilities; this connector does not launch it. Its endpoint
is fixed to `https://app.daytona.io/api` and follows no redirects.

| Action | Behavior | Provider writes |
| --- | --- | --- |
| `daytona_get_account` | Verify the selected credential's organization identity | None |
| `daytona_list_workspaces` | Paginate company-recorded task leases, including retained sources | None |
| `daytona_get_workspace` | Read exact sandbox state, resource configuration and lifecycle errors | None |
| `daytona_get_workspace_recovery` | Read saved copyback failure and exact stop evidence | None |

Discovery uses host-owned company/task/lease records and ordinary issue access.
Calls take a Paperclip lease ID; arbitrary sandbox IDs and command arguments are
rejected. Unrelated organization sandboxes are never listed. Live inspection
checks that the provider sandbox identity and organization match the selected
credential. Responses expose selected scalar fields, never raw sandbox objects,
environment variables, preview credentials or provider errors. Reads are bounded
by time and bytes. Generic connection credential-export paths deny this provider.

Daytona itself does **not** provide a diagnostic-only API key: every valid key
can access running organization sandboxes through its toolbox, even with no
selected resource permissions. The server wrapper and normal connection
permissions enforce this connector's narrower capability. Revocation is checked
on every invocation, including calls through a retained gateway session.

## Workspace recovery

A stopped sandbox and a released lease do not prove that files were copied.
The diagnostic tool distinguishes file recovery from permission to continue the
source task. It does not clear holds, replay a run, answer a human review card,
start a sandbox, or run commands. Those require separately governed repair
operations, with exact source/stop proof and bounded durable attempts.

A shutdown must let an owned legacy adapter finish copyback before releasing its
sandbox. The recovery drain now joins that executor under one shared 30-second
budget, reads its final restore evidence, then applies the normal bounded retry
policy. If it cannot join, it records required file recovery and requests
stop-and-retain rather than ephemeral deletion. Startup and periodic reconciliation
can settle an existing shutdown hold when the latest same-run finalization proves
copy-back completed after that incident and every exact retained source has a
stop receipt. It preserves human review, unknown external outcomes and newer
incidents. Missing proof still requires source recovery; metadata alone is not
sufficient.

## Evidence and validation

Provider research verified 2026-10-15:

- https://www.daytona.io/docs/en/api-keys/ — key identity and organization/runtime authority.
- https://www.daytona.io/docs/en/sandboxes/ — exact sandbox lookup and lifecycle states.
- https://www.daytona.io/docs/en/mcp/ — CLI MCP transport and broad tool inventory.
- https://www.daytona.io/brand — official light/dark square logo assets, copied unchanged.

Logo sources: `https://framerusercontent.com/images/k2z1jCEWqymEd7reVoRseEVMFHU.svg`
and `https://framerusercontent.com/images/JjrFl7J2k84ANwYg3pD9Hwilc.svg`.

Deterministic tests exercise shared and personal vault ownership, setup/discovery,
real run-scoped gateway reads, output/error bounds, foreign-resource rejection,
revocation, and file-recovery reporting. These fixtures do not establish access
to a real Daytona organization. Real account proof is pending the operator's
connection; no test key, platform secret or credential grant is installed by
shipping this connector. There are no write actions to qualify in this version.
