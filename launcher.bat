@echo off
setlocal enabledelayedexpansion
set EXITCODE=0

set BASE_DIR=%~dp0
set NODE_EXE=%BASE_DIR%nodejs\node.exe
set ELECTRON_EXE=%BASE_DIR%electron\electron.exe
set NPM_CMD=%BASE_DIR%nodejs\npm.cmd
set FLAG_FILE=%BASE_DIR%data\post-update.flag
set RIE_PROXY=http://rie-proxy.justice.gouv.fr:8080

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

rem ============================================================
rem  Mise a jour detectee ? -> rebuild automatique
rem ============================================================
if exist "%FLAG_FILE%" (
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
    set NEEDS_INSTALL=0
    "%NODE_EXE%" -e "try{const f=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.exit(f.needsInstall?0:1)}catch(e){process.exit(1)}" "%FLAG_FILE%"
    if !ERRORLEVEL! equ 0 set NEEDS_INSTALL=1

    set PATH=%BASE_DIR%nodejs;%PATH%
    set ELECTRON_SKIP_BINARY_DOWNLOAD=1

    if "!NEEDS_INSTALL!"=="1" (
        echo [1/3] Installation des dependances npm...
        echo       Cela peut prendre quelques minutes.

        rem Detection proxy
        call "%NPM_CMD%" config set registry https://registry.npmjs.org/ >nul 2>&1
        call "%NPM_CMD%" config set strict-ssl false >nul 2>&1
        "%NODE_EXE%" -e "const req=require('https').get('https://registry.npmjs.org/',r=>process.exit(r.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.setTimeout(5000,()=>{req.destroy();process.exit(1)})" >nul 2>&1
        if !ERRORLEVEL! neq 0 (
            echo       Proxy RIE detecte, configuration...
            call "%NPM_CMD%" config set proxy %RIE_PROXY% >nul 2>&1
            call "%NPM_CMD%" config set https-proxy %RIE_PROXY% >nul 2>&1
        ) else (
            call "%NPM_CMD%" config delete proxy >nul 2>&1
            call "%NPM_CMD%" config delete https-proxy >nul 2>&1
        )

        call "%NPM_CMD%" install --omit=dev --no-audit --no-fund
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
    "%NODE_EXE%" scripts\build-with-timeout.js 600
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
    "%NODE_EXE%" scripts\generate-integrity.js "." >nul 2>&1
    echo       OK
    echo.

    rem -- Suppression du flag : MAJ appliquee --
    del "%FLAG_FILE%" >nul 2>&1

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
