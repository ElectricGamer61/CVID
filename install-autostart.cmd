@echo off
REM Double-click to make Cvideo start on login in server mode (reachable from phone/laptop).
REM Undo later with:  install-autostart.cmd remove
set FLAG=
if /I "%1"=="remove" set FLAG=-Remove
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\install-autostart.ps1" %FLAG%
