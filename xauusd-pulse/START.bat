@echo off
title XAUUSD Pulse
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 goto nonode
if exist node_modules goto run
echo Installing for the first time. This takes about a minute...
call npm install
if errorlevel 1 goto failed
:run
if not exist .env copy .env.example .env >nul
rem Stop an older copy of this platform if one is still running on port 3000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr LISTENING') do tasklist /FI "PID eq %%a" | findstr /I "node.exe" >nul && taskkill /F /PID %%a >nul 2>&1
start "" cmd /c "timeout /t 5 >nul & start http://127.0.0.1:3000"
echo.
echo XAUUSD Pulse - published by John Mugendi Kinyua
echo Keep this window open. Close it to stop.
echo If the page shows a yellow box, paste your Twelve Data key into it.
echo.
call npm start
echo.
echo The platform stopped. If you see an error above, send it to Claude.
pause
exit /b 0
:nonode
echo Node.js is not installed. Opening the download page.
echo Install the LTS version, restart the PC if asked, then double-click START.bat again.
start https://nodejs.org
pause
exit /b 1
:failed
echo Install failed. Copy the message above and send it to Claude.
pause
exit /b 1
