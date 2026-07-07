@echo off
REM Double-click to open Cvideo (starts the app if needed, opens it in its own window).
powershell -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File "%~dp0scripts\open-cvideo.ps1"
