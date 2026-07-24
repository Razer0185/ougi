@echo off
cd /d "%~dp0"
title Ougi Host
echo Starting Ougi Host from the Ougi folder...
if exist "%~dp0Ougi\OugiHost.exe" (
  start "" "%~dp0Ougi\OugiHost.exe"
) else if exist "%~dp0release\OugiHost\OugiHost.exe" (
  start "" "%~dp0release\OugiHost\OugiHost.exe"
) else if exist "%~dp0OugiHost.exe" (
  start "" "%~dp0OugiHost.exe"
) else (
  echo OugiHost.exe not found. Run: npm run host-app:pack
  pause
)
