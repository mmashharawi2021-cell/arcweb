@echo off
setlocal
title ArcWeb
cd /d "%~dp0"
if errorlevel 1 goto :failed

where node.exe >nul 2>&1
if errorlevel 1 (
    echo Node.js is required. Install Node.js, then run this file again.
    goto :failed
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo npm was not found. Reinstall Node.js, then run this file again.
    goto :failed
)

if not exist "node_modules\vite\bin\vite.js" (
    echo Installing project dependencies...
    call npm.cmd ci
    if errorlevel 1 goto :failed
)

echo Starting ArcWeb and opening your browser...
echo Keep this window open while using ArcWeb. Press Ctrl+C to stop.
call npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort --open
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo ArcWeb could not start. Review the message above.
pause
exit /b 1
