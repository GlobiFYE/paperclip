# Host deployment after independent review

These are operator instructions, not actions performed by the builder. The
builder leaves all source changes uncommitted and never publishes. Run the
isolated proof in `TEST-INSTANCE.md` first. Keep its config and database separate.

1. Review the working diff, frozen-plan deviations and test evidence. On the
   host, commit only the approved source/docs on `deliverables-page`; do not add
   test homes, screenshots, build output or temporary tooling configuration.
2. Record the live revision and pause the live service for a maintenance window.
   The next commands deliberately target the live checkout; run them only on the
   host after that review. Preserve any existing uncommitted live edits before
   proceeding; the clean-tree assertion must pass.

```sh
set -e
export NVM_DIR=~/.nvm
. "$NVM_DIR/nvm.sh"
nvm use 24
export TMPDIR=/tmp
cd /Volumes/AI-Models/pantheon-app
test -z "$(git status --porcelain)"
DEPLOY_OLD_REV=$(git rev-parse HEAD)
DEPLOY_RECORD=/Volumes/AI-Models/pantheon-release/deliverables-$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEPLOY_RECORD"
printf '%s\n' "$DEPLOY_OLD_REV" > "$DEPLOY_RECORD/previous-revision"
cp "$HOME/Library/LaunchAgents/com.pantheon.paperclip.plist" "$DEPLOY_RECORD/"
launchctl bootout "gui/$(id -u)/com.pantheon.paperclip"
# Verify the app and embedded database have stopped before copying files.
if lsof -nP -iTCP:3100 -sTCP:LISTEN; then
  echo "Port 3100 is still listening; stop here."
  exit 1
fi
```

3. Back up the stopped database plus storage, secrets, config, and logs. This
   cold copy includes migration history and does not depend on a running DB.
   Check that the live `instances/default/db/postmaster.pid` is absent; if it is
   present, investigate the process and do not copy an active database.

```sh
test ! -e /Volumes/AI-Models/paperclip/data/instances/default/db/postmaster.pid
ditto /Volumes/AI-Models/paperclip/data "$DEPLOY_RECORD/data-before"
test -f "$DEPLOY_RECORD/data-before/instances/default/config.json"
git merge --no-edit deliverables-page
pnpm install --frozen-lockfile
pnpm build
node scripts/link-cli-externals.mjs
node --conditions=pantheon-dist cli/dist/index.js --version
pnpm -r typecheck
pnpm --filter @paperclipai/server exec vitest run src/services/deliverable src/__tests__/server-startup-feedback-export.test.ts
pnpm --filter ./ui exec vitest run src/api/deliverables src/components/Sidebar src/pages/Deliverables
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.pantheon.paperclip.plist"
# Make at most 60 attempts (each bounded to two seconds), with two-second pauses for embedded Postgres, migrations and API startup.
DEPLOY_HEALTH_READY=0
for DEPLOY_HEALTH_TRY in $(seq 1 60); do
  if curl -fsS --connect-timeout 1 --max-time 2 http://127.0.0.1:3100/api/health; then
    DEPLOY_HEALTH_READY=1
    break
  fi
  sleep 2
done
if [ "$DEPLOY_HEALTH_READY" != 1 ]; then
  echo "Health check timed out; inspect service logs before proceeding."
  exit 1
fi
curl --fail http://127.0.0.1:3100/api/companies/57cfaea0-c864-4bff-9433-2fad7be3d4c5/deliverables
```

Startup applies migrations 0294–0297 if needed. Migration 0297 removes only the
unused `completion_version` column. Migration 0295 and its snapshot are preserved
because it has already been applied to the host test copy. Verify boot logs and
health before using the UI, then inspect `/TOP/deliverables`, filters, stored
summaries, polling and runtime links. Missing Gemini credentials do not block
startup: cards show task/comment fallbacks. Never print credentials while
checking the configured env file. No launchd definition or Tailscale change is
needed for this feature.

Provider failures retry after 5 minutes, 30 minutes and 2 hours, then stay
`failed_final` with no automatic requeue. Missing credentials consume no attempts
and reduce page polling to every five minutes so credential recovery is detected.
Nonterminal cards with summaries enabled, including scheduled retries, poll every
30 seconds; terminal cards stop polling. For an explicit operator
requeue, restart with a new nonsecret
`PAPERCLIP_DELIVERABLE_SUMMARY_CONFIG_VERSION` value in the server process
environment, using the host's existing environment-management procedure. A model,
base-URL or credential change also requeues provider failures. The two-repair
evidence cap is retained; no database deletion is required.

4. Roll back source on the host if validation fails: stop the service, preserve
   the failed build/revision/logs, and run the previously recorded revision in
   detached HEAD mode. The additive deliverables table/columns can remain in the
   database for a code-only rollback.

```sh
launchctl bootout "gui/$(id -u)/com.pantheon.paperclip"
git switch --detach "$(cat "$DEPLOY_RECORD/previous-revision")"
pnpm install --frozen-lockfile
pnpm build
node scripts/link-cli-externals.mjs
node --conditions=pantheon-dist cli/dist/index.js --version
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.pantheon.paperclip.plist"
# Make at most 60 attempts (each bounded to two seconds), with two-second pauses for embedded Postgres, migrations and API startup.
DEPLOY_HEALTH_READY=0
for DEPLOY_HEALTH_TRY in $(seq 1 60); do
  if curl -fsS --connect-timeout 1 --max-time 2 http://127.0.0.1:3100/api/health; then
    DEPLOY_HEALTH_READY=1
    break
  fi
  sleep 2
done
if [ "$DEPLOY_HEALTH_READY" != 1 ]; then
  echo "Health check timed out; inspect service logs before proceeding."
  exit 1
fi
```

If migration state prevents the old revision from booting, keep services stopped
and obtain explicit operator approval for restoring the cold backup: restoration
loses writes since that backup. After that approval, stop the service, verify that
port 3100 and embedded Postgres have stopped, and move failed data aside before
restoring. Run on the host only:

```sh
launchctl bootout "gui/$(id -u)/com.pantheon.paperclip"
if lsof -nP -iTCP:3100 -sTCP:LISTEN; then exit 1; fi
test ! -e /Volumes/AI-Models/paperclip/data/instances/default/db/postmaster.pid
DEPLOY_FAILED_DATA=/Volumes/AI-Models/paperclip/data.failed-$(date +%Y%m%d-%H%M%S)
test ! -e "$DEPLOY_FAILED_DATA"
mv /Volumes/AI-Models/paperclip/data "$DEPLOY_FAILED_DATA"
test ! -e /Volumes/AI-Models/paperclip/data
ditto "$DEPLOY_RECORD/data-before" /Volumes/AI-Models/paperclip/data
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.pantheon.paperclip.plist"
# Make at most 60 attempts (each bounded to two seconds), with two-second pauses for embedded Postgres, migrations and API startup.
DEPLOY_HEALTH_READY=0
for DEPLOY_HEALTH_TRY in $(seq 1 60); do
  if curl -fsS --connect-timeout 1 --max-time 2 http://127.0.0.1:3100/api/health; then
    DEPLOY_HEALTH_READY=1
    break
  fi
  sleep 2
done
if [ "$DEPLOY_HEALTH_READY" != 1 ]; then
  echo "Health check timed out; inspect service logs before proceeding."
  exit 1
fi
curl --fail http://127.0.0.1:3100/api/companies/57cfaea0-c864-4bff-9433-2fad7be3d4c5/deliverables
```

Do not automatically restore data as part of a code rollback. No pushes or
publication are part of this procedure.
