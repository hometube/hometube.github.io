# HomeTube Installer (Windows — experimental)
# Prerequisites: bun, ffmpeg, and a JS runtime for yt-dlp (e.g. Deno).
#
# Usage (PowerShell):
#   powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Warn-Missing([string]$name, [string]$hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Host "⚠️  $name not found — $hint" -ForegroundColor Yellow
    }
}

Write-Host "🚀 HomeTube Installer"
Write-Host ""

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "📦 bun not found — installing via winget..."
    winget install Oven-sh.Bun -e --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")
    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
        Write-Host "❌ bun install failed. Install it manually: https://bun.sh" -ForegroundColor Red
        exit 1
    }
}

Warn-Missing "ffmpeg" "Needed for music conversion/embedding (winget install Gyan.FFmpeg)"
Warn-Missing "yt-dlp" "Needed for downloads (winget install yt-dlp.yt-dlp)"
if (-not (Get-Command deno, node -ErrorAction SilentlyContinue)) {
    Write-Host "⚠️  No JS runtime (deno/node) found — newer yt-dlp needs one for YouTube (winget install DenoLand.Deno)" -ForegroundColor Yellow
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
