@echo off
title Mematikan Server POS...

:: Matikan proses node yang sedang berjalan pada port 3000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo Server POS telah berhasil dimatikan dengan aman.
timeout /t 2 >nul
exit