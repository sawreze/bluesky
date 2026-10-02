@echo off
cd /d "%~dp0"
echo.
echo  Pureun-Haneul starting... (keep this window open)
echo  To stop: close this window or press Ctrl + C
echo.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:5173"
node server.js
echo.
echo  Server stopped. If you see an error above, send it to Claude.
pause
