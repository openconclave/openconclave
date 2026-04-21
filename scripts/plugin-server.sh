#!/usr/bin/env bash
# Monitor entrypoint for the OpenConclave Claude Code plugin.
# Receives the plugin root as $1 (not an env var — Claude Code substitutes
# ${CLAUDE_PLUGIN_ROOT} in the monitor command but does NOT export it to the
# subprocess). Sets OC_PLUGIN_ROOT so the server picks the user's
# ~/.openconclave data directory instead of the plugin cache.
set -euo pipefail

ROOT="${1:?plugin root argument required}"

export OC_PLUGIN_ROOT="$ROOT"

cd "$ROOT"
exec bun run packages/server/src/cli.ts
