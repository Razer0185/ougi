@echo off
cd /d "%~dp0"
echo.
echo ========================================
echo  Host Ougi website FREE (Netlify Drop)
echo ========================================
echo.
echo 1) Put YOUR email in: website\public\config.js
echo    (change YOUR_EMAIL@example.com)
echo.
echo 2) A browser page will open: Netlify Drop
echo 3) Drag this folder onto the page:
echo    %~dp0website\public
echo.
echo 4) Netlify instantly gives you a free link like:
echo    https://something.netlify.app
echo.
pause
start "" "https://app.netlify.com/drop"
explorer "%~dp0website\public"
