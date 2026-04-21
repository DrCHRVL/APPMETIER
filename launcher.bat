@echo off
setlocal enabledelayedexpansion
set EXITCODE=0

set "BASE_DIR=%~dp0"
set "RIE_PROXY=http://rie-proxy.justice.gouv.fr:8080"

echo Depuis : !BASE_DIR!

rem ============================================================
rem  1. Auto-detection du dossier projet (contenant package.json)
rem     - launcher a cote du projet (layout portable au parent)
rem     - launcher dans le projet lui-meme (layout autonome)
rem ============================================================
set "PROJECT_DIR="
if exist "!BASE_DIR!package.json" set "PROJECT_DIR=!BASE_DIR:~0,-1!"
if not defined PROJECT_DIR for /d %%D in ("!BASE_DIR!*") do if not defined PROJECT_DIR if exist "%%D\package.json" set "PROJECT_DIR=%%~fD"
if not defined PROJECT_DIR goto :ERR_NO_PROJECT

rem ============================================================
rem  2. Auto-detection du dossier contenant nodejs / electron
rem     1) a cote du launcher    (launcher au parent)
rem     2) parent du projet      (launcher dans Projet1)
rem     3) dans le projet        (layout autonome historique)
rem ============================================================
set "PORTABLE_ROOT="
if exist "!BASE_DIR!nodejs\node.exe" set "PORTABLE_ROOT=!BASE_DIR:~0,-1!"
if not defined PORTABLE_ROOT for %%I in ("!PROJECT_DIR!\..") do if not defined PORTABLE_ROOT if exist "%%~fI\nodejs\node.exe" set "PORTABLE_ROOT=%%~fI"
if not defined PORTABLE_ROOT if exist "!PROJECT_DIR!\nodejs\node.exe" set "PORTABLE_ROOT=!PROJECT_DIR!"
if not defined PORTABLE_ROOT goto :ERR_NO_NODE

set "NODE_EXE=!PORTABLE_ROOT!\nodejs\node.exe"
set "NPM_CMD=!PORTABLE_ROOT!\nodejs\npm.cmd"
set "ELECTRON_EXE=!PORTABLE_ROOT!\electron\electron.exe"
set "FLAG_FILE=!PROJECT_DIR!\data\post-update.flag"

echo ============================================================
echo   APPMETIER - LANCEUR
echo ============================================================
echo Projet  : !PROJECT_DIR!
echo Portable: !PORTABLE_ROOT!
echo.

if not exist "!ELECTRON_EXE!" goto :ERR_NO_ELECTRON

rem -- Ajouter nodejs au PATH (evite les guillemets imbriques + chemins avec parentheses) --
set "PATH=!PORTABLE_ROOT!\nodejs;%PATH%"
set ELECTRON_SKIP_BINARY_DOWNLOAD=1

cd /d "!PROJECT_DIR!"

if not exist "!FLAG_FILE!" goto :RUN

rem ============================================================
rem  Flux post-update (rebuild automatique apres MAJ)
rem  Structure lineaire : un seul bloc parenthese, uniquement a la fin.
rem ============================================================
echo.
echo ============================================================
echo   MISE A JOUR DETECTEE - Reconstruction automatique
echo ============================================================
echo.

echo Arret du serveur Next.js precedent s'il tourne...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

rem -- npm install requis ? (lecture du flag via helper) --
node scripts\read-update-flag.js "!FLAG_FILE!"
if !ERRORLEVEL! neq 0 goto :STEP_BUILD

echo [1/3] Installation des dependances npm...
echo       Cela peut prendre quelques minutes.
call npm.cmd config set registry https://registry.npmjs.org/ >nul 2>&1
call npm.cmd config set strict-ssl false >nul 2>&1
node scripts\check-registry.js >nul 2>&1
if !ERRORLEVEL! neq 0 goto :USE_PROXY
call npm.cmd config delete proxy >nul 2>&1
call npm.cmd config delete https-proxy >nul 2>&1
goto :DO_INSTALL
:USE_PROXY
echo       Proxy RIE detecte, configuration...
call npm.cmd config set proxy %RIE_PROXY% >nul 2>&1
call npm.cmd config set https-proxy %RIE_PROXY% >nul 2>&1
:DO_INSTALL
call npm.cmd install --no-audit --no-fund
if !ERRORLEVEL! neq 0 goto :ERR_NPM
echo       OK
echo.

:STEP_BUILD
echo [2/3] Compilation Next.js (next build)...
echo       Cela peut prendre 1 a 3 minutes.
node scripts\build-with-timeout.js 600
if !ERRORLEVEL! neq 0 goto :ERR_BUILD
if not exist ".next\standalone\server.js" goto :ERR_BUILD_MISSING
echo       OK
echo.

echo [3/3] Signature d'integrite...
node scripts\generate-integrity.js "." >nul 2>&1
echo       OK
echo.

del "!FLAG_FILE!" >nul 2>&1

echo ============================================================
echo   Mise a jour appliquee. Lancement de l'application...
echo ============================================================
echo.

:RUN
if not exist ".next\standalone\server.js" goto :ERR_NO_BUILD

echo Preparation des fichiers statiques...
if exist ".next\static" xcopy /E /I /Q /Y ".next\static" ".next\standalone\.next\static\" >nul 2>&1
if exist "public"       xcopy /E /I /Q /Y "public"       ".next\standalone\public\"       >nul 2>&1

echo Demarrage du serveur Next.js...
start "Next.js" cmd /c "set PORT=3000&& set HOSTNAME=0.0.0.0&& node .next\standalone\server.js 2>.next\server-error.log"

echo Attente du serveur (port 3000)...
node scripts\wait-for-server.js 3000 60
if !ERRORLEVEL! neq 0 goto :ERR_TIMEOUT

echo Lancement de l'application...
start "" "!ELECTRON_EXE!" "!PROJECT_DIR!"
goto :END

rem ============================================================
rem  Gestion des erreurs - chaque cas est un label independant
rem  (pas de blocs parenthesees imbriques, pour que cmd.exe parse
rem  le script sans surprise).
rem ============================================================
:ERR_NO_PROJECT
echo ERREUR: aucun dossier contenant package.json trouve a partir de "!BASE_DIR!".
echo Lancez d'abord installer.bat depuis le dossier du projet.
set EXITCODE=1
goto :END

:ERR_NO_NODE
echo ERREUR: nodejs\node.exe introuvable.
echo Lancez d'abord installer.bat.
set EXITCODE=1
goto :END

:ERR_NO_ELECTRON
echo ERREUR: "!ELECTRON_EXE!" introuvable.
echo Lancez d'abord installer.bat.
set EXITCODE=1
goto :END

:ERR_NPM
echo ERREUR: npm install a echoue.
set EXITCODE=1
goto :END

:ERR_BUILD
echo ERREUR: le build a echoue. Voir .next\build.log pour le detail.
set EXITCODE=1
goto :END

:ERR_BUILD_MISSING
echo ERREUR: .next\standalone\server.js manquant apres build.
set EXITCODE=1
goto :END

:ERR_NO_BUILD
echo ERREUR: .next\standalone\server.js introuvable.
echo Le build Next.js est manquant. Lancez installer.bat.
set EXITCODE=1
goto :END

:ERR_TIMEOUT
echo.
echo ERREUR: le serveur n'a pas demarre en 60 secondes.
if not exist ".next\server-error.log" goto :ERR_TIMEOUT_DONE
echo.
echo Erreurs serveur :
type ".next\server-error.log"
:ERR_TIMEOUT_DONE
set EXITCODE=1
goto :END

:END
if !EXITCODE! equ 0 goto :FINAL
echo ============================================================
echo   ECHEC - voir les messages ci-dessus
echo ============================================================
echo.
echo Appuyez sur une touche pour fermer...
pause >nul
:FINAL
exit /b !EXITCODE!
