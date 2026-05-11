#!/usr/bin/env bash
# Génère le PDF de la présentation à partir de PRESENTATION.html
#
# Dépendances :
#   - python3
#   - WeasyPrint (pip install weasyprint)
#   - Pillow (pip install Pillow) — utilisé uniquement pour générer
#     les images de remplacement la première fois.
#
# Sur Debian/Ubuntu, WeasyPrint requiert aussi les libs système suivantes :
#   apt install libpango-1.0-0 libpangoft2-1.0-0
#
# Usage : bash docs/presentation/build-pdf.sh

set -e
cd "$(dirname "$0")"

# 1) S'assurer qu'on a au moins des placeholders pour toutes les captures
if command -v python3 >/dev/null 2>&1; then
  python3 _gen_placeholders.py >/dev/null 2>&1 || true
fi

# 2) Conversion HTML -> PDF via WeasyPrint
echo "→ Conversion HTML → PDF via WeasyPrint…"
python3 - <<'PY'
from weasyprint import HTML
HTML("PRESENTATION.html").write_pdf("PRESENTATION.pdf")
PY

if [ -f "PRESENTATION.pdf" ]; then
  SIZE=$(du -h PRESENTATION.pdf | cut -f1)
  echo "✓ PDF généré : $(pwd)/PRESENTATION.pdf ($SIZE)"
else
  echo "✗ Échec de la conversion" >&2
  exit 1
fi
