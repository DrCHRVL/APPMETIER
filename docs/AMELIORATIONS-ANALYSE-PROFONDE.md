# Analyses profondes — pistes d'amélioration

*Revue du module (moteur `scripts/attache/chantier.mjs` + `ordonnancement.mjs`,
service `attache-service.mjs`, interface `components/attache/*`), août 2026.
Chaque piste est vérifiée contre le code. Statut : ✅ fait · ⏸ écarté (avec la
raison). Les ✅ sont couverts par `scripts/chantier-puissance.test.mjs`.*

## 1. Aller dans le détail (lisibilité pour le magistrat)

- ✅ **Relancer les lots en échec.** Après 3 tentatives, un lot passait en
  `echec` définitif : ses pièces ne seraient jamais dépouillées sauf à
  supprimer et recréer tout le chantier. L'action `relancer_echecs` (bandeau
  rouge dans l'atelier) remet les seuls lots en échec à faire, tentatives à
  zéro.
- ✅ **Jetons réels vs devis.** Chaque run rend son bilan de jetons
  (`runAgent` → `usage`) ; le chantier les cumule (`ch.jetons`) et l'atelier
  affiche « Jetons consommés : X » à côté de l'estimation — le devis se
  confronte au réel.
- ✅ **Durée restante calibrée sur le réel.** Le moteur mesure le rythme
  observé (`ch.rythme`, minutes par lot abouti) ; l'atelier affiche
  « ≈ X h restantes (rythme observé) » au lieu des 3 min/lot théoriques.
- ✅ **Journal complet sur demande.** `GET /chantiers/detail?id=` sert le
  journal entier (le sondage n'en porte que les 12 dernières lignes) ; bouton
  « Tout le journal » dans l'atelier.
- ✅ **Doublons exclus affichés au devis.** Le bloc devis dit désormais
  « N pièces déposées — M copie(s) exacte(s) non relue(s) · K pièce(s) déjà
  couverte(s) par un chantier précédent ».
- ✅ **Pochette dépliable.** Chaque pochette se déplie lot par lot (état,
  tentatives, échecs) — le détail se charge au premier clic, jamais dans le
  sondage.

## 2. Efficacité du moteur

- ✅ **Vague glissante au lieu de barrière.** L'ancien `Promise.all` attendait
  le lot le plus lent avant de relancer. Chaque emplacement reprend désormais
  un lot dès qu'il se libère, borné à front × 2 lots par pas — le feu (nuit,
  forfait) est re-vérifié à chaque prise, un lot déjà tenté dans le pas n'y
  repart pas, et un refus de quota arrête la vague.
- ✅ **Équité entre chantiers.** Le pas choisit le chantier travaillé le moins
  récemment (`dernierPasLe`), plus le plus ancien : une masse d'archives ne
  reste plus indéfiniment derrière un gros dossier.
- ✅ **Synthèse hiérarchique.** Quand le corpus de fiches déborde le budget
  (300 k caractères), chaque grosse pochette (> 60 k) reçoit d'abord SA
  synthèse (un run borné par pas, échec 3 fois → repli sur fiches tronquées),
  puis la note finale lit les synthèses de pochettes et les fiches des petites
  pochettes — du texte entier, jamais des moignons.
- ✅ **Chantier « complément ».** À la création, les pièces déjà couvertes par
  un lot FAIT d'un chantier existant du même dossier sont écartées du plan :
  un dossier qui reçoit un versement ne relit que le delta. « Relire les
  pièces déjà couvertes » (case du formulaire) force la relecture complète.
  Limite assumée : la couverture se lit dans les plans des chantiers — un
  chantier supprimé perd sa couverture (ses fiches restent, mais le lien
  pièce → fiche part avec le plan).

## 3. Performance (l'app ne doit pas payer pour le moteur)

- ✅ **Cache des chantiers déchiffrés.** `GET /chantiers`, le tick et
  `chantierActif` passent par un cache mémoire invalidé par mtime + taille du
  fichier ; toute écriture ou suppression invalide l'entrée. Plus de
  déchiffrement intégral toutes les 20 s.
- ⏸ **Empreintes sha256 au dépôt.** Le vrai correctif (hacher au versement de
  la pièce) touche le chemin de téléversement partagé avec le client E2EE —
  hors du périmètre de ce module. Atténué : la création en masse et la reprise
  diffèrent ce travail en arrière-plan, et `ensureDocShas` reste incrémental
  (une pièce n'est hachée qu'une fois).
- ⏸ **SSE au lieu du sondage.** Le sondage passe à 20 s quand un chantier
  tourne et le détail se charge à la demande : le coût restant ne justifie pas
  encore un canal serveur → client dédié (la doc le disait déjà : « à ne faire
  que si le sondage devient réellement gênant »).

## 4. Économie (jetons et forfait)

- ✅ **Plafond `budgetJetons` par chantier.** Posable au devis (champ
  « Plafond de jetons », ex. « 2M ») ; atteint, le chantier se met en PAUSE
  proprement (journal explicite) — la synthèse, elle, va au bout. C'est la
  ceinture de sécurité de la création en masse (le plafond se propage à
  chaque chantier créé).
- ⏸ **Ordre du prompt et cache de préfixe.** `consignes.prompt()` met l'entête
  variable avant le socle stable. Inverser toucherait TOUS les socles (le
  magistrat les édite depuis Paramètres) et le gain réel dépend du
  fonctionnement du cache côté CLI — à vérifier avant de retoucher, comme le
  disait la première version de ce document.
- ⏸ **Quasi-doublons au devis.** `groupesDoublons` (dossier.mjs) regroupe les
  doublons EXACTS — déjà écartés par le devis. Détecter des versions
  « voisines » demanderait une vraie similarité de contenu : rien d'existant à
  brancher, non retenu.
- ✅ **Modèle d'extraction réglable par chantier.** Case « Extraction sur le
  modèle principal » au formulaire (`modeleFiches`) ; défaut inchangé : le
  modèle des sous-agents.

## 5. Programme (robustesse, enchaînements)

- ✅ **Chaînage liens/carto → dossiers manquants.** Le bandeau « écartés faute
  de fiches » porte un bouton « Établir les N devis manquants » : un devis
  « dossier en détail » par manquant, sans recopier les numéros.
- ✅ **La masse survit au redémarrage.** L'avancement est persisté
  (`chantiers/.masse.json`) ; au premier tick après un redémarrage,
  `reprendreMasse` relance le restant (les dossiers déjà créés sont écartés —
  rejeu sans doublon) et le bilan au fil le mentionne.
- ✅ **Synthèse relançable seule.** Action `relancer_synthese` (bandeau dans
  l'atelier sur un chantier terminé sans note) : `etat: synthese`, compteur à
  zéro — plus besoin de recréer le chantier.
- ✅ **Tests.** `chantier-puissance.test.mjs` couvre désormais aussi : la
  création en masse (portée, idempotence, arrière-plan), la vague glissante,
  les deux relances, le comptage des jetons réels, le plafond, et le
  complément (pièces déjà couvertes / « relire » / delta sur pièce nouvelle).
