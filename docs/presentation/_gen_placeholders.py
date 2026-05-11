#!/usr/bin/env python3
"""Génère des PNG de remplacement pour chaque capture attendue.

Ces images servent uniquement lors de la première génération du PDF, avant
que les vraies captures n'aient été ajoutées au dossier `screenshots/`.
Remplacer simplement les PNG par les vraies captures (mêmes noms) et
relancer `bash build-pdf.sh`.
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).parent / "screenshots"
OUT.mkdir(exist_ok=True)

SHOTS = [
    ("01-dashboard.png",        "Tableau de bord (vue Enquêtes)"),
    ("02-sidebar.png",          "Barre latérale développée"),
    ("03-enquete-detail.png",   "Modale de détail d'une enquête"),
    ("04-enquete-actes.png",    "Section Actes d'une enquête"),
    ("05-instructions-list.png","Liste des instructions"),
    ("06-instruction-detail.png","Détail d'une instruction"),
    ("07-mindmap.png",          "Cartographie relationnelle"),
    ("08-stats.png",            "Page Statistiques"),
    ("09-air-import.png",       "Assistant d'import AIR"),
    ("10-permanence.png",       "Grille Permanence hebdo"),
    ("11-alerts.png",           "Page Alertes"),
    ("12-save-sync.png",        "Page Sauvegarde / Sync"),
    ("13-settings.png",         "Panneau Administration"),
    ("14-about.png",            "Écran À propos"),
]

W, H = 1280, 800
BG = (248, 250, 252)
BORDER = (148, 163, 184)
TITLE = (15, 23, 42)
SUB = (100, 116, 139)
ACCENT = (5, 150, 105)

def font(size, bold=False):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    ]
    for c in candidates:
        try:
            return ImageFont.truetype(c, size)
        except Exception:
            continue
    return ImageFont.load_default()

def text_center(draw, text, y, f, fill):
    bbox = draw.textbbox((0, 0), text, font=f)
    w = bbox[2] - bbox[0]
    draw.text(((W - w) // 2, y), text, font=f, fill=fill)

for filename, label in SHOTS:
    target = OUT / filename
    if target.exists():
        # Ne pas écraser si l'utilisateur a déjà mis une vraie capture
        continue
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    # Cadre
    d.rectangle([8, 8, W - 9, H - 9], outline=BORDER, width=3)
    # Bande supérieure accent
    d.rectangle([8, 8, W - 9, 64], fill=ACCENT)
    text_center(d, "APP MÉTIER — Capture d'écran à remplacer", 22, font(20, True), (255, 255, 255))
    # Nom de fichier
    text_center(d, filename, 110, font(34, True), TITLE)
    # Libellé
    text_center(d, label, 170, font(22), SUB)
    # Hachures
    for i in range(0, W, 40):
        d.line([(i, 240), (i + 40, 200)], fill=(226, 232, 240), width=1)
    # Instructions
    text_center(d, "Remplacez ce fichier par la véritable capture", H // 2 + 40, font(18), SUB)
    text_center(d, "(voir docs/presentation/screenshots/README.md)", H // 2 + 70, font(14), SUB)
    img.save(target, "PNG", optimize=True)
    print(f"  ✓ {filename}")

print("Placeholders générés dans", OUT)
