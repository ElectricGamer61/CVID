# Cvideo one-click launcher (for the desktop / taskbar shortcut).
# Starts the app server if it isn't already running, then opens Cvideo in its own
# clean window (Chrome/Edge app mode) - no browser tabs, looks like a real app.
# ASCII-only on purpose: fancy dashes break PowerShell 5.1 parsing.

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$log  = "$root\data\backend.log"
# Use 127.0.0.1, NOT localhost: on Windows "localhost" resolves to IPv6 ::1 first, but the
# server listens on IPv4 only, so a localhost health check hangs ~2s per try and never passes.
$url  = "http://127.0.0.1:8000"
New-Item -ItemType Directory -Force -Path "$root\data" | Out-Null

# Refresh PATH so ffmpeg / npm / python are visible (winget updates the registry, not this shell).
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

# Resolve the YouTube browser-cookie fallback (registry + backend\.env, not just $env:, which
# is stale for anything set after this Explorer session started) and pass it to the backend.
. "$PSScriptRoot\cvideo-env.ps1"
$cookies = Initialize-CvideoBackendEnv -Root $root
$cookieLine = Get-CvideoCookieSummary $cookies
$backendEnv = Get-CvideoBackendEnvPrefix

function Test-Up {
  try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$url/api/health").StatusCode -eq 200 }
  catch { return $false }
}

if (-not (Test-Up)) {
  # First run (or after a UI change) needs the built UI; build it once if missing.
  if (-not (Test-Path "$root\frontend\dist\index.html")) {
    Write-Host "First run: building the app (one time)..." -ForegroundColor Cyan
    Push-Location "$root\frontend"; npm run build; Pop-Location
  }
  Write-Host "Starting Cvideo..." -ForegroundColor Cyan
  # Logged here, not above: when the app was already running we did not start a backend,
  # and a line in backend.log claiming otherwise would misdate the setting it reports.
  Write-Host $cookieLine -ForegroundColor DarkGray
  Add-Content $log $cookieLine
  # Backend serves the UI on one port; supervised loop self-heals a crash; log is tee'd.
  # Window is Minimized to dodge the QuickEdit freeze trap. Local-only (127.0.0.1) so no
  # firewall prompt -- use serve.cmd instead when you want other devices to reach it.
  # cmd does the stderr merge (see serve.ps1): uvicorn logs to stderr, and PowerShell's own
  # "2>&1" would tee a NativeCommandError block into backend.log for every ordinary INFO line.
  $backendCmd = "`$env:Path=[System.Environment]::GetEnvironmentVariable('Path','Machine')+';'+[System.Environment]::GetEnvironmentVariable('Path','User'); " +
    $backendEnv +
    "Set-Location '$root\backend'; while (`$true) { " +
    "cmd /c '.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000 2>&1' | Tee-Object -FilePath '$log' -Append; " +
    "Start-Sleep -Seconds 2 }"
  Start-Process powershell -ArgumentList @("-NoExit", "-Command", $backendCmd) -WindowStyle Minimized
  for ($i = 0; $i -lt 60; $i++) { if (Test-Up) { break }; Start-Sleep -Seconds 1 }
}

# Open in an app-style window (no tabs/address bar) if Chrome or Edge is present.
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
            "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
            "$env:LocalAppData\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
          "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($chrome)   { Start-Process $chrome "--app=$url" }
elseif ($edge) { Start-Process $edge   "--app=$url" }
else           { Start-Process $url }
