# Deliverables isolated test instance (host only)

Run these commands on the host after review. The builder does not start servers,
restore databases, contact Gemini, or write outside this checkout. Do not run
`launch.py` here: it targets the live home. Do not use `worktree init --from-*`
for this test: that takes a new live snapshot, whereas this work order requires
the newest existing backup.

The helper below uses the repository's embedded Postgres, restore, migration,
worktree quarantine, routine pause, and workspace rebinding helpers. It refuses
an existing test home. It pauses all companies and agents, disables routine
triggers, tool connections, chat endpoints and plugins, cancels queued/running
work, stops runtime services and clears their exposure state, copied process IDs, tool runtime slots and environment cleanup leases. It installs and
exercises database triggers rejecting queued/running agent runs and wakeups.
It copies attachment bytes into the test home; it never links live storage.
No live credentials or workspace trees are copied.

`PAPERCLIP_ONLY_DELIVERABLE_SWEEP=1` skips the app's other background timers
and startup jobs: plugin jobs/loading/watchers/log flushing, feedback export,
email polling, chat reconciliation/live-event delivery, browser reconciliation,
import cleanup, execution reconciliation, heartbeat/recovery/lease cleanup,
connection delivery, and scheduled backups. Keep the copied database quarantine
and admission guards as independent protection against request-driven execution.
The host must inspect the quarantine proof before starting the app.

```sh
set -e
cd /Volumes/AI-Models/pantheon-wt/deliverables-page
export NVM_DIR=~/.nvm
. "$NVM_DIR/nvm.sh"
nvm use 24
export TMPDIR=/tmp
pnpm build
node scripts/link-cli-externals.mjs
node --conditions=pantheon-dist cli/dist/index.js --version
pnpm -r typecheck
pnpm --filter @paperclipai/server exec vitest run src/services/deliverable src/__tests__/server-startup-feedback-export.test.ts
pnpm --filter ./ui exec vitest run src/api/deliverables src/components/Sidebar src/pages/Deliverables

# Fresh fixed destination; fails if it already exists. No API server is started.
env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp \
  PAPERCLIP_HOME=/Volumes/AI-Models/pantheon-wt/deliverables-home \
  node --import ./cli/node_modules/tsx/dist/loader.mjs \
  server/scripts/deliverables-test-instance.ts
```

Require `noRunGuard: PASS` and zero active agents, runs, services, enabled triggers
and enabled connections. The helper prints the chosen backup and resolved config,
DB, storage and server paths. All writable paths must begin with
`/Volumes/AI-Models/pantheon-wt/deliverables-home/`; server host must be
`127.0.0.1`, port `3300`. On failure, leave the home for inspection and do not
start the server. To repeat, first stop any test processes, then rename that test
home to a unique archival name; the helper must create a fresh destination.

Start in a separate terminal, preserving the clean environment. Set the env-file
path to the operator's existing Gemini credentials file (contents never printed):

```sh
cd /Volumes/AI-Models/pantheon-wt/deliverables-page
export NVM_DIR=~/.nvm
. "$NVM_DIR/nvm.sh"
nvm use 24
env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp \
  PAPERCLIP_HOME=/Volumes/AI-Models/pantheon-wt/deliverables-home \
  PAPERCLIP_CONFIG=/Volumes/AI-Models/pantheon-wt/deliverables-home/instances/default/config.json \
  PAPERCLIP_INSTANCE_ID=default \
  PAPERCLIP_ONLY_DELIVERABLE_SWEEP=1 \
  HEARTBEAT_SCHEDULER_ENABLED=false PAPERCLIP_DB_BACKUP_ENABLED=false \
  PAPERCLIP_ANNOUNCEMENTS_ENABLED=false \
  PAPERCLIP_DELIVERABLE_SUMMARY_MODEL=gemini-3.5-flash-lite \
  PAPERCLIP_DELIVERABLE_SUMMARY_ENV_FILE="$HOME/.hermes/profiles/pc-gemini/.env" \
  PORT=3300 HOST=127.0.0.1 NODE_OPTIONS=--conditions=pantheon-dist \
  node cli/dist/index.js run
```

Require the startup log `Deliverable-only mode: other background startup jobs disabled`.
Inspect the boot banner again: Home, Config, Database and storage must resolve
inside the test home. Abort if any points at live data. `lsof` must show only a
loopback listener for port 3300:

```sh
lsof -nP -iTCP:3300 -sTCP:LISTEN
curl --fail http://127.0.0.1:3300/api/health
mkdir -p screenshots
curl --fail http://127.0.0.1:3300/api/companies/57cfaea0-c864-4bff-9433-2fad7be3d4c5/deliverables \
  -o screenshots/deliverables-response.json
node -e 'const r=require("./screenshots/deliverables-response.json"); console.log({cards:r.deliverables.length,generated:r.deliverables.filter(d=>d.generationState==="generated"&&d.summary).length,states:r.deliverables.map(d=>d.generationState)}); if(!r.deliverables.length) process.exit(1)'
```

Repeat the GET after a few minutes and require at least three `generated` cards
with useful stored text; the first page is newest-first while backfill prioritizes new completions, due retries and repairs before
routine generated-row checks, so follow `nextCursor` if needed. The sweep admits at most five
attempts in a rolling minute, with one HTTP request per durable attempt and four
attempts per generation: the initial request and retries after 5 minutes,
30 minutes and 2 hours. Provider failures then stay `failed_final`;
there is no automatic daily requeue. Missing credentials leave cards
pending with fallback text, without consuming attempts or rate slots. The API
returns `summariesEnabled: false` and the page checks every five minutes for
restored credentials. With credentials, nonterminal cards (including scheduled
retries) poll every 30 seconds. Polling stops when all loaded cards are terminal. Evidence
repairs remain capped at two per issue; their cap is not reset by a provider
configuration change. Do not call fallback text a successful live-model proof.

The sweep examines at most ten candidates per tick, rechecks unchanged generated
rows once per day as a safety check; issue/comment/product/attachment timestamp
changes qualify earlier. Due work takes priority. A rate rejection stops the tick
without moving the candidate's checkedAt timestamp.
Each summary input includes at most twelve comments and six work products.
Verification attribution separately checks at most 24 matching comments.

To explicitly requeue provider failures, stop the test process and
repeat the launch command above with this additional environment assignment
inside its `env -i` command (before `node`):

```sh
PAPERCLIP_DELIVERABLE_SUMMARY_CONFIG_VERSION=operator-requeue-20261012
```

Use a new nonsecret value for each explicit requeue. A changed model, base URL or
credential also requeues provider failures. This does not bypass the rate gate or
the lifetime evidence-repair cap. Successful summaries are retained.

Try a board agent invocation against one paused copied agent and require denial:

```sh
curl --fail http://127.0.0.1:3300/api/companies/57cfaea0-c864-4bff-9433-2fad7be3d4c5/agents -o screenshots/test-agents.json
TEST_AGENT_ID=$(node -e 'console.log(require("./screenshots/test-agents.json")[0].id)')
curl -sS -o screenshots/invoke-denial.json -w '%{http_code}\n' \
  -H 'Content-Type: application/json' -d '{}' \
  "http://127.0.0.1:3300/api/agents/$TEST_AGENT_ID/heartbeat/invoke"
```

Require a 4xx denial, no new run, and the helper's database guard proof. Do not
unpause copied agents to test the UI.

```sh
node /Volumes/AI-Models/pantheon-ai/tools/shot/capture.mjs \
  --url http://127.0.0.1:3300/TOP/deliverables \
  --out "$PWD/screenshots/deliverables-desktop.png" --preset desktop \
  --wait-selector '[data-testid="deliverable-card"]'
node /Volumes/AI-Models/pantheon-ai/tools/shot/capture.mjs \
  --url http://127.0.0.1:3300/TOP/deliverables \
  --out "$PWD/screenshots/deliverables-phone.png" --width 390 --height 844 \
  --wait-selector '[data-testid="deliverable-card"]'
```

Inspect project and UTC date filters, pagination, fallback/summary text, authors,
verification, unavailable output labels, and absence of horizontal scrolling.
Stop with Ctrl-C in the server terminal and wait for embedded Postgres shutdown.
Never merge the test config, triggers or copied database into production.

Migration compatibility: 0295 has already run on the host test copy, so its SQL
and snapshot are preserved. Forward migration 0297 drops the unused
`completion_version` column; the application schema no longer includes it. Run
normal migrations on existing copied homes before starting the updated server.
