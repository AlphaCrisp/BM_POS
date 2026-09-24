@echo off
title Menjalankan POS Toko Bahan Kue...

cd /d "%~dp0"

:: 1. Jalankan server di latar belakang (background)
start /min "POS Server" node server.js

:: 2. Tunggu 2 detik agar server siap
timeout /t 2 /nobreak >nul

:: 3. Buka sebagai Jendela Aplikasi Mandiri (Bukan Tab Browser Biasa)
:: Prioritas 1: Gunakan Google Chrome jika ada
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app=http://localhost:3000
    exit
)
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" --app=http://localhost:3000
    exit
)

:: Prioritas 2: Gunakan Microsoft Edge (Bawaan semua Windows 10/11)
start msedge --app=http://localhost:3000

exit