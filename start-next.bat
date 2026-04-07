@echo off
rem ── Script de demarrage Next.js (auto-detection dev/production) ──
rem Ce fichier est mis a jour automatiquement via le reseau.
rem S'il existe un fichier .dev-mode → next dev (developpeur)
rem Sinon → node .next\standalone\server.js (utilisateur final)

if exist ".dev-mode" (
    echo [DEV] Demarrage en mode developpement...
    start "Next.js" ..\nodejs\node.exe node_modules\next\dist\bin\next dev
) else (
    echo [PROD] Demarrage en mode production...
    rem Copie des assets statiques pour le serveur standalone (rafraichie a chaque demarrage)
    xcopy /E /I /Q /Y ".next\static" ".next\standalone\.next\static\" >nul 2>&1
    xcopy /E /I /Q /Y "public" ".next\standalone\public\" >nul 2>&1
    start "Next.js" ..\nodejs\node.exe .next\standalone\server.js
)
