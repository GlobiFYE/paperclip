#!/bin/bash
# Shared guest-side helpers. Sourced by provision.sh / start.sh / run-agent.sh.

# wait_for <timeout_s> <shell-cmd...> — poll the command until it succeeds or the
# timeout elapses. Returns 0 on success, 1 on timeout. Replaces the copy-pasted
# `for i in $(seq ...); do ... && break; sleep 1; done` blocks.
wait_for() {
  local timeout="$1"; shift
  local i
  for ((i = 0; i < timeout; i++)); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

# port_listening <port> — true iff something listens on 127.0.0.1:<port>.
port_listening() { sudo ss -tnlp 2>/dev/null | grep -q "127.0.0.1:$1"; }

# file_exists_sudo <path> — true iff the path exists (root view).
file_exists_sudo() { sudo test -f "$1"; }
