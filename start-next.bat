@echo off
rem ── Script de demarrage Next.js (auto-detection dev/production) ──
rem Ce fichier est mis a jour automatiquement via le reseau.
rem S'il existe un fichier .dev-mode → next dev (developpeur)
rem Sinon → node .next\standalone\server.js (utilisateur final)

set NEXT_TELEMETRY_DISABLED=1

if exist ".dev-mode" (
    echo [DEV] Demarrage en mode developpement...
    start "Next.js" ..\nodejs\node.exe node_modules\next\dist\bin\next dev
) else (
    echo [PROD] Demarrage en mode production...

    rem Verifier que le build production existe
    if not exist ".next\standalone\server.js" (
        echo Build production introuvable. Compilation en cours...
        echo Cela peut prendre quelques minutes...
        echo.
        set NODE_OPTIONS=--max-old-space-size=4096
        set NODE_ENV=production
        if exist ".next\cache\fetch-cache" rmdir /s /q ".next\cache\fetch-cache"
        if exist "node_modules\next\dist\bin\next" (
            ..\nodejs\node.exe node_modules\next\dist\bin\next build
            if %ERRORLEVEL% neq 0 (
                echo.
                echo ERREUR: La compilation a echoue.
                exit /b 1
            )
        ) else (
            echo ERREUR: .next\standalone\server.js introuvable et Next.js non disponible.
            echo Lancez d'abord : npm run build
            exit /b 1
        )
    )

    rem Copie des assets statiques pour le serveur standalone (rafraichie a chaque demarrage)
    if exist ".next\static" (
        xcopy /E /I /Q /Y ".next\static" ".next\standalone\.next\static\" >nul 2>&1
    )
    if exist "public" (
        xcopy /E /I /Q /Y "public" ".next\standalone\public\" >nul 2>&1
    )

    rem Demarrer le serveur standalone avec log d'erreurs pour diagnostic
    start "Next.js" cmd /c "set PORT=3000&& set HOSTNAME=0.0.0.0&& ..\nodejs\node.exe .next\standalone\server.js 2>.next\server-error.log"
)
