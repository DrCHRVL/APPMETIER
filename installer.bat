@echo off
setlocal enabledelayedexpansion
set EXITCODE=0

rem ============================================================
rem  Resolution des chemins
rem  - PROJECT_DIR : dossier contenant installer.bat (racine du projet)
rem  - PARENT_DIR  : dossier parent -> recoit nodejs, electron, launcher.bat
rem ============================================================
set "BASE_DIR=%~dp0"
set "PROJECT_DIR=%BASE_DIR:~0,-1%"
for %%I in ("%PROJECT_DIR%\..") do set "PARENT_DIR=%%~fI"

set "NODE_VERSION=v20.11.1"
set "NODE_ZIP=node-%NODE_VERSION%-win-x64.zip"
set "NODE_URL=https://nodejs.org/dist/%NODE_VERSION%/%NODE_ZIP%"
set "NODE_DIR=%PARENT_DIR%\nodejs"
set "NODE_EXE=%NODE_DIR%\node.exe"

set "ELECTRON_VERSION=v30.5.1"
set "ELECTRON_ZIP=electron-%ELECTRON_VERSION%-win32-x64.zip"
set "ELECTRON_URL=https://github.com/electron/electron/releases/download/%ELECTRON_VERSION%/%ELECTRON_ZIP%"
set "ELECTRON_DIR=%PARENT_DIR%\electron"
set "ELECTRON_EXE=%ELECTRON_DIR%\electron.exe"

set "RIE_PROXY=http://rie-proxy.justice.gouv.fr:8080"

cd /d "%BASE_DIR%"

if not exist "package.json" (
    echo ERREUR: package.json introuvable dans "!BASE_DIR!"
    echo Ce script doit etre lance depuis le dossier racine du projet.
    set EXITCODE=1
    goto :END
)

echo ============================================================
echo   INSTALLATION APPMETIER
echo ============================================================
echo Projet : !PROJECT_DIR!
echo Parent : !PARENT_DIR!
echo.

rem ============================================================
rem [1/6] Node.js portable (au niveau parent)
rem ============================================================
echo [1/6] Node.js portable (%NODE_VERSION%) - cible "!NODE_DIR!"
if exist "!NODE_EXE!" (
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
rem Nettoyage prealable : supprimer toute installation partielle d'un run precedent
rem (sinon Rename-Item echoue si le dossier cible existe deja)
if exist "!NODE_DIR!" rmdir /S /Q "!NODE_DIR!" 2>nul
if exist "!PARENT_DIR!\node-%NODE_VERSION%-win-x64" rmdir /S /Q "!PARENT_DIR!\node-%NODE_VERSION%-win-x64" 2>nul
if not exist "!PARENT_DIR!" mkdir "!PARENT_DIR!" 2>nul

rem Extraction directe dans !PARENT_DIR! (meme pattern qu'Electron) puis
rem Rename-Item local (operation atomique NTFS intra-repertoire, evite
rem le move inter-dossiers qui echoue sous OneDrive / Controlled Folder Access).
rem try/catch remonte la VRAIE cause d'erreur au lieu du "Acces refuse." opaque.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Expand-Archive -Path '%TEMP%\%NODE_ZIP%' -DestinationPath '!PARENT_DIR!' -Force -ErrorAction Stop; Rename-Item -LiteralPath (Join-Path '!PARENT_DIR!' 'node-%NODE_VERSION%-win-x64') -NewName 'nodejs' -ErrorAction Stop } catch { Write-Host ''; Write-Host '       Echec extraction/renommage Node.js :'; Write-Host ('       ' + $_.Exception.Message); Write-Host ('       Chemin cible : !PARENT_DIR!'); Write-Host '       Causes frequentes : OneDrive/Controlled Folder Access, antivirus, ACL,'; Write-Host '                          ou dossier en cours d''utilisation.'; exit 1 }"
if !ERRORLEVEL! neq 0 (
    echo ERREUR: Extraction de Node.js echouee.
    set EXITCODE=1
    goto :END
)

del "%TEMP%\%NODE_ZIP%" 2>nul

if not exist "!NODE_EXE!" (
    echo ERREUR: "!NODE_EXE!" introuvable apres extraction.
    set EXITCODE=1
    goto :END
)
echo       OK

:AFTER_NODE
echo.

rem ============================================================
rem [2/6] Electron portable (au niveau parent)
rem ============================================================
echo [2/6] Electron portable (%ELECTRON_VERSION%) - cible "!ELECTRON_DIR!"
if exist "!ELECTRON_EXE!" (
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
if not exist "!ELECTRON_DIR!" mkdir "!ELECTRON_DIR!"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%TEMP%\%ELECTRON_ZIP%' -DestinationPath '!ELECTRON_DIR!' -Force"
if !ERRORLEVEL! neq 0 (
    echo ERREUR: Extraction d'Electron echouee.
    set EXITCODE=1
    goto :END
)
del "%TEMP%\%ELECTRON_ZIP%" 2>nul

if not exist "!ELECTRON_EXE!" (
    echo ERREUR: "!ELECTRON_EXE!" introuvable apres extraction.
    set EXITCODE=1
    goto :END
)
echo       OK

:AFTER_ELECTRON
echo.

rem ============================================================
rem [3/6] npm install
rem ============================================================
echo [3/6] Installation des dependances (npm install)
rem Ajout de nodejs au PATH : permet d'appeler 'node' et 'npm.cmd' sans chemin absolu
rem (evite les pieges de guillemets imbriques quand le chemin contient des parentheses)
set "PATH=!NODE_DIR!;%PATH%"
rem Ne pas retelecharger le binaire Electron (on a deja la version portable)
set ELECTRON_SKIP_BINARY_DOWNLOAD=1

rem Config npm de base
call npm.cmd config set registry https://registry.npmjs.org/ >nul 2>&1
call npm.cmd config set strict-ssl false >nul 2>&1

rem Detection auto du proxy : test de connexion directe au registry
node -e "const req=require('https').get('https://registry.npmjs.org/',r=>process.exit(r.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.setTimeout(5000,()=>{req.destroy();process.exit(1)})" >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo       Connexion directe echouee, configuration du proxy RIE...
    call npm.cmd config set proxy %RIE_PROXY% >nul 2>&1
    call npm.cmd config set https-proxy %RIE_PROXY% >nul 2>&1
) else (
    call npm.cmd config delete proxy >nul 2>&1
    call npm.cmd config delete https-proxy >nul 2>&1
)

echo       Cela peut prendre quelques minutes...
rem Ne pas utiliser --omit=dev : le build Next.js a besoin de typescript,
rem tailwindcss, postcss et autoprefixer (declares en devDependencies).
call npm.cmd install --no-audit --no-fund
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
rem [4/6] npm run build (next build)
rem ============================================================
echo [4/6] Compilation de l'application (next build)
echo       Cela peut prendre 2 a 5 minutes...
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

rem ============================================================
rem [5/6] Signature d'integrite (.integrity)
rem ============================================================
echo [5/6] Signature SHA-256 (.integrity)
node scripts\generate-integrity.js "."
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

rem ============================================================
rem [6/6] Deploiement du launcher au dossier parent
rem ============================================================
echo [6/6] Deploiement du launcher au dossier parent
copy /Y "!BASE_DIR!launcher.bat" "!PARENT_DIR!\launcher.bat" >nul
if !ERRORLEVEL! neq 0 (
    echo ERREUR: copie de launcher.bat vers "!PARENT_DIR!" echouee.
    set EXITCODE=1
    goto :END
)
echo       OK : "!PARENT_DIR!\launcher.bat"
echo.

echo ============================================================
echo   INSTALLATION TERMINEE
echo ============================================================
echo.
echo Lancez l'application en double-cliquant sur :
echo   "!PARENT_DIR!\launcher.bat"
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
