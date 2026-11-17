@echo off
setlocal
title ArcWeb - Offline-ready
cd /d "%~dp0"
if errorlevel 1 goto :failed
where node.exe >nul 2>&1
if errorlevel 1 (
    echo Install Node.js, then run this file again.
    goto :failed
)
where npm.cmd >nul 2>&1
if errorlevel 1 goto :failed
if not exist "node_modules\vite\bin\vite.js" (
    echo First-time setup requires an internet connection.
    call npm.cmd ci
    if errorlevel 1 goto :failed
)
echo Building the offline-ready application...
call npm.cmd run build
if errorlevel 1 goto :failed
echo Opening ArcWeb at http://127.0.0.1:5173
echo Close any other ArcWeb server before starting this version.
echo Keep this window open. Press Ctrl+C to stop.
call npm.cmd run preview -- --host 127.0.0.1 --port 5173 --strictPort --open
if errorlevel 1 goto :failed
exit /b 0
:failed
echo.
echo ArcWeb could not start. Check the message above.
pause
exit /b 1
