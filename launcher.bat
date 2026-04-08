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
if %ERRORLEVEL% neq 0 (
    echo.
    echo L'application n'a pas pu demarrer.
    pause
    exit /b 1
)

rem -- Attendre que le serveur soit disponible (60 secondes max) --
echo Attente du serveur Next.js...
set /a attempts=0
:WAIT_LOOP
if %attempts% geq 60 goto TIMEOUT
timeout /t 1 /nobreak >nul
set /a attempts+=1
"%BASE_DIR%nodejs\node.exe" -e "const h=require('http');h.get('http://localhost:3000',r=>{process.exit(r.statusCode?0:1)}).on('error',()=>process.exit(1))" >nul 2>&1
if %ERRORLEVEL% neq 0 goto WAIT_LOOP

rem -- Lancer Electron --
echo Lancement de l'application...
start "" "%BASE_DIR%electron\electron.exe" "%BASE_DIR%Projet1"
goto END

:TIMEOUT
echo.
echo ERREUR: Le serveur Next.js n'a pas demarre dans les 60 secondes.
echo Verifiez que le port 3000 n'est pas deja utilise.
echo.
echo Diagnostic :
"%BASE_DIR%nodejs\node.exe" -e "const h=require('http');h.get('http://localhost:3000',r=>{console.log('Port 3000: serveur repond (code '+r.statusCode+')');process.exit(0)}).on('error',e=>{console.log('Port 3000: '+e.message);process.exit(1)})"
echo.
if not exist ".next\standalone\server.js" (
    echo Le fichier .next\standalone\server.js est introuvable.
    echo Le build production est peut-etre manquant ou incomplet.
)
if exist ".next\server-error.log" (
    echo.
    echo Erreurs du serveur :
    type ".next\server-error.log"
)
pause
exit /b 1

:END
