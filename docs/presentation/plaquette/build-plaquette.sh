#!/usr/bin/env bash
# Génère PLAQUETTE-SIRAL.pdf depuis PLAQUETTE-SIRAL.html via Chrome/Chromium headless.
# Usage : bash docs/presentation/plaquette/build-plaquette.sh
set -euo pipefail
cd "$(dirname "$0")"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
if [ -z "$CHROME" ]; then
  echo "Chrome/Chromium introuvable. Alternative : ouvrir PLAQUETTE-SIRAL.html dans un navigateur"
  echo "→ Imprimer → A4, marges « aucune », cocher « imprimer les arrière-plans »."
  exit 1
fi

"$CHROME" --headless --disable-gpu --no-sandbox \
  --no-pdf-header-footer --print-to-pdf=PLAQUETTE-SIRAL.pdf \
  "file://$(pwd)/PLAQUETTE-SIRAL.html"
echo "OK → $(pwd)/PLAQUETTE-SIRAL.pdf"
