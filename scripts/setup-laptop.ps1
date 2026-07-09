# Cvideo LAPTOP setup (Windows). One-time, after cloning the repo.
# ASCII-only on purpose: em-dash / ellipsis chars break PowerShell 5.1 parsing.
#
# Run:  powershell -ExecutionPolicy Bypass -File scripts\setup-laptop.ps1
#
# What it does: checks Python 3.11 / ffmpeg / Node, builds the venv with the BARE-BONES
# deps (no CUDA, no local Whisper, no local LLM - ElevenLabs + cloud Gemini), seeds
# backend\.env from the template, and builds the UI. After it finishes: paste your keys
# into backend\.env, then run serve.cmd.

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

# Refresh PATH so freshly winget-installed tools are visible in this shell.
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

Write-Host "=== Cvideo laptop setup ===" -ForegroundColor Cyan

# --- 1. Prerequisites -------------------------------------------------------
$missing = @()
if (-not (Get-Command py     -ErrorAction SilentlyContinue)) { $missing += "Python.Python.3.11" }
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { $missing += "Gyan.FFmpeg" }
if (-not (Get-Command node   -ErrorAction SilentlyContinue)) { $missing += "OpenJS.NodeJS.LTS" }

if ($missing.Count -gt 0) {
  Write-Host "Missing tools. Install these, then open a NEW terminal and re-run:" -ForegroundColor Red
  foreach ($m in $missing) { Write-Host ("  winget install {0}" -f $m) -ForegroundColor Yellow }
  exit 1
}

# Make sure the 3.11 interpreter specifically exists (py launcher may only have 3.13).
$py311 = (& py -3.11 -c "print('ok')" 2>$null)
if ($py311 -ne 'ok') {
  Write-Host "Python 3.11 not found (the ML stack needs 3.11, not 3.12/3.13)." -ForegroundColor Red
  Write-Host "  winget install Python.Python.3.11   (then re-run in a new terminal)" -ForegroundColor Yellow
  exit 1
}
Write-Host "Prereqs OK: Python 3.11, ffmpeg, Node." -ForegroundColor Green

# --- 2. Backend venv + lean deps -------------------------------------------
Set-Location "$root\backend"
if (-not (Test-Path ".venv")) {
  Write-Host "Creating Python 3.11 venv..." -ForegroundColor Cyan
  & py -3.11 -m venv .venv
}
Write-Host "Installing backend deps (bare-bones - no CUDA, no Whisper, no local LLM)..." -ForegroundColor Cyan
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements-bare.txt
if ($LASTEXITCODE -ne 0) { Write-Host "pip install failed - see errors above." -ForegroundColor Red; exit 1 }

# --- 3. Seed backend\.env ---------------------------------------------------
if (-not (Test-Path "$root\backend\.env")) {
  Copy-Item "$root\backend\.env.example" "$root\backend\.env"
  Write-Host "Created backend\.env from the template." -ForegroundColor Green
} else {
  Write-Host "backend\.env already exists - leaving it alone." -ForegroundColor Green
}

# --- 4. Build the UI --------------------------------------------------------
Set-Location "$root\frontend"
if (-not (Test-Path "node_modules")) {
  Write-Host "Installing frontend deps (npm install)..." -ForegroundColor Cyan
  npm install
}
Write-Host "Building the UI..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "UI build failed - see errors above." -ForegroundColor Red; exit 1 }

# --- Done -------------------------------------------------------------------
Write-Host ""
Write-Host "=== Setup complete ===" -ForegroundColor Green
Write-Host "1. Open  backend\.env  and paste your ELEVENLABS_API_KEY (and Upload-Post keys if posting)." -ForegroundColor White
Write-Host "2. Double-click  serve.cmd  (or run scripts\serve.ps1) to start." -ForegroundColor White
Write-Host "3. Open the URL it prints (e.g. http://127.0.0.1:8000)." -ForegroundColor White
