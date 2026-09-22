@echo off
REM Kiteyard cipher server - START (ASCII only)
cd /d "%~dp0"
title Kiteyard cipher server
echo [i] dir : %CD%
echo [i] port: %CIPHER_PORT% (default 3456)
echo [i] start: node server.js
echo ----------------------------------------
node server.js
echo ----------------------------------------
echo server exited.
pause
