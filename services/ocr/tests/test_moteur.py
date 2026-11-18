"""
Banc de qualité du moteur OCR — pages-types fabriquées (aucune pièce réelle).

  cd services/ocr && python -m pytest tests -q        (ou : python tests/test_moteur.py)

Exige : taux d'erreur caractères (CER) sous le seuil ET lignes dans l'ordre
(une page scannée de travers mélangeait deux lignes voisines).
"""
import io
import os
import random
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import moteur  # noqa: E402

POLICES = '/usr/share/fonts/truetype/dejavu/'
PV = """PROCÈS-VERBAL D'AUDITION DE PERSONNE GARDÉE À VUE
L'an deux mille vingt-six, le dix-sept novembre à quatorze heures trente,
Nous, Jérôme LEFÈVRE, Officier de police judiciaire en résidence à Amiens,
agissant en exécution des instructions de M. le procureur de la République,
entendons la personne ci-après dénommée qui nous déclare :
« Je m'appelle Kévin DUBOIS, né le 03/04/1998 à Saint-Quentin (02).
Le véhicule Peugeot 308 immatriculé FG-482-KT appartient à mon cousin.
Je n'ai jamais touché à la résine saisie dans le coffre, soit 1,250 kg.
Mon numéro est le 06 12 47 89 33. »
Après lecture faite, persiste et signe avec nous le présent à 15 h 42.""".split('\n')
MESSAGES = ["Wesh t'es où là ? Le gars attend depuis 20 min", "J'arrive frère, je suis vers Étouvie",
            "Il veut 3 plaquettes, 900 € cash", "Ok dis lui RDV parking Leclerc à 21h30",
            "Fais gaffe la BAC tourne vers la gare", "Reçu. Efface les messages après stp"]


def _png(img):
    b = io.BytesIO()
    img.save(b, 'PNG')
    return b.getvalue()


def _jpeg(img, q):
    b = io.BytesIO()
    img.save(b, 'JPEG', quality=q)
    return Image.open(b).convert('RGB')


def pv_scanne(inclinaison, bruit, qualite, police='DejaVuSerif.ttf'):
    random.seed(1)
    W, H = 2480, 3508
    im = Image.new('L', (W, H), 245)
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(POLICES + police, 38)
    for i, l in enumerate(PV):
        d.text((220, 300 + i * 65), l, fill=25, font=f)
    im = im.rotate(inclinaison, fillcolor=245, resample=Image.BICUBIC).filter(ImageFilter.GaussianBlur(0.9))
    px = im.load()
    for _ in range(int(W * H * bruit)):
        px[random.randrange(W), random.randrange(H)] = random.choice([0, 90, 200])
    return _jpeg(im.resize((W * 2 // 3, H * 2 // 3)), qualite)


def photo_document():
    import cv2
    doc = Image.new('L', (2000, 1100), 250)
    d = ImageDraw.Draw(doc)
    f = ImageFont.truetype(POLICES + 'DejaVuSerif.ttf', 34)
    for i, l in enumerate(PV[:8]):
        d.text((80, 100 + i * 62), l, fill=20, font=f)
    a = np.array(doc).astype(np.float32)
    a = (a * np.linspace(0.55, 1.0, a.shape[1])[None, :]).clip(0, 255).astype(np.uint8)  # ombre
    src = np.float32([[0, 0], [2000, 0], [2000, 1100], [0, 1100]])
    dst = np.float32([[120, 60], [1900, 140], [1960, 1060], [40, 1010]])
    a = cv2.warpPerspective(a, cv2.getPerspectiveTransform(src, dst), (2000, 1100), borderValue=60)
    a = cv2.resize(cv2.GaussianBlur(a, (3, 3), 0), (1300, 715))
    return _jpeg(Image.fromarray(a).convert('RGB'), 45), PV[:8]


def capture_conversation():
    W = 1080
    im = Image.new('RGB', (W, 900), (229, 221, 213))
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(POLICES + 'DejaVuSans.ttf', 34)
    y = 40
    for i, t in enumerate(MESSAGES):
        w = d.textlength(t, font=f) + 60
        x = 40 if i % 2 == 0 else W - 40 - w
        d.rounded_rectangle((x, y, x + w, y + 80), 18, fill=(255, 255, 255) if i % 2 == 0 else (220, 248, 198))
        d.text((x + 30, y + 20), t, fill=(30, 30, 30), font=f)
        y += 120
    return _jpeg(im.crop((0, 0, W, y + 20)), 40), MESSAGES


def _lev(a, b):
    prec = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cour = [i]
        for j, cb in enumerate(b, 1):
            cour.append(min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + (ca != cb)))
        prec = cour
    return prec[-1]


def _norm(t):
    return re.sub(r'\s+', ' ', t).strip()


def verifier(nom, image, attendu, seuil):
    page = moteur.lire(_png(image))[0]
    assert page.erreur is None, f'{nom} : {page.erreur}'
    cer = _lev(_norm(page.texte), _norm('\n'.join(attendu))) / len(_norm('\n'.join(attendu)))
    # ordre : chaque ligne attendue retrouvée, dans l'ordre
    lignes = page.texte.split('\n')
    positions = []
    for l in attendu:
        meilleure = min(range(len(lignes)), key=lambda k: _lev(_norm(lignes[k]), _norm(l)))
        positions.append(meilleure)
    print(f'{nom:28} CER {cer * 100:5.2f} %  confiance {page.confiance}  angle {page.angle:3}  {page.duree_ms} ms')
    assert cer <= seuil, f'{nom} : CER {cer:.3f} > {seuil}'
    assert positions == sorted(positions), f'{nom} : lignes dans le désordre {positions}'
    return page


def test_pv_droit():
    verifier('PV scanné droit', pv_scanne(0.6, 0.004, 30), PV, 0.01)


def test_pv_de_travers():
    verifier('PV scanné de travers (-2,6°)', pv_scanne(-2.6, 0.006, 22, 'DejaVuSans.ttf'), PV, 0.01)


def test_pv_tres_degrade():
    verifier('PV très dégradé', pv_scanne(1.8, 0.012, 18, 'DejaVuSansMono.ttf'), PV, 0.02)


def test_pv_retourne():
    p = verifier('PV retourné (180°)', pv_scanne(0.6, 0.004, 30).rotate(180), PV, 0.01)
    assert p.angle == 180


def test_pv_paysage():
    p = verifier('PV couché (90°)', pv_scanne(0.6, 0.004, 30).rotate(90, expand=True), PV, 0.01)
    assert p.angle in (90, 270)


def test_photo_document():
    verifier('Photo de document', *photo_document(), 0.02)


def test_capture_conversation():
    verifier('Capture de conversation', *capture_conversation(), 0.02)


if __name__ == '__main__':
    for nom, fn in list(globals().items()):
        if nom.startswith('test_'):
            fn()
    print('OK')
