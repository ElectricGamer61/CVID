# Put a "Cvideo" button on the Desktop (and in the Start menu) that opens the app.
#
# The shortcut runs scripts\open-cvideo.ps1, which starts the local server only if it is not
# already up and then opens Cvideo in its own Chrome/Edge --app window - so after install the
# whole thing is one double-click, with no terminal to look at.
#
# Run again any time to refresh it; use -Remove to take it away. ASCII-only for PS 5.1.

param([switch]$Remove, [switch]$Quiet)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) "Cvideo.lnk"),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) "Programs\Cvideo.lnk")
)

if ($Remove) {
  foreach ($p in $targets) { if (Test-Path $p) { Remove-Item $p -Force } }
  Write-Host "Cvideo shortcuts removed." -ForegroundColor Green
  return
}

$ws = New-Object -ComObject WScript.Shell
foreach ($p in $targets) {
  $dir = Split-Path $p -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $lnk = $ws.CreateShortcut($p)
  $lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $lnk.Arguments = "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File `"$root\scripts\open-cvideo.ps1`""
  $lnk.WorkingDirectory = $root
  if (Test-Path "$root\assets\cvideo.ico") { $lnk.IconLocation = "$root\assets\cvideo.ico" }
  $lnk.Description = "Open Cvideo (starts the local app if it is not running)"
  $lnk.WindowStyle = 7
  $lnk.Save()
}

Write-Host "Done - there is now a 'Cvideo' icon on your Desktop (and in the Start menu)." -ForegroundColor Green
Write-Host "Double-click it any time to open the app." -ForegroundColor Gray
if (-not $Quiet) { Read-Host "Press Enter to close" }
