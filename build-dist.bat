@echo off
setlocal
title Build Distribution - App Metier
echo.
echo  ============================================
echo   BUILD DISTRIBUTION - App Metier
echo  ============================================
echo.

rem === Chemins ===
set BASE_DIR=%~dp0
set NODE=%BASE_DIR%..\nodejs\node.exe
set NPM=%BASE_DIR%..\nodejs\node_modules\npm\bin\npm-cli.js
set DIST=%BASE_DIR%..\dist-app

rem === Verification Node.js ===
if not exist "%NODE%" (
    echo [ERREUR] Node.js introuvable : %NODE%
    echo Verifiez que nodejs\ est au bon endroit.
    pause & exit /b 1
)

echo [1/5] Installation de javascript-obfuscator...
"%NODE%" "%NPM%" install javascript-obfuscator --save-dev --no-fund --no-audit --quiet
if ERRORLEVEL 1 (
    echo [ERREUR] Installation javascript-obfuscator echouee
    pause & exit /b 1
)
echo       OK.
echo.

echo [2/5] Build Next.js ^(mode production^)...
echo       Cela peut prendre 1-3 minutes...
"%NODE%" node_modules\next\dist\bin\next build
if ERRORLEVEL 1 (
    echo [ERREUR] Next.js build echoue ^(voir erreurs ci-dessus^)
    pause & exit /b 1
)
echo       Build OK.
echo.

echo [3/5] Obfuscation de main.js et preload.js...

rem Backup temporaire
copy /Y main.js main.js.bak > nul
copy /Y preload.js preload.js.bak > nul

"%NODE%" node_modules\.bin\javascript-obfuscator main.js.bak ^
    --output main.js ^
    --compact true ^
    --string-array true ^
    --string-array-encoding base64 ^
    --rename-globals false ^
    --self-defending true ^
    --dead-code-injection false

if ERRORLEVEL 1 (
    echo [ERREUR] Obfuscation main.js echouee
    copy /Y main.js.bak main.js > nul
    del main.js.bak preload.js.bak > nul 2>&1
    pause & exit /b 1
)

"%NODE%" node_modules\.bin\javascript-obfuscator preload.js.bak ^
    --output preload.js ^
    --compact true ^
    --string-array true ^
    --string-array-encoding base64 ^
    --rename-globals false ^
    --self-defending true ^
    --dead-code-injection false

if ERRORLEVEL 1 (
    echo [ERREUR] Obfuscation preload.js echouee
    copy /Y preload.js.bak preload.js > nul
    del main.js.bak preload.js.bak > nul 2>&1
    pause & exit /b 1
)

echo       Obfuscation OK.
echo.

echo [4/5] Creation du dossier de distribution...

rem Nettoyage et creation
if exist "%DIST%" (
    echo       Suppression ancienne version...
    rmdir /s /q "%DIST%"
)

mkdir "%DIST%\Projet1\.next\standalone"
mkdir "%DIST%\Projet1\.next\static"
mkdir "%DIST%\Projet1\public"
mkdir "%DIST%\Projet1\data\casiers"
mkdir "%DIST%\Projet1\data\backups"
mkdir "%DIST%\Projet1\data\documentenquete"

rem Copie du serveur standalone Next.js
xcopy /E /I /Q ".next\standalone" "%DIST%\Projet1\.next\standalone" > nul

rem Les assets statiques doivent aussi etre dans standalone
xcopy /E /I /Q ".next\static" "%DIST%\Projet1\.next\static" > nul
xcopy /E /I /Q ".next\static" "%DIST%\Projet1\.next\standalone\.next\static" > nul

rem Dossiers publics et tessdata (OCR)
xcopy /E /I /Q "public" "%DIST%\Projet1\public" > nul
if exist "tessdata" (
    xcopy /E /I /Q "tessdata" "%DIST%\Projet1\tessdata" > nul
)

rem Fichiers Electron (obfusques)
copy /Y "main.js" "%DIST%\Projet1\main.js" > nul
copy /Y "preload.js" "%DIST%\Projet1\preload.js" > nul

rem package.json minimal (juste pour Electron)
copy /Y "package.json" "%DIST%\Projet1\package.json" > nul

rem Restaurer les fichiers originaux (non-obfusques) pour continuer a developper
copy /Y main.js.bak main.js > nul
copy /Y preload.js.bak preload.js > nul
del main.js.bak preload.js.bak > nul 2>&1

echo       Copie OK.
echo.

echo [5/5] Creation du launcher de production...
(
echo @echo off
echo title App Metier
echo set BASE_DIR=%%~dp0
echo set ELECTRON_OVERRIDE_DIST_PATH=%%BASE_DIR%%electron
echo cd Projet1
echo echo Demarrage du serveur...
echo start "NextJS-Server" /min ..\nodejs\node.exe .next\standalone\server.js
echo echo Attente du serveur...
echo set /a attempts=0
echo :WAIT_LOOP
echo if %%attempts%% geq 30 ^(echo Timeout & exit /b 1^)
echo timeout /t 1 ^> nul
echo set /a attempts+=1
echo curl -s http://localhost:3000 ^> nul
echo if %%ERRORLEVEL%% neq 0 goto WAIT_LOOP
echo echo Lancement de l'application...
echo start "" ..\electron\electron.exe .
echo exit
) > "%DIST%\launcher.bat"

echo       Launcher OK.
echo.

rem Copier electron et nodejs si presents
echo INFO: Copiez manuellement les dossiers suivants dans dist-app\ :
echo        - electron\   ^(binaire Electron^)
echo        - nodejs\     ^(binaire Node.js^)
echo.

echo  ============================================
echo   DISTRIBUTION PRETE : %DIST%
echo  ============================================
echo.
echo  Structure finale attendue :
echo  dist-app\
echo    electron\        ^(a copier manuellement^)
echo    nodejs\          ^(a copier manuellement^)
echo    Projet1\
echo      .next\standalone\  ^(serveur Next.js compile^)
echo      .next\static\      ^(assets CSS/JS^)
echo      public\
echo      data\              ^(vide - donnees utilisateur^)
echo      tessdata\          ^(OCR^)
echo      main.js            ^(obfusque^)
echo      preload.js         ^(obfusque^)
echo      package.json
echo    launcher.bat
echo.
echo  Vos fichiers sources ^(.tsx, .ts^) ne sont PAS dans la distribution.
echo  Vos main.js et preload.js sont obfusques dans votre dossier dev.
echo.
pause
