@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo    INSTALLATION DES DEPENDANCES
echo    (a lancer une seule fois)
echo ============================================================
echo.

rem -- Auto-detection des chemins --
rem %~dp0 = dossier ou se trouve CE fichier bat (la racine USB)
set BASE_DIR=%~dp0
set PROJET_DIR=%BASE_DIR%Projet1
set NODE_DIR=%BASE_DIR%nodejs
set NODE_EXE=%NODE_DIR%\node.exe
set NPM_CMD=%NODE_DIR%\npm.cmd

rem -- Verification de la structure --
if not exist "%NODE_EXE%" (
    echo ERREUR: nodejs\node.exe introuvable.
    echo Verifiez que le dossier nodejs\ est present a cote de ce script.
    pause
    exit /b 1
)

if not exist "%PROJET_DIR%\package.json" (
    echo ERREUR: Projet1\package.json introuvable.
    echo Verifiez que le dossier Projet1\ est present a cote de ce script.
    pause
    exit /b 1
)

echo Dossier detecte : %BASE_DIR%
echo Node.js         : %NODE_EXE%
echo Projet          : %PROJET_DIR%
echo.

rem -- Ajouter nodejs au PATH pour cette session --
set PATH=%NODE_DIR%;%PATH%

rem -- Se deplacer dans le dossier du projet --
cd /d "%PROJET_DIR%"

rem -- Configuration du proxy RIE (reseau Justice) --
echo [1/3] Configuration du proxy reseau...
call "%NPM_CMD%" config set proxy http://rie-proxy.justice.gouv.fr:8080
call "%NPM_CMD%" config set https-proxy http://rie-proxy.justice.gouv.fr:8080
call "%NPM_CMD%" config set registry https://registry.npmjs.org/
call "%NPM_CMD%" config set strict-ssl false
echo       OK
echo.

rem -- Ne pas telecharger le binaire Electron (on a deja le notre) --
set ELECTRON_SKIP_BINARY_DOWNLOAD=1

rem -- Installation des dependances de production --
echo [2/3] Installation des dependances (npm install)...
echo        Cela peut prendre quelques minutes selon la connexion...
echo.
call "%NPM_CMD%" install --production
if %ERRORLEVEL% neq 0 (
    echo.
    echo ERREUR: L'installation a echoue.
    echo.
    echo Causes possibles :
    echo   - Pas de connexion reseau
    echo   - Proxy non accessible (etes-vous sur le reseau RIE ?)
    echo   - Permissions insuffisantes
    echo.
    echo Reessayez ou contactez votre administrateur.
    pause
    exit /b 1
)
echo       OK
echo.

rem -- Verification --
echo [3/3] Verification de l'installation...
if not exist "%PROJET_DIR%\node_modules" (
    echo ERREUR: Le dossier node_modules n'a pas ete cree.
    pause
    exit /b 1
)
echo       OK
echo.

echo ============================================================
echo    INSTALLATION TERMINEE !
echo ============================================================
echo.
echo Vous pouvez maintenant lancer l'application avec :
echo   launcher.bat
echo.
echo (Ce script n'a besoin d'etre execute qu'une seule fois.)
echo ============================================================
pause
