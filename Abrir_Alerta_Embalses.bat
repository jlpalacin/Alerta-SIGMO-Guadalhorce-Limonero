@echo off
setlocal
cd /d "%~dp0"
start "Alerta de Embalses" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
endlocal
