# HomeTube Installer (Windows — experimental)
# Installs whatever is missing — bun, ffmpeg, yt-dlp, and a JS runtime for
# yt-dlp (Deno) — via winget, then the server deps and the ht command.
#
# Usage (PowerShell):
#   powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$script:HasWinget = [bool](Get-Command winget -ErrorAction SilentlyContinue)
if (-not $script:HasWinget) {
    Write-Host "⚠️  winget not found — tools must be installed manually." -ForegroundColor Yellow
    Write-Host "    (get 'App Installer' from the Microsoft Store)" -ForegroundColor Yellow
    Write-Host ""
}

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")
}

# Install $name via $wingetId when it is missing; warn with $hint if that fails.
function Ensure-Tool([string]$name, [string]$wingetId, [string]$hint) {
    if (Get-Command $name -ErrorAction SilentlyContinue) { return }
    if ($script:HasWinget) {
        Write-Host "📦 $name not found — installing $wingetId via winget..."
        winget install $wingetId -e --accept-source-agreements --accept-package-agreements
        Refresh-Path
    }
    if (Get-Command $name -ErrorAction SilentlyContinue) {
        Write-Host "✅ $name installed"
    } else {
        Write-Host "⚠️  $name still not found — $hint" -ForegroundColor Yellow
    }
}

Write-Host "🚀 HomeTube Installer"
Write-Host ""

Ensure-Tool "bun" "Oven-sh.Bun" "install it manually: https://bun.sh"
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "❌ bun install failed. Install it manually: https://bun.sh" -ForegroundColor Red
    exit 1
}

Ensure-Tool "ffmpeg" "Gyan.FFmpeg" "needed for music conversion/embedding (winget install Gyan.FFmpeg)"
Ensure-Tool "yt-dlp" "yt-dlp.yt-dlp" "needed for downloads (winget install yt-dlp.yt-dlp)"
if (-not (Get-Command deno -ErrorAction SilentlyContinue) -and
    -not (Get-Command node -ErrorAction SilentlyContinue)) {
    Ensure-Tool "deno" "DenoLand.Deno" "newer yt-dlp needs a JS runtime for YouTube (winget install DenoLand.Deno)"
}

Write-Host "=== Server ==="
Push-Location (Join-Path $ScriptDir "server")
bun install
Pop-Location

# Install ht command (also adds ~/.local/bin to the user PATH)
Write-Host ""
Write-Host "=== CLI ==="
bun (Join-Path $ScriptDir "server\src\cli.ts") install

Write-Host ""
Write-Host "✅ HomeTube installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "To start the server:"
Write-Host "  ht serve                   # http://localhost:8000 on your LAN"
Write-Host ""
Write-Host "Or use the ht CLI tool (restart your terminal first):"
Write-Host "  ht init                    # configure data directory and user"
Write-Host "  ht login <username>        # set active user"
Write-Host "  ht download <url>          # download videos/music"
Write-Host "  ht export -o backup.ht     # export your data"
