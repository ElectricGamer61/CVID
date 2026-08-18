# Cvideo launcher -- starts the backend + frontend and opens the app.
# Double-click start.cmd, or run:  powershell -ExecutionPolicy Bypass -File scripts\start.ps1
# ASCII-only on purpose: em-dash / ellipsis chars break PowerShell 5.1 parsing.

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$log  = "$root\data\backend.log"

# Make sure data\ exists so the log has a home.
New-Item -ItemType Directory -Force -Path "$root\data" | Out-Null

# Refresh PATH so ffmpeg / ollama are visible (winget updates the registry, not this shell).
$refresh = "`$env:Path=[System.Environment]::GetEnvironmentVariable('Path','Machine')+';'+[System.Environment]::GetEnvironmentVariable('Path','User')"

# Resolve the YouTube browser-cookie fallback here and hand it to the backend window
# explicitly ($backendEnv below). A setx / System-Properties value never reaches an
# already-running shell, so the backend used to start with the setting missing.
. "$PSScriptRoot\cvideo-env.ps1"
$cookies = Initialize-CvideoBackendEnv -Root $root
$cookieLine = Get-CvideoCookieSummary $cookies
Write-Host $cookieLine -ForegroundColor DarkGray
Add-Content $log $cookieLine
$backendEnv = Get-CvideoBackendEnvPrefix

Write-Host "Starting Cvideo backend (http://127.0.0.1:8000)..." -ForegroundColor Cyan
# Supervised loop: if uvicorn dies (e.g. a native GPU crash slips past the worker isolation),
# it self-heals in ~2s. All output is tee'd to data\backend.log so a crash leaves evidence.
# Window is Minimized to dodge the QuickEdit trap (a click in a normal console pauses stdout
# and freezes the server until a key is pressed).
# cmd does the stderr merge (see serve.ps1): uvicorn logs to stderr, and PowerShell's own "2>&1"
# would tee a NativeCommandError block into backend.log for every ordinary INFO line.
$backendCmd = "$refresh; $backendEnv" + "Set-Location '$root\backend'; " +
  "while (`$true) { " +
  "cmd /c '.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000 2>&1' | Tee-Object -FilePath '$log' -Append; " +
  # Single quotes for the child's own string: `\"` is not an escape in PowerShell, it just ends
  # the string here and made this whole file fail to parse (so start.cmd did nothing at all).
  "Add-Content '$log' ('=== backend exited {0} - restarting ===' -f (Get-Date)); " +
  "Start-Sleep -Seconds 2 }"
Start-Process powershell -ArgumentList @("-NoExit", "-Command", $backendCmd) -WindowStyle Minimized

Write-Host "Starting Cvideo frontend (http://localhost:3000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "Set-Location '$root\frontend'; npm run dev"
)

Start-Sleep -Seconds 4
Write-Host "Opening the app in your browser..." -ForegroundColor Green
Start-Process "http://localhost:3000"
Write-Host "`nTip: make sure Ollama is running (it starts on login). The backend window is minimized and auto-restarts; its log is data\backend.log. Close the two windows to stop Cvideo." -ForegroundColor DarkGray
