@echo off
setlocal enabledelayedexpansion
set EXITCODE=0

echo ============================================================
echo    PREPARATION DE LA VERSION USB (sans node_modules)
echo    Protection anti-tampering : signature SHA-256 .integrity
echo ============================================================
echo.

rem ── Chemins ──
set BASE_DIR=%~dp0
set NODE_EXE=%BASE_DIR%..\nodejs\node.exe
set USB_ROOT=%BASE_DIR%..\USB_Distribution
set OUTPUT_DIR=%USB_ROOT%\Projet1

rem ── Verifications rapides ──
if not exist "package.json" (
    echo ERREUR: Ce script doit etre lance depuis le dossier Projet1
    echo Ex: cd Bureau\MonProjetPortable\Projet1
    set EXITCODE=1
    goto :END
)
if not exist "%NODE_EXE%" (
    echo ERREUR: nodejs\node.exe introuvable dans le dossier parent.
    set EXITCODE=1
    goto :END
)
if not exist "node_modules\next" (
    echo ERREUR: node_modules\next manquant. Lancez d'abord : npm install
    set EXITCODE=1
    goto :END
)

echo Dossier de sortie : %OUTPUT_DIR%
echo.

rem ── Configuration environnement ──
set CI=true
set NEXT_TELEMETRY_DISABLED=1
set NODE_OPTIONS=--max-old-space-size=4096
set NODE_ENV=production
set HTTP_PROXY=
set HTTPS_PROXY=
set NO_PROXY=localhost,127.0.0.1
set DEBUG=
set NEXT_PRIVATE_WORKER_THREADS=

rem ============================================================
rem [1/4] DIAGNOSTICS ENVIRONNEMENT
rem ============================================================
echo [1/4] Verification de l'environnement...
"%NODE_EXE%" scripts\check-env.js
if !ERRORLEVEL! neq 0 (
    echo ERREUR: Verification environnement echouee.
    set EXITCODE=1
    goto :END
)
echo.

rem ============================================================
rem [2/4] BUILD NEXT.JS
rem ============================================================
echo [2/4] Compilation de l'application...
echo       [%TIME%] Debut du build
echo.

rem -- Nettoyage selectif (garder webpack/swc cache) --
if exist ".next\cache\fetch-cache" rmdir /s /q ".next\cache\fetch-cache"
if exist ".next\standalone" rmdir /s /q ".next\standalone"

rem -- Build --
"%NODE_EXE%" scripts\build-with-timeout.js
if !ERRORLEVEL! neq 0 (
    echo.
    echo ERREUR: Le build a echoue (code !ERRORLEVEL!).
    echo Voir la console ci-dessus pour les details.
    set EXITCODE=1
    goto :END
)

rem -- Valider server.js --
if not exist ".next\standalone\server.js" (
    echo.
    echo ERREUR: server.js absent apres le build.
    echo Le mode standalone n'a pas fonctionne.
    echo.
    echo --- Diagnostic .next\ ---
    if exist ".next" (
        dir ".next" /b /a
    ) else (
        echo .next\ introuvable
    )
    if exist ".next\standalone" (
        echo.
        echo .next\standalone\ present mais server.js manque :
        dir ".next\standalone" /b /s
    ) else (
        echo .next\standalone\ introuvable
    )
    if exist ".next\BUILD_ID" (
        set /p _BID=<".next\BUILD_ID"
        echo BUILD_ID: !_BID!
    ) else (
        echo BUILD_ID manquant
    )
    echo --- Fin diagnostic ---
    set EXITCODE=1
    goto :END
)

echo       [%TIME%] Build OK
if exist ".next\BUILD_ID" (
    set /p BUILD_ID=<".next\BUILD_ID"
    echo       BUILD_ID: !BUILD_ID!
)
echo.

rem ============================================================
rem [3/4] PACKAGING
rem ============================================================
echo [3/4] Creation du package USB...
echo       [%TIME%] Preparation du dossier...

rem -- Nettoyer et creer la sortie --
if exist "%OUTPUT_DIR%" rmdir /s /q "%OUTPUT_DIR%"
mkdir "%OUTPUT_DIR%"
mkdir "%OUTPUT_DIR%\data"

rem -- Copier les fichiers compiles --
echo       [%TIME%] Copie .next...
xcopy ".next" "%OUTPUT_DIR%\.next" /E /I /Q /Y >nul
echo       [%TIME%] Copie public...
if exist "public" xcopy "public" "%OUTPUT_DIR%\public" /E /I /Q /Y >nul
echo       [%TIME%] Copie tessdata...
if exist "tessdata" xcopy "tessdata" "%OUTPUT_DIR%\tessdata" /E /I /Q /Y >nul

rem -- Fichiers racine --
echo       [%TIME%] Copie fichiers racine...
copy "main.js" "%OUTPUT_DIR%\main.js" >nul
copy "preload.js" "%OUTPUT_DIR%\preload.js" >nul
if exist "next.config.js" copy "next.config.js" "%OUTPUT_DIR%\next.config.js" >nul
if exist "next.config.mjs" copy "next.config.mjs" "%OUTPUT_DIR%\next.config.mjs" >nul
if exist ".npmrc" copy ".npmrc" "%OUTPUT_DIR%\.npmrc" >nul
if exist "package-lock.json" copy "package-lock.json" "%OUTPUT_DIR%\package-lock.json" >nul

rem -- Generer package.json de production --
echo       [%TIME%] Generation package.json production...
"%NODE_EXE%" scripts\generate-prod-package.js "%OUTPUT_DIR%"
if !ERRORLEVEL! neq 0 (
    echo ERREUR: Generation du package.json echouee.
    set EXITCODE=1
    goto :END
)
echo       [%TIME%] Packaging OK
echo.

rem ============================================================
rem [4/4] RUNTIMES, SIGNATURE ET SCRIPTS
rem ============================================================
echo [4/4] Copie des runtimes, signature anti-tampering, scripts...

rem -- Integrite : SHA-256 de main.js, preload.js, package.json ──
rem    Verifie au demarrage par main.js (verifyIntegrity) : dialog d'alerte
rem    si un fichier est modifie, avec bouton "Quitter" par defaut.
echo       [%TIME%] Generation empreinte integrite .integrity...
"%NODE_EXE%" scripts\generate-integrity.js "%OUTPUT_DIR%"

rem -- Runtimes --
if exist "%BASE_DIR%..\electron" (
    echo       [%TIME%] Copie electron runtime...
    xcopy "%BASE_DIR%..\electron" "%USB_ROOT%\electron" /E /I /Q /Y >nul
)
if exist "%BASE_DIR%..\nodejs" (
    echo       [%TIME%] Copie nodejs runtime...
    xcopy "%BASE_DIR%..\nodejs" "%USB_ROOT%\nodejs" /E /I /Q /Y >nul
)

rem -- Scripts de lancement --
echo       [%TIME%] Copie launcher / installer...
copy "%BASE_DIR%installer.bat" "%USB_ROOT%\installer.bat" >nul
copy "%BASE_DIR%launcher.bat" "%USB_ROOT%\launcher.bat" >nul

echo       [%TIME%] OK
echo.

rem ============================================================
echo    TERMINE ! [%TIME%]
echo ============================================================
echo.
echo Le dossier USB est pret dans :
echo   %USB_ROOT%
echo.
echo Contenu :
echo   - launcher.bat   lance l'app (auto-installe au 1er lancement)
echo   - installer.bat  installe les dependances manuellement
echo   - electron\       runtime Electron
echo   - nodejs\         runtime Node.js
echo   - Projet1\        app compilee et protegee
echo.
echo INSTRUCTIONS :
echo   1. Copier USB_Distribution sur le Bureau du collegue
echo   2. Double-cliquer sur launcher.bat (tout est automatique)
echo.

:END
echo.
if !EXITCODE! neq 0 (
    echo ============================================================
    echo    ECHEC - Code !EXITCODE!
    if exist ".next\build.log" echo    Log du build : %CD%\.next\build.log
    echo ============================================================
)
echo.
echo ============================================================
echo    Fenetre maintenue ouverte. Appuyez sur une touche puis
echo    tapez 'exit' pour fermer (scrollback conserve).
echo ============================================================
pause < CON >nul
cmd /k
exit /b !EXITCODE!
