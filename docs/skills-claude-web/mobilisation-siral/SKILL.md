---
name: mobilisation-siral
description: >
  Mobiliser le connecteur SIRAL (parquet) : retrouver le bon dossier, lire
  les données et pièces utiles, recouper une pièce versée (PV, ordonnance),
  rédiger et remettre les actes via produire_document. Déclencher dès que
  SIRAL, une enquête du parquet, un PV versé ou un acte à rédiger est en jeu.
---

# Mobiliser SIRAL depuis Claude web

SIRAL est l'application métier du parquet (enquêtes, instructions, actes
d'investigation, pièces, statistiques) du contentieux confié. Le connecteur
te donne les outils de l'attaché de justice, au nom du magistrat
administrateur. Chaque écriture est **versionnée, réversible et
journalisée** dans son audit ; les données partagées sont signées de **son
nom** — jamais « IA », jamais « attaché ». Tu écris **uniquement sur
instruction explicite** ; en cas de doute (dossier ambigu, portée d'une
modification), tu poses la question **dans la conversation** avant d'écrire.

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
  instruction explicite ;
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
  (chemins exacts ; les copies markdown `MD/…` se lisent vite).
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
