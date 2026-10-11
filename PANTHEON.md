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
export PATH=/Users/clawd/.nvm/versions/node/v24.14.0/bin:$PATH
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
export PATH=/Users/clawd/.nvm/versions/node/v24.14.0/bin:$PATH
cd /Volumes/AI-Models/pantheon-app
PAPERCLIP_HOME=/Volumes/AI-Models/pantheon-app/.test-home \
PORT=3200 HOST=127.0.0.1 NODE_OPTIONS=--conditions=pantheon-dist \
node cli/dist/index.js run
```

Verified checks (see "Verification" in the issue for full output):
`/api/health` -> `{"status":"ok",...}`, `/api/adapters` lists `hermes_local`
with the Pantheon model list, and the UI HTML `<title>` is "Pantheon".

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

## 5. CUTOVER (performed by the lead — do NOT run these as an agent)

Preconditions: `pnpm build` green at the desired commit; the port-3200 test
instance passed (health, adapters, UI title); this checklist read in full.

Baseline to preserve (captured 2026-10-11 from the live instance):
19 agents, 36 skills, `PAPERCLIP_HOME=/Volumes/AI-Models/paperclip/data`,
port 3100, launch agent `com.pantheon.paperclip`
(plist: `/Users/clawd/Library/LaunchAgents/com.pantheon.paperclip.plist`,
currently pointing at `/Volumes/AI-Models/paperclip/launch.py`).

Steps:

1. **Backup the live database** (from the live checkout, server keeps running):

   ```sh
   cd /Volumes/AI-Models/paperclip
   PAPERCLIP_HOME=/Volumes/AI-Models/paperclip/data \
     ./node_modules/.bin/paperclipai db:backup
   ```

   (Equivalent: `pnpm db:backup` in the fork with the same `PAPERCLIP_HOME`,
   since it forwards to `paperclipai db:backup`.) Note the printed backup
   path — it is the rollback restore point.

2. **Stop the live launch agent:**

   ```sh
   launchctl bootout gui/$(id -u)/com.pantheon.paperclip
   ```

   Wait for the process to exit (port 3100 no longer listening):
   `curl -sS http://127.0.0.1:3100/api/health` must fail.

3. **Point the launch agent at the fork.** Edit
   `/Users/clawd/Library/LaunchAgents/com.pantheon.paperclip.plist` and change
   the single program argument

   `/Volumes/AI-Models/paperclip/launch.py` → `/Volumes/AI-Models/pantheon-app/launch.py`

   Nothing else in the plist changes. `launch.py` keeps the SAME
   `PAPERCLIP_HOME=/Volumes/AI-Models/paperclip/data` and port 3100.

4. **Start the fork:**

   ```sh
   launchctl bootstrap gui/$(id -u) /Users/clawd/Library/LaunchAgents/com.pantheon.paperclip.plist
   ```

   Tail `/Volumes/AI-Models/paperclip/data/server.log` until boot completes.

5. **Verify** (compare against the baseline):

   ```sh
   curl -sS http://127.0.0.1:3100/api/health
   # -> {"status":"ok",...}  (version/commit now report the fork build)

   curl -sS http://127.0.0.1:3100/api/companies/57cfaea0-c864-4bff-9433-2fad7be3d4c5/agents | jq length
   # -> 19

   curl -sS http://127.0.0.1:3100/api/companies/57cfaea0-c864-4bff-9433-2fad7be3d4c5/skills | jq length
   # -> 36

   curl -sS http://127.0.0.1:3100/ | grep -o '<title>[^<]*</title>'
   # -> <title>Pantheon</title>
   ```

   Also spot-check in the UI: dashboard loads, an agent chat opens, and the
   Hermes adapter (`hermes_local`) lists the Pantheon model list.

## 6. ROLLBACK

1. Stop the fork: `launchctl bootout gui/$(id -u)/com.pantheon.paperclip`
2. Revert the plist argument to `/Volumes/AI-Models/paperclip/launch.py`
3. `launchctl bootstrap gui/$(id -u) /Users/clawd/Library/LaunchAgents/com.pantheon.paperclip.plist`
4. Verify: `/api/health` ok, 19 agents, 36 skills (step 5 above).
5. If data was corrupted during the failed window, restore from the step-1
   backup. The backup is a plain-SQL dump (restored with `psql`); note that
   this build has no `db:restore` CLI command — the in-tree restore path is
   `runDatabaseRestore` in `packages/db/src/backup-lib.ts` (used by the
   worktree tooling), so ask engineering to run it or restore the dump with
   `psql` against the embedded postgres.

Because Pantheon and Paperclip share the same schema and identifiers
(no DB migrations were added), the data dir is forward- and backward-compatible:
either binary can open it. The backup in step 1 is the safety net for
anything unforeseen.
