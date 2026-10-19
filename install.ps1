# HomeTube Installer (Windows)
# Prerequisites: Python 3.10+, Node.js, ffmpeg, and a JS runtime for yt-dlp (e.g. Deno).
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

Warn-Missing "python" "Install Python 3.10+ (winget install Python.Python.3.12)"
Warn-Missing "py" "or install the Python launcher with the python.org installer"
Warn-Missing "ffmpeg" "Needed for music conversion/embedding (winget install Gyan.FFmpeg)"
if (-not (Get-Command deno, node, bun -ErrorAction SilentlyContinue)) {
    Write-Host "⚠️  No JS runtime (deno/node/bun) found — newer yt-dlp needs one for YouTube (winget install DenoLand.Deno)" -ForegroundColor Yellow
}

# Backend setup (virtual environment + dependencies)
Write-Host "=== Backend ==="
& (Join-Path $ScriptDir "backend\cli.ps1") init

# Frontend setup (npm install + build)
Write-Host ""
Write-Host "=== Frontend ==="
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "❌ npm not found. Install Node.js LTS (winget install OpenJS.NodeJS.LTS)" -ForegroundColor Red
    exit 1
}
Push-Location (Join-Path $ScriptDir "frontend")
Write-Host "📦 Installing npm dependencies..."
npm install
Write-Host "🔨 Building frontend..."
npm run build
Pop-Location

# Install ht command
Write-Host ""
Write-Host "=== CLI ==="
& (Join-Path $ScriptDir "backend\cli.ps1") install

Write-Host ""
Write-Host "✅ HomeTube installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "To start the server:"
Write-Host "  cd backend ; . .\cli.ps1 ; python main.py"
Write-Host ""
Write-Host "Or use the ht CLI tool (restart your terminal first):"
Write-Host "  ht init                    # configure data directory and user"
Write-Host "  ht login <username>        # set active user"
Write-Host "  ht download <url>          # download videos/music"
Write-Host "  ht export -o backup.ht     # export your data"
