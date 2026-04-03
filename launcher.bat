@echo off
echo Starting Application...

rem Definir le chemin de base
set BASE_DIR=%~dp0
set ELECTRON_OVERRIDE_DIST_PATH=%BASE_DIR%electron

rem Se deplacer dans le dossier du projet
cd Projet1

rem Demarrer Next.js (auto-detection dev/prod via start-next.bat)
call start-next.bat

rem Attendre que le serveur soit disponible (20 secondes max)
echo Waiting for Next.js server to start...
set /a attempts=0
:WAIT_LOOP
if %attempts% geq 20 (
    echo Timeout waiting for Next.js server
    exit /b 1
)
timeout /t 1 > nul
set /a attempts+=1
curl -s http://localhost:3000 > nul
if %ERRORLEVEL% neq 0 (
    goto WAIT_LOOP
)

rem Lancer Electron
echo Starting Electron...
start "Electron" ..\electron\electron.exe .
