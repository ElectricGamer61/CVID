# Put "Cvideo" and "Cvideo Studio" buttons on the Desktop (and in the Start menu).
#
# Both run scripts\open-cvideo.ps1, which starts the local server only if it is not already
# up and then opens the app in its own Chrome/Edge --app window - so after install the whole
# thing is one double-click, with no terminal to look at. One server, two apps: the Studio
# button passes -Page /studio/.
#
# Run again any time to refresh them; use -Remove to take them away. ASCII-only for PS 5.1.

param([switch]$Remove, [switch]$Quiet)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

$apps = @(
  @{ Name = "Cvideo"; Page = ""; Description = "Open Cvideo (starts the local app if it is not running)" },
  @{ Name = "Cvideo Studio"; Page = "/studio/"; Description = "Open Cvideo Studio: edit long videos by editing words" }
)
$targets = @()
foreach ($a in $apps) {
  $targets += @{ App = $a; Path = (Join-Path ([Environment]::GetFolderPath('Desktop')) "$($a.Name).lnk") }
  $targets += @{ App = $a; Path = (Join-Path ([Environment]::GetFolderPath('StartMenu')) "Programs\$($a.Name).lnk") }
}

if ($Remove) {
  foreach ($t in $targets) { if (Test-Path $t.Path) { Remove-Item $t.Path -Force } }
  Write-Host "Cvideo shortcuts removed." -ForegroundColor Green
  return
}

$ws = New-Object -ComObject WScript.Shell
foreach ($t in $targets) {
  $dir = Split-Path $t.Path -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $lnk = $ws.CreateShortcut($t.Path)
  $lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $page = ""
  if ($t.App.Page) { $page = " -Page $($t.App.Page)" }
  $lnk.Arguments = "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File `"$root\scripts\open-cvideo.ps1`"$page"
  $lnk.WorkingDirectory = $root
  if (Test-Path "$root\assets\cvideo.ico") { $lnk.IconLocation = "$root\assets\cvideo.ico" }
  $lnk.Description = $t.App.Description
  $lnk.WindowStyle = 7
  $lnk.Save()
}

Write-Host "Done - 'Cvideo' and 'Cvideo Studio' icons are now on your Desktop (and in the Start menu)." -ForegroundColor Green
Write-Host "Double-click either one any time; they share one local server." -ForegroundColor Gray
if (-not $Quiet) { Read-Host "Press Enter to close" }
