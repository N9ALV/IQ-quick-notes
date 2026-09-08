@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-QuickNotes.ps1" %*
if errorlevel 1 (
  echo Installation was not completed. Please keep the message above and ask IQ Wealth for help.
  pause
  exit /b 1
)
echo You can now find Quick Notes in the Start menu.
pause
