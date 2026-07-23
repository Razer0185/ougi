@echo off
cd /d "%~dp0"
REM Opens the correct Ougi bot invite (adds bot as a server member — not "Add App")
powershell -NoProfile -Command ^
  "$t = Get-Content -Raw 'token.txt'; $id = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($t.Trim() -split '\.')[0])); $url = 'https://discord.com/oauth2/authorize?client_id=' + $id + '&permissions=8&scope=bot%%20applications.commands'; Start-Process $url; Write-Host $url; Set-Content -Path 'invite-url.txt' -Value $url"
pause
