@echo off
chcp 65001 >nul
title Seguimiento de Taller - Lima Mecanizados
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   No se encontro Node.js en esta computadora.
  echo   Descarga la version LTS desde https://nodejs.org , instalala y volve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

echo.
echo   Iniciando el sistema... el navegador se abre solo en unos segundos.
echo   No cierres esta ventana mientras uses el sistema.
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:3000"
node server.js

echo.
echo   El sistema se detuvo.
pause
