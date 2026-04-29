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

# ── Rebuild PATH from the real Windows environment ───────────
# Claude Code's monitor subprocess sometimes inherits a trimmed PATH on
# Windows (depending on how CC itself was launched), which makes
# Bun.spawn("node" | "bash") exit 66 with empty stderr in code nodes.
# Ask cmd.exe for the effective system+user PATH so we match whatever the
# user's interactive shell sees, regardless of install layout (Program
# Files, scoop, choco, nvm-windows, custom drives). git-bash / MSYS
# translates the ';'-separated Windows form to ':'-separated form on
# assignment, and back to Windows form when bun's child processes start.
case "${OS:-}" in
  Windows_NT)
    WIN_PATH="$(cmd //c 'echo %PATH%' 2>/dev/null | tr -d '\r')"
    # cygpath -up converts ';'-separated Windows PATH to ':'-separated MSYS form
    # (e.g. 'C:\Program Files\Git\usr\bin' -> '/usr/bin'), which keeps bash's own
    # utilities (mkdir, tr, curl, kill) findable while adding nodejs, bun, etc.
    if [ -n "$WIN_PATH" ] && command -v cygpath >/dev/null 2>&1; then
      MSYS_PATH="$(cygpath -up "$WIN_PATH" 2>/dev/null || true)"
      if [ -n "$MSYS_PATH" ]; then
        export PATH="$MSYS_PATH:$PATH"
      fi
    fi
    ;;
esac

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

cd "$ROOT"

# ── First-run client build ────────────────────────────────────
# Fresh git clones don't include packages/client/dist/ (gitignored), so the
# server's static-serve check at startup finds no index.html and the web UI
# returns 404. Build it once on first launch; subsequent runs see dist/ and
# skip the ~3s build cost.
if [ ! -f "$ROOT/packages/client/dist/index.html" ]; then
  echo "openconclave plugin: building client (first run)…" >&2
  if [ ! -d "$ROOT/node_modules" ]; then
    bun install >> "$LOGFILE" 2>&1 || {
      echo "openconclave plugin: bun install failed; see $LOGFILE" >&2
      exit 1
    }
  fi
  (cd "$ROOT/packages/client" && bun run build) >> "$LOGFILE" 2>&1 || {
    echo "openconclave plugin: client build failed; see $LOGFILE" >&2
    exit 1
  }
fi

# ── Start the server ──────────────────────────────────────────
# Server writes its own pidfile at $DATA/oc.pid once Bun.serve succeeds.
# Its stderr goes to $LOGFILE so we can post-mortem silent crashes. Stdout
# stays on the monitor channel (banner + __OC_EVENT__ notifications).
echo "openconclave plugin: starting server; stderr -> $LOGFILE" >&2
exec bun run packages/server/src/cli.ts 2>> "$LOGFILE"
