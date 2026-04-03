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
echo [1/5] Compilation de l'application (next build)...
"%NODE_EXE%" node_modules\next\dist\bin\next build
if %ERRORLEVEL% neq 0 (
    echo ERREUR: Le build a echoue.
    pause
    exit /b 1
)
echo       OK
echo.

rem ── Étape 2 : Nettoyer et créer le dossier de sortie ──
echo [2/5] Preparation du dossier de distribution...
if exist "%OUTPUT_DIR%" (
    rmdir /s /q "%OUTPUT_DIR%"
)
mkdir "%OUTPUT_DIR%"
echo       OK
echo.

rem ── Étape 3 : Copier les fichiers nécessaires (PAS les sources) ──
echo [3/5] Copie des fichiers compiles...

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
echo [4/5] Protection du code (obfuscation)...
"%NODE_EXE%" -e "const JO=require('javascript-obfuscator');const fs=require('fs');['main.js','preload.js'].forEach(f=>{const p='%OUTPUT_DIR%\\'+f;try{const code=fs.readFileSync(p,'utf8');const result=JO.obfuscate(code,{compact:true,controlFlowFlattening:false,identifierNamesGenerator:'hexadecimal',renameGlobals:false,stringArray:true,stringArrayEncoding:['base64'],stringArrayThreshold:0.75});fs.writeFileSync(p,result.getObfuscatedCode(),'utf8');console.log('  Protege: '+f)}catch(e){console.error('  Erreur '+f+': '+e.message)}});"
echo       OK
echo.

rem ── Étape 5 : Copier les fichiers externes (electron, nodejs, launcher) ──
echo [5/5] Copie de l'environnement (electron, nodejs, launcher)...
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
