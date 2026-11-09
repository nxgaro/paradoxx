@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or is not in PATH.
  echo Install Node.js 22.5 or newer, then run this file again.
  pause
  exit /b 1
)

start "Paradox server" cmd.exe /k "cd /d ""%~dp0"" && npm start"
timeout /t 2 /nobreak >nul
start "" http://localhost:3000
