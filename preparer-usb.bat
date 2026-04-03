@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================================
echo    PREPARATION DE LA VERSION USB (protegee)
echo ============================================================
echo.

rem ── Vérifier qu'on est bien dans Projet1 ──
if not exist "package.json" (
    echo ERREUR: Ce script doit etre lance depuis le dossier Projet1
    echo Ex: cd Bureau\MonProjetPortable\Projet1
    echo     preparer-usb.bat
    pause
    exit /b 1
)

rem ── Chemin de base ──
set BASE_DIR=%~dp0
set PROJET_DIR=%CD%
set NODE_EXE=%BASE_DIR%..\nodejs\node.exe

rem ── Vérifier que Node.js est disponible ──
if not exist "%NODE_EXE%" (
    echo ERREUR: nodejs\node.exe introuvable dans le dossier parent.
    pause
    exit /b 1
)

rem ── Dossier de sortie ──
set OUTPUT_DIR=%BASE_DIR%..\USB_Distribution\Projet1
echo Dossier de sortie : %OUTPUT_DIR%
echo.

rem ── Étape 1 : Build Next.js ──
echo [1/6] Compilation de l'application (next build)...
"%NODE_EXE%" node_modules\next\dist\bin\next build
if %ERRORLEVEL% neq 0 (
    echo ERREUR: Le build a echoue.
    pause
    exit /b 1
)
echo       OK
echo.

rem ── Étape 2 : Nettoyer et créer le dossier de sortie ──
echo [2/6] Preparation du dossier de distribution...
if exist "%OUTPUT_DIR%" (
    rmdir /s /q "%OUTPUT_DIR%"
)
mkdir "%OUTPUT_DIR%"
echo       OK
echo.

rem ── Étape 3 : Copier les fichiers nécessaires (PAS les sources) ──
echo [3/6] Copie des fichiers compiles...

rem Copier .next (le build compilé)
xcopy ".next" "%OUTPUT_DIR%\.next" /E /I /Q /Y >nul

rem Copier node_modules
xcopy "node_modules" "%OUTPUT_DIR%\node_modules" /E /I /Q /Y >nul

rem Copier public
if exist "public" xcopy "public" "%OUTPUT_DIR%\public" /E /I /Q /Y >nul

rem Copier data (dossier vide pour structure)
mkdir "%OUTPUT_DIR%\data"

rem Copier tessdata si présent
if exist "tessdata" xcopy "tessdata" "%OUTPUT_DIR%\tessdata" /E /I /Q /Y >nul

rem Copier package.json et next.config.js
copy "package.json" "%OUTPUT_DIR%\package.json" >nul
if exist "next.config.js" copy "next.config.js" "%OUTPUT_DIR%\next.config.js" >nul
if exist "next.config.mjs" copy "next.config.mjs" "%OUTPUT_DIR%\next.config.mjs" >nul
if exist ".npmrc" copy ".npmrc" "%OUTPUT_DIR%\.npmrc" >nul

rem Copier main.js et preload.js (seront obfusqués ensuite)
copy "main.js" "%OUTPUT_DIR%\main.js" >nul
copy "preload.js" "%OUTPUT_DIR%\preload.js" >nul

echo       OK
echo.

rem ── Étape 4 : Obfusquer main.js et preload.js ──
echo [4/6] Protection du code (obfuscation main.js/preload.js)...
"%NODE_EXE%" -e "const JO=require('javascript-obfuscator');const fs=require('fs');const opts={compact:true,controlFlowFlattening:true,controlFlowFlatteningThreshold:0.7,deadCodeInjection:true,deadCodeInjectionThreshold:0.3,identifierNamesGenerator:'hexadecimal',renameGlobals:false,selfDefending:true,stringArray:true,stringArrayEncoding:['rc4'],stringArrayThreshold:0.9,stringArrayRotate:true,stringArrayShuffle:true,transformObjectKeys:true,unicodeEscapeSequence:true,numbersToExpressions:true,splitStrings:true,splitStringsChunkLength:5};['main.js','preload.js'].forEach(f=>{const p='%OUTPUT_DIR%\\'+f;try{const code=fs.readFileSync(p,'utf8');const result=JO.obfuscate(code,opts);fs.writeFileSync(p,result.getObfuscatedCode(),'utf8');console.log('  Protege: '+f)}catch(e){console.error('  Erreur '+f+': '+e.message)}});"
echo       OK
echo.

rem ── Étape 5 : Obfusquer les fichiers JS du build Next.js ──
echo [5/6] Protection du build Next.js (obfuscation des chunks)...
"%NODE_EXE%" -e "const JO=require('javascript-obfuscator');const fs=require('fs');const path=require('path');const opts={compact:true,controlFlowFlattening:false,identifierNamesGenerator:'hexadecimal',renameGlobals:false,selfDefending:false,stringArray:true,stringArrayEncoding:['base64'],stringArrayThreshold:0.75,unicodeEscapeSequence:true};function walkAndObfuscate(dir){if(!fs.existsSync(dir))return;const items=fs.readdirSync(dir);items.forEach(item=>{const full=path.join(dir,item);const stat=fs.statSync(full);if(stat.isDirectory()){walkAndObfuscate(full)}else if(item.endsWith('.js')&&stat.size>500&&stat.size<5000000){try{const code=fs.readFileSync(full,'utf8');const result=JO.obfuscate(code,opts);fs.writeFileSync(full,result.getObfuscatedCode(),'utf8')}catch(e){}}});}walkAndObfuscate('%OUTPUT_DIR%\\.next\\server');walkAndObfuscate('%OUTPUT_DIR%\\.next\\static');console.log('  Build Next.js protege');"
echo       OK
echo.

rem ── Étape 5b : Générer le fichier d'intégrité ──
echo        Generation de l'empreinte d'integrite...
"%NODE_EXE%" -e "const crypto=require('crypto');const fs=require('fs');const path=require('path');const m={};['main.js','preload.js','package.json'].forEach(f=>{const fp=path.join('%OUTPUT_DIR%',f);if(fs.existsSync(fp)){const c=fs.readFileSync(fp);m[f]=crypto.createHash('sha256').update(c).digest('hex')}});fs.writeFileSync(path.join('%OUTPUT_DIR%','.integrity'),JSON.stringify(m,null,2),'utf8');console.log('  Integrite generee');"
echo       OK
echo.

rem ── Étape 6 : Copier les fichiers externes (electron, nodejs, launcher) ──
echo [6/6] Copie de l'environnement (electron, nodejs, launcher)...
set USB_ROOT=%BASE_DIR%..\USB_Distribution

rem Copier electron
if exist "%BASE_DIR%..\electron" (
    xcopy "%BASE_DIR%..\electron" "%USB_ROOT%\electron" /E /I /Q /Y >nul
)

rem Copier nodejs
if exist "%BASE_DIR%..\nodejs" (
    xcopy "%BASE_DIR%..\nodejs" "%USB_ROOT%\nodejs" /E /I /Q /Y >nul
)

rem Créer le launcher pour la version production
(
echo @echo off
echo echo Starting Application...
echo.
echo rem Definir le chemin de base
echo set BASE_DIR=%%~dp0
echo set ELECTRON_OVERRIDE_DIST_PATH=%%BASE_DIR%%electron
echo.
echo rem Se deplacer dans le dossier du projet
echo cd Projet1
echo.
echo rem Demarrer Next.js (auto-detection dev/prod via start-next.bat)
echo call start-next.bat
echo.
echo rem Attendre que le serveur soit disponible
echo echo Waiting for Next.js server to start...
echo set /a attempts=0
echo :WAIT_LOOP
echo if %%attempts%% geq 20 ^(
echo     echo Timeout waiting for Next.js server
echo     exit /b 1
echo ^)
echo timeout /t 1 ^> nul
echo set /a attempts+=1
echo curl -s http://localhost:3000 ^> nul
echo if %%ERRORLEVEL%% neq 0 ^(
echo     goto WAIT_LOOP
echo ^)
echo.
echo rem Lancer Electron
echo echo Starting Electron...
echo start "Electron" ..\electron\electron.exe .
) > "%USB_ROOT%\launcher.bat"

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
echo   - launcher.bat     (lance l'app en mode production)
echo   - electron\         (runtime Electron)
echo   - nodejs\            (runtime Node.js)
echo   - Projet1\          (app compilee et protegee)
echo.
echo Les fichiers sources (app/, components/, hooks/, etc.)
echo ne sont PAS inclus. Le code est compile et obfusque.
echo.
echo Copiez ce dossier sur une cle USB pour vos collegues.
echo ============================================================
pause
