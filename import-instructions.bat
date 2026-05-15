@echo off
setlocal enabledelayedexpansion

rem ============================================================
rem  IMPORT one-shot des dossiers d'instruction depuis SUIVI_INSTRU.xlsx
rem  -----------------------------------------------------------
rem  A double-cliquer. Demande le chemin du xlsx, fait un dry-run
rem  (preview), puis confirme avant ecriture dans data\data.json.
rem ============================================================

set "BASE_DIR=%~dp0"
set "PROJECT_DIR=%BASE_DIR:~0,-1%"

rem -- Detection Node.js portable (meme logique que launcher.bat) --
set "PORTABLE_ROOT="
if exist "%BASE_DIR%nodejs\node.exe" set "PORTABLE_ROOT=%PROJECT_DIR%"
if not defined PORTABLE_ROOT for %%I in ("%PROJECT_DIR%\..") do if not defined PORTABLE_ROOT if exist "%%~fI\nodejs\node.exe" set "PORTABLE_ROOT=%%~fI"
if not defined PORTABLE_ROOT (
  echo [ERREUR] Node.js portable introuvable. Lancez d'abord installer.bat puis launcher.bat une fois.
  pause
  exit /b 1
)
set "NODE_EXE=%PORTABLE_ROOT%\nodejs\node.exe"

cd /d "%PROJECT_DIR%"

echo ============================================================
echo   IMPORT DOSSIERS D'INSTRUCTION DEPUIS SUIVI_INSTRU.xlsx
echo ============================================================
echo.

rem -- Demande des parametres --
set /p XLSX_PATH=Chemin complet du fichier SUIVI_INSTRU.xlsx :
if not exist "%XLSX_PATH%" (
  echo [ERREUR] Fichier introuvable : %XLSX_PATH%
  pause
  exit /b 1
)

set /p PARQUETIER=Parquetier (ex : A.CHEVALIER) :
if "%PARQUETIER%"=="" (
  echo [ERREUR] Parquetier requis.
  pause
  exit /b 1
)

set /p WIN_USER=Username Windows pour la cle de stockage (ex : audran.chevalier) :
if "%WIN_USER%"=="" (
  echo [ERREUR] Username requis.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   ETAPE 1/2 : APERCU (rien n'est ecrit pour l'instant)
echo ============================================================
echo.

"%NODE_EXE%" "%PROJECT_DIR%\scripts\import-instructions-xlsx.js" --xlsx "%XLSX_PATH%" --user "%WIN_USER%" --parquetier "%PARQUETIER%" --dry-run
if errorlevel 1 (
  echo.
  echo [ERREUR] L'apercu a echoue. Aucune ecriture effectuee.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   IMPORTANT : fermez l'application APPMETIER avant de continuer
echo   (sinon vos modifications en cours ecraseront l'import)
echo ============================================================
echo.
set /p CONFIRM=Tout est bon ? Confirmer l'ecriture dans data\data.json [O/N] :
if /i not "%CONFIRM%"=="O" (
  echo Annule. data\data.json non modifie.
  pause
  exit /b 0
)

echo.
echo ============================================================
echo   ETAPE 2/2 : ECRITURE
echo ============================================================
echo.

"%NODE_EXE%" "%PROJECT_DIR%\scripts\import-instructions-xlsx.js" --xlsx "%XLSX_PATH%" --user "%WIN_USER%" --parquetier "%PARQUETIER%"
if errorlevel 1 (
  echo.
  echo [ERREUR] L'ecriture a echoue. Verifiez le backup .bak-import-* dans data\
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   TERMINE. Relancez l'app via launcher.bat pour voir les dossiers.
echo ============================================================
pause
exit /b 0
