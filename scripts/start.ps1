# Cvideo launcher -- starts the backend + frontend and opens the app.
# Double-click start.cmd, or run:  powershell -ExecutionPolicy Bypass -File scripts\start.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

# Refresh PATH so ffmpeg / ollama are visible (winget updates the registry, not this shell).
$refresh = "`$env:Path=[System.Environment]::GetEnvironmentVariable('Path','Machine')+';'+[System.Environment]::GetEnvironmentVariable('Path','User')"

Write-Host "Starting Cvideo backend (http://127.0.0.1:8000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "$refresh; Set-Location '$root\backend'; .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000"
)

Write-Host "Starting Cvideo frontend (http://localhost:5173)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "Set-Location '$root\frontend'; npm run dev"
)

Start-Sleep -Seconds 4
Write-Host "Opening the app in your browser..." -ForegroundColor Green
Start-Process "http://localhost:5173"
Write-Host "`nTip: make sure Ollama is running (it starts on login). Two terminal windows opened -- close them to stop Cvideo." -ForegroundColor DarkGray
