#!/usr/bin/env bash
# Monitor entrypoint for the OpenConclave Claude Code plugin.
# Sets OC_PLUGIN_ROOT so the server picks the user's ~/.openconclave data
# directory instead of creating a fresh DB in the plugin cache.
set -euo pipefail

ROOT="${CLAUDE_PLUGIN_ROOT:?CLAUDE_PLUGIN_ROOT not set}"

export OC_PLUGIN_ROOT="$ROOT"
export OC_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-}"

cd "$ROOT"
exec bun run packages/server/src/cli.ts
