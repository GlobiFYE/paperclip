# Onboarding and first work

An operator can start an instance, create a company, configure its first agent, and reach a real first task. Instance setup and company onboarding are separate steps.

Implementation: [web wizard](../../ui/src/components/OnboardingWizard.tsx), [CLI setup](../../cli/src/commands/onboard.ts).

Agent access: [companion](../agent-access-map/onboarding.md).

## Sub-features

- `instance`: choose local instance configuration and start the server.
- `company`: create a company with its identity and initial agent.
- `adapter`: choose an available harness, model, account, and execution environment.
- `first-task`: leave setup with a task whose execution or missing prerequisite is visible.
- `resume`: return to an incomplete wizard without losing saved state.

## How to get to it (user POV)

### `web-wizard`

Open `/onboarding` or the onboarding launcher in an empty company context.
Use `/<company-prefix>/onboarding` to resume an existing company's agent setup;
the unprefixed route starts at organization naming on self-hosted instances.
Cloud-managed instances reuse their existing company for agent setup.

### `cli-setup`

Use `paperclipai onboard --help` or `paperclipai run --help` to select an isolated data directory before setup.

## Driving it with Playwright and the Paperclip CLI

Preconditions: follow the [baseline](./README.md#before-driving-a-journey). Use a new isolated data directory and record deployment mode. A configured adapter may still need account authentication.

### `web-wizard`

Automated: [wizard tests](../../ui/src/components/OnboardingWizard.test.tsx) cover mocked wizard behavior; [onboarding browser suite](../../tests/e2e/onboarding.spec.ts) supplies its own test environment. Live model execution is a separate check.

- **Create company and resume.** Start a fresh empty instance and run doctor using
  the [verification skill](../../.agents/skills/verify-paperclip/SKILL.md). Run
  `node .agents/skills/verify-paperclip/scripts/onboarding-smoke.mjs --evidence-dir "$VERIFY_EVIDENCE_DIR"`.
  The helper opens `/onboarding` in a fresh self-hosted instance, enters a unique
  name in `e.g. Northwind Labs`, and chooses `Continue`. The agent-name field must
  appear and the saved company must have no invented goal. Reopen the
  company-prefixed onboarding route and reload; the agent step must appear
  without creating another company. Screenshots and a trace capture the real UI action and result.
  This proves company creation/resumption, not hiring or a first model run.

Manual: Create a disposable company and first agent. Leave midway, reopen the
company's onboarding route, and finish; drafts save automatically. Follow the
created first task, verify the selected agent and company, and inspect its output
or explicit authentication gate. Reload both company and task.

For Codex, choose the harness and leave runner selection automatic to prove the
first-agent default. On a qualified target it saves Paperclip Runner; Advanced
also permits Legacy. Do not switch runners after onboarding when claiming proof
of that default. Test the selected runtime and account, then complete a bounded
useful task and follow-up with an independently checked file artifact. Saved
execution configuration and recorded run identity must match after reload.
The Codex first-task eval applies operator QA bounds before Get started through
the existing agent configuration API. It verifies that only timeout and
concurrency change; automatic runner, account and environment choices remain.
These campaign bounds are separate from production creation defaults.
Use [runner validation](./runs-adapters.md#adapter-setup) and
[environment qualification](./execution-environments.md#environment-settings)
for the prerequisites; a successful login alone is insufficient.

For a new Codex agent with Auto on a saved immutable OCI sandbox, Connect first
uses the existing saved environment probe when authoritative qualification is
absent. The board actor needs the existing instance-environment administration
permission. Refresh company/environment-scoped discovery before testing the
selected runtime. A denied probe, unconfirmed cleanup or setup failure must be
visible; selecting Legacy remains an explicit choice. Creation and discovery
themselves allocate no target. A valid measured unsupported target follows the
server's Legacy default. Named Cloud snapshots remain a separate unqualified
boot-identity and fresh-signup gap.

Selected native setup derives its target isolation as task execution does. The
hello probe retains its read-only permission profile, approval-never policy and
bounded provider turn. It skips Codex's project-instruction discovery in its new,
empty private workspace; ordinary tasks still load their project instructions.
Local and SSH transports retain Codex isolation. An injected environment flag
cannot establish an outer sandbox identity. Verify these boundaries with the
existing native setup controls and a real managed task/follow-up; source checks
alone are insufficient.

The explicit manual Product E2E cell
`confirmation-replies.runner-codex.daytona.task-card-accept` covers this fresh
managed wizard path without fixture agent creation or a fixture preprobe. Its
existing attachment oracle checks a downloaded physical file and follow-up
continuity. Setup evidence must correlate both lease IDs with the same company,
environment and provider; missing responses or unmatched rows keep cost coverage
unknown. Run this cell only on an eligible target with separately authorized
provider, runtime and cleanup reservations. Its source and mock controls are
prepared; live execution remains unverified. Local cases and automatic selection
remain unchanged.

Leave and resume during harness/runner setup. Confirm the draft retains the
explicit choice and compatible account bindings, old native Codex setup links
recover the harness and runner, and a changed harness or runner invalidates stale
test results. Existing Legacy agents remain Legacy when their onboarding/setup
configuration is reopened; this journey does not migrate them.

Reload both `/onboarding` and the company-prefixed route after the first agent is
saved but before Get started. The authorized draft must retain its current step
and that agent's execution choice. An explicit new-company opening still starts
fresh. Opening another company must clear the previous company's resource IDs;
an unauthorized account must not restore its draft. Existing component controls
cover these boundaries; they do not substitute for the managed first-task eval.

### `cli-setup`

Automated: [CLI onboarding](../../cli/src/__tests__/onboard.test.ts) and [isolated test drive](../../cli/src/__tests__/test-drive.test.ts) cover their setup contracts; they do not establish that every model account is usable.

Manual: Run setup in the disposable directory, open the URL it prints, and confirm the instance identity and company. Restart using that same configuration and verify saved state. Exercise an unavailable adapter and confirm an actionable error.

## Gotchas

- An empty company, an empty instance, and an unauthenticated browser are different states.
- Creating an agent does not prove its provider login or first execution succeeded.
- See [access](./access.md) for authenticated deployments and [agents](./agents.md) for later hiring.
