"""
SIRAL — moteur OCR (PaddleOCR PP-OCRv5, alphabet latin).

Choix mesuré sur pièces types (PV scanné dégradé, photo de document en
perspective, capture de conversation, pages tournées) face à Tesseract 5 :
qualité égale sur les scans propres, et seul lisible sur les photos (0 %
d'erreurs contre 85 % pour Tesseract). Modèles « mobile » : 2 à 4 s par page
sur 4 cœurs, sans carte graphique.

Chaîne : rastérisation (pdfium) → redressement d'orientation (0/90/180/270)
→ détection des lignes → reconnaissance → remise en ordre de lecture.
"""
from __future__ import annotations

import io
import os
import time
from dataclasses import dataclass, field

import numpy as np
import pypdfium2 as pdfium
from PIL import Image

MODELE_DETECTION = 'PP-OCRv5_mobile_det'
MODELE_RECONNAISSANCE = 'latin_PP-OCRv5_mobile_rec'
MODELE_ORIENTATION = 'PP-LCNet_x1_0_doc_ori'
# Modèles embarqués dans l'image (prechargement.py) ; vide = cache paddlex.
DOSSIER_MODELES = os.environ.get('SIRAL_OCR_MODELES', '')
DPI = 300
# Garde-fou mémoire : au-delà, la page est rastérisée moins finement.
COTE_MAX_PX = 4200


@dataclass
class Ligne:
    texte: str
    confiance: float
    boite: list[int]  # x0, y0, x1, y1 en pixels de la page rastérisée


@dataclass
class Page:
    page: int
    texte: str = ''
    confiance: float | None = None
    angle: int = 0
    largeur: int = 0
    hauteur: int = 0
    lignes: list[Ligne] = field(default_factory=list)
    duree_ms: int = 0
    erreur: str | None = None


_ocr = None


def charger():
    """Charge les modèles une fois (embarqués dans l'image : aucun téléchargement)."""
    global _ocr
    if _ocr is None:
        from paddleocr import PaddleOCR
        dossier = (lambda nom: os.path.join(DOSSIER_MODELES, nom)) if DOSSIER_MODELES else (lambda nom: None)
        _ocr = PaddleOCR(
            text_detection_model_name=MODELE_DETECTION,
            text_detection_model_dir=dossier(MODELE_DETECTION),
            text_recognition_model_name=MODELE_RECONNAISSANCE,
            text_recognition_model_dir=dossier(MODELE_RECONNAISSANCE),
            doc_orientation_classify_model_name=MODELE_ORIENTATION,
            doc_orientation_classify_model_dir=dossier(MODELE_ORIENTATION),
            use_doc_orientation_classify=True,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            cpu_threads=int(os.environ.get('SIRAL_OCR_THREADS') or os.cpu_count() or 4),
        )
    return _ocr


def est_pdf(octets: bytes) -> bool:
    return octets[:5] == b'%PDF-'


def nombre_pages(octets: bytes) -> int:
    if not est_pdf(octets):
        return 1
    doc = pdfium.PdfDocument(octets)
    try:
        return len(doc)
    finally:
        doc.close()


def _images(octets: bytes, pages: list[int]):
    """Rend (numéro, image RGB ndarray) pour chaque page demandée (base 1)."""
    if not est_pdf(octets):
        yield 1, np.array(Image.open(io.BytesIO(octets)).convert('RGB'))
        return
    doc = pdfium.PdfDocument(octets)
    try:
        for n in pages:
            if n < 1 or n > len(doc):
                yield n, None
                continue
            page = doc[n - 1]
            l, h = page.get_size()
            echelle = min(DPI / 72, COTE_MAX_PX / max(l, h, 1))
            yield n, np.array(page.render(scale=echelle).to_pil().convert('RGB'))
            page.close()
    finally:
        doc.close()


def _ordre_de_lecture(boites, textes, scores) -> list[Ligne]:
    """
    Regroupe les fragments en lignes (recouvrement vertical ≥ 50 %), lignes de
    haut en bas, fragments de gauche à droite. Un grand blanc horizontal
    (colonnes d'un tableau, heure d'un message) devient une tabulation.

    Une page scannée de travers incline toutes les lignes : leurs rectangles
    englobants deviennent hauts et se chevauchent d'une ligne à l'autre. Le
    regroupement se fait donc dans le repère REDRESSÉ (inclinaison médiane des
    lignes détectées) ; les boîtes rendues restent dans le repère de la page.
    """
    polys = [np.asarray(p, dtype=float) for p in boites]
    angles = [np.arctan2(p[1, 1] - p[0, 1], p[1, 0] - p[0, 0]) for p in polys if p[1, 0] - p[0, 0] > 3 * abs(p[3, 1] - p[0, 1])]
    a = float(np.median(angles)) if angles else 0.0
    cos, sin = np.cos(a), np.sin(a)
    frags = []
    for p, t, s in zip(polys, textes, scores):
        if not str(t).strip():
            continue
        xr = p[:, 0] * cos + p[:, 1] * sin
        yr = -p[:, 0] * sin + p[:, 1] * cos
        frags.append((xr.min(), yr.min(), xr.max(), yr.max(), str(t), float(s),
                      [int(p[:, 0].min()), int(p[:, 1].min()), int(p[:, 0].max()), int(p[:, 1].max())]))
    frags.sort(key=lambda f: (f[1] + f[3]) / 2)
    rangs: list[list] = []
    for f in frags:
        h = f[3] - f[1]
        r = rangs[-1] if rangs else None
        if r is not None:
            y0, y1 = min(x[1] for x in r), max(x[3] for x in r)
            recouvrement = min(f[3], y1) - max(f[1], y0)
            if recouvrement >= 0.5 * min(h, y1 - y0):
                r.append(f)
                continue
        rangs.append([f])
    lignes = []
    for r in rangs:
        r.sort(key=lambda f: f[0])
        hauteur = np.median([f[3] - f[1] for f in r])
        morceaux = [r[0][4]]
        for prec, f in zip(r, r[1:]):
            morceaux.append('\t' if f[0] - prec[2] > 2.5 * hauteur else ' ')
            morceaux.append(f[4])
        poids = [len(f[4]) for f in r]
        lignes.append(Ligne(
            texte=''.join(morceaux),
            confiance=round(float(np.average([f[5] for f in r], weights=poids)), 3),
            boite=[min(f[6][0] for f in r), min(f[6][1] for f in r), max(f[6][2] for f in r), max(f[6][3] for f in r)],
        ))
    return lignes


def lire(octets: bytes, pages: list[int] | None = None) -> list[Page]:
    """OCR des pages demandées (toutes si None). Une page en échec n'arrête pas les autres."""
    ocr = charger()
    if pages is None:
        pages = list(range(1, nombre_pages(octets) + 1))
    sortie = []
    for n, image in _images(octets, pages):
        p = Page(page=n)
        debut = time.monotonic()
        if image is None:
            p.erreur = 'page inexistante'
        else:
            try:
                r = ocr.predict(image)[0]
                pre = r.get('doc_preprocessor_res') or {}
                p.angle = int(pre.get('angle') or 0)
                img = pre.get('output_img')
                p.hauteur, p.largeur = (img.shape[:2] if img is not None else image.shape[:2])
                p.lignes = _ordre_de_lecture(r['rec_polys'], r['rec_texts'], r['rec_scores'])
                p.texte = '\n'.join(l.texte for l in p.lignes)
                if p.lignes:
                    p.confiance = round(float(np.average([l.confiance for l in p.lignes], weights=[len(l.texte) for l in p.lignes])), 3)
            except Exception as e:  # une page illisible ne casse pas le lot
                p.erreur = str(e)[:300]
        p.duree_ms = int((time.monotonic() - debut) * 1000)
        sortie.append(p)
    return sortie
