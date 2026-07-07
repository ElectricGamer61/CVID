@echo off
REM Double-click this to run Cvideo in SERVER MODE (one port, reachable from your laptop/phone).
REM Same-wifi: http://<this-pc-ip>:8000   From anywhere: install Tailscale, http://<tailscale-name>:8000
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\serve.ps1"
