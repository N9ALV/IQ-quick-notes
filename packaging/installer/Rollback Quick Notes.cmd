@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0Rollback-QuickNotes.ps1" %*
if errorlevel 1 (
  echo Rollback was not completed. Please ask IQ Wealth for help with the message above.
  pause
  exit /b 1
)
pause
