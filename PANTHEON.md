# PANTHEON — private fork of Paperclip

Pantheon is our private, self-hosted copy of the Paperclip control plane,
forked from `github.com/paperclipai/paperclip` at commit `467125f`
(the exact version the live server runs). Everything below lives at:

    /Volumes/AI-Models/pantheon-app

The fork keeps every upstream identifier (package names, `paperclipai` CLI,
`PAPERCLIP_*` env vars, `/api/*` routes, DB schema/identifiers) byte-compatible
with the existing live data. Only the product name shown in the UI and the
Hermes adapter defaults are ours (see "Our change list").

- Upstream remote: `upstream` = https://github.com/paperclipai/paperclip.git
  with pushing disabled (`git remote set-url --push upstream DISABLED`).
  There are no other remotes. LICENSE and the MIT copyright notice are intact.

---

## 1. Build

Requirements: Node 24 (via nvm), pnpm (Homebrew, matching the pinned
`packageManager` field).

```sh
export PATH=/Users/clawd/.nvm/versions/node/v24.14.0/bin:/Users/clawd/.cargo/bin:$PATH
cd /Volumes/AI-Models/pantheon-app
pnpm install          # once per dependency change (pnpm 9.15.4)
pnpm build            # preflight:workspace-links + pnpm -r build
```

Pitfall: some build steps (tsx) open a unix socket under `$TMPDIR`. If the
harness runs you with a very long scratch `$TMPDIR`, the socket path exceeds
macOS's 104-character limit and the build dies with `listen EINVAL`. Fix:

```sh
export TMPDIR=/tmp
pnpm build
```

Build output lands in each package's `dist/` (`server/dist`, `ui/dist`,
`cli/dist`, `packages/*/dist`). The built UI is served by the API server.

## 2. Run

The production entry point is the prepared (NOT INSTALLED) launcher:

    /Volumes/AI-Models/pantheon-app/launch.py

It is modeled on `/Volumes/AI-Models/paperclip/launch.py` and runs the fork's
built CLI with the live data directory:

- `PAPERCLIP_HOME=/Volumes/AI-Models/paperclip/data` (same as live)
- `PORT=3100`, `HOST=127.0.0.1`
- `NODE_OPTIONS=--conditions=pantheon-dist` (the fork's export condition that
  makes the built runtime resolve its bundled runtime assets)
- command: `node /Volumes/AI-Models/pantheon-app/cli/dist/index.js run`
- logs append to `/Volumes/AI-Models/paperclip/data/server.log`
- signals: SIGTERM/SIGINT are forwarded to the Node child

Manual smoke run (test instance, does NOT touch live data):

```sh
export PATH=/Users/clawd/.nvm/versions/node/v24.14.0/bin:/Users/clawd/.cargo/bin:$PATH
export TMPDIR=/tmp

# 1. Fresh home + first-run config (non-interactive quickstart, no service):
env -i PATH="$PATH" HOME=/Users/clawd TMPDIR=/tmp \
  PAPERCLIP_HOME=/Volumes/AI-Models/pantheon-app/.test-home \
  node cli/dist/index.js onboard -y --no-install-service

# 2. Start the instance on the test port (loopback only):
env -i PATH="$PATH" HOME=/Users/clawd TMPDIR=/tmp \
  PAPERCLIP_HOME=/Volumes/AI-Models/pantheon-app/.test-home \
  PORT=3200 HOST=127.0.0.1 NODE_OPTIONS=--conditions=pantheon-dist \
  node cli/dist/index.js run
```

**Pitfall — always start test instances with `env -i` (or unset every
inherited `PAPERCLIP_*` variable).** When launched from inside a Paperclip
agent session, inherited `PAPERCLIP_CONFIG` / `PAPERCLIP_INSTANCE_ID` make
`paperclipai run` resolve the LIVE instance config
(`/Volumes/AI-Models/paperclip/data/instances/default/config.json`) and attach
to the live database even though `PAPERCLIP_HOME` points elsewhere. The boot
banner is the tell: it prints `Home:` and `Config:` — the `Config:` path MUST
be under the test home. `NODE_OPTIONS=--conditions=pantheon-dist` is required
on `run` (without it the CLI resolves the server's source entry instead of the
built runtime and fails on a missing module).

Verified checks (2026-10-11, isolated instance at commit `b440cd4`):
`/api/health` -> `{"status":"ok","commit":"b440cd4..."}`
`/api/adapters` -> `hermes_local`, `modelsCount: 8`
`/api/companies/:id/adapters/hermes_local/models` -> the 8 Pantheon models
UI HTML `<title>` -> `<title>Pantheon</title>`
screenshot -> `screenshots/test.png` (Playwright headless, Chrome channel)

Stop cleanly with SIGTERM to the `node cli/dist/index.js run` process; the
boot log shows `Stopping embedded PostgreSQL` and the instance's postgres
child (datadir `<home>/instances/default/db`) exits with it.

## 3. Pulling upstream updates

```sh
cd /Volumes/AI-Models/pantheon-app
git fetch upstream
git log --oneline HEAD..upstream/main      # review what would come in
git merge upstream/main                    # or rebase our pantheon: commits
pnpm install && pnpm build
```

Our changes are small and sit on top of `467125f`, so merges should be easy.
If upstream moves the adapter sources we patched (see below), re-apply the
Pantheon deltas by hand — they are enumerated in `git log --oneline 467125f..`.

Never push: `upstream`'s push URL is `DISABLED` on purpose. Keep LICENSE and
all MIT copyright notices intact when merging.

## 4. Our change list (467125f..HEAD)

| Commit | What |
| --- | --- |
| `e2229de` | Hermes adapter defaults: default model `mimo-v2.6-pro` (was `auto`), allowed providers `xiaomi`/`gemini`/`nvidia`, model-prefix hints `mimo-`→`xiaomi` and `nvidia/`→`nvidia`; the Pantheon model list (MiMo 2.6 Pro/Flash, MiMo 2.5 Pro, Gemini 3 Flash preview, Gemini 3.1 Flash-Lite, Gemini 3.5 Flash, MiniMax M2.7, Nemotron 3 Ultra); when a run context carries `paperclipWorkspace.projectId`, `paperclipWorkspace.cwd` takes precedence over the agent's configured cwd. |
| `171f551` | UI rebrand: the product name shown in the browser title, PWA manifest, document-title suffix, auth wordmark/headings, boot overlay, error boundary, dashboard welcome, and onboarding copy now says "Pantheon". Packages, CLI binary, `PAPERCLIP_*` env vars, API routes, storage keys, and DB identifiers are unchanged. |
| `eed4943` | `pantheon-dist` package export condition so the built runtime resolves its assets outside the npm package layout. |
| `ed31b1d` | Checkout runtime linker + prepared `launch.py` entry point. |
| `6a68f91` | `launch.py` passes `NODE_OPTIONS=--conditions=pantheon-dist`. |
| `6d67009` | Idempotent skill symlink sync: `ensurePaperclipSkillSymlink` treats `EEXIST` on the symlink as success when the occupying link already points at the expected source (still fails on genuine conflicts), and tolerates `ENOENT` on the repair unlink. Fixes crashes when concurrent runs share one Hermes profile. Unit tests included. |

Note: the model list above is the 8-model list from the work order, a superset
of the 6 models in the live dist patch (the live patch never contained the
"Gemini 3 Flash preview" and "Gemini 3.1 Flash-Lite" entries).

## 5. CUTOVER — prepared, NOT authorized or executed

The owner explicitly requires a fresh yes before the live cutover. Verification
and preparation do not grant that permission. This is a private local service
change, not a public deployment. Do not push, add remotes, buy anything, delete
state, or expand the workforce as part of the cutover.

Release evidence is in `/Volumes/AI-Models/pantheon-release/2026-10-12/`.
Read `RELEASE-VERIFICATION.md` for the final verdict and source commits; an
unfinished or failed gate stops this procedure.

### Preconditions and dynamic baseline

- Build, type checks, relevant regression tests, desktop/phone UAT and visual
  verification must pass. Confirm the desired source commit and clean tracked
  tree. Generated test homes, caches, raw exports and secrets stay untracked.
- Port 3200 uses an isolated test database, with scheduling disabled. Its
  rehearsal copy has 43 paused agents with inert process adapters, 561 skills,
  166 issues and 5 projects from the export snapshot. This proves portable
  content survives import, not that runtime secrets/history were cloned.
- The real cutover uses the EXISTING live data directory. There is no export,
  import, migration, new company, agent recreation or data replacement.
- Re-read live company `57cfaea0-c864-4bff-9433-2fad7be3d4c5` through the API.
  Capture agent/issue/skill/project IDs and counts, active runs, and automation
  settings into a private baseline file. The earlier 19-agent/36-skill baseline
  is obsolete; the release snapshot has 43 agents and 561 skills. Issue counts
  change while agents work; compare against the fresh drained baseline.
- Inspect `git diff 467125f -- packages/db/src/migrations packages/db/src/schema`.
  This release adds no schema or migration changes. Reassess rollback if that
  changes before approval.
- Drain active agent runs before stopping the server. If schedules or incoming
  Telegram work keep producing runs, temporarily suspend admission after the
  approved maintenance window begins and record exactly what to restore. Do
  not kill active work or silently leave automations paused.

### Build assets before touching the live service

```sh
export PATH=/Users/clawd/.local/bin:/Users/clawd/.nvm/versions/node/v24.14.0/bin:/Users/clawd/.cargo/bin:/opt/homebrew/bin:/usr/bin:/bin
export TMPDIR=/tmp
cd /Volumes/AI-Models/pantheon-app
pnpm build
```

The server prefers `server/ui-dist` when present, ahead of `ui/dist`.
The monorepo build updates `ui/dist`; an old `server/ui-dist` can therefore
serve an obsolete UI even while health reports a newer source revision.
Before cutover, preserve the existing served directory in the private release
folder, then copy the built UI into it with `shutil.copytree(...,
dirs_exist_ok=True)`. Do not delete old hashed assets. Verify `ui/dist/index.html`
and `server/ui-dist/index.html` have identical SHA-256 hashes, and fetch the
served index from port 3200 to confirm the matching asset references. Restart
only the isolated test instance and smoke-test its City and task pages.

### Execution, only after the owner's explicit yes

1. Capture the drained live baseline and back up the plist, both launchers and
   live instance configuration into a mode-0700 directory under the release
   folder. Keep private files mode 0600. Do not print configuration contents.
2. Back up the live database using the CURRENT installed CLI:

   ```sh
   cd /Volumes/AI-Models/paperclip
   PAPERCLIP_HOME=/Volumes/AI-Models/paperclip/data \
     ./node_modules/.bin/paperclipai db:backup
   ```

   Record the backup path and verify a nonempty successful dump. Preserve
   filesystem skills, instructions and other live data in place. A database
   dump alone is not a copy of all artifacts. Keep the old runtime installed.
3. Stop the launch job and verify port 3100 has stopped answering:

   ```sh
   launchctl bootout gui/$(id -u)/com.pantheon.paperclip
   ```

4. In `/Users/clawd/Library/LaunchAgents/com.pantheon.paperclip.plist`, change
   only `/Volumes/AI-Models/paperclip/launch.py` to
   `/Volumes/AI-Models/pantheon-app/launch.py`. Validate with `plutil -lint`.
   Preserve `/opt/homebrew/bin/python3`, all other arguments, logging, RunAtLoad
   and KeepAlive. The prepared fork launcher retains
   `PAPERCLIP_HOME=/Volumes/AI-Models/paperclip/data`, `HOST=127.0.0.1`,
   `PORT=3100`, Node 24 and `NODE_OPTIONS=--conditions=pantheon-dist`.
5. Bootstrap the same job:

   ```sh
   launchctl bootstrap gui/$(id -u) /Users/clawd/Library/LaunchAgents/com.pantheon.paperclip.plist
   ```

6. Verify health, actual served UI assets and Pantheon title; compare all
   baseline IDs/counts. Open dashboard, inbox, agent, skills, task and City.
   Confirm the fork Hermes model list and project cwd behaviour. Check the
   local City on 5180 and its connection to 3100, including zoom persistence.
7. Verify the existing Tailscale endpoint
   `https://brain.tail3625db.ts.net:3443` still serves Pantheon and the allowed
   hostname remains unchanged. Local-trusted mode still trusts devices with
   access; this cutover does not introduce human accounts or public access.
8. Verify the existing Telegram bridge configuration still points to 3100 and
   the Flight Director, its process is healthy, and its local API probe works.
   An actual incoming Telegram idea and reply is a separate end-to-end check;
   do not claim it happened without a real message. Do not send messages as the
   owner or publish anything just to obtain a green check.
9. Restore only the admission/automation settings temporarily changed during
   maintenance, verify live operation, and update the release handoff.

## 6. ROLLBACK — binary switch, not automatic data restore

If post-switch checks fail, stop the fork job, restore the preserved plist
argument to `/Volumes/AI-Models/paperclip/launch.py`, validate the plist, and
bootstrap the original job. Compare against the fresh baseline and confirm
Paperclip, City, Tailscale and the bridge are healthy. Keep the same live data
and restore any temporary admission settings.

This binary rollback is possible because this release has no schema changes.
Do not automatically restore a database dump: restoration overwrites data and
requires a separate explicit owner yes. Preserve diagnostics privately and
report any failed checks without exposing secrets. No rollback step deletes
worktrees, branches, backups, artifacts, accounts or issues.
