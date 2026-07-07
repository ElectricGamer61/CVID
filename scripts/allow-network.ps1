# One-time network setup: lets your phone / laptop reach Cvideo on this PC.
# Adds a Windows Firewall rule allowing inbound port 8000 on PRIVATE networks
# (home wifi + Tailscale) -- NOT public networks, so a coffee-shop wifi can't reach it.
# Self-elevates (you'll see a "Yes?" UAC prompt). ASCII-only for PowerShell 5.1.

$rule = "Cvideo (port 8000)"

# Re-launch as administrator if we aren't already (firewall changes need it).
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Host "Asking for admin (needed to change the firewall)..." -ForegroundColor Cyan
  Start-Process powershell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -NoProfile -File `"$PSCommandPath`""
  exit
}

if (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue) {
  Write-Host "Firewall rule already set - you're good." -ForegroundColor Green
} else {
  New-NetFirewallRule -DisplayName $rule -Direction Inbound -Protocol TCP -LocalPort 8000 `
    -Action Allow -Profile Private, Domain | Out-Null
  Write-Host "Done - other devices on your network can now reach Cvideo." -ForegroundColor Green
}

Write-Host ""
Write-Host "On the SAME wifi, open this on your phone/laptop:" -ForegroundColor Cyan
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' -or $_.IPAddress -like '172.*' } |
  ForEach-Object { Write-Host ("   http://{0}:8000" -f $_.IPAddress) -ForegroundColor White }
Write-Host ""
Write-Host "(Make sure Cvideo is running in server mode: double-click serve.cmd)" -ForegroundColor DarkGray
Read-Host "Press Enter to close"
