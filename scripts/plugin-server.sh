#!/usr/bin/env bash
# Monitor entrypoint for the OpenConclave Claude Code plugin.
# Receives the plugin root as $1 (not an env var — Claude Code substitutes
# ${CLAUDE_PLUGIN_ROOT} in the monitor command but does NOT export it to the
# subprocess). Sets OC_PLUGIN_ROOT so the server picks the user's
# ~/.openconclave data directory instead of the plugin cache.
set -euo pipefail

ROOT="${1:?plugin root argument required}"
DATA="${2:?plugin data argument required}"

export OC_PLUGIN_ROOT="$ROOT"
export OC_DATA_DIR="$DATA"

PIDFILE="$DATA/oc.pid"
LOGFILE="$DATA/server.log"

mkdir -p "$DATA"

# ── Reap stale pidfiles ───────────────────────────────────────
# If a prior session left a pidfile behind, check whether that process is
# still alive. kill -0 sends no signal but returns 0 iff the PID exists.
if [ -f "$PIDFILE" ]; then
  PRIOR_PID="$(cat "$PIDFILE" 2>/dev/null || echo '')"
  if [ -n "$PRIOR_PID" ] && kill -0 "$PRIOR_PID" 2>/dev/null; then
    # Previous session's server is genuinely alive.
    if curl --silent --fail --max-time 2 "http://localhost:4000/api/dashboard" >/dev/null 2>&1; then
      echo "openconclave plugin: server already running (pid=$PRIOR_PID), attaching." >&2
      exit 0
    fi
    # Process alive but port not answering — probably stuck in startup or crashed silently.
    # Kill it so we can restart cleanly.
    echo "openconclave plugin: stale server (pid=$PRIOR_PID) not serving, killing." >&2
    kill "$PRIOR_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PIDFILE"
fi

# Belt-and-suspenders: if some *other* process (standalone `oc`, another plugin
# install) is holding :4000 without our pidfile, attach rather than crash.
if curl --silent --fail --max-time 2 "http://localhost:4000/api/dashboard" >/dev/null 2>&1; then
  echo "openconclave plugin: :4000 held by foreign process, attaching." >&2
  exit 0
fi

# ── Start the server ──────────────────────────────────────────
# Server writes its own pidfile at $DATA/oc.pid once Bun.serve succeeds.
# Its stderr goes to $LOGFILE so we can post-mortem silent crashes. Stdout
# stays on the monitor channel (banner + __OC_EVENT__ notifications).
echo "openconclave plugin: starting server; stderr -> $LOGFILE" >&2
cd "$ROOT"
exec bun run packages/server/src/cli.ts 2>> "$LOGFILE"
