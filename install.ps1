$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════╗"
Write-Host "  ║      OpenConclave Installer           ║"
Write-Host "  ║  AI Agent Orchestration Platform      ║"
Write-Host "  ╚═══════════════════════════════════════╝"
Write-Host ""

$InstallDir = if ($env:OPENCONCLAVE_DIR) { $env:OPENCONCLAVE_DIR } else { "$env:USERPROFILE\.openconclave" }
$Repo = "https://github.com/openconclave/openconclave.git"

# Check for bun
$bunPath = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bunPath) {
    Write-Host ">> Installing Bun..."
    irm https://bun.sh/install.ps1 | iex
    $env:PATH = "$env:USERPROFILE\.bun\bin;$env:PATH"
}

Write-Host ">> Bun $(bun --version) found"

# Clone or update
if (Test-Path $InstallDir) {
    Write-Host ">> Updating existing installation..."
    Set-Location $InstallDir
    git pull --quiet
} else {
    Write-Host ">> Cloning OpenConclave..."
    git clone --depth 1 $Repo $InstallDir
    Set-Location $InstallDir
}

# Install dependencies
Write-Host ">> Installing dependencies..."
bun install --silent

# Create start script
$BinDir = "$env:USERPROFILE\.local\bin"
if (-not (Test-Path $BinDir)) { New-Item -ItemType Directory -Path $BinDir -Force | Out-Null }

@"
@echo off
cd /d "$InstallDir"
bun run start.ts %*
"@ | Set-Content "$BinDir\openconclave.cmd"

# Install Claude Code plugin if claude is available
$claudePath = Get-Command claude -ErrorAction SilentlyContinue
if ($claudePath) {
    Write-Host ">> Setting up Claude Code MCP integration..."

    $ClaudeDir = "$env:USERPROFILE\.claude"
    if (-not (Test-Path $ClaudeDir)) { New-Item -ItemType Directory -Path $ClaudeDir -Force | Out-Null }

    $McpConfig = "$ClaudeDir\.mcp.json"
    $mcpJson = @{
        mcpServers = @{
            openconclave = @{
                command = "bun"
                args = @("run", "$InstallDir\packages\server\src\mcp\server.ts")
            }
            "openconclave-channel" = @{
                command = "bun"
                args = @("run", "$InstallDir\packages\server\src\channel\openconclave-channel.ts")
            }
        }
    }

    if (Test-Path $McpConfig) {
        $existing = Get-Content $McpConfig | ConvertFrom-Json
        $existing.mcpServers | Add-Member -NotePropertyName "openconclave" -NotePropertyValue $mcpJson.mcpServers.openconclave -Force
        $existing.mcpServers | Add-Member -NotePropertyName "openconclave-channel" -NotePropertyValue $mcpJson.mcpServers."openconclave-channel" -Force
        $existing | ConvertTo-Json -Depth 10 | Set-Content $McpConfig
    } else {
        $mcpJson | ConvertTo-Json -Depth 10 | Set-Content $McpConfig
    }
}

Write-Host ""
Write-Host "  ✅ OpenConclave installed!"
Write-Host ""
Write-Host "  Start:    openconclave"
Write-Host "  Or:       cd $InstallDir; bun start"
Write-Host ""
Write-Host "  UI:       http://localhost:5173"
Write-Host "  API:      http://localhost:4000"
Write-Host ""
if ($claudePath) {
    Write-Host "  Claude Code MCP: configured"
    Write-Host "  Channel: run with --dangerously-load-development-channels server:openconclave-channel"
}
Write-Host ""
