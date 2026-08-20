# Cvideo manual update - double-click update.cmd.
# ASCII-only on purpose: em-dash / ellipsis chars break PowerShell 5.1 parsing.
#
# The launchers do this for you before they start the backend (scripts\cvideo-update.ps1).
# This script is the one to reach for when Cvideo is already running, when the working tree
# has local changes the launcher deliberately refuses to touch, or when a support answer is
# simply "double-click update.cmd" - and it forces the dependency re-sync either way, which
# is what fixes a YouTube download that has started failing on a stale yt-dlp.

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$log  = "$root\data\backend.log"
New-Item -ItemType Directory -Force -Path "$root\data" | Out-Null

# Refresh PATH so git / npm / python are visible (winget updates the registry, not this shell).
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

. "$PSScriptRoot\cvideo-update.ps1"

Write-Host "=== Updating Cvideo ===" -ForegroundColor Cyan
$checkout = Update-CvideoCheckout -Root $root
Write-Host $checkout.Message -ForegroundColor White
Add-Content $log $checkout.Message

# -Force: the whole point of asking for an update by hand is not to be told the hash matched.
$deps = Sync-CvideoBackendDeps -Root $root -Log $log -Force
Write-Host $deps -ForegroundColor White
Add-Content $log $deps

# -Force here too: a manual update is exactly when someone wants the newest yt-dlp, not
# "checked recently". This is the step that fixes a YouTube clipper that stopped working
# without anything on this PC changing.
$ytdlp = Sync-CvideoYtDlp -Root $root -Log $log -Force
Write-Host $ytdlp -ForegroundColor White
Add-Content $log $ytdlp

$ui = Sync-CvideoUi -Root $root -Changed $checkout.Changed
Write-Host $ui -ForegroundColor White

$ready = Test-CvideoYtDlpReady -Root $root
if ($ready) {
  Write-Host $ready -ForegroundColor White
  Add-Content $log $ready
}

Write-Host ""
Write-Host "Done. Start Cvideo from the Desktop icon (or serve.cmd)." -ForegroundColor Green
if (-not $checkout.Updated) {
  Write-Host "If the checkout could not be updated above, this PC is still on its installed version." -ForegroundColor DarkGray
}
