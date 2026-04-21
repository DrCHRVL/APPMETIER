@echo off
setlocal enabledelayedexpansion
set EXITCODE=0

set "BASE_DIR=%~dp0"
set "RIE_PROXY=http://rie-proxy.justice.gouv.fr:8080"

rem ============================================================
rem  Auto-detection du dossier projet (contenant package.json)
rem  - launcher a cote du projet (layout portable au parent)
rem  - launcher dans le projet lui-meme (layout autonome)
rem ============================================================
set "PROJECT_DIR="
if exist "!BASE_DIR!package.json" (
    set "PROJECT_DIR=!BASE_DIR:~0,-1!"
) else (
    for /d %%D in ("!BASE_DIR!*") do (
        if exist "%%D\package.json" if not defined PROJECT_DIR set "PROJECT_DIR=%%~fD"
    )
)

if not defined PROJECT_DIR (
    echo ERREUR: aucun dossier contenant package.json trouve a partir de "!BASE_DIR!".
    echo Lancez d'abord installer.bat depuis le dossier du projet.
    set EXITCODE=1
    goto :END
)

rem ============================================================
rem  Auto-detection du dossier contenant nodejs / electron
rem  1) a cote du launcher    (launcher au parent)
rem  2) parent du projet      (launcher dans Projet1)
rem  3) dans le projet        (layout autonome historique)
rem ============================================================
set "PORTABLE_ROOT="
if exist "!BASE_DIR!nodejs\node.exe" set "PORTABLE_ROOT=!BASE_DIR:~0,-1!"

if not defined PORTABLE_ROOT (
    for %%I in ("!PROJECT_DIR!\..") do (
        if exist "%%~fI\nodejs\node.exe" set "PORTABLE_ROOT=%%~fI"
    )
)

if not defined PORTABLE_ROOT (
    if exist "!PROJECT_DIR!\nodejs\node.exe" set "PORTABLE_ROOT=!PROJECT_DIR!"
)

if not defined PORTABLE_ROOT (
    echo ERREUR: nodejs\node.exe introuvable.
    echo Lancez d'abord installer.bat.
    set EXITCODE=1
    goto :END
)

set "NODE_EXE=!PORTABLE_ROOT!\nodejs\node.exe"
set "NPM_CMD=!PORTABLE_ROOT!\nodejs\npm.cmd"
set "ELECTRON_EXE=!PORTABLE_ROOT!\electron\electron.exe"
set "FLAG_FILE=!PROJECT_DIR!\data\post-update.flag"

if not exist "!ELECTRON_EXE!" (
    echo ERREUR: "!ELECTRON_EXE!" introuvable.
    echo Lancez d'abord installer.bat.
    set EXITCODE=1
    goto :END
)

rem -- Ajouter nodejs au PATH (evite les guillemets imbriques + chemins avec parentheses) --
set "PATH=!PORTABLE_ROOT!\nodejs;%PATH%"
set ELECTRON_SKIP_BINARY_DOWNLOAD=1

cd /d "!PROJECT_DIR!"

rem ============================================================
rem  Mise a jour detectee ? -> rebuild automatique
rem ============================================================
if exist "!FLAG_FILE!" (
    echo.
    echo ============================================================
    echo   MISE A JOUR DETECTEE - Reconstruction automatique
    echo ============================================================
    echo.

    rem -- Tuer le serveur Next.js d'une precedente session (port 3000) --
    echo Arret du serveur Next.js precedent s'il tourne...
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
        taskkill /F /PID %%P >nul 2>&1
    )

    rem -- Lire le flag pour savoir si npm install est requis --
    set "NEEDS_INSTALL=0"
    node -e "try{const f=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.exit(f.needsInstall?0:1)}catch(e){process.exit(1)}" "!FLAG_FILE!"
    if !ERRORLEVEL! equ 0 set "NEEDS_INSTALL=1"

    if "!NEEDS_INSTALL!"=="1" (
        echo [1/3] Installation des dependances npm...
        echo       Cela peut prendre quelques minutes.

        rem Detection proxy
        call npm.cmd config set registry https://registry.npmjs.org/ >nul 2>&1
        call npm.cmd config set strict-ssl false >nul 2>&1
        node -e "const req=require('https').get('https://registry.npmjs.org/',r=>process.exit(r.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.setTimeout(5000,()=>{req.destroy();process.exit(1)})" >nul 2>&1
        if !ERRORLEVEL! neq 0 (
            echo       Proxy RIE detecte, configuration...
            call npm.cmd config set proxy %RIE_PROXY% >nul 2>&1
            call npm.cmd config set https-proxy %RIE_PROXY% >nul 2>&1
        ) else (
            call npm.cmd config delete proxy >nul 2>&1
            call npm.cmd config delete https-proxy >nul 2>&1
        )

        call npm.cmd install --omit=dev --no-audit --no-fund
        if !ERRORLEVEL! neq 0 (
            echo ERREUR: npm install a echoue.
            set EXITCODE=1
            goto :END
        )
        echo       OK
        echo.
    )

    echo [2/3] Compilation Next.js (next build)...
    echo       Cela peut prendre 1 a 3 minutes.
    node scripts\build-with-timeout.js 600
    if !ERRORLEVEL! neq 0 (
        echo ERREUR: le build a echoue. Voir .next\build.log pour le detail.
        set EXITCODE=1
        goto :END
    )
    if not exist ".next\standalone\server.js" (
        echo ERREUR: .next\standalone\server.js manquant apres build.
        set EXITCODE=1
        goto :END
    )
    echo       OK
    echo.

    echo [3/3] Signature d'integrite...
    node scripts\generate-integrity.js "." >nul 2>&1
    echo       OK
    echo.

    rem -- Suppression du flag : MAJ appliquee --
    del "!FLAG_FILE!" >nul 2>&1

    echo ============================================================
    echo   Mise a jour appliquee. Lancement de l'application...
    echo ============================================================
    echo.
)

rem -- Securite : si le build est absent, guider vers installer.bat --
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
start "Next.js" cmd /c "set PORT=3000&& set HOSTNAME=0.0.0.0&& node .next\standalone\server.js 2>.next\server-error.log"

rem -- Attendre que le serveur reponde (60s max) --
echo Attente du serveur (port 3000)...
set /a ATTEMPTS=0
:WAIT
if !ATTEMPTS! geq 60 goto :TIMEOUT
timeout /t 1 /nobreak >nul
set /a ATTEMPTS+=1
node -e "require('http').get('http://127.0.0.1:3000',function(r){process.exit(0)}).on('error',function(){process.exit(1)})" >nul 2>&1
if !ERRORLEVEL! neq 0 goto :WAIT

rem -- Lancer Electron --
echo Lancement de l'application...
start "" "!ELECTRON_EXE!" "!PROJECT_DIR!"
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
