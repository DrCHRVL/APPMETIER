#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extraction du « Mémento parquet » (tableaux NATINF) vers JSON structuré.

Ce script transforme le PDF du mémento parquet (tableaux d'infractions courantes
créés par la promotion 2015 puis actualisés) en un référentiel JSON exploitable
par l'application : pour chaque code NATINF, on récupère le quantum (peine
encourue, sous forme abrégée du mémento), la nature de l'infraction qui en
découle (crime / délit / contravention) et le thème (catégorie de la section).

Le mémento ne fournit PAS le libellé officiel complet : on en extrait un libellé
de travail (libelleMemento), volontairement secondaire. Le libellé faisant foi
provient de l'export officiel data.gouv.fr (cf. scripts/build-natinf.mjs et
data/natinf/README.md). Le mémento apporte ce que l'export officiel n'a pas :
le quantum « parquet » abrégé, le thème, et le fait qu'une infraction soit
fréquente (présente dans le mémento).

Usage :
    python3 scripts/parse-memento-pdf.py <chemin_du_PDF> [chemin_sortie_json]

Dépendance : pypdf (pip install pypdf).
"""
import re
import sys
import json
from collections import Counter

try:
    from pypdf import PdfReader
except ImportError:
    sys.exit("Dépendance manquante : pip install pypdf")

# Catégorie (thème) par défaut, calée sur l'en-tête de chaque page du mémento.
# Affinée ensuite par détection des sous-titres de section (voir HEADERS).
PAGE_CAT = {
    1: None,
    2: 'Violences', 3: 'Violences',
    4: 'Infractions sexuelles', 5: 'Infractions sexuelles', 6: 'Infractions sexuelles',
    7: 'Menaces',
    8: 'Atteintes volontaires aux personnes',
    9: 'Homicide et blessures involontaires',
    10: 'Stupéfiants (ILS)',
    11: 'Armes et explosifs (ILA)',
    12: 'Atteintes aux biens',
    13: 'Extorsion',
    14: 'Recel',
    15: 'Économique et financier (écofi)',
    16: 'Faux',
    17: 'Destructions et dégradations volontaires',
    18: 'Destructions et dégradations involontaires',
    19: "Infractions contre l'État et l'autorité",
    20: 'Association de malfaiteurs et ordre public',
    21: 'Association de malfaiteurs et ordre public',
    22: 'Circulation routière',
    23: 'Circulation routière',
    24: 'Coordination des transports',
}

# Sous-titres de section : (motif, catégorie). Testés uniquement sur les lignes
# SANS code NATINF (les lignes de contenu portent toujours un couple code+quantum).
HEADERS = [
    (r'^Infractions sexuelles$', 'Infractions sexuelles'),
    (r'^Droit pénal de la prostitution', 'Infractions sexuelles'),
    (r'^Menaces', 'Menaces'),
    (r'^Autres atteintes aux personnes', 'Atteintes volontaires aux personnes'),
    (r'^Homicide$', 'Atteintes volontaires aux personnes'),
    (r'^Arrestation, enlèvement', 'Séquestration et enlèvement'),
    (r'^Harcèlement', 'Harcèlement'),
    (r'^Homicide et blessures involontaires', 'Homicide et blessures involontaires'),
    (r"^Atteintes à la vie privée", 'Atteintes à la vie privée'),
    (r'^Droit pénal de la famille', 'Droit pénal de la famille'),
    (r'stupéfiants \(ILS\)', 'Stupéfiants (ILS)'),
    (r'armes \(ILA\)', 'Armes et explosifs (ILA)'),
    (r'^Atteintes aux biens', 'Atteintes aux biens'),
    (r'^Extorsion', 'Extorsion'),
    (r'^Chantage', 'Extorsion'),
    (r'^Recel', 'Recel'),
    (r'^Blanchiment', 'Économique et financier (écofi)'),
    (r'^Escroquerie', 'Économique et financier (écofi)'),
    (r'^Abus de confiance', 'Économique et financier (écofi)'),
    (r'détériorations volontaires', 'Destructions et dégradations volontaires'),
    (r'détériorations involontaires', 'Destructions et dégradations involontaires'),
    (r"contre l'État et l'autorité", "Infractions contre l'État et l'autorité"),
    (r'^Association de malfaiteurs', 'Association de malfaiteurs et ordre public'),
    (r'^Rébellion', 'Outrage et rébellion'),
    (r'post-sentencielle', 'Incriminations post-sentencielles'),
    (r'terroristes', 'Infractions terroristes'),
    (r'^Circulation routière', 'Circulation routière'),
    (r'conducteur', 'Circulation routière'),
    (r'^Coordination des transports', 'Coordination des transports'),
]
HEADERS = [(re.compile(p), c) for p, c in HEADERS]

# Quantum abrégé du mémento :
#   RCP            -> réclusion criminelle à perpétuité
#   Na  (20a, 15a) -> crime, réclusion de N années
#   DN  (D7, D10)  -> délit, N années d'emprisonnement
#   DNm (D6m)      -> délit, N mois d'emprisonnement
#   DA             -> délit puni d'amende seule
#   CN  (C1..C5)   -> contravention de Ne classe
QUANT = r'(RCP|\d{1,2}a|D\d{1,2}m|D\d{1,2}|DA|C[1-5])'
PAIR = re.compile(r'(\d{1,6})\s*\(\s*' + QUANT + r'\s*\)|(\d{1,6})\s+' + QUANT + r'(?=\s|$)')


def decode_quantum(q):
    """Quantum abrégé -> { nature, + champ numérique de la peine encourue }."""
    if q == 'RCP':
        return {'nature': 'crime', 'perpetuite': True}
    m = re.fullmatch(r'(\d{1,2})a', q)
    if m:
        return {'nature': 'crime', 'reclusionAnnees': int(m.group(1))}
    m = re.fullmatch(r'D(\d{1,2})m', q)
    if m:
        return {'nature': 'delit', 'emprisonnementMois': int(m.group(1))}
    m = re.fullmatch(r'D(\d{1,2})', q)
    if m:
        return {'nature': 'delit', 'emprisonnementMois': int(m.group(1)) * 12}
    if q == 'DA':
        return {'nature': 'delit', 'amendeSeule': True}
    m = re.fullmatch(r'C([1-5])', q)
    if m:
        return {'nature': 'contravention', 'classe': int(m.group(1))}
    return {'nature': 'inconnu'}


# Lignes sans code qui ne sont PAS des racines de famille (sections génériques) :
# elles réinitialisent la racine sans servir de préfixe.
NON_ROOT = re.compile(r'^(Autres?( infractions?)?|Divers|Observations?)\b', re.I)

# En-têtes de colonnes des tableaux matriciels (violences, armes, transport…) :
# à ne jamais prendre pour une racine de famille.
MATRIX_NOISE = re.compile(
    r'Catégorie [ABCD]|Sans ITT|ITT|Infirmité|Port\s+Transport|Natinf|Peine|PTAC|PTRA|[≤≥>]|\bMort\b'
)


def clean(s):
    return re.sub(r'\s+', ' ', s).strip().strip(' .·–-').strip()


def parse(pdf_path):
    reader = PdfReader(pdf_path)
    entries = {}
    for pi, page in enumerate(reader.pages, start=1):
        cat = PAGE_CAT.get(pi)
        if cat is None:
            continue
        root = None        # racine de famille courante (ex: « Viol »)
        last_full = None   # dernier libellé complet (pour résoudre les « … »)
        for raw in (page.extract_text() or '').split('\n'):
            # retire le pied de page « NNN/668 »
            line = re.sub(r'\b\d{1,3}/668\b', '', raw.replace('\xa0', ' ')).rstrip()
            matches = list(PAIR.finditer(line))
            if not matches:
                s = line.strip()
                if not s:
                    continue
                # sous-titre de section connu -> change le thème, réinitialise la racine
                header = next((c for rx, c in HEADERS if rx.search(s) and len(s) < 60), None)
                if header:
                    cat = header
                    root = None
                    continue
                # section générique ("Autres infractions"…) -> pas une racine
                if NON_ROOT.match(s):
                    root = None
                    continue
                # en-tête de colonnes d'un tableau matriciel -> pas une racine
                if MATRIX_NOISE.search(s):
                    root = None
                    continue
                # Une racine de famille est un libellé « propre » : pas de « … » en
                # tête, aucun code NATINF ni quantum épars (ce qui exclut les
                # résidus de tableaux matriciels et les infractions sans natinf).
                if (s.startswith('…')
                        or re.search(r'\d{3,6}', s)
                        or re.search(r'(?:^|\s)(RCP|\d{1,2}a|D\d{1,2}m|D\d{1,2}|DA|C[1-5])(?=\s|$)', s)):
                    continue
                # sinon : racine de famille (ex: « Viol », « Homicide », « Vol »)
                if 2 < len(s) < 48:
                    root = clean(s)
                continue

            lead = clean(line[:matches[0].start()])
            # résolution de la hiérarchie pour obtenir un libellé exploitable
            if lead.startswith('…'):
                rest = clean(lead.lstrip('…'))
                base = last_full or root or ''
                libelle = (base + ' ' + rest).strip() if rest else base
            elif root and lead and not lead.lower().startswith(root.lower()):
                libelle = f'{root} — {lead}'
                last_full = libelle
            else:
                libelle = lead
                if lead:
                    last_full = lead

            for m in matches:
                code = m.group(1) or m.group(3)
                q = m.group(2) or m.group(4)
                if not code or not q or int(code) < 10:
                    continue
                if code not in entries:
                    entries[code] = {
                        'code': code,
                        'libelleMemento': libelle or None,
                        'quantumRaw': q,
                        'categorie': cat,
                        **decode_quantum(q),
                    }
                elif not entries[code].get('libelleMemento') and libelle:
                    entries[code]['libelleMemento'] = libelle
    return sorted(entries.values(), key=lambda e: int(e['code']))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    pdf_path = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else 'data/natinf/natinf-memento.json'
    out = parse(pdf_path)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write('\n')
    nat = Counter(e['nature'] for e in out)
    print(f"{len(out)} codes -> {out_path}")
    print("Nature :", dict(nat))
    print("Catégories :", dict(Counter(e['categorie'] for e in out).most_common()))


if __name__ == '__main__':
    main()
