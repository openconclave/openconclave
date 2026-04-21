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

# If another Claude Code session (or a standalone `oc`) is already serving
# :4000, don't try to bind again — just exit 0 so Claude Code doesn't mark
# this monitor as failed. The running instance handles MCP + UI for us.
if curl --silent --fail --max-time 2 "http://localhost:4000/api/health" >/dev/null 2>&1 \
  || curl --silent --fail --max-time 2 "http://localhost:4000/api/dashboard" >/dev/null 2>&1; then
  echo "openconclave plugin: server already running on :4000, attaching." >&2
  exit 0
fi

cd "$ROOT"
exec bun run packages/server/src/cli.ts
