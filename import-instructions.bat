@echo off
setlocal enabledelayedexpansion

rem ============================================================
rem  IMPORT one-shot des dossiers d'instruction depuis SUIVI_INSTRU.xlsx
rem  -----------------------------------------------------------
rem  Etape 0 : detection des cles instructions__* deja presentes
rem            (pour eviter le piege du username Windows).
rem  Etape 1 : apercu (dry-run).
rem  Etape 2 : ecriture confirmee.
rem ============================================================

set "BASE_DIR=%~dp0"
set "PROJECT_DIR=%BASE_DIR:~0,-1%"

rem -- Detection Node.js portable --
set "PORTABLE_ROOT="
if exist "%BASE_DIR%nodejs\node.exe" set "PORTABLE_ROOT=%PROJECT_DIR%"
if not defined PORTABLE_ROOT for %%I in ("%PROJECT_DIR%\..") do if not defined PORTABLE_ROOT if exist "%%~fI\nodejs\node.exe" set "PORTABLE_ROOT=%%~fI"
if not defined PORTABLE_ROOT (
  echo [ERREUR] Node.js portable introuvable. Lancez d'abord installer.bat puis launcher.bat une fois.
  pause
  exit /b 1
)
set "NODE_EXE=%PORTABLE_ROOT%\nodejs\node.exe"
set "SCRIPT=%PROJECT_DIR%\scripts\import-instructions-xlsx.js"

cd /d "%PROJECT_DIR%"

echo ============================================================
echo   IMPORT DOSSIERS D'INSTRUCTION DEPUIS SUIVI_INSTRU.xlsx
echo ============================================================
echo.
echo ============================================================
echo   ETAPE 0 : diagnostic des cles existantes dans data.json
echo ============================================================
echo.
echo IMPORTANT : pour que cette etape donne un resultat utile,
echo l'app APPMETIER doit avoir ete LANCEE AU MOINS UNE FOIS sur
echo ce poste (elle cree alors la cle correspondant a votre nom
echo Windows reel). Si ce n'est pas encore le cas :
echo   1. Fermez cette fenetre
echo   2. Lancez launcher.bat
echo   3. Allez sur la page Instructions (ca cree la cle vide)
echo   4. Fermez l'app
echo   5. Relancez ce script
echo.
"%NODE_EXE%" "%SCRIPT%" --list-keys
echo.

set /p WIN_USER=Username Windows a utiliser (copiez-collez l'un des noms ci-dessus apres 'instructions__') :
if "%WIN_USER%"=="" (
  echo [ERREUR] Username requis.
  pause
  exit /b 1
)

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

echo.
echo ============================================================
echo   ETAPE 1/2 : APERCU (rien n'est ecrit pour l'instant)
echo ============================================================
echo.

"%NODE_EXE%" "%SCRIPT%" --xlsx "%XLSX_PATH%" --user "%WIN_USER%" --parquetier "%PARQUETIER%" --dry-run
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

"%NODE_EXE%" "%SCRIPT%" --xlsx "%XLSX_PATH%" --user "%WIN_USER%" --parquetier "%PARQUETIER%"
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
