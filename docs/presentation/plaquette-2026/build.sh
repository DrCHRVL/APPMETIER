#!/usr/bin/env bash
# Génère PLAQUETTE-SIRAL.pdf depuis PLAQUETTE-SIRAL.html via Chrome/Chromium headless.
# Polices requises sur le poste : Inter et Inter Display (https://rsms.me/inter/).
# Usage : bash docs/presentation/plaquette-2026/build.sh
set -euo pipefail
cd "$(dirname "$0")"

CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)}"
if [ -z "$CHROME" ]; then
  echo "Chrome/Chromium introuvable. Alternative : ouvrir PLAQUETTE-SIRAL.html dans Chrome"
  echo "→ Imprimer → A4, marges « aucune », cocher « graphiques d'arrière-plan »."
  exit 1
fi

"$CHROME" --headless --disable-gpu --no-sandbox \
  --no-pdf-header-footer --run-all-compositor-stages-before-draw \
  --print-to-pdf=PLAQUETTE-SIRAL.pdf \
  "file://$(pwd)/PLAQUETTE-SIRAL.html"
echo "OK → $(pwd)/PLAQUETTE-SIRAL.pdf"
