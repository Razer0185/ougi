@echo off
cd /d "%~dp0"
start "" cmd /c "npm run site"
timeout /t 2 >nul
start "" "http://127.0.0.1:5050"
