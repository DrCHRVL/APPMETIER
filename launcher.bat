@echo off
setlocal enabledelayedexpansion
set EXITCODE=0

rem ── Chemins ──
set BASE_DIR=%~dp0
set NODE_EXE=%BASE_DIR%nodejs\node.exe
set ELECTRON_EXE=%BASE_DIR%electron\electron.exe
set PROJET_DIR=%BASE_DIR%Projet1
set ELECTRON_OVERRIDE_DIST_PATH=%BASE_DIR%electron

rem ── Verifications ──
if not exist "%NODE_EXE%" (
    echo ERREUR: nodejs\node.exe introuvable.
    set EXITCODE=1
    goto :END
)
if not exist "%PROJET_DIR%\package.json" (
    echo ERREUR: Projet1\package.json introuvable.
    set EXITCODE=1
    goto :END
)

cd /d "%PROJET_DIR%"

rem ── Auto-installation si premier lancement ──
if not exist "node_modules" (
    echo ============================================================
    echo    PREMIER LANCEMENT : installation des dependances...
    echo ============================================================
    echo.
    cd /d "%BASE_DIR%"
    call installer.bat
    if !ERRORLEVEL! neq 0 (
        echo ERREUR: L'installation a echoue.
        set EXITCODE=1
        goto :END
    )
    cd /d "%PROJET_DIR%"
)

rem ── Verifier que le build production existe ──
if not exist ".next\standalone\server.js" (
    echo ERREUR: .next\standalone\server.js introuvable.
    echo Le build production est manquant ou incomplet.
    set EXITCODE=1
    goto :END
)

rem ── Copie des assets statiques pour le serveur standalone ──
echo Preparation des fichiers statiques...
if exist ".next\static" (
    xcopy /E /I /Q /Y ".next\static" ".next\standalone\.next\static\" >nul 2>&1
)
if exist "public" (
    xcopy /E /I /Q /Y "public" ".next\standalone\public\" >nul 2>&1
)

rem ── Demarrer le serveur Next.js ──
echo Demarrage du serveur...
start "Next.js" cmd /c "set PORT=3000&& set HOSTNAME=0.0.0.0&& "%NODE_EXE%" .next\standalone\server.js 2>.next\server-error.log"

rem ── Attendre que le serveur reponde (60s max) ──
echo Attente du serveur (port 3000)...
set /a ATTEMPTS=0
:WAIT
if !ATTEMPTS! geq 60 goto :TIMEOUT
timeout /t 1 /nobreak >nul
set /a ATTEMPTS+=1
"%NODE_EXE%" -e "require('http').get('http://127.0.0.1:3000',function(r){process.exit(0)}).on('error',function(){process.exit(1)})" >nul 2>&1
if !ERRORLEVEL! neq 0 goto :WAIT

rem ── Lancer Electron ──
echo Lancement de l'application...
start "" "%ELECTRON_EXE%" "%PROJET_DIR%"
goto :SUCCESS

:TIMEOUT
echo.
echo ERREUR: Le serveur n'a pas demarre en 60 secondes.
echo.
echo Diagnostic :
if exist ".next\server-error.log" (
    echo Erreurs serveur :
    type ".next\server-error.log"
)
set EXITCODE=1
goto :END

:SUCCESS
goto :END

:END
echo.
if !EXITCODE! neq 0 (
    echo ============================================================
    echo    ECHEC - Voir les messages ci-dessus
    echo ============================================================
    echo.
    echo Appuyez sur une touche pour fermer...
    pause >nul
)
exit /b !EXITCODE!
