@echo off
REM Cvideo one-click installer - double-click this after cloning the repo.
REM Installs prerequisites, builds the app, saves your keys, and launches.
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap.ps1"
pause
