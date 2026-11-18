# Service OCR de SIRAL

Lecture des pages images (PDF scannés, annexes en image, photos de documents,
captures d'écran). Un service unique, réutilisable par tout module de l'app.
Premier utilisateur : le **convertisseur PDF → texte** (bouton « Océriser »).

## Modèle de sécurité : une exception distincte de l'attaché

SIRAL chiffre tout de bout en bout ; seul l'attaché (réservé à l'administrateur)
détient une clé-maître. L'OCR a besoin de lire des pages en clair : il le fait
dans un **conteneur séparé**, pour ne pas ouvrir l'attaché à d'autres usages.

| | Service `ocr` |
|---|---|
| Clés | aucune |
| Données | aucun volume ; système de fichiers en lecture seule, `/tmp` en mémoire |
| Réseau | réseau docker interne **sans accès Internet** ; seule l'app lui parle |
| Accès | secret dérivé de `SIRAL_SECRET` ; route app `/api/ocr` réservée aux sessions du TJ |
| Conservation | aucune : les octets vivent le temps de la requête, le contenu n'est jamais journalisé |
| Minimisation | le convertisseur n'envoie **que les pages images**, par lots de 10, jamais le PDF entier |

Les modèles sont téléchargés et éprouvés **à la construction** de l'image.

## Moteur : PaddleOCR PP-OCRv5 (Apache 2.0)

Choix mesuré (taux d'erreur caractères, CPU 4 cœurs, sans carte graphique) :

| Pièce type | Tesseract 5 (fra) | PaddleOCR PP-OCRv5 mobile (latin) |
|---|---|---|
| PV scanné dégradé | 0,6 % · 1,5 s | 0,0–0,5 % · 1,2–3 s |
| Photo de document (perspective, ombre) | **85 %** (illisible) | **0 %** · 0,5–2 s |
| Capture de conversation | ~0 % (2 heures manquées) | 0 % |
| Page à 90° / 180° | échec sans prétraitement | 0 % (orientation détectée) |

Chaîne : rastérisation 300 dpi (pdfium) → orientation 0/90/180/270
(PP-LCNet) → détection des lignes → reconnaissance → **ordre de lecture**
reconstitué dans le repère redressé (une page scannée de travers ne mélange
pas ses lignes ; un grand blanc horizontal devient une tabulation).

Versions figées dans `services/ocr/requirements.txt` (paddlepaddle 3.3 casse
l'accélération CPU ; 3.0 ne lit pas les modèles PP-OCRv5).

## API v1 (via l'app : `POST /api/ocr`)

```json
{ "b64": "<PDF ou image PNG/JPEG/TIFF en base64>",
  "pages": [2, 5],
  "lignes": true }
```

- `pages` : numéros (base 1) ; absent = toutes. 50 pages au plus par requête.
- `lignes` : détail par ligne (texte, confiance, boîte), défaut `true`.

Réponse :

```json
{ "ok": true, "version": "1", "pages_document": 12,
  "pages": [ { "page": 2, "texte": "…", "confiance": 0.991, "angle": 0,
               "largeur": 2480, "hauteur": 3508, "duree_ms": 1450, "erreur": null,
               "lignes": [ { "texte": "…", "confiance": 0.99, "boite": [x0, y0, x1, y1] } ] } ] }
```

Les boîtes sont en pixels de la page rastérisée **après** redressement
d'orientation (`largeur` × `hauteur`) : de quoi produire plus tard un PDF
cherchable ou surligner un passage dans une pièce. `GET /api/ocr` : 200 si le
service répond, 404 s'il n'est pas configuré (`SIRAL_OCR_URL` vide).

## Déploiement

`docker-compose.yml` déclare le service `ocr` (image ~1,5 Go, ~1 Go de mémoire)
et `SIRAL_OCR_URL=http://ocr:8788` côté app. La mise à jour in-app le construit
et le démarre (il fait partie des services mis à jour). Premier démarrage :
le conteneur charge les modèles en quelques secondes. Les requêtes sont
traitées une par une (chacune occupe tous les cœurs) ; `cpu_shares` laisse
l'app passer devant.

## Qualité : banc de non-régression

```bash
cd services/ocr && python tests/test_moteur.py
```

Pages-types fabriquées (aucune pièce réelle) : PV droit, de travers, très
dégradé, retourné, couché ; photo de document ; capture de conversation.
Exige un taux d'erreur ≤ 1–2 % **et** les lignes dans l'ordre.

## Usages prévus

- Section documents des enquêtes : texte des pièces scannées téléversées.
- Lecture des pièces par l'attaché (aujourd'hui Tesseract interne).
- PDF cherchables (couche texte invisible à partir des boîtes).
