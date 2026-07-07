# Make Cvideo start automatically on login, in SERVER MODE (reachable from your phone/laptop
# and, with Tailscale, from anywhere). Adds a shortcut to your Startup folder that runs
# serve.ps1 minimized. Run again to refresh; use -Remove to undo. ASCII-only for PS 5.1.

param([switch]$Remove)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup "Cvideo Server.lnk"

if ($Remove) {
  if (Test-Path $lnkPath) { Remove-Item $lnkPath -Force; Write-Host "Autostart removed." -ForegroundColor Green }
  else { Write-Host "No autostart entry found." -ForegroundColor Yellow }
  return
}

$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$lnk.Arguments = "-ExecutionPolicy Bypass -NoProfile -WindowStyle Minimized -File `"$root\scripts\serve.ps1`""
$lnk.WorkingDirectory = $root
if (Test-Path "$root\assets\cvideo.ico") { $lnk.IconLocation = "$root\assets\cvideo.ico" }
$lnk.Description = "Run Cvideo in server mode on login"
$lnk.WindowStyle = 7
$lnk.Save()

Write-Host "Done - Cvideo now starts on every login (server mode, one window minimized)." -ForegroundColor Green
Write-Host ""
Write-Host "So your desktop is reachable while you travel:" -ForegroundColor Cyan
Write-Host "  1. Keep this PC powered on (and not asleep) while you're away." -ForegroundColor Gray
Write-Host "  2. Install Tailscale on this PC + your phone/laptop, signed into the same account." -ForegroundColor Gray
Write-Host "  3. From anywhere, open  http://<this-pc-tailscale-name>:8000" -ForegroundColor Gray
Write-Host ""
Write-Host "To stop autostart later:  powershell -File scripts\install-autostart.ps1 -Remove" -ForegroundColor DarkGray
Read-Host "Press Enter to close"
