@echo off
setlocal enabledelayedexpansion
set EXITCODE=0

echo ============================================================
echo    INSTALLATION DES DEPENDANCES
echo ============================================================
echo.

rem ── Chemins ──
set BASE_DIR=%~dp0
set PROJET_DIR=%BASE_DIR%Projet1
set NODE_DIR=%BASE_DIR%nodejs
set NODE_EXE=%NODE_DIR%\node.exe
set NPM_CMD=%NODE_DIR%\npm.cmd

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

echo Dossier : %BASE_DIR%
echo Node.js : %NODE_EXE%
echo Projet  : %PROJET_DIR%
echo.

rem ── Ajouter nodejs au PATH ──
set PATH=%NODE_DIR%;%PATH%

cd /d "%PROJET_DIR%"

rem ── [1/3] Configuration proxy RIE ──
echo [1/3] Configuration du proxy reseau...
call "%NPM_CMD%" config set proxy http://rie-proxy.justice.gouv.fr:8080
call "%NPM_CMD%" config set https-proxy http://rie-proxy.justice.gouv.fr:8080
call "%NPM_CMD%" config set registry https://registry.npmjs.org/
call "%NPM_CMD%" config set strict-ssl false
echo       OK
echo.

rem ── Ne pas telecharger Electron (deja sur la cle) ──
set ELECTRON_SKIP_BINARY_DOWNLOAD=1

rem ── [2/3] Installation ──
echo [2/3] Installation des dependances (npm install)...
echo       Cela peut prendre quelques minutes...
echo.
cd /d "%PROJET_DIR%"
call "%NPM_CMD%" install --omit=dev
if !ERRORLEVEL! neq 0 (
    echo.
    echo ERREUR: L'installation a echoue.
    echo.
    echo Causes possibles :
    echo   - Pas de connexion reseau
    echo   - Proxy non accessible (reseau RIE ?)
    echo   - Permissions insuffisantes
    set EXITCODE=1
    goto :END
)
echo       OK
echo.

rem ── [3/3] Verification ──
echo [3/3] Verification...
if not exist "%PROJET_DIR%\node_modules" (
    echo ERREUR: node_modules n'a pas ete cree.
    set EXITCODE=1
    goto :END
)
echo       OK
echo.

echo ============================================================
echo    INSTALLATION TERMINEE !
echo ============================================================
echo.
echo Lancez l'application avec : launcher.bat
echo.

:END
echo.
if !EXITCODE! neq 0 (
    echo ============================================================
    echo    ECHEC - Voir les messages ci-dessus
    echo ============================================================
)
echo.
echo Appuyez sur une touche pour fermer...
pause >nul
exit /b !EXITCODE!
