@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0QuickNotes-Launch.ps1" Friendly %*
exit /b %ERRORLEVEL%
