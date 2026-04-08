@echo off
setlocal

rem -- Auto-detection des chemins --
set BASE_DIR=%~dp0
set ELECTRON_OVERRIDE_DIST_PATH=%BASE_DIR%electron

rem -- Se deplacer dans le dossier du projet --
cd /d "%BASE_DIR%Projet1"

rem -- Verifier que node_modules existe, sinon auto-installer --
if not exist "node_modules" (
    echo ============================================================
    echo    PREMIER LANCEMENT : installation des dependances...
    echo ============================================================
    echo.
    cd /d "%BASE_DIR%"
    call installer.bat
    if %ERRORLEVEL% neq 0 exit /b 1
    cd /d "%BASE_DIR%Projet1"
)

rem -- Demarrer Next.js (auto-detection dev/prod via start-next.bat) --
echo Demarrage de l'application...
call start-next.bat

rem -- Attendre que le serveur soit disponible (30 secondes max) --
echo Attente du serveur Next.js...
set /a attempts=0
:WAIT_LOOP
if %attempts% geq 30 goto TIMEOUT
timeout /t 1 /nobreak >nul
set /a attempts+=1
"%BASE_DIR%nodejs\node.exe" -e "const h=require('http');h.get('http://localhost:3000',r=>{process.exit(r.statusCode?0:1)}).on('error',()=>process.exit(1))" >nul 2>&1
if %ERRORLEVEL% neq 0 goto WAIT_LOOP

rem -- Lancer Electron --
echo Lancement de l'application...
start "" "%BASE_DIR%electron\electron.exe" .
goto END

:TIMEOUT
echo.
echo ERREUR: Le serveur Next.js n'a pas demarre dans les 30 secondes.
echo Verifiez que le port 3000 n'est pas deja utilise.
pause
exit /b 1

:END
