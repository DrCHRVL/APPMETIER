@echo off
setlocal enabledelayedexpansion

rem ============================================================
rem  APPMETIER - Installation des runtimes portables
rem
rem  Role : telecharger et extraire Node.js et Electron au
rem  dossier parent, copier le launcher, et laisser au launcher
rem  le soin de faire npm install + build au premier lancement
rem  via le mecanisme data\post-update.flag.
rem ============================================================

set "BASE_DIR=%~dp0"
set "PROJECT_DIR=%BASE_DIR:~0,-1%"
for %%I in ("%PROJECT_DIR%\..") do set "PARENT_DIR=%%~fI"

set "NODE_VERSION=v20.11.1"
set "NODE_ZIP=node-%NODE_VERSION%-win-x64.zip"
set "NODE_URL=https://nodejs.org/dist/%NODE_VERSION%/%NODE_ZIP%"
set "NODE_DIR=%PARENT_DIR%\nodejs"

set "ELECTRON_VERSION=v30.5.1"
set "ELECTRON_ZIP=electron-%ELECTRON_VERSION%-win32-x64.zip"
set "ELECTRON_URL=https://github.com/electron/electron/releases/download/%ELECTRON_VERSION%/%ELECTRON_ZIP%"
set "ELECTRON_DIR=%PARENT_DIR%\electron"

set "RIE_PROXY=http://rie-proxy.justice.gouv.fr:8080"

rem Dossier temporaire UNIQUE par execution : immunise contre les
rem fichiers laisses verrouilles par l'antivirus d'un run precedent.
set "WORK_DIR=%TEMP%\appmetier-%RANDOM%%RANDOM%"
mkdir "%WORK_DIR%" 2>nul

cd /d "%BASE_DIR%"
if not exist "package.json" (
    echo ERREUR: package.json introuvable dans "%BASE_DIR%".
    echo Ce script doit etre lance depuis le dossier racine du projet.
    goto :ERR
)

where curl.exe >nul 2>&1 || (
    echo ERREUR: curl.exe introuvable. Windows 10 1803+ ou superieur requis.
    goto :ERR
)
where tar.exe >nul 2>&1 || (
    echo ERREUR: tar.exe introuvable. Windows 10 1803+ ou superieur requis.
    goto :ERR
)

echo ============================================================
echo   APPMETIER - INSTALLATION DES RUNTIMES
echo ============================================================
echo Projet : %PROJECT_DIR%
echo Parent : %PARENT_DIR%
echo.

rem ------------------------------------------------------------
rem [1/3] Node.js portable
rem ------------------------------------------------------------
echo [1/3] Node.js %NODE_VERSION%
if exist "%NODE_DIR%\node.exe" (
    echo       Deja present : OK
    goto :AFTER_NODE
)
echo       Telechargement...
call :DOWNLOAD "%NODE_URL%" "%WORK_DIR%\%NODE_ZIP%"
if !ERRORLEVEL! neq 0 (
    echo ERREUR: telechargement Node.js echoue.
    goto :ERR
)
echo       Extraction...
tar.exe -xf "%WORK_DIR%\%NODE_ZIP%" -C "%WORK_DIR%"
if !ERRORLEVEL! neq 0 (
    echo ERREUR: extraction Node.js echouee.
    goto :ERR
)
if exist "%NODE_DIR%" rmdir /S /Q "%NODE_DIR%" 2>nul
move "%WORK_DIR%\node-%NODE_VERSION%-win-x64" "%NODE_DIR%" >nul
if not exist "%NODE_DIR%\node.exe" (
    echo ERREUR: node.exe introuvable apres extraction.
    goto :ERR
)
echo       OK
:AFTER_NODE
echo.

rem ------------------------------------------------------------
rem [2/3] Electron portable
rem ------------------------------------------------------------
echo [2/3] Electron %ELECTRON_VERSION%
if exist "%ELECTRON_DIR%\electron.exe" (
    echo       Deja present : OK
    goto :AFTER_ELECTRON
)
echo       Telechargement...
call :DOWNLOAD "%ELECTRON_URL%" "%WORK_DIR%\%ELECTRON_ZIP%"
if !ERRORLEVEL! neq 0 (
    echo ERREUR: telechargement Electron echoue.
    goto :ERR
)
echo       Extraction...
if exist "%ELECTRON_DIR%" rmdir /S /Q "%ELECTRON_DIR%" 2>nul
mkdir "%ELECTRON_DIR%" 2>nul
tar.exe -xf "%WORK_DIR%\%ELECTRON_ZIP%" -C "%ELECTRON_DIR%"
if !ERRORLEVEL! neq 0 (
    echo ERREUR: extraction Electron echouee.
    goto :ERR
)
if not exist "%ELECTRON_DIR%\electron.exe" (
    echo ERREUR: electron.exe introuvable apres extraction.
    goto :ERR
)
echo       OK
:AFTER_ELECTRON
echo.

rem ------------------------------------------------------------
rem [3/3] Deploiement launcher + flag post-update
rem ------------------------------------------------------------
echo [3/3] Deploiement du launcher
copy /Y "%BASE_DIR%launcher.bat" "%PARENT_DIR%\launcher.bat" >nul
if !ERRORLEVEL! neq 0 (
    echo ERREUR: copie de launcher.bat vers "%PARENT_DIR%" echouee.
    goto :ERR
)

rem Flag lu par launcher.bat (via scripts\read-update-flag.js) pour
rem declencher npm install + build au premier lancement.
if not exist "%PROJECT_DIR%\data" mkdir "%PROJECT_DIR%\data" 2>nul
> "%PROJECT_DIR%\data\post-update.flag" echo {"needsInstall":true}

echo       OK : "%PARENT_DIR%\launcher.bat"
echo.

rmdir /S /Q "%WORK_DIR%" 2>nul

echo ============================================================
echo   INSTALLATION TERMINEE
echo ============================================================
echo.
echo Lancez l'application en double-cliquant sur :
echo   "%PARENT_DIR%\launcher.bat"
echo.
echo Le premier lancement installera les dependances npm et
echo compilera l'application (2 a 5 minutes selon la machine).
echo.
pause
exit /b 0

:ERR
rmdir /S /Q "%WORK_DIR%" 2>nul
echo.
echo ============================================================
echo   ECHEC - voir les messages ci-dessus
echo ============================================================
echo.
pause
exit /b 1

rem ============================================================
rem  Sous-routine de telechargement
rem  Essai 1 : connexion directe
rem  Essai 2 : proxy RIE (justice.gouv.fr)
rem  Args   : %1 = URL, %2 = fichier de destination
rem ============================================================
:DOWNLOAD
curl.exe -L --fail --show-error -o %2 %1
if !ERRORLEVEL! equ 0 exit /b 0
echo       Connexion directe echouee, tentative via proxy RIE...
curl.exe -L --fail --show-error --proxy "%RIE_PROXY%" -o %2 %1
exit /b !ERRORLEVEL!
