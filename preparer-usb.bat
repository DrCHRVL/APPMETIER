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

rem -- Fichier de log --
set LOG_FILE=%BASE_DIR%preparer-usb.log
echo [%DATE% %TIME%] === DEBUT PREPARATION USB === > "%LOG_FILE%"

rem -- Dossier de sortie --
set USB_ROOT=%BASE_DIR%..\USB_Distribution
set OUTPUT_DIR=%USB_ROOT%\Projet1
echo Dossier de sortie : %OUTPUT_DIR%
echo.

rem ============================================================
rem    DIAGNOSTICS ENVIRONNEMENT
rem ============================================================
echo [DIAG] Environnement :
echo        Dossier courant : %CD%
echo        Node.js portable: %NODE_EXE%

"%NODE_EXE%" -e "console.log('       Node version  : ' + process.version);console.log('       Architecture  : ' + process.arch);console.log('       Plateforme    : ' + process.platform);console.log('       Memoire totale: ' + Math.round(require('os').totalmem()/1024/1024) + ' Mo');console.log('       Memoire libre : ' + Math.round(require('os').freemem()/1024/1024) + ' Mo');console.log('       CPUs          : ' + require('os').cpus().length + 'x ' + require('os').cpus()[0].model)"

echo        NODE_OPTIONS    : %NODE_OPTIONS%
echo        CI              : %CI%
echo        HTTP_PROXY      : (vide - desactive)

rem -- Verifier l'espace disque --
echo.
echo [DIAG] Espace disque :
for %%D in ("%CD%") do (
    echo        Dossier projet sur : %%~dD
)

rem -- Verifier les fichiers critiques --
echo.
echo [DIAG] Fichiers critiques :
if exist "node_modules\next" (echo        next             : OK) else (echo        next             : MANQUANT !)
if exist "node_modules\react" (echo        react            : OK) else (echo        react            : MANQUANT !)
if exist "node_modules\.package-lock.json" (echo        node_modules     : installe) else (echo        node_modules     : potentiellement incomplet)

rem -- Verifier le cache existant --
echo.
echo [DIAG] Cache .next :
if exist ".next\cache\webpack" (echo        webpack cache    : present ^(build incremental^)) else (echo        webpack cache    : absent ^(build complet^))
if exist ".next\cache\swc" (echo        swc cache        : present) else (echo        swc cache        : absent)
if exist ".next\BUILD_ID" (
    set /p OLD_BUILD_ID=<".next\BUILD_ID"
    echo        BUILD_ID prec.   : !OLD_BUILD_ID!
) else (
    echo        BUILD_ID prec.   : aucun ^(premier build^)
)
echo.

echo [%DATE% %TIME%] Diagnostics OK >> "%LOG_FILE%"

rem -- Etape 1 : Build Next.js --
echo ============================================================
echo [1/7] Compilation de l'application...
echo ============================================================
set STEP1_START=%TIME%
echo        [%TIME%] Debut de l'etape 1
echo [%DATE% %TIME%] [1/7] Debut compilation >> "%LOG_FILE%"

rem -- Nettoyage selectif (garder le cache webpack/swc pour builds incrementaux) --
echo        [%TIME%] Nettoyage selectif du cache...
if exist ".next\cache\fetch-cache" (
    echo        [%TIME%]   Suppression fetch-cache...
    rmdir /s /q ".next\cache\fetch-cache"
)
if exist ".next\standalone" (
    echo        [%TIME%]   Suppression ancien standalone...
    rmdir /s /q ".next\standalone"
)
echo        [%TIME%] Nettoyage termine.
echo [%DATE% %TIME%] Cache nettoye >> "%LOG_FILE%"

rem -- Verifier que SWC est disponible --
echo.
echo        [%TIME%] Verification de SWC...
"%NODE_EXE%" -e "try{const m=require('@next/swc-win32-x64-msvc');console.log('       [SWC] OK - binaire natif win32-x64-msvc charge')}catch(e){try{require('@next/swc-win32-ia32-msvc');console.log('       [SWC] OK - binaire natif win32-ia32 charge')}catch(e2){console.log('       [SWC] ATTENTION: binaire natif NON TROUVE');console.log('       [SWC] Erreur: ' + e.message);console.log('       [SWC] Le build utilisera WASM (beaucoup plus lent)');console.log('       [SWC] Solution: npm install @next/swc-win32-x64-msvc')}}"
echo [%DATE% %TIME%] SWC verifie >> "%LOG_FILE%"

rem -- Verifier la config Next.js --
echo.
echo        [%TIME%] Verification next.config...
"%NODE_EXE%" -e "try{const c=await import('./next.config.mjs');const cfg=c.default;console.log('       [CONFIG] output: ' + (cfg.output||'default'));console.log('       [CONFIG] swcMinify: ' + (cfg.swcMinify||false));console.log('       [CONFIG] experimental.cpus: ' + (cfg.experimental?.cpus||'auto'));const ex=cfg.experimental?.outputFileTracingExcludes;console.log('       [CONFIG] tracingExcludes: ' + (ex?Object.values(ex).flat().length + ' regles':'aucune'))}catch(e){console.log('       [CONFIG] Erreur lecture: ' + e.message)}" --input-type=module
echo [%DATE% %TIME%] Config verifiee >> "%LOG_FILE%"

rem -- Lancer le build avec logging detaille --
echo.
echo        [%TIME%] >>> LANCEMENT DU BUILD NEXT.JS <<<
echo        --------------------------------------------------------
echo        Si le build bloque ici, verifiez :
echo          - Le fichier log : %LOG_FILE%
echo          - Memoire insuffisante (fermer d'autres programmes)
echo          - SWC manquant (voir diagnostic ci-dessus)
echo        --------------------------------------------------------
echo.
echo [%DATE% %TIME%] Lancement next build... >> "%LOG_FILE%"

rem -- S'assurer que les variables problematiques sont vides --
set DEBUG=
set NEXT_PRIVATE_WORKER_THREADS=

rem -- Build avec timeout, progression et log vers next-build.log --
"%NODE_EXE%" scripts\build-with-timeout.js
set BUILD_EXIT=%ERRORLEVEL%

echo.
echo        [%TIME%] Build termine (code retour: %BUILD_EXIT%)
echo [%DATE% %TIME%] Build termine, code=%BUILD_EXIT% >> "%LOG_FILE%"

if %BUILD_EXIT% neq 0 (
    echo.
    echo ============================================================
    echo        ERREUR: Le build a echoue (code %BUILD_EXIT%)
    echo ============================================================
    echo.
    echo [DIAG] Verification post-echec :
    if not exist "node_modules\next" echo   [MANQUANT] node_modules\next
    if not exist "node_modules\react" echo   [MANQUANT] node_modules\react
    if not exist "node_modules\@next" echo   [MANQUANT] node_modules\@next (binaires SWC)
    echo.
    echo   Essayez :
    echo     1. npm install
    echo     2. Relancer preparer-usb.bat
    echo.
    echo   Voir le log complet : %LOG_FILE%
    echo [%DATE% %TIME%] ECHEC BUILD >> "%LOG_FILE%"
    pause
    exit /b 1
)

rem -- Valider que le build standalone a produit server.js --
if not exist ".next\standalone\server.js" (
    echo.
    echo ERREUR: Le build s'est termine mais server.js est absent.
    echo Le mode standalone n'a peut-etre pas fonctionne correctement.
    echo.
    echo [DIAG] Contenu de .next\ :
    dir /b ".next\" 2>nul
    echo.
    echo [DIAG] Contenu de .next\standalone\ :
    dir /b ".next\standalone\" 2>nul
    echo [%DATE% %TIME%] ECHEC: server.js absent >> "%LOG_FILE%"
    pause
    exit /b 1
)

rem -- Afficher les stats du build --
echo.
echo        [%TIME%] Build termine avec succes !
echo        [STATS] Debut: %STEP1_START%  -  Fin: %TIME%
if exist ".next\BUILD_ID" (
    set /p NEW_BUILD_ID=<".next\BUILD_ID"
    echo        [STATS] BUILD_ID: !NEW_BUILD_ID!
)
echo        [STATS] server.js : present
for %%F in (".next\standalone\server.js") do echo        [STATS] Taille server.js : %%~zF octets
echo [%DATE% %TIME%] [1/7] OK >> "%LOG_FILE%"
echo.

rem -- Etape 2 : Nettoyer et creer le dossier de sortie --
echo [2/7] [%TIME%] Preparation du dossier de distribution...
echo [%DATE% %TIME%] [2/7] Preparation dossier >> "%LOG_FILE%"
if exist "%OUTPUT_DIR%" (
    echo        Suppression ancien dossier de sortie...
    rmdir /s /q "%OUTPUT_DIR%"
)
mkdir "%OUTPUT_DIR%"
mkdir "%OUTPUT_DIR%\data"
echo       OK
echo [%DATE% %TIME%] [2/7] OK >> "%LOG_FILE%"
echo.

rem -- Etape 3 : Copier les fichiers compiles (SANS node_modules) --
echo [3/7] [%TIME%] Copie des fichiers compiles (sans node_modules)...
echo [%DATE% %TIME%] [3/7] Copie fichiers >> "%LOG_FILE%"

echo        [%TIME%] Copie .next...
xcopy ".next" "%OUTPUT_DIR%\.next" /E /I /Q /Y >nul
echo        [%TIME%] Copie public...
if exist "public" xcopy "public" "%OUTPUT_DIR%\public" /E /I /Q /Y >nul
echo        [%TIME%] Copie tessdata...
if exist "tessdata" xcopy "tessdata" "%OUTPUT_DIR%\tessdata" /E /I /Q /Y >nul

echo        [%TIME%] Copie fichiers racine...
copy "main.js" "%OUTPUT_DIR%\main.js" >nul
copy "preload.js" "%OUTPUT_DIR%\preload.js" >nul
if exist "next.config.js" copy "next.config.js" "%OUTPUT_DIR%\next.config.js" >nul
if exist "next.config.mjs" copy "next.config.mjs" "%OUTPUT_DIR%\next.config.mjs" >nul
if exist ".npmrc" copy ".npmrc" "%OUTPUT_DIR%\.npmrc" >nul
copy "start-next.bat" "%OUTPUT_DIR%\start-next.bat" >nul

echo       OK
echo [%DATE% %TIME%] [3/7] OK >> "%LOG_FILE%"
echo.

rem -- Etape 4 : Generer un package.json allege + copier le lock --
echo [4/7] [%TIME%] Generation du package.json de production...
echo [%DATE% %TIME%] [4/7] Generation package.json >> "%LOG_FILE%"
"%NODE_EXE%" -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8'));const nbDeps=Object.keys(p.dependencies||{}).length;delete p.devDependencies;delete p.dependencies['javascript-obfuscator'];const nbProd=Object.keys(p.dependencies||{}).length;require('fs').writeFileSync('%OUTPUT_DIR:\=/%/package.json',JSON.stringify(p,null,2),'utf8');console.log('       package.json allege: ' + nbProd + ' deps production (supprime ' + (nbDeps-nbProd) + ' deps)');"
if exist "package-lock.json" (
    copy "package-lock.json" "%OUTPUT_DIR%\package-lock.json" >nul
    echo        package-lock.json copie.
)
echo       OK
echo [%DATE% %TIME%] [4/7] OK >> "%LOG_FILE%"
echo.

rem -- Etape 5 : Obfusquer le code --
echo [5/7] [%TIME%] Protection du code (obfuscation)...
echo [%DATE% %TIME%] [5/7] Obfuscation >> "%LOG_FILE%"

echo        [%TIME%] Obfuscation main.js / preload.js...
"%NODE_EXE%" scripts\obfuscate-main.js "%OUTPUT_DIR%"
if %ERRORLEVEL% neq 0 (
    echo        [ATTENTION] L'obfuscation de main.js/preload.js a echoue (code %ERRORLEVEL%).
    echo [%DATE% %TIME%] ATTENTION: obfuscate-main echoue >> "%LOG_FILE%"
) else (
    echo        [%TIME%] main.js / preload.js OK
)

echo        [%TIME%] Obfuscation build Next.js (peut prendre 1-2 min)...
"%NODE_EXE%" scripts\obfuscate-next.js "%OUTPUT_DIR%"
if %ERRORLEVEL% neq 0 (
    echo        [ATTENTION] L'obfuscation du build Next.js a echoue (code %ERRORLEVEL%).
    echo [%DATE% %TIME%] ATTENTION: obfuscate-next echoue >> "%LOG_FILE%"
) else (
    echo        [%TIME%] Build Next.js OK
)
echo       OK
echo [%DATE% %TIME%] [5/7] OK >> "%LOG_FILE%"
echo.

rem -- Etape 6 : Generer le fichier d'integrite --
echo [6/7] [%TIME%] Generation de l'empreinte d'integrite...
echo [%DATE% %TIME%] [6/7] Integrite >> "%LOG_FILE%"
"%NODE_EXE%" scripts\generate-integrity.js "%OUTPUT_DIR%"
echo       OK
echo [%DATE% %TIME%] [6/7] OK >> "%LOG_FILE%"
echo.

rem -- Etape 7 : Copier les fichiers externes et scripts --
echo [7/7] [%TIME%] Copie de l'environnement et des scripts...
echo [%DATE% %TIME%] [7/7] Copie runtimes >> "%LOG_FILE%"

if exist "%BASE_DIR%..\electron" (
    echo        [%TIME%] Copie electron runtime...
    xcopy "%BASE_DIR%..\electron" "%USB_ROOT%\electron" /E /I /Q /Y >nul
)
if exist "%BASE_DIR%..\nodejs" (
    echo        [%TIME%] Copie nodejs runtime...
    xcopy "%BASE_DIR%..\nodejs" "%USB_ROOT%\nodejs" /E /I /Q /Y >nul
)

rem Copier installer.bat et launcher.bat
echo        [%TIME%] Copie scripts launcher/installer...
copy "%BASE_DIR%installer.bat" "%USB_ROOT%\installer.bat" >nul
copy "%BASE_DIR%launcher.bat" "%USB_ROOT%\launcher.bat" >nul

echo       OK
echo [%DATE% %TIME%] [7/7] OK >> "%LOG_FILE%"
echo.

echo ============================================================
echo    TERMINE ! [%TIME%]
echo ============================================================
echo [%DATE% %TIME%] === FIN PREPARATION USB === >> "%LOG_FILE%"
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
echo.
echo Log detaille : %LOG_FILE%
echo Log du build   : %BASE_DIR%next-build.log
echo ============================================================
pause
