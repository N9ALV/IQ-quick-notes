@echo off
setlocal
if "%~1"=="" (
  echo Choose a Markdown file, or drag one onto Quick Notes.cmd.
  exit /b 2
)
set "IQ_QUICK_NOTES_ROOT=%~dp0.."
set "IQ_QUICK_NOTES_MANAGED=1"
set "IQ_QUICK_NOTES_FILE=%~f1"
"%IQ_QUICK_NOTES_ROOT%\runtime\node.exe" "%IQ_QUICK_NOTES_ROOT%\app\packages\server\bin\roughdraft.mjs" open "%IQ_QUICK_NOTES_FILE%" --no-watch %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
