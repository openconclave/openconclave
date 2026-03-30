$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║      OpenConclave Installer           ║" -ForegroundColor Cyan
Write-Host "  ║  AI Agent Orchestration Platform      ║" -ForegroundColor Cyan
Write-Host "  ╚═══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$InstallDir = if ($env:OPENCONCLAVE_DIR) { $env:OPENCONCLAVE_DIR } else { "$env:USERPROFILE\.openconclave-app" }
$Repo = "https://github.com/openconclave/openconclave.git"

# ── Check prerequisites ──────────────────────────────────────

# Git
$gitPath = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitPath) {
    Write-Host "  [!] Git is required. Install from https://git-scm.com" -ForegroundColor Red
    exit 1
}

# Bun
$bunPath = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bunPath) {
    Write-Host "  >> Installing Bun..." -ForegroundColor Yellow
    irm https://bun.sh/install.ps1 | iex
    # Refresh PATH
    $env:BUN_INSTALL = "$env:USERPROFILE\.bun"
    $env:PATH = "$env:BUN_INSTALL\bin;$env:PATH"
    $bunPath = Get-Command bun -ErrorAction SilentlyContinue
    if (-not $bunPath) {
        Write-Host "  [!] Bun installation failed. Install manually from https://bun.sh" -ForegroundColor Red
        exit 1
    }
}

$bunVersion = & bun --version
Write-Host "  >> Bun $bunVersion found" -ForegroundColor Green

# ── Clone or update ──────────────────────────────────────────

if (Test-Path "$InstallDir\.git") {
    Write-Host "  >> Updating existing installation..."
    Push-Location $InstallDir
    git pull --quiet
    Pop-Location
} else {
    if (Test-Path $InstallDir) {
        Write-Host "  >> Removing old installation..."
        Remove-Item -Recurse -Force $InstallDir
    }
    Write-Host "  >> Cloning OpenConclave..."
    git clone --depth 1 $Repo $InstallDir
}

# ── Install dependencies ─────────────────────────────────────

Push-Location $InstallDir
Write-Host "  >> Installing dependencies..."
bun install --silent 2>$null
Pop-Location

# ── Create start command ─────────────────────────────────────

$BinDir = "$env:USERPROFILE\.local\bin"
if (-not (Test-Path $BinDir)) { New-Item -ItemType Directory -Path $BinDir -Force | Out-Null }

# openconclave.cmd — start server + client
@"
@echo off
cd /d "$InstallDir"
bun start %*
"@ | Set-Content "$BinDir\openconclave.cmd" -Encoding ASCII

# Add to user PATH if not already there
$UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($UserPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("PATH", "$BinDir;$UserPath", "User")
    $env:PATH = "$BinDir;$env:PATH"
    Write-Host "  >> Added $BinDir to PATH" -ForegroundColor Yellow
}

# ── Configure Claude Code MCP ────────────────────────────────

$ClaudeConfigured = $false
$claudePath = Get-Command claude -ErrorAction SilentlyContinue

if ($claudePath) {
    Write-Host "  >> Configuring Claude Code integration..."

    $ClaudeDir = "$env:USERPROFILE\.claude"
    if (-not (Test-Path $ClaudeDir)) { New-Item -ItemType Directory -Path $ClaudeDir -Force | Out-Null }

    $McpConfigPath = "$ClaudeDir\.mcp.json"

    $ocServer = @{
        command = "bun"
        args = @("run", "$InstallDir\packages\server\src\mcp\server.ts")
        cwd = $InstallDir
    }
    $ocChannel = @{
        command = "bun"
        args = @("run", "$InstallDir\packages\server\src\channel\openconclave-channel.ts")
        cwd = $InstallDir
    }

    if (Test-Path $McpConfigPath) {
        $existing = Get-Content $McpConfigPath -Raw | ConvertFrom-Json
        if (-not $existing.mcpServers) {
            $existing | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue @{} -Force
        }
        $existing.mcpServers | Add-Member -NotePropertyName "openconclave" -NotePropertyValue $ocServer -Force
        $existing.mcpServers | Add-Member -NotePropertyName "openconclave-channel" -NotePropertyValue $ocChannel -Force
        $existing | ConvertTo-Json -Depth 10 | Set-Content $McpConfigPath
    } else {
        @{
            mcpServers = @{
                openconclave = $ocServer
                "openconclave-channel" = $ocChannel
            }
        } | ConvertTo-Json -Depth 10 | Set-Content $McpConfigPath
    }

    $ClaudeConfigured = $true
}

# ── Done ─────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║      OpenConclave installed!          ║" -ForegroundColor Green
Write-Host "  ╚═══════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Start:     openconclave" -ForegroundColor White
Write-Host "  Or:        cd $InstallDir; bun start" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  UI:        http://localhost:5173" -ForegroundColor Cyan
Write-Host "  API:       http://localhost:4000" -ForegroundColor Cyan
Write-Host ""

if ($ClaudeConfigured) {
    Write-Host "  Claude Code MCP: configured in ~/.claude/.mcp.json" -ForegroundColor Green
    Write-Host "  With channel:    claude --dangerously-load-development-channels server:openconclave-channel" -ForegroundColor DarkGray
} else {
    Write-Host "  Claude Code: not found. Install it, then re-run this script." -ForegroundColor Yellow
}

Write-Host ""
