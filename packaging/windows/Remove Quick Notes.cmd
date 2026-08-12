@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Register-QuickNotesFileOpener.ps1" -Remove
exit /b %ERRORLEVEL%
