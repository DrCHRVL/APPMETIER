@echo off
setlocal enabledelayedexpansion
set EXITCODE=0

set BASE_DIR=%~dp0
set NODE_EXE=%BASE_DIR%nodejs\node.exe
set ELECTRON_EXE=%BASE_DIR%electron\electron.exe

cd /d "%BASE_DIR%"

rem -- Verifications --
if not exist "%NODE_EXE%" (
    echo ERREUR: nodejs\node.exe introuvable.
    echo Lancez d'abord installer.bat.
    set EXITCODE=1
    goto :END
)
if not exist "%ELECTRON_EXE%" (
    echo ERREUR: electron\electron.exe introuvable.
    echo Lancez d'abord installer.bat.
    set EXITCODE=1
    goto :END
)
if not exist "package.json" (
    echo ERREUR: package.json introuvable dans %BASE_DIR%
    set EXITCODE=1
    goto :END
)
if not exist ".next\standalone\server.js" (
    echo ERREUR: .next\standalone\server.js introuvable.
    echo Le build Next.js est manquant. Lancez installer.bat.
    set EXITCODE=1
    goto :END
)

rem -- Preparation des assets statiques (requis par Next.js standalone) --
echo Preparation des fichiers statiques...
if exist ".next\static" (
    xcopy /E /I /Q /Y ".next\static" ".next\standalone\.next\static\" >nul 2>&1
)
if exist "public" (
    xcopy /E /I /Q /Y "public" ".next\standalone\public\" >nul 2>&1
)

rem -- Demarrer le serveur Next.js --
echo Demarrage du serveur Next.js...
start "Next.js" cmd /c "set PORT=3000&& set HOSTNAME=0.0.0.0&& "%NODE_EXE%" .next\standalone\server.js 2>.next\server-error.log"

rem -- Attendre que le serveur reponde (60s max) --
echo Attente du serveur (port 3000)...
set /a ATTEMPTS=0
:WAIT
if !ATTEMPTS! geq 60 goto :TIMEOUT
timeout /t 1 /nobreak >nul
set /a ATTEMPTS+=1
"%NODE_EXE%" -e "require('http').get('http://127.0.0.1:3000',function(r){process.exit(0)}).on('error',function(){process.exit(1)})" >nul 2>&1
if !ERRORLEVEL! neq 0 goto :WAIT

rem -- Lancer Electron --
echo Lancement de l'application...
start "" "%ELECTRON_EXE%" "%BASE_DIR:~0,-1%"
goto :END

:TIMEOUT
echo.
echo ERREUR: le serveur n'a pas demarre en 60 secondes.
if exist ".next\server-error.log" (
    echo.
    echo Erreurs serveur :
    type ".next\server-error.log"
)
set EXITCODE=1

:END
if !EXITCODE! neq 0 (
    echo ============================================================
    echo   ECHEC - voir les messages ci-dessus
    echo ============================================================
    echo.
    echo Appuyez sur une touche pour fermer...
    pause >nul
)
exit /b !EXITCODE!
