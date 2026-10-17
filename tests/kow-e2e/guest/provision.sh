#!/bin/bash
# In-guest provisioning for the kow+agent security slice. Runs as tester via sudo.
# Idempotent-ish: safe to re-run. All secret-bearing files are 0600 and owned by
# the service user that needs them; `agent` can read none of them (sweep-2 H2/A7).
#
# Args (positional): <NONCE> <PLACEHOLDER> <RUNROOT>
set -euo pipefail
NONCE="$1"; PLACEHOLDER="$2"; RUNROOT="${3:-/opt/pkst}"
ASSET_DIR="/home/tester/pkst-assets"   # scp'd here by the orchestrator

log(){ echo "[provision] $*"; }

# --- packages (egress up in this phase) ---
if ! command -v node >/dev/null; then
  log "installing nodejs + openssl + python venv"
  sudo apt-get update -qq
  # NB: install nodejs WITHOUT npm — on noble `nodejs npm` conflict (dpkg err 2).
  # The core slice uses plain `node` (global fetch). npm/pnpm come later for Paperclip.
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs openssl python3-venv python3-pip >/dev/null
fi
# kow via a dedicated venv owned by kowd (installed as root into /opt so kowd can read)
if [ ! -x /opt/kow-venv/bin/kow ]; then
  log "installing keys-on-the-wire into /opt/kow-venv (pulls mitmproxy)"
  sudo python3 -m venv /opt/kow-venv
  sudo /opt/kow-venv/bin/pip install -q --upgrade pip
  sudo /opt/kow-venv/bin/pip install -q keys-on-the-wire
fi

# --- users (service isolation; sweep-1 C3) ---
for u in kowd upstream agent; do
  id "$u" >/dev/null 2>&1 || sudo useradd -m -s /bin/bash "$u"
done

# --- dirs ---
sudo mkdir -p "$RUNROOT"
KOWD_DIR="$RUNROOT/kowd"; UP_DIR="$RUNROOT/upstream"; AG_DIR="$RUNROOT/agent"; PUB="$RUNROOT/pub"
sudo install -d -m 0700 -o kowd    -g kowd    "$KOWD_DIR" "$KOWD_DIR/confdir"
sudo install -d -m 0700 -o upstream -g upstream "$UP_DIR"
sudo install -d -m 0700 -o agent   -g agent   "$AG_DIR"
sudo install -d -m 0755 -o root    -g root    "$PUB"   # agent-readable public material (CA copies, certs)
# shared, world-readable dir for the .mjs test programs (every service user runs node on them)
sudo install -d -m 0755 -o root -g root "$RUNROOT/assets"
sudo install -m 0755 "$ASSET_DIR/mock-upstream.mjs" "$ASSET_DIR/agent.mjs" "$RUNROOT/assets/"

# --- /etc/hosts for the bound + control hosts ---
grep -q vault-echo.test /etc/hosts || echo "127.0.0.1 vault-echo.test control-host.test wrongca.test" | sudo tee -a /etc/hosts >/dev/null

# --- upstream-CA + leaf cert for vault-echo.test (A9/C9/L3 trust anchor) ---
if [ ! -f "$PUB/upstream-ca.pem" ]; then
  log "minting upstream-CA + leaf cert"
  TMP=$(mktemp -d)
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TMP/ca.key" -out "$TMP/ca.pem" \
    -subj "/CN=pkst-upstream-CA" -days 3 >/dev/null 2>&1
  openssl req -newkey rsa:2048 -nodes -keyout "$TMP/leaf.key" -out "$TMP/leaf.csr" \
    -subj "/CN=vault-echo.test" >/dev/null 2>&1
  cat > "$TMP/ext" <<EXT
subjectAltName=DNS:vault-echo.test,DNS:control-host.test
EXT
  openssl x509 -req -in "$TMP/leaf.csr" -CA "$TMP/ca.pem" -CAkey "$TMP/ca.key" \
    -CAcreateserial -out "$TMP/leaf.pem" -days 3 -extfile "$TMP/ext" >/dev/null 2>&1
  sudo cp "$TMP/ca.pem" "$PUB/upstream-ca.pem"          # public (kow trusts it on upstream leg)
  sudo install -m 0600 -o upstream -g upstream "$TMP/leaf.pem" "$UP_DIR/leaf.pem"
  sudo install -m 0600 -o upstream -g upstream "$TMP/leaf.key" "$UP_DIR/leaf.key"
  sudo chmod 0644 "$PUB/upstream-ca.pem"
  rm -rf "$TMP"
fi

# --- fixture (the real secret) generated as kowd, umask 077 (sweep-2 H2) ---
# A0: >=32 alnum from CSPRNG, != placeholder, distinct. static-secrets.yaml 0600 in 0700 dir.
sudo -u kowd bash -c "umask 077; cat > '$KOWD_DIR/gen.sh' <<'GEN'
FIX=\$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40)
printf 'secrets:\n  TEST_API_KEY: %s\n' \"\$FIX\" > '$KOWD_DIR/static-secrets.yaml'
chmod 600 '$KOWD_DIR/static-secrets.yaml'
printf '%s' \"\$FIX\" | sha256sum | cut -c1-12 > '$KOWD_DIR/fixture.fp'
GEN
bash '$KOWD_DIR/gen.sh' && rm -f '$KOWD_DIR/gen.sh'"
# export ONLY the fingerprint to the public dir (never the fixture — sweep-2 H2/L2)
sudo cp "$KOWD_DIR/fixture.fp" "$PUB/fixture.fp"; sudo chmod 0644 "$PUB/fixture.fp"

# --- kow bindings.yaml (owned by kowd) ---
sudo -u kowd bash -c "umask 077; cat > '$KOWD_DIR/bindings.yaml' <<YAML
tls_termination: all
unmatched_destination_policy: forward_unmodified
binding_source: file
allow_wildcard_hosts: false
audit:
  path: $KOWD_DIR/audit.jsonl
  fail_on_unwritable: true
backend:
  type: static
  config:
    path: $KOWD_DIR/static-secrets.yaml
secrets:
  TEST_API_KEY:
    placeholder: '$PLACEHOLDER'
    inject:
      header: Authorization
      format: 'Bearer {TEST_API_KEY}'
    bindings:
      - host: vault-echo.test
        methods: [POST]
        paths: ['/echo']
YAML"

log "provision OK (nonce=$NONCE)"
