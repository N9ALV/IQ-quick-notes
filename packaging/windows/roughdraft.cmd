@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0QuickNotes-Launch.ps1" Agent %*
exit /b %ERRORLEVEL%
