@echo off
setlocal
set "IQ_QUICK_NOTES_ROOT=%~dp0.."
set "IQ_QUICK_NOTES_MANAGED=1"
"%IQ_QUICK_NOTES_ROOT%\runtime\node.exe" "%IQ_QUICK_NOTES_ROOT%\app\packages\server\bin\roughdraft.mjs" %*
exit /b %ERRORLEVEL%
