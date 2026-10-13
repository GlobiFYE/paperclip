#!/usr/bin/env bash
# Host memory-pressure watchdog (TOP-253).
#
# Prints an alert line to stdout when swap usage is at or above the alert
# threshold, and stays silent otherwise (watchdog convention: empty output on
# healthy hosts). Uses only macOS/BSD core tools so it can run from launchd,
# cron, or a Hermes script-only cron job.
#
# Environment:
#   SWAP_ALERT_THRESHOLD_PCT  Swap used percentage that triggers an alert.
#                             Default: 90.
#
# Exit codes: 0 = checked (alert or not), 1 = could not read memory stats.

set -u

threshold="${SWAP_ALERT_THRESHOLD_PCT:-90}"

if ! [[ "$threshold" =~ ^[0-9]+$ ]] || [ "$threshold" -lt 1 ] || [ "$threshold" -gt 100 ]; then
  echo "host-memory-watchdog: invalid SWAP_ALERT_THRESHOLD_PCT '$threshold' (want integer 1-100)" >&2
  exit 1
fi

swap_used_pct=""
swap_detail=""

if [ "$(uname -s)" = "Darwin" ]; then
  # e.g. "vm.swapusage: total = 18432.00M  used = 17182.50M  free = 1249.50M  (encrypted)"
  swap_line="$(sysctl -n vm.swapusage 2>/dev/null)" || {
    echo "host-memory-watchdog: sysctl vm.swapusage failed" >&2
    exit 1
  }
  total_mb="$(printf '%s' "$swap_line" | sed -n 's/.*total = \([0-9.]*\)M.*/\1/p')"
  used_mb="$(printf '%s' "$swap_line" | sed -n 's/.*used = \([0-9.]*\)M.*/\1/p')"
  if [ -z "$total_mb" ] || [ -z "$used_mb" ] || [ "$total_mb" = "0" ]; then
    echo "host-memory-watchdog: cannot parse vm.swapusage: $swap_line" >&2
    exit 1
  fi
  swap_used_pct="$(awk -v u="$used_mb" -v t="$total_mb" 'BEGIN { printf "%d", (u * 100) / t }')"
  swap_detail="swap ${used_mb}M/${total_mb}M used (${swap_used_pct}%) via vm.swapusage"
else
  # Linux fallback: SwapTotal/SwapFree in kB from /proc/meminfo.
  meminfo="/proc/meminfo"
  [ -r "$meminfo" ] || {
    echo "host-memory-watchdog: cannot read $meminfo" >&2
    exit 1
  }
  total_kb="$(awk '/^SwapTotal:/ { print $2 }' "$meminfo")"
  free_kb="$(awk '/^SwapFree:/ { print $2 }' "$meminfo")"
  if [ -z "$total_kb" ] || [ -z "$free_kb" ] || [ "$total_kb" = "0" ]; then
    echo "host-memory-watchdog: cannot parse swap from $meminfo" >&2
    exit 1
  fi
  used_kb="$((total_kb - free_kb))"
  swap_used_pct="$((used_kb * 100 / total_kb))"
  swap_detail="swap ${used_kb}k/${total_kb}k used (${swap_used_pct}%) via /proc/meminfo"
fi

if [ "$swap_used_pct" -ge "$threshold" ]; then
  host="$(hostname -s 2>/dev/null || hostname)"
  echo "MEMORY PRESSURE ALERT: $host swap usage ${swap_used_pct}% >= ${threshold}% threshold — $swap_detail. Concurrency bursts can cause the OS to reap agent child processes (see TOP-253); consider pausing non-critical heartbeat runs or raising host memory."
fi

exit 0
