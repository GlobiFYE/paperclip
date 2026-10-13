# Host Memory Pressure Runbook

How to run Paperclip on a memory-constrained host without losing in-flight agent
work, and how to detect the failure mode early. Written after the 2026-10-12
fleet-wide `process_lost` incident ([TOP-253]).

## Incident summary (2026-10-12)

Between 20:21–20:47 UTC, 5+ agents (Program Manager, Org Architect, City
Architect, Arsenal Curator, one Troubleshooter run) were simultaneously killed
with `Process lost -- child pid <n> is no longer running`. Evidence: heartbeat
runs `2d36e7ff`, `de8d9e7d`, `6ec1f2f6`, `10c4d5f0`, `e7c6e980` all finalized
`process_lost` inside the window.

Root cause was host-level, not per-agent: Brain.local swap was ~93% used
(17.2G/18.4G) with heavy pages-compressed/decompressed activity while 14
heartbeat runs were active. Under that pressure the OS reaps child processes,
and each reaped child is reported as a lost run.

## Mitigations

Three layers address this class of failure. Use all of them on small hosts.

### 1. Cap simultaneous heartbeat runs (fleet-wide)

Every heartbeat run is a host process (agent CLI or adapter child). Per-agent
`heartbeat.maxConcurrentRuns` in an agent's `runtimeConfig` bounds one agent,
but a timer burst across many agents can still oversubscribe the host. Set the
instance-wide ceiling:

```sh
HEARTBEAT_GLOBAL_MAX_CONCURRENT_RUNS=6
```

Behavior:

- At most N heartbeat runs may be `running` across the whole instance at once.
- Runs beyond the cap stay `queued` and are promoted by the periodic recovery
  sweep (one scheduler tick, `HEARTBEAT_SCHEDULER_INTERVAL_MS`, default 30s)
  or by the finishing run's own agent promotion once a slot frees.
- Unset, `0`, or invalid values disable the cap (previous behavior).

Sizing rule of thumb: budget roughly 1–1.5 GiB of resident memory per running
agent process (CLI agents with tool children sit at the high end), leave headroom
for the database and the OS, and set the cap below the point where swap starts
filling. On Brain.local (18 GiB swap already near-full), `6` is a sane starting
value.

### 2. Process-loss retry lane (built in)

When the orphan reaper finds a tracked local child gone, the run is finalized as
`failed` / `process_lost` and the process-loss retry lane takes over:

- Up to 3 automatic reschedules on escalating delays (30s, 2m, 5m) so a child
  reaped during a transient pressure spike is retried after the pressure clears
  instead of immediately re-spawning into the same thrash.
- The attempts share the durable failure-retry counter with ordinary transient
  retries (process loss never opens a second retry budget).
- The escalating lane applies only to genuinely reaped children
  (`error_code = 'process_lost'`). Other interruption families, such as
  graceful shutdown drains, keep the ordinary transient retry lane and its
  tighter ceiling, so a spent retry budget stays spent across restarts.
- While a retry is scheduled the agent stays `idle` — it is not marked `error`
  between attempts. Only a terminal process loss with no retry left marks the
  agent `error`.
- Retry wakes carry reason `process_lost_retry`; the UI shows the chain as
  "Retry scheduled — Process lost" and offers "Resume lost run" for terminal
  losses.

### 3. Alert on swap pressure

`scripts/host-memory-watchdog.sh` prints an alert line when swap used % is at or
above a threshold (default 90) and stays silent otherwise, so it can be wired to
any log collector or agent cron as a watchdog:

```sh
# one-shot check
scripts/host-memory-watchdog.sh

# tighter threshold
SWAP_ALERT_THRESHOLD_PCT=80 scripts/host-memory-watchdog.sh
```

Example launchd agent (`~/Library/LaunchAgents/com.paperclip.host-memory-watchdog.plist`)
that runs the check every 5 minutes and appends alerts to a log:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.paperclip.host-memory-watchdog</string>
  <key>ProgramArguments</key>
  <array>
    <string>/path/to/pantheon-app/scripts/host-memory-watchdog.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>SWAP_ALERT_THRESHOLD_PCT</key><string>90</string></dict>
  <key>StartInterval</key><integer>300</integer>
  <key>StandardOutPath</key><string>/tmp/paperclip-host-memory-watchdog.log</string>
  <key>StandardErrorPath</key><string>/tmp/paperclip-host-memory-watchdog.log</string>
</dict></plist>
```

`launchctl load ~/Library/LaunchAgents/com.paperclip.host-memory-watchdog.plist`

## Detecting a memory-pressure kill window

Same-minute `process_lost` clusters are the signature (runs killed together are
finalized together):

```sql
SELECT date_trunc('minute', finished_at) AS minute, count(*)
FROM heartbeat_runs
WHERE error_code = 'process_lost'
  AND finished_at > now() - interval '7 days'
GROUP BY 1
HAVING count(*) >= 2
ORDER BY 1 DESC;
```

Correlate with host swap history (`sysctl vm.swapusage`, `vm_stat`, or the
watchdog log) before blaming an agent or adapter: a single-agent `process_lost`
is a crash, a synchronized multi-agent burst is the host.

## Tuning checklist for a new small host

1. Set `HEARTBEAT_GLOBAL_MAX_CONCURRENT_RUNS` before loading the company roster.
2. Keep per-agent `heartbeat.maxConcurrentRuns` at 1 unless an agent's tools are
   known to be light.
3. Install the swap watchdog and point its output somewhere that pages a human.
4. Watch the first timer bursts: 20+ queued runs during a burst is expected and
   healthy when the cap is doing its job.

[TOP-253]: /TOP/issues/TOP-253
