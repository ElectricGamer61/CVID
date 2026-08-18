# Cvideo SERVER MODE -- one port, reachable from your other devices (laptop/phone).
# Run:  powershell -ExecutionPolicy Bypass -File scripts\serve.ps1
# ASCII-only on purpose: em-dash / ellipsis chars break PowerShell 5.1 parsing.
#
# Unlike start.ps1 (two windows for local dev), this builds the UI once and lets the
# BACKEND serve it, so the whole app is a single url on port 8000 bound to 0.0.0.0.
# On the same wifi:   http://<this-pc-ip>:8000
# From anywhere:      install Tailscale on both devices, then http://<tailscale-name>:8000

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$log  = "$root\data\backend.log"
New-Item -ItemType Directory -Force -Path "$root\data" | Out-Null

# Refresh PATH so ffmpeg / ollama / npm are visible (winget updates the registry, not this shell).
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

# Resolve the YouTube browser-cookie fallback and put it in THIS process's environment, so
# the backend below inherits it. Reading the registry (not just $env:) is the point: a value
# set with setx / the System Properties dialog never reaches an already-running shell.
. "$PSScriptRoot\cvideo-env.ps1"
$cookies = Initialize-CvideoBackendEnv -Root $root
$cookieLine = Get-CvideoCookieSummary $cookies
Write-Host $cookieLine -ForegroundColor DarkGray
Add-Content $log $cookieLine

# Build the UI only if it hasn't been built yet (fast startup / boot-time autostart).
# Force a rebuild after a UI change by deleting frontend\dist first, or run npm run build.
if (-not (Test-Path "$root\frontend\dist\index.html")) {
  Write-Host "First run: building the UI (one time)..." -ForegroundColor Cyan
  Set-Location "$root\frontend"
  npm run build
  # Prompt before exiting: a double-clicked serve.cmd would otherwise flash and close unexplained.
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Frontend build failed - fix TS errors and retry." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
  }
}

# Show the addresses this machine can be reached at (LAN + any Tailscale 100.x address).
$ips = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -ExpandProperty IPAddress
Write-Host "`nCvideo will be reachable at:" -ForegroundColor Green
foreach ($ip in $ips) { Write-Host ("  http://{0}:8000" -f $ip) -ForegroundColor Green }
Write-Host ""

# Fail loudly here rather than in the loop below: a missing venv means install.cmd never ran.
Set-Location "$root\backend"
if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
  Write-Host "Backend venv is missing - run install.cmd first." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

# Supervised loop (same self-heal + tee'd log as start.ps1), bound to 0.0.0.0 for other devices.
#
# Two things keep this alive that are easy to get wrong on Windows PowerShell 5.1:
#   1. uvicorn logs everything to STDERR. Merging a native command's stderr with PowerShell's own
#      "2>&1" turns each line into a NativeCommandError record, which under $ErrorActionPreference
#      = "Stop" is TERMINATING - the script died on uvicorn's first INFO line, killing the server
#      before it bound the port and before Tee-Object ever created backend.log. So let cmd do the
#      merge instead: PowerShell then only ever sees plain stdout.
#   2. Belt and braces, drop to "Continue" for the loop so a stray native stderr line can never
#      take the supervisor down. Everything above this point still fails fast under "Stop".
$ErrorActionPreference = "Continue"
$serveCmd = ".\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 2>&1"
while ($true) {
  cmd /c $serveCmd | Tee-Object -FilePath $log -Append
  Add-Content $log ("=== backend exited {0} - restarting ===" -f (Get-Date))
  Start-Sleep -Seconds 2
}
