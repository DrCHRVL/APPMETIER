@echo off
setlocal enabledelayedexpansion

rem ============================================================
rem  MIGRATION : deplace les dossiers d'instruction d'une cle
rem  instructions__<X> vers une cle instructions__<Y>.
rem
rem  A utiliser quand un import a ete fait sous le mauvais
rem  username Windows et qu'il faut recoller le tir.
rem ============================================================

set "BASE_DIR=%~dp0"
set "PROJECT_DIR=%BASE_DIR:~0,-1%"

set "PORTABLE_ROOT="
if exist "%BASE_DIR%nodejs\node.exe" set "PORTABLE_ROOT=%PROJECT_DIR%"
if not defined PORTABLE_ROOT for %%I in ("%PROJECT_DIR%\..") do if not defined PORTABLE_ROOT if exist "%%~fI\nodejs\node.exe" set "PORTABLE_ROOT=%%~fI"
if not defined PORTABLE_ROOT (
  echo [ERREUR] Node.js portable introuvable.
  pause
  exit /b 1
)
set "NODE_EXE=%PORTABLE_ROOT%\nodejs\node.exe"
set "SCRIPT=%PROJECT_DIR%\scripts\import-instructions-xlsx.js"

cd /d "%PROJECT_DIR%"

echo ============================================================
echo   MIGRATION CLES INSTRUCTIONS
echo ============================================================
echo.
echo Cles actuellement presentes :
echo.
"%NODE_EXE%" "%SCRIPT%" --list-keys
echo.

set /p FROM_USER=Username SOURCE (celui sous lequel les dossiers ont ete importes par erreur) :
if "%FROM_USER%"=="" (
  echo [ERREUR] Source requise.
  pause
  exit /b 1
)

set /p TO_USER=Username CIBLE (votre vrai username Windows tel qu'il apparait ci-dessus) :
if "%TO_USER%"=="" (
  echo [ERREUR] Cible requise.
  pause
  exit /b 1
)

echo.
echo Les dossiers vont etre deplaces de :
echo   instructions__%FROM_USER%
echo vers :
echo   instructions__%TO_USER%
echo.
echo IMPORTANT : fermez l'app APPMETIER avant de continuer.
echo.
set /p CONFIRM=Confirmer [O/N] :
if /i not "%CONFIRM%"=="O" (
  echo Annule.
  pause
  exit /b 0
)

"%NODE_EXE%" "%SCRIPT%" --migrate-from "%FROM_USER%" --migrate-to "%TO_USER%"
if errorlevel 1 (
  echo.
  echo [ERREUR] Migration echouee.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   TERMINE. Relancez l'app via launcher.bat.
echo ============================================================
pause
exit /b 0
