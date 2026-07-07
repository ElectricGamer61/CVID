@echo off
REM Double-click ONCE to let your phone/laptop reach Cvideo (adds a firewall rule; asks for admin).
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\allow-network.ps1"
