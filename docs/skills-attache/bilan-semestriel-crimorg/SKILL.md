---
name: bilan-semestriel-crimorg
description: >
  Produire le bilan périodique (semestre, trimestre, année) de la criminalité
  organisée : chiffres stats_synthese, graphiques commentés, tendances,
  affaires marquantes anonymisées, valorisation pour procureur et
  partenaires. Déclencher sur : bilan semestriel, bilan, rapport d'activité.
---

# Bilan périodique d'activité — criminalité organisée

## Finalité et registre

Ce document est à la fois un **acte de politique pénale** (rendre compte au
procureur de l'action du contentieux) et un **outil de communication
institutionnelle** (montrer les résultats aux partenaires : parquet général,
JIRS, préfecture, services d'enquête, élus). Il a vocation à être diffusé :
il doit donner à voir la force de l'action — et il n'y parvient que par
l'exactitude. La valorisation vient des faits : chiffres sourcés, dynamiques
visibles, exemples concrets. Jamais d'emphase creuse, jamais un chiffre
tordu, jamais un superlatif que les données ne portent pas.

Ton : institutionnel, dense, assuré. Prose de magistrat, pas de plaquette
publicitaire — c'est précisément ce qui rend le document convaincant.

## Étape 0 — Cadrage

1. **Période** : par défaut, le semestre écoulé (1ᵉʳ janvier → 30 juin, ou
   1ᵉʳ juillet → 31 décembre). Si la demande dit autre chose (trimestre,
   année, « depuis le 1ᵉʳ janvier »), suivre la demande. En cas de doute
   réel sur la période attendue, la question vaut d'être posée — c'est le
   seul point de cadrage qui change tout le document.
2. **Relire la demande du magistrat** : ses observations, ses angles
   (phénomènes qu'il veut voir traités, destinataires qu'il vise, format).
   Ses consignes priment sur le plan-type ci-dessous.
3. **Associations et méthodes** : vérifier (associations_lister) si une
   trame ou une autre skill est associée à ce type de document — l'appliquer
   alors en complément.

## Étape 1 — Les chiffres : stats_synthese, source unique

Appeler `stats_synthese(du, au)` sur la période. C'est la **source unique**
de tout chiffre du bilan : ne JAMAIS compter à la main dans les dossiers, ne
JAMAIS estimer, ne JAMAIS reprendre un chiffre de mémoire.

- **Lire les notes** de chaque section du résultat (définitions : procédures
  terminées « hors classements et OI », défèrements « à leur date réelle »,
  orientations « 1 par dossier, 1 par prévenu en CRPC ») et **respecter ces
  définitions dans le texte** — les préciser en note quand un chiffre
  pourrait être mal lu.
- Relever pour la rédaction : totaux et **évolutions vs la même période un
  an plus tôt** (comparatifPeriodePrecedente), pics mensuels, structure des
  orientations, peines (convertir la prison ferme cumulée en années : 74
  mois → « plus de six années de prison ferme »), **avoirs saisis et
  confisqués** (numéraire, comptes, crypto, véhicules, immeubles), actes
  TSE, suivi JIRS/PG, photographie de l'instruction.
- **Contrôle de vraisemblance** : des zéros partout, une section vide, une
  incohérence manifeste → le dire au magistrat (les données sont peut-être
  incomplètes) plutôt que de broder autour.

## Étape 2 — Les graphiques : stats_graphique — VOIR avant d'écrire

Générer et **regarder** les graphiques, au minimum :

| Graphique | Ce qu'on y lit |
|---|---|
| `procedures_terminees_par_mois` | le rythme de sortie des procédures |
| `deferements_par_mois` | l'intensité de la réponse pénale au fil des mois |
| `orientation` | la structure de la réponse (CRPC, CI, OI, classements) |
| `tendance_infractions_par_mois` | les bascules du contentieux (ex. atteintes aux biens au 1ᵉʳ trimestre, stupéfiants ensuite) |

et selon la matière : `condamnations_par_mois`, `infractions_terminees`,
`services_terminees`, `ouvertures_par_mois`, `orientation_par_mois`,
`infractions_en_cours`.

Pour chaque graphique retenu :
- **décrire la dynamique VISIBLE** (pic, creux, plateau, bascule,
  accélération) — la description doit correspondre à ce que l'image montre,
  couleurs et proportions comprises ;
- **appuyer chaque nombre** sur les données chiffrées jointes à l'image
  (jamais une lecture approximative des pixels) ;
- **expliquer** la dynamique par les dossiers (étape 3) : un pic de
  défèrements a une cause — la nommer.

## Étape 3 — Les dossiers derrière les chiffres

Les listes de `stats_synthese` (procédures terminées, défèrements,
catégories avec leurs dossiers) désignent les affaires qui portent les
chiffres.

1. **Sélectionner les dossiers marquants** : fortes peines, saisies
   importantes, ouvertures d'information structurantes, défèrements
   multiples, dossiers emblématiques des catégories dominantes de chaque
   phase de la période.
2. **Les lire** : `lire_dossier` un par un s'ils sont peu nombreux ; au-delà
   de 5-6, déléguer à `sous_agents` (une tâche par dossier, consigne
   autonome : « résume en 5 lignes les faits, le mode opératoire, la réponse
   judiciaire — peines, saisies — SANS AUCUN nom de personne »).
3. En tirer **3 à 6 encadrés « affaires marquantes »** : 4-6 lignes chacun,
   factuels, percutants, **strictement anonymisés** (voir étape 6).
4. **Nommer les tendances** : croiser `tendance_infractions_par_mois` avec
   la réalité des dossiers lus. C'est ici que le bilan prend sa valeur :
   « le premier trimestre a été dominé par les atteintes aux biens — vols de
   fret en bande organisée sur les axes autoroutiers — avant une bascule
   nette vers les trafics de stupéfiants organisés depuis la détention » se
   démontre par la courbe ET par les dossiers.

## Étape 4 — Le contexte et les enjeux : base de connaissances (et web)

Un bilan qui aligne des chiffres sans les situer ne « vend » rien. Situer
l'action dans son environnement :

1. **Base de connaissances d'abord** : consulter les documents réflexes ★,
   puis `kb_chercher` sur : état de la menace (SIRASCO, criminalité
   organisée), politique pénale (circulaires, plans nationaux stupéfiants,
   feuilles de route OFAST), notes de doctrine locales. `kb_lire` les
   entrées pertinentes et **citer le document** quand on s'y adosse.
2. **Recherche web, si elle est activée** (Paramètres → Cerveau) :
   actualiser prudemment le contexte (sources officielles et institutions
   reconnues : ministères, Interstats, OFAST, rapports parlementaires) et
   sourcer chaque emprunt. Si elle n'est pas activée, s'en tenir à la base —
   sans le regretter dans le document.
3. En tirer un fil : **en quoi les résultats de la période répondent aux
   priorités nationales et aux réalités locales de la menace** (ex. la
   lutte contre les trafics depuis la détention, priorité nationale,
   trouve ici une traduction concrète : X procédures, Y défèrements).

## Étape 5 — Rédaction

Plan-type (adapter aux consignes et à la matière réelle) :

1. **Synthèse** — 10 lignes maximum : les 4-5 chiffres qui marquent, la
   tendance dominante, le sens de l'action. C'est ce que les destinataires
   pressés liront seul : le soigner en premier.
2. **L'activité de la période en chiffres** — flux (ouvertures), procédures
   terminées, orientations, durées moyennes ; comparaison à période
   constante.
3. **La réponse pénale** — défèrements (avec la dynamique mensuelle),
   condamnations, prison ferme cumulée, CRPC/CI, interdictions.
4. **Frapper au portefeuille** — saisies et confiscations, catégorie par
   catégorie ; c'est un marqueur fort de la lutte contre la criminalité
   organisée, le mettre en avant dès que les montants le portent.
5. **Les moyens engagés** — actes TSE (écoutes, géolocalisations,
   prolongations), co-saisines et services, dossiers suivis JIRS / parquet
   général, stock à l'instruction.
6. **Tendances de la délinquance organisée et affaires marquantes** — les
   phénomènes de la période, adossés aux encadrés anonymisés.
7. **Perspectives** — stock en cours et son ancienneté, dossiers à
   l'instruction, priorités du semestre suivant.

Règles d'écriture :
- prose institutionnelle française, paragraphes courts ; les listes à puces
  se réservent aux encadrés et aux tableaux de chiffres ;
- chiffres exacts, conversions parlantes (mois → années ; cumuls) ;
  évolutions en valeur ET en pourcentage quand les deux éclairent ;
- insérer chaque graphique par un MARQUEUR seul sur sa ligne, à l'endroit
  exact où il illustre le propos :
  `[GRAPHIQUE : nom_du_graphique | du=AAAA-MM-JJ | au=AAAA-MM-JJ]`
  (mêmes noms que `stats_graphique` ; TOUJOURS préciser la période pour figer
  le document). Aux exports PDF, Word et PowerPoint, SIRAL remplace
  automatiquement chaque marqueur par l'image — celle regardée à l'étape 2,
  mêmes couleurs. Pour un chiffre ventilé par l'analyse elle-même (décompte
  hors catalogue), utiliser le marqueur libre
  `[DIAGRAMME : colonnes | titre=… | Étiquette: valeur ; …]`. Le texte
  doit néanmoins décrire la dynamique : le document reste lisible sans les
  images ;
- aucune mention de l'assistant (règle de dissimulation absolue).

## Étape 6 — Contrôles avant remise

Relire intégralement en vérifiant, ligne à ligne :

1. **Traçabilité** : chaque chiffre du texte figure dans `stats_synthese`
   ou dans les données jointes d'un graphique. Un chiffre introuvable = le
   retirer ou le recalculer à la source.
2. **Période constante** : mêmes bornes partout ; le comparatif porte sur la
   même période un an plus tôt ; les définitions (hors classements/OI, date
   réelle des défèrements) sont respectées et, si utile, rappelées en note.
3. **Anonymisation stricte** (document diffusable) : aucun nom de mis en
   cause, de victime ou de tiers ; initiales au besoin ; pas de plaque, pas
   d'adresse précise, pas de numéro de procédure dans les encadrés ; les
   lieux restent au niveau de la commune ou de l'axe (jamais l'adresse).
   Les services d'enquête et juridictions peuvent être cités.
4. **Cohérence visuelle** : les dynamiques décrites correspondent aux
   graphiques regardés.
5. **Format** : 2 à 4 pages ; la synthèse tient en 10 lignes.

## Étape 7 — Remise

- `produire_document` avec `type: "livrable"`, titre
  « Bilan d'activité — criminalité organisée — [période] », rangé au
  pseudo-dossier `_hors-dossier` (sauf consigne contraire). Le magistrat le
  retrouve dans « Actes rédigés — hors dossier », le retouche, l'exporte en
  PDF/Word et le valide.
- Récapituler en réponse : la période, les totaux clés, les graphiques
  insérés (leurs marqueurs seront remplacés par les images à l'export
  PDF/Word), les affaires retenues en encadré, et ce qui manquerait
  (données incomplètes signalées à l'étape 1).
- Proposer les déclinaisons utiles sans les imposer : version courte (une
  page) pour diffusion large, article pour la dépêche du parquet, et
  **version diaporama** — une seconde production `type: "presentation"`
  (syntaxe : `#` page de garde, `##` une diapositive par section du bilan,
  puces courtes, mêmes marqueurs de graphiques) que le magistrat exporte
  d'un clic en PowerPoint pour la présenter en réunion.
