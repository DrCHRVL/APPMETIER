---
name: mobilisation-siral
description: >
  Mobiliser le connecteur SIRAL (parquet) : trouver le bon dossier, lire
  données et pièces, recouper une pièce versée (PV), rédiger et remettre
  les actes (produire_document). Consignes permanentes (écritures directes)
  et balayages par lots. Déclencher dès que SIRAL, une enquête ou un acte
  est en jeu.
---

# Mobiliser SIRAL depuis Claude web

SIRAL est l'application métier du parquet (enquêtes, instructions, actes
d'investigation, pièces, statistiques) du contentieux confié. Le connecteur
te donne les outils de l'attaché de justice, au nom du magistrat
administrateur. Chaque écriture est **versionnée, réversible et
journalisée** dans son audit ; les données partagées sont signées de **son
nom** — jamais « IA », jamais « attaché ». Tu écris **uniquement sur
instruction du magistrat** — ponctuelle, ou permanente (voir « Régimes
d'écriture ») ; en cas de doute (dossier ambigu, portée d'une consigne),
tu poses la question **dans la conversation** avant d'écrire.

## Étape 1 — Identifier le dossier (toujours en premier)

Indices à chercher dans la demande et dans toute pièce versée : numéro
SIRAL (`2026/000123 - ALIAS`), numéro de parquet (`85103/843/2026`), numéro
IDJ, numéro d'instruction, noms des mis en cause, ligne téléphonique ou
plaque visée, alias du réseau.

1. `lister_dossiers` (ajouter `archives:true` si introuvable) — enquêtes du
   contentieux ; `instru_lister` — dossiers d'instruction (DML, débats JLD).
2. Rapprochement **tolérant** (casse, accents, fragments de numéro), mais
   jamais hasardeux : deux candidats plausibles → cite-les et demande.
3. `lire_dossier` en **aperçu d'abord** (défaut) — jamais `section:
   "complet"` sur un gros dossier. Puis, selon le besoin :
   - `section: "fiche"` + `cible` : tout ce qui concerne UNE personne, une
     ligne, un acte (l'outil pour retrouver un propriétaire, une échéance) ;
   - `section: "cr"` + `offset`/`limit` : comptes-rendus intégraux paginés
     (les index `[#i]` viennent de l'aperçu) ;
   - `"actes"`, `"mec"`, `"documents"` : la section seule.
4. `memoire_dossier_lire` : décisions et orientations déjà actées par le
   magistrat sur ce dossier — à relire avant de rédiger.

## Étape 2 — Exploiter une pièce versée dans la conversation (PV, ordonnance…)

La pièce versée dans Claude web se lit **nativement** (elle est dans la
conversation, PAS dans SIRAL). En extraire systématiquement : numéro de
procédure, personnes citées, lignes/IMEI/plaques, dates, actes évoqués ou
autorisés, qualifications (NATINF). Puis **confronter au dossier** :

- **numéro de procédure divergent** de la fiche → le signaler (pièce du
  mauvais dossier ?) avant toute exploitation ;
- **noms nouveaux** → `recouper_personnes` (homonymes, alias inter-dossiers)
  puis `proposer_mec` (bandeau ✓/✗) — `ajouter_mec` seulement sur
  instruction, ponctuelle ou permanente (voir « Régimes d'écriture ») ;
- **NATINF visés absents de la fiche** → `natinf_chercher` pour valider les
  codes puis `ajouter_natinfs` (écriture autonome permise, citer la pièce
  source) ;
- **mesure évoquée** (autorisation signée, pose, refus, fin) → sur
  instruction, `enregistrer_acte` / `modifier_acte` (transitions :
  `autorisation_accordee`, `pose`, `refus_jld`, `pose_avortee`, `terminer`,
  `champs`) ; sinon `proposer_acte`.

**Limite à dire au magistrat** : le connecteur ne peut PAS enregistrer le
fichier lui-même dans les documents du dossier. S'il veut conserver la pièce
dans SIRAL : téléversement dans l'app (zone PV/Actes/DML du détail
d'enquête) ou transfert à la boîte mail de l'attaché. Sur demande, tu peux
en attendant classer un **CR de réception** (`classer_note`, synthèse texte
de la pièce) — visible dans les comptes-rendus et la chronologie.

## Étape 3 — Mobiliser les données utiles à la rédaction

- `chronologie_lire` : la trame factuelle datée (actes, prolongations,
  attentes JLD, CR, DML, cotes NPP) — socle de toute motivation.
- `dossier_arborescence` puis `lire_document` : les pièces déjà téléversées
  (chemins exacts ; les copies markdown `MD/…` se lisent vite). Dossier
  volumineux (plusieurs procédures versées en arborescence, milliers de
  pièces) : partir du panorama `pochettes` de la réponse, dépouiller pochette
  par pochette (`pochette:"PV/Nom"`, puis `offset`/`offsetSuivant` pour
  paginer — l'offset se compte DANS le périmètre filtré : à chaque changement
  de pochette, repartir à `offset:0`). Une pièce longue se lit de même en
  plusieurs pages : tant que `lire_document` renvoie `offsetSuivant`, la
  suite existe — la relire avec `offset` avant de conclure quoi que ce soit.
- **Pages images** : si le texte servi contient des marqueurs
  `[page N : image sans couche texte]` (annexes en captures d'écran,
  planches photo, tapissages — souvent le cœur probatoire), relire la pièce
  avec `integrale:true` : l'original est relu avec OCR de ces pages
  (première lecture lente, ~30 pages OCR max par pièce, en cache ensuite).
  Ne JAMAIS conclure sur une pièce dont des pages restent marquées sans
  avoir tenté cette lecture intégrale.
- **Dépouillement massif** (plusieurs centaines de pièces) : déléguer avec
  `sous_agents` — un sous-agent par pochette/procédure, chacun rendant sa
  fiche (chronologie, déclarations verbatim, contradictions, cotes) — et
  consigner chaque fiche dans la mémoire du dossier
  (`memoire_dossier_noter`) pour que rien ne se perde entre les passes.
- `productions_lister` / `production_lire` : les actes déjà rédigés —
  cohérence des motivations, reprise des formules validées, pas de doublon.
- `verifier_completude` / `diagnostic_dossier` : échéances, actes expirants,
  attentes JLD, incohérences — à vérifier avant une prolongation.
- `lister_dml` et `instru_lister` pour tout ce qui touche une DML (réponse
  précédente archivée dans la zone « Archive DML » du dossier).
- `kb_chercher` / `kb_lire` : base de connaissances du cabinet — consulter
  par réflexe les documents ★ (Memento parquet…) dès que le sujet peut y
  toucher ; `skills_lister` / `skill_lire` si une méthode maison correspond.
- `stats_synthese` / `stats_graphique` pour tout chiffre d'activité —
  jamais d'estimation.

## Étape 4 — Rédiger et remettre l'acte DANS SIRAL

1. `associations_lister` d'abord : si le type d'acte y figure, appliquer
   d'office la trame et la skill associées. Sinon `trames_lister` puis
   `trame_lire` — la trame du magistrat **prime toujours** sur un
   `modele-*`.
2. **NATINF** : reprendre obligatoirement les qualifications ENREGISTRÉES du
   dossier (section « Infractions (NATINF) » de `lire_dossier`) ; s'il en
   manque une que la pièce fonde, `ajouter_natinfs` d'abord.
3. Rédaction **complète, prête à signer**, en texte brut (jamais de HTML),
   paragraphes séparés par des lignes vides, dates et cibles exactes tirées
   du dossier. Ce qui attend une confirmation du magistrat : `[À CONFIRMER]`
   (jamais `[À COMPLÉTER]`, `TODO` ni un acte squelettique — les portes de
   qualité rejettent l'écriture ; corriger et re-soumettre aussitôt).
4. Remise par `produire_document` : `numero`, `type`, titre daté explicite,
   `source` = nom EXACT de la trame suivie, `objet` = ligne interceptée ou
   objet géolocalisé s'il y a lieu, et `acteMeta` pour toute
   écoute/géolocalisation (`kind`, `cible`/`objet`, `duree`,
   `pendingJld:true` tant que le JLD n'a pas statué). Pour retoucher un acte
   existant : reprendre son `id` (`productions_lister`).
   L'acte apparaît dans « Actes rédigés » du dossier : relecture, édition,
   export PDF/Word officiel, validation — c'est LA livraison ; un texte
   seulement collé dans la conversation n'est pas une remise.
5. Synthèse, note, projet de mail au directeur d'enquête → `remettre_livrable`
   (fil « pendant votre absence », bouton Copier). `terminer_todo` si le
   travail accompli règle un à-faire du dossier.

## Régimes d'écriture — proposition (défaut) ou direct (consigne permanente)

Par défaut, une **détection** (nom nouveau, élément absent de la fiche,
mesure évoquée dans une pièce) devient une **proposition** ✓/✗
(`proposer_mec`, `proposer_cr`, `proposer_acte`) : rien n'entre au dossier
sans validation du magistrat.

Le magistrat peut basculer en **régime direct** par une consigne
permanente — donnée dans la conversation ou dans les instructions d'un
projet Claude web dédié. Reconnais-la aux formules : « consigne
permanente », « sans me demander », « directement », « systématiquement »,
« à chaque fois ». Le régime direct s'applique alors, dans le périmètre
exact de la consigne :

- CR de réception ou de synthèse → `classer_note` directement (titre daté,
  prise de notes dense) ;
- mis en cause identifiés → `recouper_personnes` PUIS `ajouter_mec`
  (l'outil refuse les doublons ; statut par défaut « actif ») ;
- NATINF fondés par une pièce → `ajouter_natinfs` (autonome de toute façon) ;
- échéancier → `enregistrer_acte` / `modifier_acte` seulement si la
  consigne couvre EXPLICITEMENT ce type de transition (« quand une
  ordonnance montre que le JLD a signé, acte-le »).

Bornes du régime direct, non négociables :

- la consigne vaut ce qu'elle dit — n'étends JAMAIS son périmètre par
  analogie ; tout ce qui déborde retourne au régime des propositions ;
- `creer_dossier` et `archiver_dossier` restent au cas par cas (demande
  expresse visant CE dossier) ;
- doute sur la portée de la consigne → question AVANT d'écrire ;
- chaque réponse **récapitule** tout ce qui a été écrit en direct (dossier,
  outil, contenu en une ligne) : le magistrat doit pouvoir tout survoler —
  et tout annuler (chaque écriture est versionnée, l'audit trace tout).

## Travaux au long cours — balayages par lots

Pour une tâche de masse (« mets à jour la description de chaque enquête »,
« contrôle la complétude de tout le stock », « sonde les liens sur tous les
dossiers ») : la fenêtre de contexte est finie — travaille **en lots**,
avec un **état de reprise**.

1. **Le plan d'abord** : `lister_dossiers` (+ `archives:true` si la demande
   les couvre) → affiche la liste numérotée dans la conversation (c'est le
   plan de travail) et annonce la taille des lots : 5 à 10 dossiers.
2. **Un lot à la fois** : pour chaque dossier, lectures MINIMALES
   nécessaires (aperçu, sections ciblées — jamais « complet ») →
   l'écriture demandée (ex. `actualiser_description` au format SYNTHÈSE /
   MIS EN CAUSE) → dossier suivant. Fin de lot : point d'étape court
   (traités / restants) et proposer de continuer. N'entame pas un lot que
   tu ne peux pas finir proprement.
3. **État de reprise** : la conversation peut s'arrêter à tout moment. En
   fin de session (ou tous les 2-3 lots), dépose l'état par
   `remettre_livrable` SANS `numero` — sujet « État du balayage <tâche> »,
   corps : dossiers traités, restants, consignes particulières données en
   route. Il se range dans « Actes rédigés — hors dossier ». À la reprise
   dans une NOUVELLE conversation : `productions_lister` sur
   `_hors-dossier` puis `production_lire` → reprendre exactement où on en
   était ; mettre l'état à jour (même `id`) au fil du balayage, et le
   supprimer (`production_supprimer`, réversible) une fois le balayage
   terminé. Si l'état manque, demande au magistrat de coller le dernier
   point d'étape.
4. **Jamais de qualité dégradée pour finir** : mieux vaut un lot de moins
   que des écritures bâclées. Conversation devenue lourde → clore le lot en
   cours, déposer l'état, inviter à rouvrir une conversation.
5. **Le vraiment massif ou récurrent se délègue** : pour un balayage
   exhaustif ou régulier (cartographie du corpus entier, revue
   hebdomadaire), propose d'enregistrer une **routine de nuit de
   l'attaché** (`routine_enregistrer` : prompt autonome et précis, heure de
   nuit type 22:30) — elle tournera côté serveur, sans limite de fenêtre de
   conversation. Le connecteur garde le pilotage et les sondages ciblés.

Cartographie par lots : traite les dossiers par groupes, croise avec
`recouper_personnes` et `carto_rapprochements`, et dépose les propositions
(`proposer_lien`, `proposer_mec_carto`, `proposer_dossier_carto`) **au fil
de l'eau** — elles survivent à la conversation dans le module de revue de
la cartographie, où le magistrat valide ✓/✗ à son rythme.

## Discipline permanente

- Jamais de suppression (dossier, acte, CR, mis en cause) : impossible par
  le connecteur — proposer l'équivalent réversible (archiver, terminer,
  corriger) et, au besoin, le geste manuel dans l'app.
- Économie : aperçus puis sections ciblées ; pagination des CR ; ne jamais
  relire une pièce déjà lue dans la conversation.
- Fin de réponse : **récapituler** ce qui a été écrit dans SIRAL (dossier,
  outil, identifiants), ce qui reste `[À CONFIRMER]`, et ce que le magistrat
  doit faire lui-même (valider l'acte, téléverser la pièce, geste manuel).

## Exemple type — « je verse un PV, rédige la prolongation »

1. Lire le PV versé → n° de procédure, ligne visée, éléments nouveaux.
2. `lister_dossiers` → dossier correspondant ; `lire_dossier` (aperçu) →
   acte d'écoute concerné (id, échéance), NATINF, mis en cause.
3. `chronologie_lire` + `production_lire` de la requête initiale +
   `verifier_completude` → durée déjà écoulée, chaîne d'autorisations.
4. `associations_lister` / `trame_lire` de la trame de prolongation ;
   `kb_lire` du Memento si utile.
5. Rédiger la demande de prolongation motivée (éléments nouveaux du PV
   cités), puis `produire_document` avec `acteMeta` et `source` = trame.
6. Proposer dans la même réponse : `acter_prolongation` (mode `demande`)
   pour l'échéancier, `ajouter_natinfs` si le PV en révèle, CR de réception
   (`classer_note`) — et rappeler que le PV lui-même reste à téléverser
   dans l'app s'il doit rejoindre le dossier.
