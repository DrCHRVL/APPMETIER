# Documents d'enquête — explorateur, indexation, capital documentaire

> Note de réflexion. Trois questions : (1) un explorateur de fichiers pour
> naviguer les pièces sur le serveur ; (2) toute la donnée est-elle accessible
> à l'IA de chaque enquête, et comment ; (3) faire que chaque versement soit
> analysé, indexé, dédoublonné — pour retrouver vite et synthétiser bien.
> Prolonge `ANALYSE-PROFONDE.md` (doctrine « lire une fois, capitaliser »)
> et `COWORK-PISTES.md` (refus motivé du RAG vectoriel).
>
> Date : 2026-08-20.

---

## 1. État des lieux — ce qui est DÉJÀ en place

### Stockage : rien à changer

Chaque pièce est un blob chiffré (AES-GCM côté navigateur, `SIR1+iv+ct`,
`lib/web/bridge.ts:190`) posé sous son **chemin relatif complet** :

```
<DATA_DIR>/[tj/<id>/]docs/<cleEnquete>/<Zone>/<Pochette>/<piece>.pdf.enc
<DATA_DIR>/[tj/<id>/]docs/<cleEnquete>/.index.json     ← { rel, size, savedAt, savedBy, category, originalName }
```

(`lib/server/store.ts:243-290`). Cinq zones figées (Geoloc, Ecoutes, Actes,
PV, DML — `DocumentsSection.tsx:116`), l'arborescence versée est INTACTE,
écriture atomique sous verrou par enquête, audit append-only. Pas de base
SQL : l'« index » est un JSON plat par enquête — suffisant, à ENRICHIR
(§4), pas à remplacer.

### Affichage : l'arbre existe, l'explorateur pas encore

La Phase 0 d'`ANALYSE-PROFONDE.md` est faite : dès qu'une zone contient des
sous-pochettes, la liste plate devient un **arbre repliable** (pochettes
fermées par défaut, compteurs, suppression par pochette —
`DocumentsSection.tsx:69-99` et `:1213`). Le module instruction a le sien
(`DossierCompletSection.tsx`). Ce qui manque pour un vrai explorateur : §3.

### Accès IA : oui, tout est accessible — par divulgation progressive

L'attaché (et le connecteur Claude web) voit TOUT le dossier, mais jamais
d'un bloc :

- `dossier_arborescence` — la table des matières physique : panorama des
  pochettes (nb de pièces chacune) puis détail paginé
  (`scripts/attache/dossier.mjs:1158`) ;
- `lire_document` — lecture d'une pièce, paginée (200 000 car./page), en
  servant d'abord le **jumeau markdown** versé avec la pièce, sinon le cache
  d'extraction par hash, sinon extraction (OCR à la demande via
  `integrale:true`) — `dossier.mjs:516` ;
- `lire_dossier` — l'aperçu compact, les CR paginés, la vue `fiche` ciblée
  sur une personne (`dossier.mjs:305-363`) ;
- `chronologie_lire`, `cotes_lire` (architecture NPP A/B/C/D/E/G/S/Z),
  `verifier_completude`, `diagnostic_dossier`.

### « Une fiche avec une sorte de sommaire » — oui, mais en QUATRE couches

Il n'y a pas UN sommaire ; il y a un empilement, et c'est voulu :

| Couche | Rôle | Où |
|---|---|---|
| **Arborescence** | OÙ sont les pièces (pochettes, volumes) | reconstruite depuis `.index.json` |
| **Description du dossier** | CE QU'EST l'affaire (SYNTHÈSE + MIS EN CAUSE), actualisée automatiquement à chaque versement/CR/acte | `actualiser_description`, fil de l'eau (`attache-service.mjs:595-647`) |
| **Fiches de dépouillement** | CE QUE CONTIENT chaque lot de pièces, AVEC COTES : chronologie datée, personnes, verbatims, à charge/à décharge, contradictions, actes manquants | chantiers d'analyse profonde (`chantier.mjs`), productions type `fiche` |
| **Mémoire du dossier** | ce qui a été dit/décidé (4 000 car., registres `[fait]`/`[échange]`) | `dossierMemory.mjs` |

Le pont « information → emplacement », c'est la **fiche** : chaque fait y est
coté. Mais les fiches n'existent que si un chantier a tourné — d'où le §4.

### Indexation & doublons : ce qui existe vraiment

- **Extraction une fois** : jumeau `MD/<chemin>.md` produit dans le
  navigateur au versement (`DocumentsSection.tsx:656`, best-effort), cache
  serveur chiffré indexé par sha256 du blob, OCR fr (poppler+tesseract)
  jamais d'office. Solide.
- **Dédoublonnage** : par CHEMIN à l'upload (reprise sans doublon), flou sur
  les ACTES extraits (`DuplicateDetectionService.ts`), Damerau-Levenshtein
  sur les PERSONNES (`dossier.mjs:925-1053`), sémantique par le modèle.
  **Aucune détection de contenu identique entre deux pièces** — le vrai trou
  (§4).
- **Recherche dans les pièces** : côté magistrat, moteur navigateur
  (extraction + cache IndexedDB, `documentTextSearch.ts`) ; côté IA,
  **aucun outil de recherche plein texte dans les pièces** — le parcours est
  arborescence → lecture pièce à pièce, ou lecture des fiches. Deuxième trou
  (§5).

---

## 2. Ce que font les applications de référence (et ce qu'on en retient)

Le comparable sérieux n'est pas Notion : c'est l'**eDiscovery** (Relativity,
Everlaw, Nuix — des dizaines de millions de pièces par affaire) et les
assistants juridiques agentiques (Harvey, NotebookLM côté grand public).
Leur pipeline converge partout sur le même squelette :

1. **Ingestion = extraction + empreinte.** Texte extrait UNE fois à
   l'entrée ; chaque pièce reçoit un hash de contenu (MD5/SHA) → les
   **doublons exacts sont écartés du travail avant toute analyse** (dans une
   affaire fusionnée, 20-40 % du volume est du doublon — exactement le cas
   d'une jonction de 9 procédures type PRISON BREAK). Le near-duplicate
   (même texte à 95 %, re-scan, re-impression) est détecté par empreinte de
   texte normalisé, pas par IA.
2. **Métadonnées riches par pièce**, extraites d'office : type, date,
   personnes citées, résumé court. C'est l'équivalent de « NotebookLM résume
   chaque source à l'import ». La pièce devient trouvable SANS être relue.
3. **Résumés hiérarchiques** : pièce → pochette → dossier. Jamais « tout le
   corpus dans un contexte ».
4. **Recherche lexicale d'abord**, vecteurs seulement pour de très gros
   corpus ou la recherche par concept. Le consensus 2026 côté agents (dont
   Claude Code lui-même) : la recherche agentique sur du markdown structuré
   bat le RAG vectoriel — pas d'index à synchroniser, pas de fuite hors du
   modèle E2EE. **Le choix anti-vecteurs de SIRAL est le bon ; on le
   garde.**
5. **Citations obligatoires** : toute affirmation pointe sa source. Déjà la
   règle des fiches (cotes systématiques).

SIRAL a déjà 3, 4 (à moitié) et 5. Il lui manque 1 (empreinte de contenu)
et 2 (métadonnées/mini-fiche d'office au versement).

---

## 3. Chantier A — l'Explorateur de pièces

### Le constat

L'arbre par zone est un affichage, pas un poste de travail : pas de vue
transverse aux cinq zones, pas de tri (date, taille, nom), pas de recherche
sur les noms, pas de déplacement/renommage, pas de sélection multiple, et
aucun signal d'état (copie texte présente ? fiche produite ? copié au
commun ?).

### La cible : un volet « Explorateur » par enquête (type Finder/Explorateur)

- **Deux panneaux** : arbre des pochettes à gauche (les 5 zones = racines),
  liste détaillée à droite (nom, date, taille, badges), fil d'Ariane,
  double-clic = aperçu (le `DocHoverPreview` existe déjà).
- **Tri + filtre instantané** sur les noms — tout est déjà dans
  `.index.json`, c'est du pur client, coût quasi nul.
- **Badges d'état par pièce** : `T` copie texte présente (`MD/` ou cache),
  `F` couverte par une fiche de chantier, `✗ commun` (le
  `DocumentSyncManager` le sait déjà), `≡ doublon` (§4).
- **Opérations** : renommer, déplacer vers une autre pochette/zone,
  sélection multiple, corbeille logique. Côté serveur c'est une seule
  primitive nouvelle : `moveDoc(rel → rel')` (copie du blob sous le nouveau
  chemin + suppression + mise à jour de l'index, sous le verrou existant) —
  l'ORIGINAL n'est jamais modifié, seul son chemin change. Prévoir la même
  opération pour le jumeau `MD/` et une trace `doc.move` dans l'audit.
- **Réutilisation** : `buildZoneTree` devient le modèle partagé
  (DocumentsSection, DossierCompletSection, Explorateur) au lieu de deux
  implémentations sœurs.

Effort : petit-moyen, aucun changement de stockage, grosse valeur d'usage.

---

## 4. Chantier B — chaque versement analysé, indexé, dédoublonné

C'est le cœur de la demande. Trois étages, du déterministe (gratuit) vers
l'IA (économe), dans l'esprit « lire une fois, capitaliser ».

### B1. Empreinte de contenu au versement (gratuit, prioritaire)

**Piège à connaître** : le blob chiffré ne peut PAS servir d'empreinte — l'IV
AES-GCM est aléatoire, le même PDF versé deux fois donne deux blobs
différents. L'empreinte doit être calculée **côté client sur le clair**
(`crypto.subtle.digest` pendant `docUpload`) et stockée dans `DocMeta` :

```
DocMeta { rel, size, savedAt, savedBy, category?, originalName?,
          sha?,      // sha256 de l'OCTET en clair
          shaTexte?  // sha256 du TEXTE extrait normalisé (minuscules,
                     // accents, espaces) — attrape le re-scan/re-export
}
```

(L'attaché, qui détient les clés, calcule les mêmes empreintes quand c'est
lui qui range — `ranger_document` — et peut remplir le stock existant en
tâche de fond, zéro jeton.)

Ce que ça débloque immédiatement :

- **au versement** : « cette pièce existe déjà en `PV/AMI-…/D2/` » —
  proposer d'ignorer ou de verser quand même (une jonction duplique
  légitimement ; on SIGNALE, on ne bloque jamais) ;
- **au devis d'un chantier** : les doublons exacts comptés une fois — sur
  une jonction, c'est 20-40 % de lots (donc de nuits et de jetons) en
  moins ; la fiche du doublon = « copie de D34, voir fiche X » ;
- **badge `≡`** dans l'explorateur, et `dossier_arborescence` qui annote
  les copies.

### B2. Mini-fiche d'office par pièce (fil de l'eau, IA économe)

Aujourd'hui le fil de l'eau actualise la DESCRIPTION quand le dossier bouge
(signature de changement, `dossierSyntheseSignals`) — mais la pièce
elle-même n'est pas lue. Extension du même mécanisme : après la période de
calme, pour chaque pièce NOUVELLE (et non-doublon), un run court (Haiku /
effort bas, comme l'étage 1) produit une **mini-fiche** de quelques lignes :

```
{ rel, type (PV audition / ordonnance / rapport / …), datePiece,
  personnes: [...], resume: 2-3 lignes, aLire: booléen (pièce de fond ?) }
```

Rangée dans un **REGISTRE du dossier** (un JSON chiffré par enquête, données
attaché — même famille que `cotes/`). Le registre est le chaînon manquant
entre l'arborescence (où) et les fiches de chantier (quoi, en profondeur) :
c'est le **sommaire pièce par pièce**, produit au fil de l'eau et non plus
seulement quand un chantier tourne.

- Outil MCP `registre_lire(numero, filtre?)` — et le chat de dossier répond
  « où est l'audition de X ? » sans rien relire.
- La description s'actualise DEPUIS les mini-fiches (plus précis et moins
  cher que relire les signaux bruts).
- Un chantier de dépouillement démarre avec le registre en main : il sait
  déjà quoi prioriser (`aLire`), et ses fiches profondes REMPLACENT les
  mini-fiches lot par lot.
- Gouvernance inchangée : un dossier par tick, anti-rafale, fenêtre de
  nuit, différé si forfait saturé.

### B3. Le doublon d'INFORMATION (la « phrase déjà indexée »)

Dédupliquer à la phrase serait le mauvais grain : en procédure, la
répétition est un signal (un PV de synthèse qui recite une audition, c'est
une information de structure, pas du bruit). Le bon grain :

- **la pièce** : B1 (exact + near-dup par texte normalisé) ;
- **le fait** : dans le registre et les fiches, un fait = une ligne avec SES
  cotes cumulées (« X reconnaît les transports — D34, D112 (copie), E7 »).
  C'est la consolidation qui dédouble, pas l'indexation. La règle est déjà
  dans les consignes de synthèse (« doublons fusionnés, contradictions
  tranchées ») — le registre lui donne un support persistant.

---

## 5. Chantier C — retrouver l'info : recherche plein texte dans les pièces

Le manque le plus net côté IA : `blocFiche` ne cherche que dans les CR et
les actes, pas dans les pièces. Or tout le matériau est là (jumeaux `MD/`,
cache d'extraction) et l'attaché détient les clés.

- Nouvel outil `pieces_chercher(numero, requete)` : scan linéaire normalisé
  (même normalisation que `kb_chercher` : minuscules, sans accents) sur les
  jumeaux `MD/` + le cache + les fiches + le registre ; rend des extraits
  ±200 caractères avec `rel` et pochette. Un dossier de 1 000 pièces ≈
  quelques dizaines de Mo de texte : un grep, pas un index. **Zéro jeton**,
  zéro infrastructure, cohérent avec le refus des vecteurs.
- La même primitive alimente la barre de recherche de l'Explorateur (§3)
  pour le magistrat — via l'attaché quand il est là, sinon repli sur le
  moteur navigateur existant (`documentTextSearch`).
- Effet composé : « trouver l'info rapidement » = registre (sommaire) →
  `pieces_chercher` (localisation exacte) → `lire_document` page ciblée.
  Trois sauts, coût minime, toujours cité.

### C0 — FAIT : le texte vient du serveur, l'extraction locale devient un repli

Le principe « via l'attaché quand il est là, sinon repli navigateur » est en
place pour la matière première elle-même — le texte des pièces.

Le navigateur ré-extrayait avec pdfjs, pour son propre compte, un texte que
l'attaché avait déjà extrait **et océrisé**, et rangé dans un cache chiffré avec
la clé « global » — celle que tout navigateur détient. Trois conséquences, toutes
mauvaises : les procès-verbaux SCANNÉS restaient introuvables (le navigateur n'a
pas d'OCR), chaque poste refaisait le travail, et il fallait tronquer les textes
pour que l'onglet survive.

| | Avant | Maintenant |
|---|---|---|
| Source du texte | pdfjs, dans chaque navigateur | cache de l'attaché, servi tel quel |
| PV scannés | invisibles | océrisés côté serveur, cherchables |
| Texte retenu par pièce | 400 000 caractères | 1 000 000 |
| Borne du cache de session | 120 pièces | 24 M caractères (~48 Mo) — la mémoire, pas le compte |

Sans attaché, rien ne change : le navigateur extrait comme avant. La recherche
ne dépend jamais du serveur ; elle est seulement plus rapide et plus complète
quand il répond.

| Fichier | Rôle |
|---|---|
| `lib/documents/docCacheCore.mjs` | où se range le texte d'une pièce — formule PARTAGÉE app ↔ attaché (deux copies divergentes rendraient le cache muet sans erreur) |
| `lib/server/docTexte.ts` | retrouve l'enveloppe, vérifie qu'elle correspond à la pièce EN PLACE, la rend sans l'ouvrir |
| `app/api/doc-texte/[enquete]/[...path]` | route de lecture, tout utilisateur authentifié |
| `utils/documents/documentTextSearch.ts` | serveur d'abord, extraction locale en repli |
| `scripts/doc-texte.test.mjs` | la chaîne complète : écriture attaché → lecture serveur → ouverture navigateur, fraîcheur comprise |

---

## 6. Feuille de route

| # | Chantier | Contenu | Effort | Priorité | État |
|---|---|---|---|---|---|
| 1 | **Empreintes + doublons** (B1) | sha256 du clair dans DocMeta au versement, remplissage du stock par l'attaché, signalement UI + arborescence annotée + copies exactes écartées des lots de chantier | Faible | 🔴 | ✅ Fait |
| 2 | **Recherche dans les pièces** (C) | outil MCP `pieces_chercher` : fiches d'abord, puis pièces (MD/ + caches + extraction bornée progressive), doublons sautés | Faible-moyen | 🔴 | ✅ Fait |
| 3 | **Explorateur** (A) | deux panneaux (pochettes / liste triable-filtrable), badges T (copie texte) et ≡ (doublon), renommer/déplacer (`moveDoc` : original renommé sur place, jumeau MD suivi), multi-sélection, suppression | Moyen | 🟠 | ✅ Fait |
| 4 | **Registre + mini-fiches** (B2) | entités déterministes (tél/plaques/IBAN/adresses, regex carto) à l'ingestion + mini-fiche IA par pièce (type, date, PERSONNES, résumé) au fil de l'eau ; `registre_lire` + `registre_recouper` (recoupement inter-dossiers, pièces citées) | Moyen | 🟠 | ✅ Fait |
| 5 | Niveau pochette | note de pochette dans la pyramide (pièce→pochette→dossier) quand 1-4 sont en place | Faible | 🟢 | À faire |

Choix actés à l'implémentation de 1 et 2 (2026-08-20) :

- **Strict uniquement** : pas de `shaTexte` (near-dup) pour l'instant — le
  magistrat ne veut JAMAIS perdre une pièce simplement voisine ; seul le
  contenu identique octet à octet est traité en doublon, et toujours en
  SIGNALANT, jamais en bloquant ni en supprimant.
- **La recherche fouille les fiches d'abord** : le capital de dépouillement
  accélère la localisation ; les pièces jamais extraites le sont par lots
  bornés au fil des recherches — l'« index » plein texte se construit
  progressivement dans le cache existant, sans infrastructure nouvelle.
- **Ingestion d'office au fil de l'eau** (validée « extraction + empreinte à
  l'ingestion », patron eDiscovery) : un passage borné à chaque tick du
  service attaché (`scripts/attache/ingest.mjs`) pose l'empreinte et extrait
  le texte de toute pièce qui n'en a pas encore (majordome, mail, scans,
  stock ancien) — CPU local, zéro jeton, échecs mémorisés sans re-tentative.
  La couverture n'attend donc plus ni une recherche ni un devis de chantier.
- **Le registre au service de la cartographie** (chantiers 3-4, 2026-08-20) :
  les entités sensibles — noms, adresses, téléphones, plaques, IBAN — sont le
  fil rouge. Les entités « dures » sont extraites par les mêmes regex que la
  carto (normalisation identique : un numéro trouvé dans une pièce et un
  numéro de la carte se recoupent à l'identique) ; les PERSONNES viennent des
  mini-fiches, avec la clé canonique de la carto (insensible à l'ordre des
  mots). `registre_recouper` rend, à coût nul, les entités présentes dans au
  moins deux dossiers avec les pièces exactes de chaque côté — c'est la
  matière première des liens de renseignement, extraite de la masse versée
  et non plus des seules données structurées. Un recoupement reste un
  signalement à vérifier dans les pièces avant tout `proposer_lien`.
- Tests : `scripts/attache-docs-empreintes.test.mjs`.

Ordre recommandé : **1 → 2** (déterministes, gratuits, débloquent le reste),
puis 3 et 4 en parallèle. Tout reste dans le modèle actuel : E2EE, originaux
intacts, pas de base de données, pas de vecteurs, écritures journalisées,
IA admin-only, gouvernance nuit/5 h inchangée.

## Ce qui ne change pas

La doctrine d'`ANALYSE-PROFONDE.md` tient : chaque pièce lue en entier UNE
fois, tout le travail ultérieur sur les fiches. Ces chantiers ne la
remplacent pas — ils la complètent en amont (empreintes et mini-fiches dès
le versement, pour que le capital se constitue au fil de l'eau et non plus
seulement la nuit d'un chantier) et en aval (explorateur et recherche, pour
que magistrat et IA exploitent ce capital sans relire).
