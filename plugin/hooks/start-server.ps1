# OpenConclave SessionStart hook
# Starts the server if not already running

$PluginRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$OcRoot = Split-Path -Parent $PluginRoot
$Port = if ($env:OPENCONCLAVE_PORT) { $env:OPENCONCLAVE_PORT } else { "4000" }

# Check if server is already running
try {
    $health = Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 2 -ErrorAction Stop
    exit 0
} catch {}

# Start server in background
Push-Location $OcRoot
Start-Process -NoNewWindow -FilePath "bun" -ArgumentList "run", "packages/server/src/index.ts" -RedirectStandardOutput "NUL" -RedirectStandardError "NUL"
Pop-Location

# Wait for server to be ready (up to 10s)
for ($i = 0; $i -lt 20; $i++) {
    try {
        $health = Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 1 -ErrorAction Stop
        Write-Output '{"hookSpecificOutput":{"message":"OpenConclave server started on port '$Port'"}}'
        exit 0
    } catch {}
    Start-Sleep -Milliseconds 500
}

Write-Output '{"hookSpecificOutput":{"message":"OpenConclave server failed to start"}}'
exit 0
