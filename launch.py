"""launchd entry point for Pantheon (private Paperclip fork).

Modeled on /Volumes/AI-Models/paperclip/launch.py (the live Paperclip entry
point). PREPARED ONLY — do NOT install or load this file until the lead
performs the cutover described in PANTHEON.md.

Cutover contract: run the Pantheon fork from /Volumes/AI-Models/pantheon-app
with the SAME PAPERCLIP_HOME=/Volumes/AI-Models/paperclip/data as the live
instance, on port 3100. The server binary is the fork's built CLI
(cli/dist/index.js), which is the exact equivalent of the live
node_modules/.bin/paperclipai entry point.

Runs under Homebrew Python (which has macOS access to the external volume),
then starts the Pantheon server with Node 24 as a child and forwards signals.
"""
import os
import signal
import subprocess
import sys

ROOT = "/Volumes/AI-Models/pantheon-app"
PAPERCLIP_HOME = "/Volumes/AI-Models/paperclip/data"
NODE = "/Users/clawd/.nvm/versions/node/v24.14.0/bin/node"
env = dict(os.environ, PAPERCLIP_HOME=PAPERCLIP_HOME,
           PORT="3100", HOST="127.0.0.1",
           PATH="/Users/clawd/.nvm/versions/node/v24.14.0/bin:/Users/clawd/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin")
log = open(f"{PAPERCLIP_HOME}/server.log", "ab")
p = subprocess.Popen([NODE, f"{ROOT}/cli/dist/index.js", "run"], cwd=ROOT, env=env,
                     stdout=log, stderr=subprocess.STDOUT)
for s in (signal.SIGTERM, signal.SIGINT):
    signal.signal(s, lambda *_: p.send_signal(signal.SIGTERM))
sys.exit(p.wait())
