@echo off
REM Optional: install CrisperWhisper, the speech engine that lets Cvideo Studio find every
REM "um" and stutter. About 6 GB. Non-commercial licence: for your own videos only.
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\install-crisper.ps1"
pause
