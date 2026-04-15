@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo    PREPARATION DE LA VERSION USB (sans node_modules)
echo ============================================================
echo.

rem -- Verifier qu'on est bien dans Projet1 --
if not exist "package.json" (
    echo ERREUR: Ce script doit etre lance depuis le dossier Projet1
    echo Ex: cd Bureau\MonProjetPortable\Projet1
    echo     preparer-usb.bat
    pause
    exit /b 1
)

rem -- Chemin de base --
set BASE_DIR=%~dp0
set PROJET_DIR=%CD%
set NODE_EXE=%BASE_DIR%..\nodejs\node.exe

rem -- Verifier que Node.js est disponible --
if not exist "%NODE_EXE%" (
    echo ERREUR: nodejs\node.exe introuvable dans le dossier parent.
    pause
    exit /b 1
)

rem -- Configuration environnement build --
set CI=true
set NEXT_TELEMETRY_DISABLED=1
set NODE_OPTIONS=--max-old-space-size=4096
set NODE_ENV=production
rem -- Desactiver le proxy pour le build (pas besoin de reseau) --
set HTTP_PROXY=
set HTTPS_PROXY=
set NO_PROXY=localhost,127.0.0.1

rem -- Dossier de sortie --
set USB_ROOT=%BASE_DIR%..\USB_Distribution
set OUTPUT_DIR=%USB_ROOT%\Projet1
echo Dossier de sortie : %OUTPUT_DIR%
echo.

rem -- Etape 1 : Build Next.js --
echo [1/7] Compilation de l'application...

rem -- Nettoyage selectif (garder le cache webpack/swc pour builds incrementaux) --
echo        (nettoyage selectif du cache...)
if exist ".next\cache\fetch-cache" rmdir /s /q ".next\cache\fetch-cache"
if exist ".next\standalone" rmdir /s /q ".next\standalone"

rem -- Verifier que SWC est disponible --
echo        (verification de SWC...)
"%NODE_EXE%" -e "try{require('@next/swc-win32-x64-msvc');console.log('       SWC: OK')}catch(e){try{require('@next/swc-win32-ia32-msvc');console.log('       SWC: OK (32-bit)')}catch(e2){console.log('       ATTENTION: SWC natif non disponible, le build sera lent');console.log('       Solution: npm install @next/swc-win32-x64-msvc')}}"

echo        (compilation en cours, les etapes s'affichent ci-dessous...)
echo.
"%NODE_EXE%" node_modules\next\dist\bin\next build
if %ERRORLEVEL% neq 0 (
    echo.
    echo ERREUR: Le build a echoue (code %ERRORLEVEL%).
    echo.
    echo Diagnostics :
    if not exist "node_modules\next" echo   - next n'est pas installe dans node_modules
    if not exist "node_modules\@next" echo   - les binaires SWC (@next) sont manquants
    echo   - Verifiez que node_modules est installe: npm install
    pause
    exit /b 1
)

rem -- Valider que le build standalone a produit server.js --
if not exist ".next\standalone\server.js" (
    echo ERREUR: Le build s'est termine mais server.js est absent.
    echo Le mode standalone n'a peut-etre pas fonctionne correctement.
    pause
    exit /b 1
)
echo       Build termine avec succes.
echo.

rem -- Etape 2 : Nettoyer et creer le dossier de sortie --
echo [2/7] Preparation du dossier de distribution...
if exist "%OUTPUT_DIR%" rmdir /s /q "%OUTPUT_DIR%"
mkdir "%OUTPUT_DIR%"
mkdir "%OUTPUT_DIR%\data"
echo       OK
echo.

rem -- Etape 3 : Copier les fichiers compiles (SANS node_modules) --
echo [3/7] Copie des fichiers compiles (sans node_modules)...

xcopy ".next" "%OUTPUT_DIR%\.next" /E /I /Q /Y >nul
if exist "public" xcopy "public" "%OUTPUT_DIR%\public" /E /I /Q /Y >nul
if exist "tessdata" xcopy "tessdata" "%OUTPUT_DIR%\tessdata" /E /I /Q /Y >nul

copy "main.js" "%OUTPUT_DIR%\main.js" >nul
copy "preload.js" "%OUTPUT_DIR%\preload.js" >nul
if exist "next.config.js" copy "next.config.js" "%OUTPUT_DIR%\next.config.js" >nul
if exist "next.config.mjs" copy "next.config.mjs" "%OUTPUT_DIR%\next.config.mjs" >nul
if exist ".npmrc" copy ".npmrc" "%OUTPUT_DIR%\.npmrc" >nul
copy "start-next.bat" "%OUTPUT_DIR%\start-next.bat" >nul

echo       OK
echo.

rem -- Etape 4 : Generer un package.json allege + copier le lock --
echo [4/7] Generation du package.json de production...
"%NODE_EXE%" -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8'));delete p.devDependencies;delete p.dependencies['javascript-obfuscator'];require('fs').writeFileSync('%OUTPUT_DIR:\=/%/package.json',JSON.stringify(p,null,2),'utf8');console.log('  package.json allege genere');"
if exist "package-lock.json" copy "package-lock.json" "%OUTPUT_DIR%\package-lock.json" >nul
echo       OK
echo.

rem -- Etape 5 : Obfusquer le code --
echo [5/7] Protection du code main.js / preload.js...
"%NODE_EXE%" scripts\obfuscate-main.js "%OUTPUT_DIR%"
if %ERRORLEVEL% neq 0 (
    echo ATTENTION: L'obfuscation de main.js/preload.js a echoue.
)
echo       OK
echo.

echo        Protection du build Next.js...
"%NODE_EXE%" scripts\obfuscate-next.js "%OUTPUT_DIR%"
if %ERRORLEVEL% neq 0 (
    echo ATTENTION: L'obfuscation du build Next.js a echoue.
)
echo       OK
echo.

rem -- Etape 6 : Generer le fichier d'integrite --
echo [6/7] Generation de l'empreinte d'integrite...
"%NODE_EXE%" scripts\generate-integrity.js "%OUTPUT_DIR%"
echo       OK
echo.

rem -- Etape 7 : Copier les fichiers externes et scripts --
echo [7/7] Copie de l'environnement et des scripts...

if exist "%BASE_DIR%..\electron" xcopy "%BASE_DIR%..\electron" "%USB_ROOT%\electron" /E /I /Q /Y >nul
if exist "%BASE_DIR%..\nodejs" xcopy "%BASE_DIR%..\nodejs" "%USB_ROOT%\nodejs" /E /I /Q /Y >nul

rem Copier installer.bat et launcher.bat
copy "%BASE_DIR%installer.bat" "%USB_ROOT%\installer.bat" >nul
copy "%BASE_DIR%launcher.bat" "%USB_ROOT%\launcher.bat" >nul

echo       OK
echo.

echo ============================================================
echo    TERMINE !
echo ============================================================
echo.
echo Le dossier USB est pret dans :
echo   %USB_ROOT%
echo.
echo Contenu :
echo   - launcher.bat       lance l'app (auto-installe au 1er lancement)
echo   - installer.bat      installe les dependances manuellement
echo   - electron\          runtime Electron
echo   - nodejs\            runtime Node.js
echo   - Projet1\           app compilee et protegee (sans node_modules)
echo.
echo INSTRUCTIONS POUR LE COLLEGUE :
echo   1. Copier le dossier USB_Distribution sur le Bureau
echo   2. Double-cliquer sur launcher.bat (tout est automatique)
echo.
echo Les fichiers sources ne sont PAS inclus.
echo Le code est compile et obfusque.
echo node_modules sera installe automatiquement au premier lancement.
echo ============================================================
pause
