@echo off
REM Kiteyard cipher server - STOP (ASCII only)
setlocal
set PORT=%CIPHER_PORT%
if "%PORT%"=="" set PORT=3456
set SECRET=tower-cipher-shutdown-2026-fixed-long-key-000000
echo [i] asking http://127.0.0.1:%PORT%/shutdown ...
curl -s -X POST "http://127.0.0.1:%PORT%/shutdown" -H "Content-Type: application/json" -d "{\"secret\":\"%SECRET%\"}" >nul 2>&1
timeout /t 3 /nobreak >nul
netstat -ano | findstr ":%PORT%" | findstr LISTENING >nul 2>&1
if errorlevel 1 (echo [ok] port %PORT% is free.&goto :end)
echo [i] still listening - force kill ...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1
timeout /t 2 /nobreak >nul
netstat -ano | findstr ":%PORT%" | findstr LISTENING >nul 2>&1
if errorlevel 1 (echo [ok] stopped.) else (echo [x] still running - check Task Manager.)
:end
pause
