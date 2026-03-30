#!/bin/bash
# OpenConclave SessionStart hook
# Starts the server if not already running

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OC_ROOT="$(cd "$PLUGIN_ROOT/.." && pwd)"
PORT="${OPENCONCLAVE_PORT:-4000}"

# Check if server is already running
if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
  exit 0
fi

# Start server in background
cd "$OC_ROOT"
nohup bun run packages/server/src/index.ts > /dev/null 2>&1 &

# Wait for server to be ready (up to 10s)
for i in $(seq 1 20); do
  if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
    echo '{"hookSpecificOutput":{"message":"OpenConclave server started on port '$PORT'"}}'
    exit 0
  fi
  sleep 0.5
done

echo '{"hookSpecificOutput":{"message":"OpenConclave server failed to start"}}'
exit 0
