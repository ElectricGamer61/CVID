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

Write-Host "Starting Cvideo backend (http://127.0.0.1:8000)..." -ForegroundColor Cyan
# Supervised loop: if uvicorn dies (e.g. a native GPU crash slips past the worker isolation),
# it self-heals in ~2s. All output is tee'd to data\backend.log so a crash leaves evidence.
# Window is Minimized to dodge the QuickEdit trap (a click in a normal console pauses stdout
# and freezes the server until a key is pressed).
$backendCmd = "$refresh; Set-Location '$root\backend'; " +
  "while (`$true) { " +
  ".\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000 2>&1 | Tee-Object -FilePath '$log' -Append; " +
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
