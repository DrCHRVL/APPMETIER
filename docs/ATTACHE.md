# Attaché de justice (IA)

Service intégré à SIRAL, réservé à l'**administrateur** — invisible de tout
autre utilisateur — sur **un seul TJ** et un contentieux de travail
(criminalité organisée par défaut). Il est propulsé par **Claude Code
connecté à l'abonnement Claude du magistrat** (pas de clé API, pas de
facturation à l'usage).

## Partage des rôles : on rédige et on interroge dans Claude web

**Rien ne se rédige dans l'application, et on n'y converse pas avec l'IA.**
Les actes (requêtes, prolongations, réquisitions, soit-transmis, réponses DML,
réquisitoires), les synthèses, les analyses transversales et les questions
sur les dossiers se font **dans Claude web**, branché sur SIRAL par le
[connecteur](CONNECTEUR-CLAUDE-WEB.md). L'acte rédigé reste dans la
conversation : il n'est jamais rangé dans SIRAL.

Dans l'application, l'IA n'écrit que dans **les zones de texte prévues** :
description du dossier, comptes rendus, mis en cause, NATINF, échéancier —
et dépose des **propositions ✓/✗** que le magistrat tranche.

L'attaché, lui, est un **analyste de fond**. Il n'a pas d'interface de
conversation : il tourne en arrière-plan ou à la demande d'un bouton, et seul
compte ce qu'il **dépose** dans SIRAL. Concrètement :

| Ce qu'il fait | Où on le voit |
|---|---|
| Lit chaque pièce versée et rédige un **CR** s'il y a du neuf (flux tendu) | fiche du dossier : bandeau d'état, CR, propositions |
| **Actualise la description** et détecte les **mis en cause** manquants | icônes « Actualiser » de la fiche |
| Enrichit la **cartographie** (« Enrichir », « Détecter les camps ») | panneau de revue de la carte (✓/✗) |
| Tient le **registre des pièces**, les **recoupements**, les **rapports de dossier** | lus par Claude web via le connecteur |
| **Apprend** de vos ✓/✗ et de vos leçons, **étudie** vos actes signés | Paramètres → Attaché IA (propositions de méthode, trames `modele-*`) |
| Exécute vos **routines** | propositions ✓/✗ |

Ce qui a été retiré, et ne reviendra pas par la petite porte : la page
« Assistant de justice », le fil « pendant votre absence », le panneau et les
bulles de chat, la boîte mail dédiée, l'atelier des « actes rédigés » (et ses
exports), le fichier global téléchargeable et le dossier de rédaction `.zip`,
le dépôt de pièces. Les outils correspondants du connecteur
(`remettre_livrable`, `signaler`, `poser_question`, `produire_document`,
`production_*`, `boite_*`, `depot_*`, `ranger_document`…) n'existent plus.

## Dans l'application

### Fiche dossier (administrateur)

- **Bandeau du flux tendu** : où en est l'attaché sur ce dossier — pièce en
  file (« analyse dans 40 s »), analyse en cours, puis le résultat réel
  (« Compte rendu rédigé », « Rien de neuf »). Il ne promet jamais un CR.
  Les **contrôles de cohérence des pièces versées** (numéro de procédure
  divergent, NATINF visés absents, dates incohérentes, maillon manquant de la
  chaîne légale) s'y affichent jusqu'au passage suivant.
- **Propositions ✓/✗** : mis en cause, actes, CR détectés. Rien n'est écrit
  avant le ✓. Le ✗ ouvre un champ « motif » facultatif — signal
  d'apprentissage.
- **Actualiser la description** : un run reprend toute la description depuis
  le dossier (CR, registre des pièces, mini-fiches) et la fait progresser,
  en deux parties en prise de notes — **SYNTHÈSE** (vision globale qui
  s'enrichit) et **MIS EN CAUSE** (personnes enregistrées + éléments à
  charge). Suivi en direct (étapes, temps restant). L'ancienne version est
  archivée.
- **Actualiser les mis en cause** (à côté du + de la section) : l'attaché
  relit CR, actes et documents et **propose** les noms manquants — victimes,
  témoins, enquêteurs, magistrats, avocats et simples alias écartés.
  Dédoublonnage au dépôt : nom déjà présent ⇒ rien ; nom très proche
  (orthographe voisine, ordre des mots, prénom en moins) ou connu d'une autre
  enquête ⇒ déposé **avec son avertissement**, le magistrat tranche.
- **Chronologie probatoire** : la frise fusionnée de tout ce qui est daté —
  actes, prolongations, attentes JLD, CR, apparition de mis en cause, DML
  archivées. On peut y coller l'**architecture NPP** d'un dossier
  d'instruction : les cotes datées rejoignent la frise.

### Cartographie (administrateur)

- **Enrichir** (fiche d'une personne) et **Détecter les camps** (légende des
  camps, gros amas ≥ 15 personnes) lancent une **analyse en arrière-plan** —
  une à la fois, sans fenêtre de chat. Un message dit le lancement, un autre
  la fin et le nombre de propositions déposées. Tout arrive dans le
  **panneau de revue** de la carte (bas-gauche) : liens de renseignement,
  personnes et dossiers ex nihilo, notes, camps. ✓ trace sur la carte (signé
  du nom du magistrat), ✗ refuse. Les notes du magistrat ne sont jamais
  réécrites : un enrichissement s'ajoute. Route
  `POST`/`GET /api/attache/analyse-carto` ; consigne « Cadrage des analyses
  de la carte ».

### Paramètres → Attaché IA

- **Diagnostic** (« pourquoi l'attaché apparaît — ou non ») et
  **interrupteur** « Masquer toutes les fonctionnalités » (voir plus bas).
- **Santé** du service, **clés** (remettre, renouveler, révoquer), **journal
  d'audit**.
- **Connexion Claude Code** : jeton d'abonnement, test.
- **Connecteur Claude web** : activation, URL à coller dans claude.ai,
  test de poignée de main, connexions OAuth (révocation un clic).
- **Cerveau** : modèle, effort, modèle des sous-agents, recherche web
  (décochée par défaut), **signature des comptes rendus**.
- **Consommation IA** : jauges du forfait, répartition par poste, derniers
  runs, mode économe (voir « Forfait »).
- **Apprentissage** : signaux en attente, progression mesurée, « Consolider
  maintenant », « Étudier mes actes maintenant ».
- **Propositions de méthode** : révisions de trames, skills et instructions
  du projet Claude web, avec diff ligne à ligne — ✓ Appliquer / ✗ Refuser.
- **Instructions du projet Claude web**, **Consignes permanentes**,
  **Rédaction des descriptions**, **Consignes par domaine**.
- **Skills**, **Bibliothèque de trames**, **Base de connaissances**,
  **Routines**.

## Ce qu'il fait en arrière-plan

### Flux tendu : le CR au versement d'une pièce

Une pièce versée, un CR rédigé, un acte ajouté — par vous ou par un collègue
— met le dossier en **file d'attente** (visible dans le moniteur d'activité).
Deux entrées : le **réveil** (l'app prévient le service dès l'écriture,
jamais une donnée, seulement « ce dossier a bougé ») et la **relève**
(signature déterministe à chaque tick, qui rattrape tout réveil manqué).
Après une période de calme (60 s, `SIRAL_ATTACHE_FLUX_QUIET_SEC` — une rafale
est fusionnée), **un dossier à la fois** passe le pipeline
(`scripts/attache/flux.mjs`), qui ne traite que le **neuf** :

1. **ingestion** de ses pièces nouvelles (texte, OCR au besoin, empreinte,
   entités — zéro jeton) ;
2. **mini-fiches** du registre (lots de 8, trois lots par passage au plus —
   le reste au passage suivant) ;
3. **analyse d'actes** des pièces des zones Actes / Geoloc / Écoutes / DML
   (un tour, sans outil) : actes détectés **proposés** ✓/✗ (dédoublonnés
   contre l'échéancier), contrôles de cohérence remontés au **bandeau** ;
4. **un run court et économe** (socle `flux` réglable) qui reçoit le neuf
   déjà digéré — fiches, CR et actes nouveaux, description, candidats mis en
   cause pré-calculés — et, dans l'ordre : **rédige UN CR** (`classer_note`,
   signature configurée) si le neuf apporte des faits absents ; ajoute les
   **NATINF** nouveaux ; **propose** les mis en cause manquants ;
   **actualise la description** ; acte une **prolongation** sans ambiguïté.
   Rien de neuf ⇒ rien d'écrit.

Le CR de l'attaché ne réveille pas le dossier. **Versement massif** (≥ 100
pièces, `SIRAL_ATTACHE_DESC_CHANTIER_SEUIL`) : pas de passage rapide, mais
une **analyse complète programmée** (`versement.mjs`) — chaque pièce fichée,
puis une synthèse (personnes et rôles, véhicules, lignes, adresses, comptes,
chronologie, points à vérifier) classée au dossier comme CR. De nuit de
préférence. Les étages 2 à 4 passent par le gouverneur de forfait (différés,
jamais perdus) ; l'ingestion tourne toujours.

### Registre, recherche, recoupements

- **Ingestion de fond** (zéro jeton) : à chaque tick, les dossiers dont
  l'index a bougé reçoivent empreinte sha256, extraction de texte (OCR
  compris pour les scans muets) et cache chiffré (`attache/doccache/`). Les
  originaux ne sont jamais modifiés. Un PDF n'est jamais ré-extrait ; un
  contenu identique octet à octet n'est lu qu'une fois.
- **Registre des pièces** : une entrée par pièce, en deux étages — entités
  déterministes (téléphones, plaques, IBAN, adresses : regex, zéro jeton) et
  **mini-fiche IA** (type, date, personnes, résumé de 2-3 lignes ; modèle
  économe, prompt réglable). Outils `registre_lire` et `registre_recouper`
  (entités présentes dans au moins deux dossiers, pièces citées de chaque
  côté).
- **Recherche plein texte** (`pieces_chercher`) : un dossier ou tout le fonds
  (enquêtes archivées, instructions, documents de la carte) ; ET, `OU`,
  `"expression exacte"`, casse et accents indifférents ; reprise au curseur.
  Zéro jeton.
- **Recoupements** : veille hebdomadaire de nuit, **calcul pur** (aucune IA),
  entre tous les dossiers et contentieux confiés ; pièces peut-être mal
  classées signalées (`pieces_mal_classees`). Voir
  [RECOUPEMENTS.md](RECOUPEMENTS.md).
- **Graphe de la carte calculé côté serveur** (`carto_analyser`,
  `carto_chemin`) : score d'importance identique à l'écran, centralité
  d'intermédiarité, communautés, plus courts chemins sourcés. Zéro jeton.

### Interrogation du fonds et rapports de dossier

- **Interrogation du fonds** (`interrogation.mjs`, outil `fonds_interroger`
  du connecteur) : une question large qui exige de sonder toutes les pièces
  d'un dossier ou du fonds. Chaque pièce rend un **verdict** (pertinente,
  score, justification, extraits verbatim) ; puis **contrôle d'élusion**
  (échantillon des pièces écartées relu, rappel estimé) et **synthèse**
  citant chaque pièce. Exécutée par lots, à chaque tick, sous le gouverneur
  de forfait. Résultat lu par **`interrogation_lire`** (synthèse et pièces
  retenues paginées) ; suivi par `interrogations_lister`, arrêt par
  `interrogation_arreter`. Modèles : Haiku pour les verdicts, Sonnet pour la
  synthèse, Opus seulement en `puissance:"renforcee"` (alias, jamais
  d'identifiant daté).
- **Rapports de dossier** (`rapport.mjs`, outil `rapport_lire`) : un rapport
  de synthèse par dossier (genèse, protagonistes, logistique, données
  matérielles, topographie des responsabilités à charge et à décharge,
  chronologie, lacunes, pièces clés — tout coté), bâti sur le registre ;
  un rapport par pochette pour les gros dossiers. Réécrit seulement quand le
  registre a bougé ; entretien de nuit.

### Apprentissage, étude du corpus, méthodes

C'est ce qui améliore la rédaction **dans Claude web** :

- **Signaux captés sans coût** (`attache/apprentissage.jsonl`, chiffré) :
  propositions ✓/✗ (avec le motif du ✗), leçons notées par `memoire_noter` —
  y compris depuis Claude web, quand le magistrat y reprend une rédaction.
- **Consolidation** périodique (run court, modèle économe, de nuit) :
  distille signaux et mémoire en règles générales sous un budget strict
  (`SIRAL_ATTACHE_MEMOIRE_BUDGET`, défaut 6 000 caractères), et **propose**
  les révisions de méthode qui s'en déduisent — trames, skills, et surtout
  les **instructions du projet Claude web** (`proposer_instructions_projet`).
  Déclencheurs : accumulation de signaux, signaux forts, mémoire au-dessus
  du budget, cadence (défaut 7 j) ; bouton « Consolider maintenant ».
- **Étude du corpus** : les pièces des zones **Actes** et **DML** sont des
  versions validées — vos actes signés et les ordonnances des JLD. Un run
  périodique les dépouille et en extrait des **gabarits par type d'acte** —
  trames `modele-*`, anonymisées — que Claude web lit par le connecteur. Vos
  propres trames priment toujours sur un `modele-*` du même type, et ne
  s'améliorent que par proposition ✓/✗. Déclenchement :
  `SIRAL_ATTACHE_ETUDE_SEUIL` nouveaux actes (défaut 5) ou
  `SIRAL_ATTACHE_ETUDE_JOURS` (défaut 30 j) ; bouton « Étudier mes actes
  maintenant ».
- **Propriété des méthodes, imposée dans le code** : skills `auto-*` et
  trames `modele-*` appartiennent à l'attaché (écrites librement,
  versionnées ; plafond `SIRAL_ATTACHE_AUTO_SKILLS_MAX`) ; les vôtres ne
  changent que par **proposition** (texte intégral, résumé, motif, diff dans
  « Propositions de méthode »).
- **Progression mesurée** (30 j face aux 30 j précédents) : taux
  d'acceptation des propositions, propositions refusées, leçons notées.

### Routines

Consignes récurrentes (quotidiennes à HH:MM ou toutes les N heures), gérées
dans Paramètres → Attaché IA ou depuis Claude web (`routine_lister`,
`routine_enregistrer`, `routine_suspendre`, `routine_supprimer`). Une routine
**ne converse pas** : elle dépose des **propositions ✓/✗** (et n'écrit
directement que si sa consigne le demande expressément). Exemple : « Chaque
nuit, cherche dans les pièces versées depuis la veille les liens de
renseignement absents de la carte et propose-les. » Plafond de durée
`SIRAL_ATTACHE_ROUTINE_TIMEOUT_MIN` (défaut 60 min ; 90 min pour une
routine qui balaie la cartographie). L'état de la dernière exécution
s'affiche dans la liste.

### Classements de la bibliothèque

« Classer » (trames, skills, base de connaissances) : une passe de
**description rapide** — un appel modèle par lot, sans sous-agent ; le
contenu n'est jamais modifié, seules la description, la catégorie et le
rangement le sont. Les descriptions apparaissent dans la liste.

## Ressources tenues dans SIRAL pour Claude web

Toutes chiffrées (clé globale) et versionnées ; lues par le connecteur.

- **Instructions du projet Claude web** : la version de référence des
  instructions du projet claude.ai où le magistrat rédige — éditable, bouton
  **Copier** ; Claude web la lit au début d'une rédaction
  (`instructions_projet_lire`), elle peut donc être plus récente que celle
  collée dans le projet. Les révisions proposées par la consolidation
  s'appliquent d'un ✓.
- **Trames** : plans-types d'actes, téléversables en masse (`.odt`, `.docx`,
  `.doc`, `.pdf`… convertis en markdown dans le navigateur).
- **Skills** : méthodes réutilisables, téléversables telles qu'exportées de
  Claude web (`.skill`) — skills prêtes à l'emploi dans
  [docs/skills-attache/](skills-attache/README.md).
- **Base de connaissances** : le fond durable du cabinet (jurisprudences,
  circulaires, fiches réflexes, contacts), versé par dossiers entiers,
  affiché comme un explorateur ; documents **réflexes ★** consultés en
  priorité. Recherche agentique (`kb_chercher`, `kb_lire`), pas d'index
  vectoriel. Un PDF scanné sans texte est signalé au téléversement : passez-le
  par l'OCR avant.
- **Mémoire de l'attaché** et **mémoire par dossier**
  (`memoire_dossier_lire` / `memoire_dossier_noter`) : courtes, plafonnées.

## Règles de conduite

- **Propose au lieu d'écrire quand il détecte** ; l'écriture directe est
  réservée à ce que sa consigne prévoit (flux, actualisation) ou à une
  instruction explicite du magistrat depuis Claude web.
- **NATINF** : les qualifications officielles d'un dossier sont ses codes
  NATINF enregistrés — Claude web les reprend dans chaque acte. L'attaché
  ajoute en autonomie ceux qu'une pièce mentionne et qui manquent
  (`ajouter_natinfs`, codes vérifiés contre le référentiel).
- **Aucune trace dans les données partagées** : CR et écritures signés du
  nom du magistrat (ou de la signature configurée), jamais « Attaché IA ».
  L'attribution réelle vit dans le journal d'audit chiffré.
- **Ni shell, ni fichiers** : uniquement les outils MCP SIRAL — et la
  recherche web si le magistrat l'active.
- **Consignes permanentes** (relues à chaque run) et **consignes par
  domaine** (description, mis en cause, flux, versement, registre,
  interrogation, rapport, cartographie) : socle lisible, complétable ou
  remplaçable ; une case vidée rend la tâche à son socle.

## Forfait et consommation

- Chaque run consigne ses jetons dans `attache/usage.jsonl` (des nombres,
  aucune donnée d'enquête). « Consommation IA » les traduit en **pourcentage
  du forfait** (fenêtre glissante de 5 h et 7 jours), par poste
  (descriptions, mis en cause, flux, analyses de la carte, routines,
  apprentissage, classements, sous-agents…), avec les derniers runs.
- **Gouverneur** : au-delà de 75 % de la fenêtre de 5 h, les lots de
  sous-agents passent en régime économe ; à 100 %, les runs de fond
  (routines, étude, consolidation, flux, versements, interrogations,
  rapports) sont **différés** — rien n'est perdu. Les demandes directes
  (actualisations, analyses de la carte) ne sont jamais mises en pause,
  seulement resserrées. L'état du bridage s'affiche dans « Consommation IA ».
  Seuils : `SIRAL_ATTACHE_BUDGET_SERRER_5H` / `_STOP_5H` / `_7J`.
- **Nuit** (`SIRAL_ATTACHE_NIGHT_START` / `_END`, défaut 22 h → 7 h) : étude,
  consolidation, rapports et versements massifs s'y tiennent ; les boutons
  forcent l'exécution à tout moment.
- **Mode économe** : modèle rapide et moins de tours pour les sous-agents et
  le run principal.

## Architecture et modèle de sécurité

```
 Navigateur admin (clés E2EE)      App Next (AUCUNE clé)         Service attaché (sidecar)
 ───────────────────────────      ─────────────────────         ─────────────────────────
 Paramètres → Attaché IA,   ◄──►  /api/attache/* (garde   ◄──►  API interne :8787
 fiche dossier, carte             admin+TJ, relais,              seul détenteur de la
 (déchiffre audit, trames,        lecture d'enveloppes)          clé-maître et du trousseau
 skills, base, propositions)                                       │
                                                                   ├─ CLI claude (abonnement)
 claude.ai (connecteur)     ◄──►  /api/mcp (OAuth admin)  ◄──►     ├─ serveur MCP (outils SIRAL)
                                                                   └─ tâches de fond (flux,
                                                                      registre, recoupements,
                                                                      routines, apprentissage…)
```

- **Trousseau de l'attaché** : l'admin, déverrouillé dans son navigateur,
  remet les clés brutes des **seuls périmètres confiés** (`global` +
  contentieux confiés) ; le service les enveloppe avec sa **clé-maître**
  (`SIRAL_ATTACHE_MASTER_KEY`, jamais dans le dépôt ni à côté des données).
  Toute clé hors périmètre est refusée. **Révoquer = un clic** : l'attaché
  est aveugle immédiatement, les données ne bougent pas.
- **Conséquence assumée** : pour les périmètres confiés — et eux seuls — le
  serveur de l'attaché peut déchiffrer, condition du travail de fond.
- **L'app web ne détient aucune clé de l'attaché** : elle relaie et sert des
  enveloppes chiffrées que le navigateur admin déchiffre.
- Les routes `/api/attache/*` répondent **404** à tout non-admin, tout autre
  TJ, ou si la fonctionnalité est désactivée — indistinguable d'une route
  inexistante.

## Installation (serveur, docker compose)

1. **`.env`** — section « ATTACHÉ DE JUSTICE » (voir `.env.exemple`) :

   ```bash
   SIRAL_ATTACHE_URL=http://attache:8787
   SIRAL_ATTACHE_MASTER_KEY=$(openssl rand -hex 32)   # ≠ SIRAL_SECRET
   SIRAL_ATTACHE_TJ=default
   SIRAL_ATTACHE_CONTENTIEUX=crimorg
   ```

2. **Démarrer** : `docker compose up -d --build attache siral`

3. **Connecter l'abonnement Claude** (une fois — état persistant dans le
   volume `claude-auth`) :

   ```bash
   docker compose exec -it attache claude
   ```

   Quand cette connexion expire, Paramètres → Attaché IA → **Connexion
   Claude Code** le dit (pastille rouge, motif, bouton *Tester*). Pour
   rebrancher sans toucher au serveur : `claude setup-token` sur une machine
   de confiance, puis coller le jeton `sk-ant-…` dans *Coller un jeton* — le
   service le chiffre avec sa clé-maître et l'injecte dans chaque run ;
   *Effacer* revient à la session du serveur.

4. **Remettre les clés** : connecté en admin sur le TJ confié → Paramètres →
   **Attaché IA** → *Remettre les clés*.

5. **Brancher Claude web** : même écran → **Connecteur Claude web** →
   activer, copier l'URL, l'ajouter dans claude.ai (connecteur personnalisé).
   Guide complet : **[CONNECTEUR-CLAUDE-WEB.md](CONNECTEUR-CLAUDE-WEB.md)**.

## « Je ne vois plus l'attaché »

Ce qui relève de l'attaché dans l'app (icônes d'actualisation, bandeau,
propositions, boutons de la carte, onglet de paramètres) est commandé par
une sonde : `GET /api/attache/status?sonde=1`.

| Réponse | Sens | Ce que fait l'app |
|---|---|---|
| `200` | service vivant | fonctionnalités visibles |
| `404` | fonctionnalité absente **pour ce compte** : non-admin, `SIRAL_ATTACHE_URL` vide, ou TJ actif ≠ `SIRAL_ATTACHE_TJ` | invisible (voulu) |
| `401` | secret de pont dépareillé entre l'app et le service | visible ; les actions disent l'erreur |
| `503` | conteneur `attache` arrêté, en redémarrage, ou saturé | visible ; les actions disent l'erreur |

Hors `404`, la sonde se relance toutes les 60 s pour se raccrocher seule.
Sur le serveur :

```bash
docker compose ps attache
docker compose logs --tail=50 attache
docker compose up -d attache
```

Trois causes reviennent : le conteneur arrêté (ou en boucle de redémarrage),
un `SIRAL_SECRET` changé d'un côté seulement (app et service doivent
redémarrer ENSEMBLE), et le TJ actif qui n'est pas le TJ confié.

**Paramètres → Attaché IA** est TOUJOURS offert à l'administrateur : il
coche ou barre les quatre conditions (fonctionnalité activée, tribunal
confié, secret de pont, service joignable), via `GET
/api/attache/diagnostic` (administrateur seul, 404 sinon).

## Masquer toutes les fonctionnalités IA

En tête de Paramètres → Attaché IA, l'interrupteur **« Masquer toutes les
fonctionnalités »** retire de l'interface les icônes d'actualisation, le
bandeau, les propositions et la chronologie des fiches dossier, les
propositions de renseignement et les boutons « Enrichir » / « Détecter les
camps » de la cartographie. L'onglet des paramètres reste (c'est de là qu'on
décoche). Le drapeau est tenu par l'app (`GET`/`PUT
/api/attache/visibilite`, par TJ) et vaut sur tous les appareils.

Masquer n'est pas révoquer : le service continue son travail de fond.

## Révocation & réversibilité

| Geste | Effet |
|---|---|
| Paramètres → Attaché IA → **Révoquer** | l'attaché ne déchiffre plus rien, immédiatement |
| Changer `SIRAL_ATTACHE_MASTER_KEY` | trousseau illisible = révoqué de fait |
| Vider `SIRAL_ATTACHE_URL` | fonctionnalité totalement absente de l'app |
| **Masquer toutes les fonctionnalités** | disparaît de l'interface, continue de travailler |
| Annuler une écriture | Sauvegardes → versions du coffre (chaque écriture archive la précédente) |
| Voir tout ce qu'il a fait | Paramètres → Attaché IA → **Journal d'audit** |

## Développement sans docker

```bash
SIRAL_DATA_DIR=./srv-data SIRAL_SECRET=dev \
SIRAL_ATTACHE_MASTER_KEY=$(openssl rand -hex 32) \
node scripts/attache-service.mjs          # service sur :8787

SIRAL_ATTACHE_URL=http://localhost:8787 npm run dev
```

Le CLI `claude` doit être installé (`npm i -g @anthropic-ai/claude-code`) et
connecté (`claude login`) sur la machine qui exécute le service — ou
recevoir un jeton d'abonnement (`CLAUDE_CODE_OAUTH_TOKEN`, ou saisi dans
Paramètres → Attaché IA → Connexion Claude Code).

Tests du service : `node --test scripts/*.test.mjs` (dont
`connecteur-mcp.test.mjs` pour le connecteur, `attache-flux.test.mjs` pour
le flux tendu).
