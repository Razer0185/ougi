@echo off
cd /d "%~dp0"
title Ougi
if exist "%~dp0Ougi\OugiUnlock.exe" (
  start "" "%~dp0Ougi\OugiUnlock.exe"
) else if exist "%~dp0Ougi\OugiHost.exe" (
  start "" "%~dp0Ougi\OugiHost.exe"
) else if exist "%~dp0release\OugiHost\OugiHost.exe" (
  start "" "%~dp0release\OugiHost\OugiHost.exe"
) else (
  echo Encrypted Ougi package not found. Run: npm run host-app:pack
  pause
)
