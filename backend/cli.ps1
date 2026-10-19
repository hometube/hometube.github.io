# HomeTube CLI helper (Windows) — manages virtual environment and ht command.
#
# Usage:
#   . .\cli.ps1                 Activate virtual environment in current shell
#   .\cli.ps1 init              Create/update venv and install requirements
#   .\cli.ps1 update            Reinstall pip dependencies in existing venv
#   .\cli.ps1 install           Install ht command (uses venv Python)

param([string]$Command = "")

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvDir = Join-Path $ScriptDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$VenvActivate = Join-Path $VenvDir "Scripts\Activate.ps1"

function Find-Python {
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) { return "py" }
    foreach ($cand in @("python", "python3")) {
        if (Get-Command $cand -ErrorAction SilentlyContinue) { return $cand }
    }
    Write-Host "❌ Python not found. Install Python 3.10+ (winget install Python.Python.3.12)" -ForegroundColor Red
    exit 1
}

function Ensure-Venv {
    if (-not (Test-Path $VenvPython)) {
        Write-Host "📦 Creating virtual environment..."
        $py = Find-Python
        if ($py -eq "py") {
            & py -3 -m venv $VenvDir
        } else {
            & $py -m venv $VenvDir
        }
    }
}

switch ($Command) {
    "init" {
        Ensure-Venv
        Write-Host "📥 Installing dependencies..."
        & $VenvPython -m pip install -r (Join-Path $ScriptDir "requirements.txt")
        Write-Host "✅ Virtual environment ready at $VenvDir"
        Write-Host "   Run: . .\cli.ps1   (dot-source to activate in current shell)"
    }
    "update" {
        if (-not (Test-Path $VenvPython)) {
            Write-Host "❌ No virtual environment found. Run '.\cli.ps1 init' first." -ForegroundColor Red
            exit 1
        }
        Write-Host "📥 Updating dependencies..."
        & $VenvPython -m pip install -r (Join-Path $ScriptDir "requirements.txt")
        Write-Host "✅ Updated."
    }
    "install" {
        Ensure-Venv
        & $VenvPython (Join-Path $ScriptDir "cli.py") install
        Write-Host "✅ ht installed. Restart your terminal if 'ht' is not found yet."
    }
    default {
        # No command — activate the venv (intended for dot-sourcing)
        if (Test-Path $VenvActivate) {
            . $VenvActivate
            Write-Host "🐍 Virtual environment activated"
        } else {
            Write-Host "Run '.\cli.ps1 init' first to set up virtual environment."
        }
    }
}
