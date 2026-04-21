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
NEEDS_INSTALL=1
if [ -f "$STAMP" ] && cmp -s "$ROOT/bun.lock" "$STAMP"; then
  NEEDS_INSTALL=0
fi

cd "$ROOT"

if [ "$NEEDS_INSTALL" = "1" ]; then
  bun install --frozen-lockfile >&2
  cp bun.lock "$STAMP"
fi

if [ ! -f "$ROOT/packages/client/dist/index.html" ]; then
  echo "openconclave plugin: building client bundle (first run only)…" >&2
  bun run --filter client build >&2
fi
