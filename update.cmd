@echo off
REM Double-click this to update Cvideo: pulls the newest version, updates the backend
REM downloader (yt-dlp) and dependencies, and rebuilds the app.
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\update.ps1"
pause
