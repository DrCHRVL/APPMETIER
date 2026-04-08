@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo    PREPARATION DE LA VERSION USB
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

rem -- Dossier de sortie --
set OUTPUT_DIR=%BASE_DIR%..\USB_Distribution\Projet1
echo Dossier de sortie : %OUTPUT_DIR%
echo.

rem -- Etape 1 : Build Next.js --
echo [1/6] Compilation de l'application...
"%NODE_EXE%" node_modules\next\dist\bin\next build
if %ERRORLEVEL% neq 0 (
    echo ERREUR: Le build a echoue.
    pause
    exit /b 1
)
echo       OK
echo.

rem -- Etape 2 : Nettoyer et creer le dossier de sortie --
echo [2/6] Preparation du dossier de distribution...
if exist "%OUTPUT_DIR%" rmdir /s /q "%OUTPUT_DIR%"
mkdir "%OUTPUT_DIR%"
echo       OK
echo.

rem -- Etape 3 : Copier les fichiers necessaires (SANS node_modules) --
echo [3/6] Copie des fichiers compiles...
echo       (node_modules exclu — sera installe par installer.bat)

xcopy ".next" "%OUTPUT_DIR%\.next" /E /I /Q /Y >nul
if exist "public" xcopy "public" "%OUTPUT_DIR%\public" /E /I /Q /Y >nul
mkdir "%OUTPUT_DIR%\data"
if exist "tessdata" xcopy "tessdata" "%OUTPUT_DIR%\tessdata" /E /I /Q /Y >nul

copy "package.json" "%OUTPUT_DIR%\package.json" >nul
if exist "package-lock.json" copy "package-lock.json" "%OUTPUT_DIR%\package-lock.json" >nul
if exist "next.config.js" copy "next.config.js" "%OUTPUT_DIR%\next.config.js" >nul
if exist "next.config.mjs" copy "next.config.mjs" "%OUTPUT_DIR%\next.config.mjs" >nul
if exist ".npmrc" copy ".npmrc" "%OUTPUT_DIR%\.npmrc" >nul

copy "main.js" "%OUTPUT_DIR%\main.js" >nul
copy "preload.js" "%OUTPUT_DIR%\preload.js" >nul
copy "start-next.bat" "%OUTPUT_DIR%\start-next.bat" >nul

echo       OK
echo.

rem -- Etape 4 : Obfusquer main.js et preload.js --
echo [4/6] Protection du code main.js / preload.js...
"%NODE_EXE%" scripts\obfuscate-main.js "%OUTPUT_DIR%"
if %ERRORLEVEL% neq 0 (
    echo ATTENTION: L'obfuscation de main.js/preload.js a echoue.
)
echo       OK
echo.

rem -- Etape 5 : Obfusquer les fichiers JS du build Next.js --
echo [5/6] Protection du build Next.js...
"%NODE_EXE%" scripts\obfuscate-next.js "%OUTPUT_DIR%"
if %ERRORLEVEL% neq 0 (
    echo ATTENTION: L'obfuscation du build Next.js a echoue.
)
echo       OK
echo.

rem -- Etape 5b : Generer le fichier d'integrite --
echo        Generation de l'empreinte d'integrite...
"%NODE_EXE%" scripts\generate-integrity.js "%OUTPUT_DIR%"
echo       OK
echo.

rem -- Etape 6 : Copier les fichiers externes --
echo [6/6] Copie de l'environnement...
set USB_ROOT=%BASE_DIR%..\USB_Distribution

if exist "%BASE_DIR%..\electron" xcopy "%BASE_DIR%..\electron" "%USB_ROOT%\electron" /E /I /Q /Y >nul
if exist "%BASE_DIR%..\nodejs" xcopy "%BASE_DIR%..\nodejs" "%USB_ROOT%\nodejs" /E /I /Q /Y >nul

rem Creer installer.bat (installation des dependances par le collegue)
>"%USB_ROOT%\installer.bat" echo @echo off
>>"%USB_ROOT%\installer.bat" echo setlocal enabledelayedexpansion
>>"%USB_ROOT%\installer.bat" echo echo ============================================================
>>"%USB_ROOT%\installer.bat" echo echo    INSTALLATION DES DEPENDANCES
>>"%USB_ROOT%\installer.bat" echo echo ============================================================
>>"%USB_ROOT%\installer.bat" echo echo.
>>"%USB_ROOT%\installer.bat" echo set BASE_DIR=%%~dp0
>>"%USB_ROOT%\installer.bat" echo set NODE_EXE=%%BASE_DIR%%nodejs\node.exe
>>"%USB_ROOT%\installer.bat" echo set NPM_CMD=%%BASE_DIR%%nodejs\npm.cmd
>>"%USB_ROOT%\installer.bat" echo if not exist "%%NODE_EXE%%" (
>>"%USB_ROOT%\installer.bat" echo     echo ERREUR: nodejs\node.exe introuvable.
>>"%USB_ROOT%\installer.bat" echo     echo Verifiez que le dossier nodejs est present.
>>"%USB_ROOT%\installer.bat" echo     pause
>>"%USB_ROOT%\installer.bat" echo     exit /b 1
>>"%USB_ROOT%\installer.bat" echo )
>>"%USB_ROOT%\installer.bat" echo set PATH=%%BASE_DIR%%nodejs;%%PATH%%
>>"%USB_ROOT%\installer.bat" echo cd "%%BASE_DIR%%Projet1"
>>"%USB_ROOT%\installer.bat" echo echo Configuration du proxy...
>>"%USB_ROOT%\installer.bat" echo call "%%NPM_CMD%%" config set proxy http://rie-proxy.justice.gouv.fr:8080
>>"%USB_ROOT%\installer.bat" echo call "%%NPM_CMD%%" config set https-proxy http://rie-proxy.justice.gouv.fr:8080
>>"%USB_ROOT%\installer.bat" echo call "%%NPM_CMD%%" config set registry https://registry.npmjs.org/
>>"%USB_ROOT%\installer.bat" echo call "%%NPM_CMD%%" config set strict-ssl false
>>"%USB_ROOT%\installer.bat" echo set ELECTRON_SKIP_BINARY_DOWNLOAD=1
>>"%USB_ROOT%\installer.bat" echo echo.
>>"%USB_ROOT%\installer.bat" echo echo Installation des modules (peut prendre quelques minutes)...
>>"%USB_ROOT%\installer.bat" echo call "%%NPM_CMD%%" install --omit=dev
>>"%USB_ROOT%\installer.bat" echo if %%ERRORLEVEL%% neq 0 (
>>"%USB_ROOT%\installer.bat" echo     echo.
>>"%USB_ROOT%\installer.bat" echo     echo ERREUR: L'installation a echoue.
>>"%USB_ROOT%\installer.bat" echo     echo Verifiez votre connexion reseau et le proxy.
>>"%USB_ROOT%\installer.bat" echo     pause
>>"%USB_ROOT%\installer.bat" echo     exit /b 1
>>"%USB_ROOT%\installer.bat" echo )
>>"%USB_ROOT%\installer.bat" echo echo.
>>"%USB_ROOT%\installer.bat" echo echo ============================================================
>>"%USB_ROOT%\installer.bat" echo echo    INSTALLATION TERMINEE !
>>"%USB_ROOT%\installer.bat" echo echo ============================================================
>>"%USB_ROOT%\installer.bat" echo echo Vous pouvez maintenant lancer l'application avec launcher.bat
>>"%USB_ROOT%\installer.bat" echo echo.
>>"%USB_ROOT%\installer.bat" echo pause

rem Creer le launcher (avec auto-detection node_modules)
>"%USB_ROOT%\launcher.bat" echo @echo off
>>"%USB_ROOT%\launcher.bat" echo set BASE_DIR=%%~dp0
>>"%USB_ROOT%\launcher.bat" echo set ELECTRON_OVERRIDE_DIST_PATH=%%BASE_DIR%%electron
>>"%USB_ROOT%\launcher.bat" echo cd Projet1
>>"%USB_ROOT%\launcher.bat" echo if not exist "node_modules" (
>>"%USB_ROOT%\launcher.bat" echo     echo ============================================================
>>"%USB_ROOT%\launcher.bat" echo     echo    PREMIER LANCEMENT : installation des dependances...
>>"%USB_ROOT%\launcher.bat" echo     echo ============================================================
>>"%USB_ROOT%\launcher.bat" echo     echo.
>>"%USB_ROOT%\launcher.bat" echo     cd "%%BASE_DIR%%"
>>"%USB_ROOT%\launcher.bat" echo     call installer.bat
>>"%USB_ROOT%\launcher.bat" echo     if %%ERRORLEVEL%% neq 0 exit /b 1
>>"%USB_ROOT%\launcher.bat" echo     cd Projet1
>>"%USB_ROOT%\launcher.bat" echo )
>>"%USB_ROOT%\launcher.bat" echo echo Starting Application...
>>"%USB_ROOT%\launcher.bat" echo call start-next.bat
>>"%USB_ROOT%\launcher.bat" echo echo Waiting for Next.js server to start...
>>"%USB_ROOT%\launcher.bat" echo set /a attempts=0
>>"%USB_ROOT%\launcher.bat" echo :WAIT_LOOP
>>"%USB_ROOT%\launcher.bat" echo if %%attempts%% geq 20 goto TIMEOUT
>>"%USB_ROOT%\launcher.bat" echo timeout /t 1 /nobreak ^>nul
>>"%USB_ROOT%\launcher.bat" echo set /a attempts+=1
>>"%USB_ROOT%\launcher.bat" echo curl -s http://localhost:3000 ^>nul 2^>^&1
>>"%USB_ROOT%\launcher.bat" echo if %%ERRORLEVEL%% neq 0 goto WAIT_LOOP
>>"%USB_ROOT%\launcher.bat" echo echo Starting Electron...
>>"%USB_ROOT%\launcher.bat" echo start "" ..\electron\electron.exe .
>>"%USB_ROOT%\launcher.bat" echo goto END
>>"%USB_ROOT%\launcher.bat" echo :TIMEOUT
>>"%USB_ROOT%\launcher.bat" echo echo Timeout waiting for Next.js server
>>"%USB_ROOT%\launcher.bat" echo exit /b 1
>>"%USB_ROOT%\launcher.bat" echo :END

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
echo Les fichiers sources ne sont PAS inclus.
echo Le code est compile et obfusque.
echo node_modules n'est PAS inclus (installe automatiquement au 1er lancement).
echo.
echo Copiez ce dossier sur une cle USB pour vos collegues.
echo ============================================================
pause
