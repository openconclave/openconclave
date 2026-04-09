param(
    [string]$Version = "latest"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = 'SilentlyContinue'

Write-Output ""
Write-Output "  * O P E N C O N C L A V E  Installer"
Write-Output ""

# ── Detect architecture ──────────────────────────────────────

if (-not [Environment]::Is64BitProcess) {
    Write-Error "OpenConclave requires 64-bit Windows."
    exit 1
}
$platform = "windows-x64"

# ── Resolve version ──────────────────────────────────────────

$REPO = "openconclave/openconclave"
$DOWNLOAD_DIR = "$env:USERPROFILE\.openconclave\downloads"
New-Item -ItemType Directory -Force -Path $DOWNLOAD_DIR | Out-Null

if ($Version -eq "latest") {
    Write-Output "  Fetching latest release..."
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/latest" -ErrorAction Stop
        $Version = $release.tag_name -replace '^v', ''
    }
    catch {
        Write-Error "Failed to fetch latest release: $_"
        exit 1
    }
}

Write-Output "  Version: $Version"

# ── Download binary ──────────────────────────────────────────

$assetName = "openconclave-$platform.exe"
$downloadUrl = "https://github.com/$REPO/releases/download/v$Version/$assetName"
$binaryPath = "$DOWNLOAD_DIR\openconclave.exe"

Write-Output "  Downloading $assetName..."
try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $binaryPath -ErrorAction Stop
}
catch {
    Write-Error "Failed to download: $_"
    if (Test-Path $binaryPath) { Remove-Item -Force $binaryPath }
    exit 1
}

# ── Run installer ────────────────────────────────────────────

Write-Output "  Running installer..."
try {
    & $binaryPath install
}
finally {
    Start-Sleep -Seconds 1
    try { Remove-Item -Force $binaryPath } catch {}
}

Write-Output ""
Write-Output "  Installation complete!"
Write-Output ""
