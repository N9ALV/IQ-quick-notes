@echo off
setlocal
if "%~1"=="" (
  echo Choose a Markdown file, or drag one onto Quick Notes.cmd.
  exit /b 2
)
set "IQ_QUICK_NOTES_ROOT=%~dp0.."
set "IQ_QUICK_NOTES_MANAGED=1"
set "IQ_QUICK_NOTES_FILE=%~f1"
set "IQ_QUICK_NOTES_NODE=%IQ_QUICK_NOTES_ROOT%\runtime\node.exe"
set "IQ_QUICK_NOTES_CLI=%IQ_QUICK_NOTES_ROOT%\app\packages\server\bin\roughdraft.mjs"

rem Diagnostic/test flags keep normal CLI output and browser suppression semantics.
if not "%~2"=="" goto cli_open
if "%ROUGHDRAFT_NO_OPEN%"=="1" goto cli_open

rem For a normal Windows association/open, ask the validated managed CLI for the
rem complete document URL, then pass that exact URL to Windows.
set "IQ_QUICK_NOTES_URL_FILE=%TEMP%\iq-quick-notes-url-%RANDOM%-%RANDOM%.txt"
"%IQ_QUICK_NOTES_NODE%" "%IQ_QUICK_NOTES_CLI%" open "%IQ_QUICK_NOTES_FILE%" --print-url --no-watch > "%IQ_QUICK_NOTES_URL_FILE%"
if errorlevel 1 (
  del /q "%IQ_QUICK_NOTES_URL_FILE%" >nul 2>&1
  exit /b 1
)
set /p IQ_QUICK_NOTES_URL=<"%IQ_QUICK_NOTES_URL_FILE%"
del /q "%IQ_QUICK_NOTES_URL_FILE%" >nul 2>&1
if not defined IQ_QUICK_NOTES_URL (
  echo Quick Notes could not obtain the document URL. 1>&2
  exit /b 1
)
start "" "%IQ_QUICK_NOTES_URL%"
exit /b 0

:cli_open
"%IQ_QUICK_NOTES_NODE%" "%IQ_QUICK_NOTES_CLI%" open "%IQ_QUICK_NOTES_FILE%" --no-watch %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
