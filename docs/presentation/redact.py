#!/usr/bin/env python3
"""Caviardage des captures d'écran.

Workflow
========
1. Sauvegarder chaque capture brute dans `screenshots/_raw/` sous son nom final
   (par exemple `screenshots/_raw/01-dashboard.png`).
2. Définir les zones à caviarder pour ce fichier dans `redaction_manifest.json`
   (coordonnées en pourcentage de la largeur/hauteur de l'image).
3. Lancer ce script :  python3 docs/presentation/redact.py
4. Les versions caviardées sont écrites dans `screenshots/<nom>.png` (à plat,
   prêtes à être référencées par PRESENTATION.html).

Effet
=====
Chaque zone est :
  - réduite à `1/block_size` puis ré-agrandie (pixelisation mosaïque),
  - puis soumise à un flou Gaussien léger (`blur_radius`).
Le rendu reste « doux à l'œil » mais le texte est illisible.
"""
from __future__ import annotations
import json
import sys
from pathlib import Path
from PIL import Image, ImageFilter

ROOT = Path(__file__).parent
MANIFEST = ROOT / "redaction_manifest.json"
RAW_DIR = ROOT / "screenshots" / "_raw"
OUT_DIR = ROOT / "screenshots"

def pixelize_region(img: Image.Image, rect_pct, block: int, blur: float) -> None:
    """Applique pixelisation + flou Gaussien sur une zone de `img` (in-place)."""
    W, H = img.size
    x, y, w, h = rect_pct
    x1 = max(0, int(round(x * W)))
    y1 = max(0, int(round(y * H)))
    x2 = min(W, int(round((x + w) * W)))
    y2 = min(H, int(round((y + h) * H)))
    if x2 <= x1 or y2 <= y1:
        return
    region = img.crop((x1, y1, x2, y2))
    rw, rh = region.size
    # Taille réduite : au moins 1 px
    nw = max(1, rw // block)
    nh = max(1, rh // block)
    small = region.resize((nw, nh), Image.Resampling.BILINEAR)
    pixelated = small.resize((rw, rh), Image.Resampling.NEAREST)
    if blur > 0:
        pixelated = pixelated.filter(ImageFilter.GaussianBlur(radius=blur))
    img.paste(pixelated, (x1, y1))


def process_one(filename: str, spec: dict, defaults: dict) -> bool:
    raw_path = RAW_DIR / filename
    if not raw_path.exists():
        print(f"  ⚠  {filename} : absent de _raw/, ignoré")
        return False
    block = spec.get("block_size", defaults.get("block_size", 12))
    blur = spec.get("blur_radius", defaults.get("blur_radius", 2.5))
    zones = spec.get("zones", [])
    img = Image.open(raw_path).convert("RGB")
    for z in zones:
        rect = z.get("rect")
        if not rect or len(rect) != 4:
            continue
        pixelize_region(img, rect, block, blur)
    out_path = OUT_DIR / filename
    img.save(out_path, "PNG", optimize=True)
    n = len(zones)
    print(f"  ✓ {filename}  ({n} zone{'s' if n != 1 else ''} caviardée{'s' if n != 1 else ''})")
    return True


def main() -> int:
    if not MANIFEST.exists():
        print(f"Manifest introuvable : {MANIFEST}", file=sys.stderr)
        return 1
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    defaults = manifest.get("_defaults", {})

    if not RAW_DIR.exists():
        RAW_DIR.mkdir(parents=True, exist_ok=True)

    n_done = 0
    for key, spec in manifest.items():
        if key.startswith("_"):
            continue
        if process_one(key, spec, defaults):
            n_done += 1
    print(f"\n{n_done} capture(s) traitée(s). Sortie : {OUT_DIR}")
    if n_done == 0:
        print("\nAstuce : placez vos captures brutes dans :")
        print(f"  {RAW_DIR}")
        print("avec les noms attendus (cf. redaction_manifest.json), puis relancez.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
