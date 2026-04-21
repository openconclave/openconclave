#!/usr/bin/env bash
# Ensures OC dependencies are installed in the plugin's persistent data dir.
# Runs on every SessionStart but no-ops when bun.lock is unchanged since the
# last successful install.
set -euo pipefail

ROOT="${CLAUDE_PLUGIN_ROOT:?CLAUDE_PLUGIN_ROOT not set}"
DATA="${CLAUDE_PLUGIN_DATA:?CLAUDE_PLUGIN_DATA not set}"

mkdir -p "$DATA"

if ! command -v bun >/dev/null 2>&1; then
  echo "openconclave plugin: bun not found in PATH." >&2
  echo "  install bun from https://bun.sh then restart Claude Code." >&2
  exit 0
fi

STAMP="$DATA/bun.lock"
if [ -f "$STAMP" ] && cmp -s "$ROOT/bun.lock" "$STAMP"; then
  exit 0
fi

cd "$ROOT"
bun install --frozen-lockfile >&2
cp bun.lock "$STAMP"
