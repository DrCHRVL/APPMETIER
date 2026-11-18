"""
SIRAL — service OCR (conteneur « ocr »). API documentée dans docs/OCR.md.

Seconde exception au « rien ne sort du navigateur », SÉPARÉE de l'attaché :
aucune clé, aucun volume, aucun accès Internet, système de fichiers en lecture
seule. Les octets reçus vivent en mémoire le temps de la requête ; rien n'est
écrit, rien n'est journalisé du contenu. Seule l'app SIRAL l'appelle (secret
dérivé de SIRAL_SECRET).
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import os
from dataclasses import asdict

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

import moteur

VERSION = '1'
MAX_OCTETS = 40 * 1024 * 1024
MAX_PAGES = 50


def _secret() -> str | None:
    if os.environ.get('SIRAL_OCR_SECRET'):
        return os.environ['SIRAL_OCR_SECRET']
    if os.environ.get('SIRAL_SECRET'):
        return hashlib.sha256(('ocr-bridge:' + os.environ['SIRAL_SECRET']).encode()).hexdigest()
    return None


SECRET = _secret()
if not SECRET:
    raise SystemExit('[ocr] SIRAL_SECRET absent — refus de démarrer')

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
# Un seul calcul à la fois : chaque page occupe déjà tous les cœurs. Les
# requêtes suivantes attendent leur tour au lieu de se disputer le CPU.
verrou = asyncio.Lock()
en_attente = 0


def _erreur(code: int, message: str) -> JSONResponse:
    return JSONResponse({'ok': False, 'error': message}, status_code=code)


@app.middleware('http')
async def garde(request: Request, suite):
    donne = request.headers.get('x-ocr-secret', '')
    if not donne or not hmac.compare_digest(donne.encode(), SECRET.encode()):
        return _erreur(401, 'Non autorisé')
    if int(request.headers.get('content-length') or 0) > MAX_OCTETS:
        return _erreur(413, 'Requête trop volumineuse')
    return await suite(request)


@app.on_event('startup')
async def demarrage():
    # Modèles chargés dès le démarrage : la première requête n'attend pas.
    await asyncio.get_running_loop().run_in_executor(None, moteur.charger)


@app.get('/status')
async def status():
    return {
        'ok': True,
        'version': VERSION,
        'moteur': 'PaddleOCR PP-OCRv5',
        'modeles': [moteur.MODELE_DETECTION, moteur.MODELE_RECONNAISSANCE],
        'dpi': moteur.DPI,
        'occupe': verrou.locked(),
        'en_attente': en_attente,
    }


@app.post('/v1/ocr')
async def ocr(request: Request):
    """
    Corps JSON : { b64: PDF ou image (PNG/JPEG/TIFF) en base64,
                   pages?: [n…] (base 1 ; toutes si absent, PDF seulement),
                   lignes?: bool (détail ligne par ligne avec boîtes, défaut true) }
    """
    global en_attente
    try:
        corps = await request.json()
        octets = base64.b64decode(corps.get('b64') or '', validate=True)
    except (ValueError, binascii.Error):
        return _erreur(400, 'Corps illisible (JSON + base64 attendus)')
    if not octets:
        return _erreur(400, 'Aucun document fourni')
    pages = corps.get('pages')
    if pages is not None:
        if not isinstance(pages, list) or not all(isinstance(n, int) and n > 0 for n in pages):
            return _erreur(400, 'pages : liste de numéros (base 1) attendue')
    try:
        total = moteur.nombre_pages(octets)
    except Exception:
        return _erreur(422, 'Document illisible (PDF corrompu ou protégé, image invalide)')
    demandees = pages if pages is not None else list(range(1, total + 1))
    if len(demandees) > MAX_PAGES:
        return _erreur(413, f'{MAX_PAGES} pages au plus par requête (découper en lots)')

    en_attente += 1
    try:
        await verrou.acquire()
    finally:
        en_attente -= 1
    try:
        resultat = await asyncio.get_running_loop().run_in_executor(None, moteur.lire, octets, demandees)
    finally:
        verrou.release()
    detail = corps.get('lignes', True) is not False
    sortie = []
    for p in resultat:
        d = asdict(p)
        if not detail:
            d.pop('lignes')
        sortie.append(d)
    return {'ok': True, 'version': VERSION, 'pages_document': total, 'pages': sortie}
