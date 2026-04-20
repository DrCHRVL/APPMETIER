@echo off
setlocal enabledelayedexpansion
set EXITCODE=0

set BASE_DIR=%~dp0
set NODE_VERSION=v20.11.1
set NODE_ZIP=node-%NODE_VERSION%-win-x64.zip
set NODE_URL=https://nodejs.org/dist/%NODE_VERSION%/%NODE_ZIP%
set NODE_DIR=%BASE_DIR%nodejs
set NODE_EXE=%NODE_DIR%\node.exe

set ELECTRON_VERSION=v30.5.1
set ELECTRON_ZIP=electron-%ELECTRON_VERSION%-win32-x64.zip
set ELECTRON_URL=https://github.com/electron/electron/releases/download/%ELECTRON_VERSION%/%ELECTRON_ZIP%
set ELECTRON_DIR=%BASE_DIR%electron
set ELECTRON_EXE=%ELECTRON_DIR%\electron.exe

set RIE_PROXY=http://rie-proxy.justice.gouv.fr:8080

cd /d "%BASE_DIR%"

if not exist "package.json" (
    echo ERREUR: package.json introuvable dans %BASE_DIR%
    echo Ce script doit etre lance depuis le dossier racine du projet.
    set EXITCODE=1
    goto :END
)

echo ============================================================
echo   INSTALLATION APPMETIER
echo ============================================================
echo Dossier : %BASE_DIR%
echo.

rem ============================================================
rem [1/5] Node.js portable
rem ============================================================
echo [1/5] Node.js portable (%NODE_VERSION%)
if exist "%NODE_EXE%" (
    echo       Deja present : OK
    goto :AFTER_NODE
)

echo       Telechargement depuis %NODE_URL% ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; try { Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%TEMP%\%NODE_ZIP%' -UseBasicParsing -ErrorAction Stop } catch { Write-Host '       Connexion directe echouee, tentative via proxy RIE...'; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%TEMP%\%NODE_ZIP%' -UseBasicParsing -Proxy '%RIE_PROXY%' -ErrorAction Stop }"
if !ERRORLEVEL! neq 0 (
    echo ERREUR: Telechargement de Node.js echoue.
    echo Verifiez votre connexion reseau ou le proxy.
    set EXITCODE=1
    goto :END
)

echo       Extraction...
if exist "%TEMP%\node-extract" rmdir /S /Q "%TEMP%\node-extract" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%TEMP%\%NODE_ZIP%' -DestinationPath '%TEMP%\node-extract' -Force"
if !ERRORLEVEL! neq 0 (
    echo ERREUR: Extraction de Node.js echouee.
    set EXITCODE=1
    goto :END
)

move "%TEMP%\node-extract\node-%NODE_VERSION%-win-x64" "%NODE_DIR%" >nul
rmdir /S /Q "%TEMP%\node-extract" 2>nul
del "%TEMP%\%NODE_ZIP%" 2>nul

if not exist "%NODE_EXE%" (
    echo ERREUR: %NODE_EXE% introuvable apres extraction.
    set EXITCODE=1
    goto :END
)
echo       OK

:AFTER_NODE
echo.

rem ============================================================
rem [2/5] Electron portable
rem ============================================================
echo [2/5] Electron portable (%ELECTRON_VERSION%)
if exist "%ELECTRON_EXE%" (
    echo       Deja present : OK
    goto :AFTER_ELECTRON
)

echo       Telechargement depuis %ELECTRON_URL% ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; try { Invoke-WebRequest -Uri '%ELECTRON_URL%' -OutFile '%TEMP%\%ELECTRON_ZIP%' -UseBasicParsing -ErrorAction Stop } catch { Write-Host '       Connexion directe echouee, tentative via proxy RIE...'; Invoke-WebRequest -Uri '%ELECTRON_URL%' -OutFile '%TEMP%\%ELECTRON_ZIP%' -UseBasicParsing -Proxy '%RIE_PROXY%' -ErrorAction Stop }"
if !ERRORLEVEL! neq 0 (
    echo ERREUR: Telechargement d'Electron echoue.
    set EXITCODE=1
    goto :END
)

echo       Extraction...
if not exist "%ELECTRON_DIR%" mkdir "%ELECTRON_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%TEMP%\%ELECTRON_ZIP%' -DestinationPath '%ELECTRON_DIR%' -Force"
if !ERRORLEVEL! neq 0 (
    echo ERREUR: Extraction d'Electron echouee.
    set EXITCODE=1
    goto :END
)
del "%TEMP%\%ELECTRON_ZIP%" 2>nul

if not exist "%ELECTRON_EXE%" (
    echo ERREUR: %ELECTRON_EXE% introuvable apres extraction.
    set EXITCODE=1
    goto :END
)
echo       OK

:AFTER_ELECTRON
echo.

rem ============================================================
rem [3/5] npm install
rem ============================================================
echo [3/5] Installation des dependances (npm install)
set PATH=%NODE_DIR%;%PATH%
set NPM_CMD=%NODE_DIR%\npm.cmd
rem Ne pas retelecharger le binaire Electron (on a deja la version portable)
set ELECTRON_SKIP_BINARY_DOWNLOAD=1

rem Config npm de base
call "%NPM_CMD%" config set registry https://registry.npmjs.org/ >nul 2>&1
call "%NPM_CMD%" config set strict-ssl false >nul 2>&1

rem Detection auto du proxy : test de connexion directe au registry
"%NODE_EXE%" -e "const req=require('https').get('https://registry.npmjs.org/',r=>process.exit(r.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.setTimeout(5000,()=>{req.destroy();process.exit(1)})" >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo       Connexion directe echouee, configuration du proxy RIE...
    call "%NPM_CMD%" config set proxy %RIE_PROXY% >nul 2>&1
    call "%NPM_CMD%" config set https-proxy %RIE_PROXY% >nul 2>&1
) else (
    call "%NPM_CMD%" config delete proxy >nul 2>&1
    call "%NPM_CMD%" config delete https-proxy >nul 2>&1
)

echo       Cela peut prendre quelques minutes...
call "%NPM_CMD%" install --omit=dev --no-audit --no-fund
if !ERRORLEVEL! neq 0 (
    echo ERREUR: npm install a echoue.
    echo Causes possibles : reseau, proxy, permissions.
    set EXITCODE=1
    goto :END
)
if not exist "node_modules" (
    echo ERREUR: node_modules non cree.
    set EXITCODE=1
    goto :END
)
echo       OK
echo.

rem ============================================================
rem [4/5] npm run build (next build)
rem ============================================================
echo [4/5] Compilation de l'application (next build)
echo       Cela peut prendre 2 a 5 minutes...
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

rem ============================================================
rem [5/5] Signature d'integrite (.integrity)
rem ============================================================
echo [5/5] Signature SHA-256 (.integrity)
"%NODE_EXE%" scripts\generate-integrity.js "."
if !ERRORLEVEL! neq 0 (
    echo ERREUR: generation .integrity echouee.
    set EXITCODE=1
    goto :END
)
if not exist ".integrity" (
    echo ERREUR: fichier .integrity non cree.
    set EXITCODE=1
    goto :END
)
echo       OK
echo.

echo ============================================================
echo   INSTALLATION TERMINEE
echo ============================================================
echo.
echo Lancez l'application en double-cliquant sur : launcher.bat
echo.

:END
if !EXITCODE! neq 0 (
    echo ============================================================
    echo   ECHEC - voir les messages ci-dessus
    echo ============================================================
)
echo.
echo Appuyez sur une touche pour fermer...
pause >nul
exit /b !EXITCODE!
