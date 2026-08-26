# Analyses profondes — pistes d'amélioration

*Revue du module (moteur `scripts/attache/chantier.mjs` + `ordonnancement.mjs`,
service `attache-service.mjs`, interface `components/attache/*`), août 2026.
Chaque piste est vérifiée contre le code : ce qui est décrit ici existe (ou
manque) réellement. Classement par famille, avec un ordre de priorité proposé
en fin de document.*

## 1. Aller dans le détail (lisibilité pour le magistrat)

- **Relancer les lots en échec.** Après `MAX_LOT_ECHECS` (3) tentatives, un lot
  passe en `echec` définitif : ses pièces ne seront jamais dépouillées sauf à
  SUPPRIMER et RECRÉER tout le chantier (en payant le devis de zéro). Il manque
  une action `relancer_echecs` (remettre `etat:'a_faire'`, `echecs:0` sur les
  seuls lots en échec) avec son bouton dans l'atelier à côté du KPI « lots en
  échec ». C'est la piste au meilleur rapport valeur/effort du document.
- **Jetons réels vs devis.** Le devis affiche une fourchette (30–60 k
  jetons/lot) mais le chantier n'affiche jamais ce qu'il a RÉELLEMENT
  consommé : `usage.mjs` agrège par catégorie de run (`chantier`), pas par
  chantier. Enregistrer le bilan de jetons de chaque run dans le chantier
  (champ `jetonsConsommes` incrémenté à chaque lot) et l'afficher à côté de
  l'estimation — le magistrat verrait le devis se confronter au réel.
- **Estimation de durée calibrée sur le réel.** `MINUTES_PAR_LOT = 3` est une
  constante. Le journal horodate chaque fiche produite : la vitesse observée
  (lots/heure sur les 20 derniers lots) donnerait un « temps restant estimé »
  vivant, bien plus juste que 3 min × lots restants.
- **Journal complet sur demande.** `resumeChantier` sert les 12 dernières
  entrées (sur 200 conservées) ; l'atelier a pourtant la place. Un
  `GET /chantiers/:id/journal` à la demande éviterait d'alourdir le sondage
  tout en donnant l'historique entier.
- **Doublons exclus invisibles à l'écran.** Le dédoublonnage strict calcule
  `piecesDeposees` / `doublonsExclus` et les sert dans le résumé, mais le bloc
  devis de l'atelier ne les affiche pas : « 463/1074 pièces » ne dit pas que
  84 copies exactes ont été écartées. Une ligne « N déposées, dont M copies
  exactes non relues » rendrait le devis honnête au premier regard.
- **Pochette dépliable.** Cliquer une pochette pourrait déplier ses lots
  (état, tentatives, pièces) et ses fiches produites — aujourd'hui il faut
  passer par la section Productions et chercher le titre.

## 2. Efficacité du moteur

- **Pipeline au lieu de barrière.** Une vague est un `Promise.all` : le pas
  attend le lot LE PLUS LENT avant de relancer. Avec 3 lots de front dont un à
  15 min et deux à 3 min, deux emplacements dorment 12 min. Relancer un lot dès
  qu'un emplacement se libère (pool glissant borné par `front`) gagnerait de
  l'ordre de 20–30 % de débit nocturne sans toucher aux plafonds.
- **Un seul chantier travaille à la fois.** `chantierStep` prend le premier
  chantier autorisé (tri par `creeLe`) : deux chantiers actifs ne partagent
  jamais une vague. Avec la création en masse (archives), la file peut être
  longue — répartir le front entre chantiers actifs (ou au minimum offrir un
  champ `priorite` que le magistrat règle) éviterait qu'un gros dossier bloque
  tous les petits derrière lui.
- **Synthèse hiérarchique pour les très gros dossiers.**
  `SYNTHESE_BUDGET_CHARS = 300 000` réparti équitablement : à 97 fiches, ~3 000
  caractères par fiche — la synthèse finale lit des fiches amputées aux 2/3.
  Piste : une synthèse INTERMÉDIAIRE par pochette (déclenchée quand la pochette
  se termine, le moteur a déjà ce jalon), puis la synthèse finale lit les
  synthèses de pochettes. Même mécanique de runs bornés, aucun nouveau concept.
- **Chantier « complément » sur pièces nouvelles.** Un dossier déjà dépouillé
  qui reçoit un versement doit aujourd'hui être re-dépouillé en entier (le
  plan est figé au devis). Piste : à la création, comparer l'index des pièces
  aux pièces déjà couvertes par les fiches des chantiers terminés du même
  dossier, et ne planifier que le delta — le principe « chaque pièce n'est lue
  qu'une fois dans la vie du dossier » n'est aujourd'hui garanti qu'à
  L'INTÉRIEUR d'un chantier, pas entre chantiers successifs.

## 3. Performance (l'app ne doit pas payer pour le moteur)

- **Cache des résumés de chantiers.** `GET /chantiers` relit et DÉCHIFFRE tous
  les fichiers chantiers à chaque sondage (toutes les 20 s quand un chantier
  tourne) ; `chantierStep` refait la même chose à chaque tick. Avec des
  dizaines de chantiers (masse d'archives), c'est du déchiffrement pour rien.
  Un cache mémoire invalidé par mtime du fichier suffirait.
- **Empreintes sha256 hors du chemin du devis.** `ensureDocShas` (déchiffrer +
  hacher chaque pièce) est synchrone au moment du devis : sur un très gros
  dossier il bloque l'event loop du service plusieurs secondes (la route Next
  plafonne à 60 s). La création en masse le contourne en différant en
  arrière-plan, mais le vrai correctif est de calculer l'empreinte AU DÉPÔT de
  la pièce (une fois pour toutes) — le devis deviendrait instantané.
- **Pousser plutôt que sonder.** Le pas en cours est sondé (20 s). Un flux SSE
  (ou long-poll) réservé à l'atelier ouvert donnerait le « en ce moment » sans
  latence ni requêtes à vide — à ne faire que si le sondage devient réellement
  gênant.

## 4. Économie (jetons et forfait)

- **`budget.jetonsMax` par chantier — prévu, jamais implémenté.** La
  spécification (ANALYSE-PROFONDE.md) prévoit un plafond de jetons par
  chantier ; le moteur n'en connaît aucun. Avec le relevé réel par chantier
  (piste § 1), la coupe propre devient triviale : plafond atteint → pause +
  ligne de journal. C'est la ceinture de sécurité de la création en masse.
- **Ordre du prompt hostile au cache.** `consignes.prompt()` assemble
  ENTÊTE VARIABLE (dossier, pochette, lot) puis SOCLE STABLE puis données. Les
  caches de préfixe ne s'amorcent que sur un début STABLE : inverser (socle
  d'abord, entête et données ensuite) rendrait le socle des centaines de runs
  d'un même chantier cacheable. À vérifier contre le fonctionnement réel du
  cache côté CLI avant de retoucher tous les socles.
- **Quasi-doublons signalés au devis.** Le dédoublonnage actuel est STRICT
  (sha identique). `dossier.mjs` sait déjà regrouper les quasi-doublons
  (`groupesDoublons`) : les NOMMER dans le devis (« 12 paires de versions
  voisines — les deux seront lues ») aiderait le magistrat à écarter des
  pochettes entières avant de valider.
- **Modèle d'extraction réglable par chantier.** Les fiches partent sur le
  modèle des sous-agents (`cfg.subModel`) global. Pour des pochettes de PV
  standardisés, un cran plus économe suffit souvent ; l'option par chantier
  (défaut = réglage global) donnerait le levier sans toucher au panneau.

## 5. Programme (robustesse, enchaînements)

- **Chaînage liens/carto → dossiers manquants.** Un chantier « liens » écarte
  les dossiers `sansFiches` et affiche « lancez d'abord un chantier dossier
  en détail, puis recréez ce chantier ». La doc prévoit mieux : « ils
  déclenchent d'abord un chantier de type 1 ». Un bouton « créer les N devis
  manquants » (voire la re-création automatique du chantier liens quand les
  dépouillements finissent) fermerait la boucle sans recopier des numéros.
- **La masse survit mal à un redémarrage.** `masseEnCours` vit en mémoire : un
  redémarrage du service au milieu d'une création en masse perd le restant en
  silence. L'idempotence (dossiers déjà en chantier écartés) rend la relance
  sûre — mais il faudrait au minimum une note au fil (« masse interrompue à
  N/M — relancez ») au redémarrage, au mieux une reprise automatique.
- **Synthèse relançable seule.** Après 3 échecs, la synthèse est abandonnée et
  le chantier terminé ; le journal conseille de « supprimer/relancer le
  chantier ». Une action `relancer_synthese` (repasser `etat:'synthese'`,
  `syntheseEchecs:0`) coûterait dix lignes et éviterait de perdre le chantier.
- **Tests.** `chantier-puissance.test.mjs` couvre l'ordonnancement, les
  vagues, la pause/suppression et désormais la création en masse. Restent non
  couverts : le dédoublonnage strict au devis, l'écartement `sansFiches` des
  chantiers liens/carto, et la troncature équitable de la synthèse.

## Priorités proposées

1. **Relancer les lots en échec** (+ synthèse relançable) — débloque des
   pièces aujourd'hui perdues, effort minime.
2. **Jetons réels par chantier + plafond `jetonsMax`** — la gouvernance
   économique que la création en masse rend nécessaire.
3. **Cache des résumés** — le coût du sondage devient quadratique avec la
   masse d'archives ; à faire avant que le parc grossisse.
4. **Pipeline de vague** — le gain de débit nocturne le plus net.
5. **Synthèse hiérarchique** — la qualité du livrable final sur les dossiers
   qui justifient précisément l'outil.
