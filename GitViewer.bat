@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20.11 or newer was not found in PATH. Please install Node.js first.
  pause
  exit /b 1
)
node launch.mjs %*
