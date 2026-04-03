@echo off
rem ── Script de démarrage Next.js (auto-détection dev/production) ──
rem Ce fichier est mis à jour automatiquement via le réseau.
rem S'il existe un fichier .dev-mode → next dev (développeur)
rem Sinon → next start (utilisateur final)

if exist ".dev-mode" (
    echo [DEV] Demarrage en mode developpement...
    start "Next.js" ..\nodejs\node.exe node_modules\next\dist\bin\next dev
) else (
    echo [PROD] Demarrage en mode production...
    start "Next.js" ..\nodejs\node.exe node_modules\next\dist\bin\next start
)
