# Cvideo ONE-SHOT installer - dead simple.
# Installs the prerequisites, gets the code, builds it, saves your keys, and launches.
# ASCII-only on purpose: em-dash / ellipsis chars break PowerShell 5.1 parsing.
#
# Run this single line in PowerShell (nothing else needed):
#   iwr -useb https://raw.githubusercontent.com/ElectricGamer61/CVID/main/scripts/bootstrap.ps1 | iex
#
# Or, if you already cloned the repo, just double-click  install.cmd  at its root.

$ErrorActionPreference = "Stop"

function Refresh-Path {
  # winget updates the registry PATH, not this shell - re-read it so freshly installed tools appear.
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
              [System.Environment]::GetEnvironmentVariable('Path','User')
}

function Ensure-Tool($cmd, $wingetId, $label) {
  Refresh-Path
  if (Get-Command $cmd -ErrorAction SilentlyContinue) { Write-Host ("  [ok] {0}" -f $label) -ForegroundColor Green; return }
  Write-Host ("  [..] installing {0} ..." -f $label) -ForegroundColor Cyan
  winget install -e --id $wingetId --accept-package-agreements --accept-source-agreements --silent
  Refresh-Path
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host ("  [!!] {0} was installed but isn't on PATH in this window yet." -f $label) -ForegroundColor Yellow
    Write-Host "       Close this window, open a NEW PowerShell, and run the one-liner again." -ForegroundColor Yellow
    exit 1
  }
  Write-Host ("  [ok] {0}" -f $label) -ForegroundColor Green
}

function Set-EnvKey($path, $key, $value) {
  if (-not $value) { return }                     # blank -> leave it for later
  $lines = if (Test-Path $path) { Get-Content $path } else { @() }
  $set = $false
  $out = foreach ($l in $lines) {
    if ($l -match ("^\s*{0}=" -f [Regex]::Escape($key))) { "$key=$value"; $set = $true } else { $l }
  }
  if (-not $set) { $out = @($out) + "$key=$value" }
  Set-Content -Path $path -Value $out -Encoding utf8
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host "winget is required (it ships with Windows 11). Update Windows / install 'App Installer' from the Microsoft Store, then re-run." -ForegroundColor Red
  exit 1
}

Write-Host "=== Cvideo installer ===" -ForegroundColor Cyan

# --- 1. Prerequisites (idempotent) -----------------------------------------
Write-Host "1. Prerequisites" -ForegroundColor White
Ensure-Tool git    "Git.Git"           "Git"
Ensure-Tool ffmpeg "Gyan.FFmpeg"       "ffmpeg"
Ensure-Tool node   "OpenJS.NodeJS.LTS" "Node.js"
# Python 3.11 specifically (the ML stack needs 3.11, not 3.12/3.13).
Refresh-Path
$hasPy311 = $false
if (Get-Command py -ErrorAction SilentlyContinue) { if ((& py -3.11 -c "print('ok')" 2>$null) -eq 'ok') { $hasPy311 = $true } }
if ($hasPy311) {
  Write-Host "  [ok] Python 3.11" -ForegroundColor Green
} else {
  Write-Host "  [..] installing Python 3.11 ..." -ForegroundColor Cyan
  winget install -e --id Python.Python.3.11 --accept-package-agreements --accept-source-agreements --silent
  Refresh-Path
  if (-not (Get-Command py -ErrorAction SilentlyContinue) -or (& py -3.11 -c "print('ok')" 2>$null) -ne 'ok') {
    Write-Host "  [!!] Python 3.11 installed but not visible yet. Open a NEW PowerShell and re-run the one-liner." -ForegroundColor Yellow
    exit 1
  }
  Write-Host "  [ok] Python 3.11" -ForegroundColor Green
}

# --- 2. Get the code --------------------------------------------------------
Write-Host "2. Getting the code" -ForegroundColor White
$root = $null
if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "..\backend"))) {
  $root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path       # running from inside the repo
  Write-Host ("  [ok] using this repo: {0}" -f $root) -ForegroundColor Green
} else {
  $target = Join-Path $HOME "CVID"
  if (Test-Path (Join-Path $target ".git")) {
    Write-Host ("  [..] updating existing clone at {0}" -f $target) -ForegroundColor Cyan
    git -C $target pull --ff-only
  } else {
    Write-Host ("  [..] cloning into {0}" -f $target) -ForegroundColor Cyan
    git clone https://github.com/ElectricGamer61/CVID.git $target
  }
  $root = $target
}

# --- 3. Build (venv + bare deps + UI) --------------------------------------
Write-Host "3. Building (this is the long part - a few minutes)" -ForegroundColor White
& powershell -ExecutionPolicy Bypass -File (Join-Path $root "scripts\setup-laptop.ps1")
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed - see errors above." -ForegroundColor Red; exit 1 }

# --- 4. API keys ------------------------------------------------------------
Write-Host "4. Your API keys (press Enter to skip any - you can paste them into backend\.env later)" -ForegroundColor White
$envFile = Join-Path $root "backend\.env"
$el = Read-Host "  ElevenLabs API key (voice + transcription)"
$oa = Read-Host "  OpenAI API key (the writing brain)"
Set-EnvKey $envFile "ELEVENLABS_API_KEY" $el.Trim()
Set-EnvKey $envFile "OPENAI_API_KEY"     $oa.Trim()
Write-Host "  [ok] keys saved to backend\.env" -ForegroundColor Green

# --- 5. Desktop button ------------------------------------------------------
# So opening Cvideo from here on is one double-click, not a folder full of .cmd files.
& powershell -ExecutionPolicy Bypass -NoProfile -File (Join-Path $root "scripts\install-shortcut.ps1") -Quiet

# --- 6. Launch --------------------------------------------------------------
Write-Host "6. Starting Cvideo" -ForegroundColor White
$serve = Join-Path $root "serve.cmd"
Start-Process -FilePath $serve -WorkingDirectory $root
Start-Sleep -Seconds 6
Start-Process "http://127.0.0.1:8000"

Write-Host ""
Write-Host "=== Done! ===" -ForegroundColor Green
Write-Host ("Cvideo is at  http://127.0.0.1:8000  (a server window opened - leave it running)." -f $root) -ForegroundColor White
Write-Host "Next time, just double-click the  Cvideo  icon on your Desktop." -ForegroundColor White
