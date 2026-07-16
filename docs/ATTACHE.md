# Attaché de justice (IA)

Assistant intégré à SIRAL, réservé à l'**administrateur** — invisible de tout
autre utilisateur — sur **un seul TJ** et **un seul contentieux** (criminalité
organisée par défaut). Il est propulsé par **Claude Code connecté à
l'abonnement Claude du magistrat** (pas de clé API, pas de facturation à
l'usage).

## Ce qu'il fait

- **Lit tout** le contentieux confié : dossiers, actes, comptes-rendus,
  documents PDF déposés — et répond aux questions sur un dossier.
- **Agit dans SIRAL** : enregistre un acte, acte une prolongation (demande ou
  validée), classe une note en CR « Attaché IA », ajoute des à-faire, vérifie
  la complétude (actes expirant, attentes JLD, CR anciens, pièces manquantes).
  Chaque écriture est **versionnée** (archivage avant écrasement — annulable),
  et **journalisée** dans un audit chiffré visible du seul administrateur.
- **Anticipe** : la boîte mail dédiée est relevée toutes les 5 min ; chaque
  message transféré par le magistrat (le corps du transfert vaut consigne)
  déclenche un traitement autonome — qualification (DML, demande d'actes TSE,
  réponse JLD, notification d'instruction…), rapprochement avec le dossier,
  actions, synthèses, projets — dont le résultat s'affiche dans le fil
  « Pendant votre absence » du panneau.
- **Ne sort JAMAIS du système** : plus aucun mail sortant (les réponses vers
  les boîtes professionnelles étaient rejetées — réputation de domaine). Les
  **livrables** se remettent DANS SIRAL : carte « Livrable 📦 » du fil
  « pendant votre absence » (texte intégral + bouton Copier, outil
  `remettre_livrable`) et actes dans l'atelier « Actes rédigés ». Le widget
  **Boîte de l'attaché** du tableau de bord (admin seul, sous le calendrier)
  montre chaque message reçu et son avancement — **reçu → en cours →
  traité** (avec résumé), toasts à chaque transition : on vérifie d'un coup
  d'œil que rien ne se perd.
- **Dossier complet (module instruction)** : le magistrat verse tout ou
  partie du dossier réel dans la fiche d'instruction — sélection d'un
  dossier entier ou glisser-déposer, **sous-pochettes comprises**
  (l'arborescence d'origine est préservée : D - Fond, E - Personnalité…).
  Chaque pièce est **convertie en markdown dans le navigateur au passage**
  puis chiffrée : ici seul le TEXTE est conservé (les originaux signés
  vivent dans l'Archive DML et les zones documents) — place serveur et
  tokens réduits d'autant. Arbre repliable, aperçu d'une pièce, suppression
  par pièce ou par pochette. L'attaché dépouille : `dossier_arborescence`
  (table des matières), lecture ciblée (`lire_document`), et sous-agents
  par pochette pour les synthèses massives — chaque affirmation cite la
  pièce.
- **Reçoit et range les pièces (majordome)** : le magistrat lui CONFIE un
  document sans décider où il va — trombone / glisser-déposer dans le
  panneau, ou pièce jointe d'un mail transféré. L'attaché l'identifie
  (lecture du contenu au dépôt si besoin), retrouve le **bon dossier**
  (enquête ou instruction), choisit la **bonne zone** (audition → PV,
  ordonnance → Actes, DML → DML, rapport géoloc → Geoloc, retranscription
  → Ecoutes), le **nomme proprement** (daté, explicite) et le range — la
  pièce apparaît dans la fiche du dossier, intacte et chiffrée, signée du
  nom du magistrat. Puis il l'**exploite** : lecture, détections →
  propositions, intégration au travail en cours (ex. l'audition attendue
  pour une réponse DML). Doute → question dans SIRAL ; pièce non
  pertinente → corbeille du dépôt (jamais détruite). Le brief quotidien
  vérifie qu'aucune pièce ne dort au dépôt.
- **Pose ses questions DANS SIRAL — jamais par mail** : quand une
  information lui manque (un acte récent dans NPP, une orientation à
  trancher), l'attaché publie une carte **« Question ❓ »** dans le fil
  « pendant votre absence », avec **zone de réponse intégrée**. La réponse
  du magistrat reprend **la conversation d'origine du run** (l'attaché
  garde tout son contexte et poursuit : révision de l'acte, retrait des
  [À CONFIRMER]…). Boutons Répondre / Ignorer, statut persistant. Une seule
  entrée (mail transféré ou chat), puis tout se passe dans l'application.
- **Retient** : une mémoire markdown (préférences, réflexes appris) relue à
  chaque intervention — lisible, corrigeable et effaçable depuis le panneau.
- **Se règle comme Claude web** : choix du **modèle** (Fable 5, Opus 4.8,
  Sonnet 5, Haiku 4.5 — ou le défaut de l'abonnement) et du **niveau
  d'effort** de raisonnement (faible → maximal), depuis le composer du chat
  ou Paramètres → Attaché IA (section « Cerveau »). Le réglage est persisté
  et vaut pour TOUS les runs : chat, mails transférés, brief, routines.
  S'y règle aussi le **modèle des sous-agents** (un modèle rapide — Sonnet,
  Haiku — suffit souvent pour les lots).
- **Travaille en parallèle (sous-agents)** : pour un lot de sous-tâches
  indépendantes — analyser les 20 PDF d'un dossier, balayer chaque dossier
  du brief quotidien, évaluer un lot de trames — l'attaché délègue à des
  **sous-agents Claude exécutés en parallèle** (outil `sous_agents`, 24
  tâches max, concurrence bornée, timeout par tâche : un document illisible
  ne bloque pas le lot). Garde-fous : les sous-agents sont en **lecture
  seule** (aucun outil d'écriture, pas de mail, pas de sous-agents
  imbriqués) — seul l'agent principal écrit, propose et signale, et chaque
  lot est journalisé dans l'audit. Réglages : concurrence
  `SIRAL_ATTACHE_SUBAGENT_CONCURRENCY` (défaut 3), timeout
  `SIRAL_ATTACHE_SUBAGENT_TIMEOUT_MIN` (défaut 8 min).
- **Ne ré-extrait jamais deux fois un PDF** : les documents déposés au
  dossier sont des **originaux** (souvent signés numériquement) — ils ne
  sont JAMAIS modifiés ni remplacés. À la première lecture d'un PDF,
  l'attaché met le texte extrait en **cache chiffré** (`attache/doccache/`,
  indexé par le hash du fichier) : les relectures sont instantanées et
  n'usent plus ni CPU ni tokens ; si le PDF change, le cache se régénère
  tout seul. Le répertoire des documents, synchronisé avec le commun
  Windows, n'est pas touché.
- **Montre où passent les jetons** : chaque run du CLI émet, en fin
  d'exécution, un bilan `usage` (jetons entrée/sortie/cache) et un
  `total_cost_usd` (équivalent au tarif API). Le service les consigne dans
  `attache/usage.jsonl` — **en clair** : ce ne sont que des nombres et des
  horodatages, aucune donnée d'enquête, lisibles même trousseau non remis.
  Paramètres → Attaché IA → **« Consommation IA »** les traduit pour un
  profane : deux jauges (fenêtre glissante de **5 h**, celle qui bride le
  plus vite, et **7 jours**) en **pourcentage du forfait**, la répartition
  par poste (conversations, mails, brief, routines, classements,
  **sous-agents**), et l'équivalent crédits en euros. Le forfait sert de
  **repère ajustable** : l'abonnement ne publie pas ses plafonds en jetons
  (limites en messages/heures), donc les plafonds Pro / Max 5× / Max 20×
  sont des ordres de grandeur que le magistrat affine — les jetons mesurés,
  eux, sont exacts. Route interne `GET /usage`.
- **Mode économe (levier anti-consommation)** : Paramètres → Attaché IA →
  « Consommation IA » → **Mode économe**. Les **sous-agents** sont le premier
  poste de dépense (un run complet par PDF/dossier, en parallèle) : le mode
  les bascule sur un **modèle rapide** (Haiku) avec **moins de tours**
  (8 au lieu de 15) et un **effort réduit**, et resserre le run principal
  (24 tours au lieu de 40). Les conversations gardent le modèle choisi.
  À activer quand les jetons filent ; à couper pour un dépouillement lourd.
  Autres leviers permanents : choisir un **modèle de sous-agents** plus léger
  (« Cerveau »), baisser l'**effort**, borner la concurrence
  (`SIRAL_ATTACHE_SUBAGENT_CONCURRENCY`) et les tours des sous-agents
  (`SIRAL_ATTACHE_SUBAGENT_MAX_TURNS`), et laisser jouer le **cache de PDF**
  (ci-dessus) qui évite de re-payer l'extraction à chaque relecture.
- **Suit vos consignes permanentes** : un « prompt » libre, rédigé par le
  magistrat (Paramètres → Attaché IA → « Consignes permanentes » — l'équivalent
  de vos instructions Claude web : style, méthode, réflexes), relu au début de
  chaque intervention. Chiffré, versionné, modifiable à tout moment. Il
  complète la persona et les règles de gouvernance, il ne les remplace pas.
- **Skills, comme Claude web** : des méthodes réutilisables (nom +
  description + contenu markdown), gérées dans Paramètres → Attaché IA →
  « Skills ». **Téléversez directement vos fichiers `.skill` exportés de
  Claude web** (archives ZIP : SKILL.md + références — déballées dans le
  navigateur, front-matter name/description repris, références concaténées),
  ou collez le markdown. Même divulgation progressive que Claude web :
  l'attaché voit en permanence la liste (nom + description) dans son prompt,
  et charge le contenu complet (outil `skill_lire`) dès qu'une tâche
  correspond. **L'attaché les rédige et les édite à la demande, en chat** :
  « crée une skill qui fait X » → il écrit lui-même la méthode et sa
  description (`skill_enregistrer`) ; « modifie la skill Z comme ça » → il la
  relit, applique le changement et la ré-enregistre sous le même nom
  (versionné, rien n'est perdu) ; « supprime-la » (`skill_supprimer`,
  réversible). « Enregistre cette skill » (dictée/collée) fonctionne toujours.
  Chiffrées (clé globale), versionnées à chaque
  réécriture, suppression réversible. Différence avec les trames : la trame
  est un plan-type de document, la skill une méthode générale.
- **Recherche web en option** : décochée par défaut. Si le magistrat l'active
  (section « Cerveau »), l'attaché gagne WebSearch/WebFetch — comme Claude
  web, utile pour jurisprudence et textes — et RIEN d'autre : shell et
  fichiers restent interdits. Les requêtes de recherche partent alors vers
  l'extérieur : à activer en connaissance de cause, révocable d'un clic.
- **Sert de majordome** : un **brief quotidien** (heure configurable,
  `SIRAL_ATTACHE_BRIEFING_HOUR`, défaut 6 h) balaye tous les dossiers et
  alimente un **widget du tableau de bord** visible du seul administrateur :
  - **échéances** à préparer (actes expirants, attentes JLD, CR anciens) ;
  - **projets de mail au directeur d'enquête** (demande de requête, point
    d'étape, actualisation, envoi du dossier pour relecture) — RIEN ne part :
    bouton **Copier**, c'est le magistrat qui colle et envoie ;
  - **projets de DML actualisées**, générés à partir des anciennes DML
    archivées dans la **zone DML** de la section documents (dossier `DML/`,
    synchronisé avec le commun Windows comme les autres catégories) ;
  - **vérifications que lui seul peut faire** (nouveaux actes dans NPP,
    Cassiopée — l'attaché n'y a aucun accès et ne l'invente jamais) ;
  - **qui appeler**, quand un mail ne suffit plus.
  Chaque item se règle d'un geste : Copier · Traité · Ignorer. Bouton
  « Générer le brief » pour relancer à la demande.
- **Tient la description à jour** : quand un dossier évolue, l'attaché
  réécrit son « objet » pour donner la vision à l'instant T — l'ancienne
  description est archivée dans le dossier (`descriptionHistory`), rien
  n'est jamais perdu (en plus du versionnage du coffre).
- **Relance les dossiers dormants** : tout dossier sans mouvement depuis
  plus de 2 mois reçoit au brief un projet de mail de relance au directeur
  d'enquête, prêt à coller.
- **Analyse transversale de renseignement (cartographie)** : sur demande
  (« analyse tous les dossiers et trouve les liens cachés ») ou en routine,
  l'attaché balaie le **corpus complet** — toutes les enquêtes (archivées
  comprises) ET tous les dossiers du **module instruction** (`carto_corpus`)
  — et **lit les pièces**, pas seulement les listes de mis en cause : les
  signaux faibles (surnoms, personnes au second plan jamais mises en cause,
  adresses, plaques, téléphones, comptes récurrents d'une affaire à l'autre)
  sont dans les PV. Il délègue le dépouillement à des **sous-agents** (un par
  dossier), recoupe les noms, puis **propose** — jamais tracé d'office :
  **liens de renseignement** personne↔personne (`proposer_lien`, numéro
  facultatif pour un lien transversal), **personnes ex nihilo** autonomes
  (`proposer_mec_carto` — un suspect ou un surnom absent des dossiers, avec
  ses alias), **dossiers ex nihilo** (`proposer_dossier_carto` — une grappe
  cachée, ex. « réseau autour d'un détenu de maison d'arrêt, pivot de 6
  affaires »). Le magistrat valide chaque proposition dans un **module de
  revue** flottant (bas-gauche de la cartographie, et fil du panneau) :
  ✓ trace sur la carte (signé de son nom), ✗ refuse. Idéal en routine
  hebdomadaire.
- **Chronologie probatoire** : dans le détail d'une enquête (section
  visible du seul administrateur), la frise fusionnée de tout ce qui est
  daté — actes, prolongations, attentes JLD, CR, apparition de mis en
  cause, DML archivées. Le magistrat peut y **coller l'architecture NPP**
  d'un dossier d'instruction (arborescence des cotes A/B/C/D/E/G/S/Z) :
  un parseur la structure, l'attaché comprend le sens et l'ordre du
  dossier, et les cotes datées rejoignent la frise.
- **Suit les trames du magistrat** : ses plans-types et consignes de
  rédaction (DML, réquisitions, TSE — ceux qu'il utilisait dans Claude
  web) se collent dans le panneau (« enregistre cette trame sous… ») ;
  l'attaché les relit avant chaque rédaction du même type. Chiffrées,
  versionnées.
- **Bibliothèque de trames téléversable en masse** : le stock du cabinet
  (fichiers `.odt`, `.docx`, **`.doc` (ancien Word)**, `.pdf`, texte…) se
  téléverse d'un coup dans
  Paramètres → Attaché IA → « Trames ». La conversion en **markdown se fait
  dans le navigateur** (le fichier ne quitte jamais le poste en clair), puis
  chaque trame est chiffrée et versionnée comme les autres. Option « Faire
  analyser » : l'attaché lit chaque trame **en profondeur** (délégation à des
  sous-agents en parallèle au-delà de 2 trames), la **classe** (description
  mise à jour via `trame_decrire` — le contenu n'est JAMAIS modifié) et remet
  dans le fil « pendant votre absence » un **livrable détaillé** : contrôle de
  légalité fondement par fondement (textes en vigueur, mentions obligatoires à
  peine de nullité, régime dérogatoire 706-80), solidité procédurale, structure
  et rédaction, puis une **synthèse transversale** (doublons, lacunes,
  incohérences entre trames) — propositions **hiérarchisées par gravité**, le
  magistrat décide. Bouton « Analyser toute la bibliothèque » pour relancer à la
  demande ; le bouton indique clairement s'il faut d'abord remettre les clés et
  affiche l'état du lancement sur place.
- **Base de connaissances — le cerveau documentaire** (pensez Obsidian
  branché sur l'IA) : le fond durable du cabinet — jurisprudences,
  conventions et circulaires, modes opératoires, fiches réflexes, contacts —
  versé par **dossiers entiers, sous-pochettes comprises** (sélecteur de
  dossier ou glisser-déposer récursif : l'arborescence d'origine est
  préservée), converti en **markdown dans le navigateur** (seul le texte est
  conservé : place et tokens économisés) puis chiffré. Le panneau l'affiche
  **comme un explorateur Windows** : pochettes repliables, lecture d'une
  entrée au clic, édition, suppression par fichier ou par pochette.
  L'attaché en est le **bibliothécaire** : « Faire analyser et classer »
  (au téléversement ou sur toute la base) lui fait lire chaque document,
  écrire sa description, corriger catégorie et rangement (`kb_decrire` —
  le contenu n'est jamais modifié) et signaler doublons et textes périmés.
  Pas d'index vectoriel : **recherche agentique** à la demande
  (`kb_chercher` insensible casse/accents, puis `kb_lire`) — le sommaire
  (arborescence + descriptions) figure dans le prompt de l'attaché, le
  contenu ne se charge que quand une tâche le réclame, comme les skills.
  **Documents réflexes (★)** : le magistrat épingle d'une étoile 2-3 documents
  au plus (par ex. le Memento parquet) — ils remontent en tête du sommaire et
  l'attaché les consulte **par réflexe** (`kb_lire`) avant toute analyse ou
  rédaction dès que le sujet peut y toucher, **sans** que les autres entrées
  soient rabaissées. Le marquage voyage dans l'enveloppe chiffrée (aucun contenu
  n'est injecté en clair dans le prompt : le coût en tokens reste celui d'un
  simple pointeur, la lecture se fait à la demande). Étoile dans le panneau ou,
  en chat, « mets tel document en réflexe / retire-le » (`kb_reflexe`).
  En chat, « ajoute à la base de connaissances » fonctionne aussi
  (`kb_enregistrer`). Chiffrée (clé globale), versionnée, réversible.
  PDF scannés (image, sans texte) : détectés et signalés au téléversement —
  passez-les par un OCR avant.
- **Gère les DML de bout en bout (module instruction)** : l'attaché lit les
  dossiers d'instruction du magistrat (coffres `instructions-*`, clé
  globale — lecture seule) : saisine, mis en examen avec périodes de
  détention, DML en attente et leur échéance (+10 jours), débats JLD,
  chronologie. Workflow d'une DML : le magistrat transfère le mail
  « nouvelle DML dossier X » à la boîte dédiée → l'attaché identifie le
  dossier et le mis en examen (`instru_lister`, `lire_dossier`), s'appuie
  sur la **réponse précédente archivée** (zone « Archive DML » du détail
  d'instruction — les PDF signés y restent INTACTS), sur les trames et la
  base de connaissances → **demande systématiquement au magistrat**, via la
  carte Question du panneau (réponse sur place, jamais par mail), si un
  acte récent (audition, expertise — souvent dans NPP, invisible pour lui)
  doit enrichir la motivation → rédige SANS attendre le projet complet
  (type « Réponse DML », points suspendus marqués [À CONFIRMER]) → à la
  réponse du magistrat, révise l'acte dans la même conversation. Le magistrat retouche dans « Actes
  rédigés », l'exporte en PDF/Word officiel puis le **valide** une fois
  traité.
  Le brief quotidien anticipe aussi les échéances instruction : DML en
  attente, débats JLD sans réquisitions, fins de détention proches.
- **Analyse automatique des documents (IA)** : la fonctionnalité « Analyse
  automatique des documents » de SIRAL (détection d'actes à partir des PDF du
  dossier) bascule, pour le seul administrateur, sur le modèle Claude de
  l'attaché — bien plus robuste que les heuristiques regex sur les formats
  atypiques, l'OCR bruité ou les cibles mal formatées. L'IA lit chaque
  ordonnance, en extrait l'acte (type, cibles, durée, dates, tribunal,
  chaînage des prolongations) **et évalue la chaîne légale** (requêtes /
  autorisations initiales / prolongations manquantes). L'analyse est en un
  seul tour, **sans aucun outil** (pas de MCP, pas d'écriture) : rien n'est
  créé sans le ✓ du magistrat — le résultat repasse par le dédoublonnage et la
  validation habituels. Bascule IA ⟷ Classique dans la fenêtre, repli
  automatique sur le moteur classique si le service est indisponible. Modèle
  configurable via `SIRAL_ATTACHE_ANALYSE_MODEL` (défaut : sonnet).
- **Propose au lieu d'écrire quand il DÉTECTE** : à la lecture d'une pièce
  (document, PV, mail), un nom nouveau → proposition de **mis en cause**
  (dédoublonnage automatique, casse/accents compris) ; une mesure évoquée →
  **acte pré-construit** (jusqu'à la demande JLD) ; des éléments nouveaux →
  **CR en prise de notes**. Les propositions apparaissent en bandeau dans le
  détail du dossier, pour le seul administrateur, avec **✓** (appliquer) et
  **✗** (refuser) discrets. Rien n'est écrit avant le ✓. L'écriture directe
  reste réservée aux instructions explicites du magistrat.
- **Ne laisse AUCUNE trace dans les données partagées** : les CR et
  écritures sont signés **du nom de l'administrateur** (jamais « Attaché
  IA »), y compris le `modifiedBy` de la synchronisation. L'attribution
  réelle de chaque action vit dans le journal d'audit chiffré, visible du
  seul administrateur. Les routes répondent 404 aux non-admins : la
  fonctionnalité est indistinguable d'une route inexistante.
- **Routines** : consignes récurrentes définies par le magistrat
  (quotidiennes à HH:MM ou toutes les N heures), gérées dans Paramètres →
  Attaché IA — créer, suspendre, exécuter immédiatement, supprimer.
- **Chat flottant par dossier** : depuis le détail d'une enquête ou d'un
  dossier d'instruction, une bulle déplaçable (admin only), toujours
  accessible même pendant la rédaction d'un CR. Une conversation par
  dossier ; bouton **Diagnostic** (délais TSE, cohérence actes
  demandés/réalisés, éparpillement des enquêteurs). Chaque dossier a une
  **mémoire légère** (petit markdown plafonné) que l'attaché relit au début
  de chaque échange et enrichit d'une ligne quand du neuf apparaît —
  consultable et éditable via l'icône livre du chat.
- **Atelier des actes rédigés** : section « Actes rédigés » dans le détail
  d'un dossier (admin only). L'attaché y range les actes qu'il rédige
  (réquisition, demande de prolongation JLD, saisine, projet de réponse —
  suivant les trames, via l'outil `produire_document`, en reprenant les
  **NATINF enregistrés du dossier**). Le magistrat les visionne, demande à
  l'IA de les retoucher (chat du dossier), les **édite légèrement à la
  main** (puis Enregistrer — le navigateur rechiffre, l'app ne voit jamais
  le clair), les **exporte en PDF / Word au gabarit officiel** (en-tête
  République française — drapeau, devise —, Times 12 pt justifié ; nom de
  fichier au formalisme de la trame suivie :
  `<trame>_<dossier>_<date>.pdf`), puis les **VALIDE** (✓) : l'acte est
  considéré traité et quitte la liste courante (récupérable via « voir les
  actes traités » ; une retouche IA le remet en attente de relecture).
- **NATINF cohérents, app ↔ actes** : les qualifications officielles d'un
  dossier sont ses codes NATINF enregistrés dans SIRAL — l'attaché les lit
  (section « Infractions (NATINF) » de `lire_dossier`) et les **reprend
  obligatoirement** dans chaque requête, autorisation ou réquisition
  (`natinf_chercher` pour le référentiel). Quand une pièce du dossier — un
  acte d'autorisation téléversé notamment — mentionne des NATINF absents de
  l'application, il les **ajoute en autonomie** (`ajouter_natinfs`, sans
  validation) : refus des codes inconnus du référentiel, dédoublonnage, et
  l'ajout apparaît dans les modifications récentes du dossier.
- **Demandes d'actes SANS dossier** : quand un mail transféré réclame un
  acte qui ne correspond à **aucune procédure en cours**, deux issues selon
  la consigne du transfert : « **et créer procédure** » (ou équivalent sans
  ambiguïté) → l'attaché **crée le dossier lui-même** (`creer_dossier` —
  tout renseigné depuis la pièce : mis en cause recoupés, NATINF, pièces
  rangées) puis y traite la demande ; « **traiter** » seul → l'acte est
  rédigé sous le pseudo-dossier `_hors-dossier` et apparaît dans la section
  « **Actes rédigés — hors dossier** » du tableau de bord (admin seul,
  masquée quand vide) — mêmes exports officiels, même validation ✓.
- **Documents d'enquête par dossiers entiers** : chaque zone de la section
  documents (Geoloc, Écoutes, Actes, PV, DML) accepte désormais un **dossier
  complet, sous-pochettes comprises** (bouton « Dossier » ou glisser-déposer
  récursif) — l'organisation d'origine est préservée sous la zone. Au
  passage, chaque pièce reçoit une **copie markdown** (`MD/…`, convertie
  dans le navigateur, invisible dans les listes) que l'attaché lit en
  priorité : zéro ré-extraction de PDF, tokens économisés — les originaux
  restent intacts.

## Architecture et modèle de sécurité

```
 Navigateur admin (clés E2EE)      App Next (AUCUNE clé)         Service attaché (sidecar)
 ───────────────────────────      ─────────────────────         ─────────────────────────
 Panneau « Attaché »        ◄──►  /api/attache/* (garde   ◄──►  API interne :8787
 déchiffre feed/audit/            admin+TJ, relais SSE,          seul détenteur de la
 mémoire/transcripts              lecture d'enveloppes)          clé-maître et du trousseau
                                                                   │
                                                                   ├─ CLI claude (abonnement)
                                                                   ├─ serveur MCP (14 outils SIRAL)
                                                                   └─ relève IMAP + runs proactifs
```

- **Trousseau de l'attaché** : l'attaché est traité comme un *collègue* du
  modèle E2EE existant. L'admin, déverrouillé dans son navigateur, lui remet
  les clés brutes des **seuls périmètres confiés** (`global` + `ctx-crimorg`) ;
  le service les enveloppe aussitôt avec sa **clé-maître**
  (`SIRAL_ATTACHE_MASTER_KEY`, jamais dans le dépôt ni à côté des données).
  Toute clé hors périmètre est **refusée**. **Révoquer = un clic** (suppression
  du trousseau) : l'attaché est aveugle immédiatement, les données ne bougent pas.
- **Conséquence assumée** : pour les périmètres confiés — et eux seuls — le
  serveur de l'attaché peut déchiffrer, condition du travail en votre absence.
  Rayon de souffle borné à un TJ / un contentieux ; les autres restent E2EE purs.
- **L'app web ne détient aucune clé de l'attaché** : elle relaie (chat,
  trousseau) et sert des enveloppes chiffrées que le navigateur admin
  déchiffre avec sa clé globale (feed, audit, mémoire, transcripts).
- **L'agent n'a ni shell, ni fichiers** : uniquement les outils MCP SIRAL
  (liste blanche + liste noire explicite) — et, SEULEMENT si le magistrat
  l'active dans « Cerveau », la recherche web (WebSearch/WebFetch). Chaque
  outil d'écriture est audité.
- Les routes `/api/attache/*` répondent **404** à tout non-admin, tout autre
  TJ, ou si la fonctionnalité est désactivée — indistinguable d'une route
  inexistante.

## Installation (serveur OVH, docker compose)

1. **Boîte dédiée** : créer `ia@votre-domaine` chez OVH (IMAP + SMTP).

2. **`.env`** — compléter la section « ATTACHÉ DE JUSTICE » :

   ```bash
   SIRAL_ATTACHE_URL=http://attache:8787
   SIRAL_ATTACHE_MASTER_KEY=$(openssl rand -hex 32)   # ≠ SIRAL_SECRET
   SIRAL_ATTACHE_OWNER_EMAIL=votre-adresse-pro@justice.fr
   SIRAL_ATTACHE_IMAP_HOST=ssl0.ovh.net
   SIRAL_ATTACHE_IMAP_USER=ia@votre-domaine
   SIRAL_ATTACHE_IMAP_PASSWORD=…
   SIRAL_ATTACHE_SMTP_HOST=ssl0.ovh.net
   SIRAL_ATTACHE_SMTP_USER=ia@votre-domaine
   SIRAL_ATTACHE_SMTP_PASSWORD=…
   ```

3. **Démarrer** : `docker compose up -d --build attache siral`

4. **Connecter l'abonnement Claude** (une fois — état persistant dans le
   volume `claude-auth`) :

   ```bash
   docker compose exec -it attache claude
   # suivre le login OAuth avec le compte de l'abonnement, puis quitter
   ```

5. **Remettre les clés** : dans SIRAL, connecté en admin sur le TJ confié →
   Paramètres → **Attaché IA** → *Remettre les clés*. Le panneau affiche
   l'état complet (clé-maître, trousseau, Claude, IMAP/SMTP).

   Si la **Boîte de l'attaché** reste vide, la section *Boîte mail
   (diagnostic)* du même panneau permet de vérifier : cliquer *Tester la
   connexion* se connecte à la boîte dédiée en **lecture seule** (rien n'est
   relevé ni marqué lu) et indique soit « boîte réellement vide » soit
   l'erreur précise (identifiants, hôte, TLS). *Détails* affiche la
   configuration non secrète (adresse de la boîte, hôte/port IMAP, présence
   du mot de passe) et la dernière erreur de relève automatique.

   Les identifiants se règlent au choix côté serveur (`SIRAL_ATTACHE_IMAP_*`)
   **ou directement dans l'app** : bouton *Régler* de cette même section
   (adresse, serveur IMAP, port, SSL, mot de passe). Les valeurs saisies dans
   l'app **prévalent** sur l'environnement ; le mot de passe est confié au
   service attaché qui le chiffre avec sa clé-maître (jamais stocké par
   l'app). *Revenir aux réglages du serveur* efface cette saisie.
   Boîte OVH/Zimbra type : `zimbra1.mail.ovh.net`, port 993, SSL,
   identifiant = adresse complète (ex. `crimorg@siral.fr`).

6. **Utiliser** : l'icône balance ⚖ apparaît dans l'en-tête (admin
   uniquement). Transférer un mail à `ia@…` avec une consigne dans le corps —
   ou parler directement dans le panneau.

## Révocation & réversibilité

| Geste | Effet |
|---|---|
| Paramètres → Attaché IA → **Révoquer** | l'attaché ne déchiffre plus rien, immédiatement |
| Changer `SIRAL_ATTACHE_MASTER_KEY` | trousseau illisible = révoqué de fait |
| Vider `SIRAL_ATTACHE_URL` | fonctionnalité totalement absente de l'app |
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
connecté (`claude login`) sur la machine qui exécute le service.
