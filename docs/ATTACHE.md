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
- **A les capacités d'un utilisateur réel, sur instruction explicite** : tout
  ce que le magistrat saisit à la main, l'attaché sait le faire quand on le
  lui demande (en chat ou par mail transféré) — et il **récapitule toujours**
  ce qu'il a touché :
  - **créer un dossier complet** (`creer_dossier`) avec les MÊMES champs que
    le formulaire « Nouvelle enquête » : numéro, date, **unité/service**,
    **directeur d'enquête**, n° parquet, n° IDJ, **NATINF** (vérifiés au
    référentiel), description, mis en cause recoupés — « crée un dossier X
    avec tel enquêteur en directeur d'enquête et telle unité » suffit ;
  - **modifier les métadonnées** d'un dossier (`modifier_dossier` : directeur
    d'enquête, services, date de début, n° parquet/IDJ — chaque changement
    laisse une entrée visible dans les modifications récentes), **archiver /
    désarchiver** (`archiver_dossier`) ;
  - **tenir l'échéancier des actes** (`modifier_acte`) : « le JLD a signé »
    → autorisation accordée (date posée, la mesure passe « pose en attente »,
    l'art. 76 passe « en cours ») ; « la balise est posée » → date de pose +
    date de fin recalculée ; refus JLD, pose avortée, fin de mesure,
    correction de cible/objet/durée — les MÊMES transitions que les boutons
    du détail d'enquête ;
  - **gérer les mis en cause** sur demande (`ajouter_mec`, `modifier_mec` —
    rôle, statut, victime ; statut par défaut « actif », comme la saisie
    manuelle) — un nom simplement *détecté* reste une proposition ✓/✗ ;
  - **cocher les à-faire** (`terminer_todo`) quand une tâche est faite — y
    compris quand son propre travail vient de l'accomplir ;
  - les **suppressions** (dossier, acte, CR, mis en cause) restent
    volontairement **manuelles** : elles posent des marqueurs côté client que
    le service ne sait pas poser — l'attaché explique et propose l'équivalent
    réversible (archiver, terminer, corriger).
- **Anticipe** : la boîte mail dédiée est relevée toutes les 5 min ; chaque
  message transféré par le magistrat (le corps du transfert vaut consigne)
  déclenche un traitement autonome — qualification (DML, demande d'actes TSE,
  réponse JLD, notification d'instruction…), rapprochement avec le dossier,
  actions, synthèses, projets — dont le résultat s'affiche dans le fil
  « Pendant votre absence » du panneau.
  - **Seul le magistrat commande** : la relève n'accepte que les mails de
    `SIRAL_ATTACHE_OWNER_EMAIL` (complétée par
    `SIRAL_ATTACHE_ALLOWED_SENDERS`) — un expéditeur inconnu est ignoré,
    audité et signalé au fil, ses « consignes » ne déclenchent jamais un run.
  - **Plusieurs actes dans un même mail** : l'attaché commence par LISTER
    tous les actes demandés, les traite un par un (une production par acte),
    vérifie avant de clore que chacun a la sienne, et le résumé du widget
    boîte les énumère.
  - **Rien ne se perd en silence** : un traitement qui échoue est retenté
    (jusqu'à `SIRAL_ATTACHE_MAIL_MAX_ATTEMPTS`, délai croissant), puis
    l'abandon est EXPLICITE — carte d'alerte au fil, relance possible depuis
    le panneau. Un mail trop volumineux (> 40 Mo) ou une pièce jointe trop
    lourde (> 15 Mo, conservée en fiche « omise ») sont signalés au lieu
    d'être avalés. Une routine qui casse laisse aussi sa carte d'alerte — en
    disant COMBIEN de propositions avaient déjà été déposées avant
    l'interruption, et OÙ les trancher (rien de déposé n'est jamais perdu).
- **Le fil « Pendant votre absence » se range TOUT SEUL — et pareil sur tous
  les appareils** : une carte disparaît quand son acte relié est validé ou
  supprimé ; les cartes d'information d'un dossier entièrement traité
  (résumés, annonces d'actes, mails traités, livrables, projets de réponse)
  s'effacent à la clôture ; et toute carte d'information **déjà vue lors d'une
  visite précédente** expire seule au bout de **48 h** — une carte jamais vue
  n'expire jamais (retour de longue absence : tout attend), et une carte
  reliée à un acte **encore en attente de validation** non plus (c'est du
  travail à faire : elle ne part que par validation ou suppression de
  l'acte). L'état de lecture
  (cartes rangées ✕, repère « vu ») est **partagé entre appareils** via
  `/api/attache/journal` — fichier de statuts indexé par **empreintes
  opaques** (hash de carte), jamais de contenu, comme les statuts des
  questions : ranger ou consulter sur l'ordinateur vaut sur le téléphone, et
  inversement ; le localStorage n'est plus qu'un cache de secours (hors-ligne),
  re-synchronisé et migré à la visite suivante. Le journal est un fil de
  reprise, pas une archive : l'historique complet demeure dans les dossiers
  (« Actes rédigés ») et le journal d'audit.
- **Et il se vide EN UN GESTE quand il a débordé** : bouton **« Tout ranger »**
  du bandeau (confirmation en deux temps, puis **« Annuler »** — un geste qui
  porte sur des centaines de cartes ne doit jamais être irréversible), et
  « Tout ranger » par dossier dans l'en-tête de chaque groupe. Le rangement en
  lot part au serveur par paquets et vaut, comme le reste, sur tous les
  appareils. En prime, les cartes **strictement identiques** (même dossier,
  même type, même titre, même résumé) sont **repliées en une seule ligne**
  portant un compteur `×N` et la date de la première occurrence : 198 fois la
  même note de mise en pause s'affichent désormais sur UNE ligne. Ranger cette
  ligne les range toutes.
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
  panneau, ou pièce jointe d'un mail transféré. L'attaché **lit le contenu**
  de la pièce avant de la ranger (`depot_lire` au dépôt, `boite_lire_piece`
  pour une pièce jointe de mail — PDF, ODT/DOCX/RTF, texte), puis
  **l'aiguille selon sa nature** :
  - **pièce de procédure** (PV, audition, ordonnance, réquisition, rapport,
    retranscription, DML…) → il retrouve le **bon dossier** (enquête ou
    instruction), choisit la **bonne zone** (audition → PV, ordonnance →
    Actes, DML → DML, rapport géoloc → Geoloc, retranscription → Ecoutes), la
    **nomme proprement** (daté, explicite) et la range (`ranger_document`) —
    la pièce apparaît dans la fiche du dossier, intacte et chiffrée, signée du
    nom du magistrat. Puis il l'**exploite** : lecture, détections →
    propositions, intégration au travail en cours (ex. l'audition attendue
    pour une réponse DML) ;
  - **document de référence durable** (memento, documentation ou circulaire
    du ministère, jurisprudence de fond, fiche réflexe, annuaire…) → il
    l'**intègre à la base de connaissances** (`kb_ranger_piece`) : le TEXTE
    est extrait côté serveur et conservé chiffré (jamais l'octet du PDF ne
    transite par la conversation), et l'attaché le **classe dès réception**
    (titre, catégorie, pochette, description d'une phrase — et **★ réflexe**
    s'il s'agit d'une référence de premier rang type Memento parquet). Un
    scan illisible est **refusé** (rien enregistré) : il demande une version
    texte.
  Doute sur l'aiguillage, le dossier ou la zone → question dans SIRAL ; pièce
  non pertinente → corbeille du dépôt (jamais détruite).
- **Pose ses questions DANS SIRAL — jamais par mail** : quand une
  information lui manque (un acte récent dans NPP, une orientation à
  trancher), l'attaché publie une carte **« Question ❓ »** dans le fil
  « pendant votre absence », avec **zone de réponse intégrée**. La réponse
  du magistrat reprend **la conversation d'origine du run** (l'attaché
  garde tout son contexte et poursuit : révision de l'acte, retrait des
  [À CONFIRMER]…). Boutons Répondre / Ignorer, statut persistant. Une seule
  entrée (mail transféré ou chat), puis tout se passe dans l'application.
- **Retient — et APPREND de vos corrections (apprentissage progressif)** :
  une mémoire markdown (exigences, réflexes appris, pièges à éviter) relue à
  chaque intervention — lisible, corrigeable et effaçable depuis le panneau.
  Elle ne se contente plus d'accumuler : l'attaché **s'améliore d'une
  intervention à l'autre, sans surcoût de jetons**, en deux temps :
  - **Capture gratuite des signaux d'expérience** (aucun appel au modèle) :
    chaque proposition refusée ✗ ou validée ✓, chaque acte qu'il a dû
    réviser, chaque acte **corrigé à la main** par le magistrat, chaque
    leçon notée en conversation (`memoire_noter`) part en une ligne chiffrée
    dans `attache/apprentissage.jsonl`. Le prompt lui impose de tirer la
    **règle générale** de chaque correction — pas l'anecdote.
  - **Une édition à la main est CAPTÉE avec ce qui a changé, pas seulement le
    fait** : quand vous retouchez un acte dans « Actes rédigés » puis
    **Enregistrez**, le service (seul détenteur de la clé) compare, dans son
    enceinte, votre correction au jet de l'attaché. Le signal n'est déposé
    **que si le contenu a réellement changé** (une simple validation ✓ ou
    réouverture n'apprend rien) et il porte un **pointeur vers le diff exact**
    (`versionAt`) ainsi que la **trame suivie**. À la consolidation, l'attaché
    appelle **`production_diff`** : il voit **ligne à ligne** ce que vous avez
    retiré (−) et ajouté (+) — la version d'avant est conservée dans
    `.versions/` — et en tire une règle durable pour ne pas refaire l'erreur.
    Le texte ne quitte jamais l'enceinte chiffrée : le journal ne stocke que
    le pointeur.
  - **Les reprises en conversation sont repérées TOUTES SEULES** : quand le
    magistrat tape « non, refais », « pas comme ça », « je t'avais déjà
    dit… », une heuristique (regex, coût nul, volontairement étroite) le
    détecte à la sauvegarde de la conversation et dépose un signal pointant
    l'échange. La consolidation **relit alors la conversation citée**
    (`conversation_lire`, réservé à l'agent principal — jamais aux
    sous-agents) pour en extraire la règle générale. Rien à noter, ni pour
    le magistrat, ni pour l'agent : l'apprentissage est **entièrement
    automatique** — le bouton « Consolider maintenant » sert seulement à ne
    pas attendre (tout signal est distillé au plus tard sous la cadence).
  - **La progression est MESURÉE** (aucun appel au modèle) : taux
    d'acceptation des propositions, actes retouchés (révisions + éditions à
    la main), portes de qualité déclenchées, corrections en conversation —
    sur 30 jours face aux 30 jours précédents. Affichée dans la section
    « Apprentissage » du panneau, et fournie au run de consolidation qui
    **cible ses régressions** (un indicateur qui se dégrade devient sa
    priorité de la consolidation suivante).
  - **Il étudie vos actes VALIDÉS et en extrait des MODÈLES** : les pièces
    téléversées en zones **Actes** et **DML** sont des versions validées —
    vos actes signés, et les **ordonnances des JLD** qui reprennent ou
    reformulent vos requêtes (des juges : la meilleure école de motivation).
    Un run d'étude périodique les dépouille (sous-agents, lecture des
    copies markdown — économe) et en extrait des **gabarits par type
    d'acte** : trames préfixées `modele-` (anonymisées — jamais un nom, une
    ligne ou une plaque d'un dossier réel), que l'attaché est **seul
    autorisé à créer et réécrire** — vos propres trames restent
    intouchables et **priment toujours** sur un `modele-` du même type. Les
    paires requête ↔ ordonnance JLD livrent en prime ce que les juges
    reprennent, reformulent ou exigent — consigné en réflexes. Déclenchement
    automatique : `SIRAL_ATTACHE_ETUDE_SEUIL` nouveaux actes validés
    (défaut 5), ou cadence `SIRAL_ATTACHE_ETUDE_JOURS` (défaut 30 j) s'il y
    a du nouveau — première étude du stock existant dès la mise en service ;
    comptage déterministe (index en clair), anti-rafale 24 h ; bouton
    « Étudier mes actes maintenant » pour ne pas attendre. Chaque étude
    remet un **livrable** (modèles créés, observations sur vos trames,
    leçons) — tout est versionné, supprimable d'un geste.
  - **Consolidation périodique** : un run **court** (14 tours max), sur le
    **modèle économe des sous-agents**, relit les signaux
    (`apprentissage_bilan`) et la mémoire, **distille** (règles générales,
    doublons fusionnés, contradictions tranchées — la consigne la plus
    récente prime —, anecdotique et périmé supprimés) puis **réécrit** la
    mémoire (`memoire_reecrire`) **sous un budget strict**
    (`SIRAL_ATTACHE_MEMOIRE_BUDGET`, défaut 6 000 caractères ≈ 1 500
    jetons). La mémoire, relue à CHAQUE run, reste donc courte et dense :
    l'apprentissage fait **baisser** la consommation (moins d'erreurs →
    moins de retouches → moins de runs), au lieu de la faire enfler.
    Déclencheurs : accumulation de signaux
    (`SIRAL_ATTACHE_APPRENTISSAGE_SEUIL`, défaut 12), **quelques corrections
    directes du magistrat** — acte corrigé à la main, proposition refusée,
    reprise en chat : signaux **forts** qui consolident sans attendre
    (`SIRAL_ATTACHE_APPRENTISSAGE_SEUIL_FORTS`, défaut 3), pour ne pas
    refaire l'erreur au prochain acte —, mémoire au-dessus du budget, ou
    cadence de fond (`SIRAL_ATTACHE_APPRENTISSAGE_JOURS`, défaut 7 j) —
    jamais deux tentatives à moins de 12 h. Chaque consolidation laisse une
    carte « Apprentissage » dans le fil « pendant votre absence » : on VOIT
    ce qu'il a retenu.
  - **Les MÉTHODES se bonifient aussi (workflows composés)** — avec une
    **gouvernance de propriété imposée dans le code**, pas seulement dans le
    prompt :
    - **Ses méthodes à lui** : skills `auto-*` (créées par consolidation) et
      trames `modele-*` (extraites du corpus) — l'attaché les crée et les
      réécrit librement (versionnées). Dans les runs autonomes
      (consolidation, étude), `skill_enregistrer`/`trame_enregistrer`
      **refusent tout autre nom** : la règle n'est pas une consigne, c'est
      un garde-fou logiciel. Plafond anti-prolifération :
      `SIRAL_ATTACHE_AUTO_SKILLS_MAX` (défaut 12) — la liste des skills se
      paie dans CHAQUE prompt, au-delà l'attaché doit **fusionner** avant de
      créer, et la consolidation a un devoir d'hygiène (regrouper les
      `auto-*` qui se recouvrent, supprimer l'inutile).
    - **Vos méthodes à vous** : jamais d'écriture d'office. L'attaché dépose
      une **proposition d'amélioration** (`proposer_trame` /
      `proposer_skill`) : le texte **intégral révisé** + le **motif**
      (signaux, écart au corpus validé, fragilité de légalité). Elle
      apparaît dans Paramètres → Attaché IA, encadré **« Propositions de
      méthode »** : motif, texte complet déroulable, **✓ Appliquer** (écriture
      versionnée — l'ancienne version reste archivée) ou **✗ Refuser** (et le
      refus est lui-même un signal d'apprentissage). L'**étude du corpus** en
      dépose quand vos propres actes signés divergent de votre trame ; une
      analyse juridique de trame demandée en chat peut en déposer aussi.
    - **Ciblage par corrélation** : les signaux d'actes retouchés portent la
      trame suivie — une trame/skill dont l'usage produit des retouches
      répétées devient la priorité de la consolidation suivante.
    - La consolidation peut aussi **fixer une association** type d'acte →
      trame + skill (appliquée d'office ensuite). Chaque évolution — écrite
      (`auto-*`/`modele-*`) ou proposée (en attente de ✓) — est listée dans
      la carte « Apprentissage ». Et une skill peut **référencer d'autres
      ressources** (autre skill, trame, entrée de la base) : l'attaché charge
      l'ensemble quand il l'applique — les méthodes se composent.
  Paramètres → Attaché IA → **« Apprentissage »** montre les signaux en
  attente, la dernière consolidation, la jauge mémoire/budget, et un bouton
  **« Consolider maintenant »**. Le coût des consolidations apparaît dans
  « Consommation IA » (poste « Apprentissage »). Tout reste sous contrôle :
  signaux chiffrés (clé globale), mémoire versionnée à chaque réécriture,
  et toujours éditable/effaçable par le magistrat.
- **Portes de qualité auto-appliquées** : des contrôles **déterministes, à
  coût de jetons nul**, exécutés au moment où l'attaché remet une
  production (`produire_document`, `remettre_livrable`) — marqueur
  d'inachèvement oublié (`[À COMPLÉTER]`, `TODO`, `XXXX` — `[À CONFIRMER]`
  reste autorisé), auto-désignation (« Attaché IA », « en tant qu'IA » :
  règle de dissimulation), HTML dans un acte, **acte à signer
  squelettique** (< 600 caractères). Une violation **rejette l'écriture**
  avec une erreur actionnable : l'agent corrige et re-soumet dans le même
  run — le magistrat ne voit jamais le travail non conforme. Chaque rejet
  est capté en signal d'apprentissage : une porte qui claque souvent
  devient un réflexe consolidé.
- **Traite plusieurs choses à la fois** : conversations, routines et
  mails transférés cohabitent déjà ; les runs proactifs (un par mail) sont
  désormais exécutés par un **pool borné**
  (`SIRAL_ATTACHE_PROACTIVE_CONCURRENCY`, défaut 2, max 4 ; 1 = séquentiel
  strict) : trois transferts d'affilée ne font plus attendre le troisième.
  Les écritures restent sérialisées fichier par fichier et le dédoublonnage
  des propositions est vérifié au dépôt ET à l'application — la concurrence
  ne crée pas de doublons. À régler selon la mémoire du serveur et le
  rythme du forfait.
- **Se règle comme Claude web** : choix du **modèle** (Fable 5, **Opus 5**,
  Opus 4.8, Sonnet 5, Haiku 4.5 — ou le défaut de l'abonnement) et du **niveau
  d'effort** de raisonnement (faible → maximal), depuis le composer du chat
  ou Paramètres → Attaché IA (section « Cerveau »). Le réglage est persisté
  et vaut pour TOUS les runs : chat, mails transférés, routines.
  S'y règle aussi le **modèle des sous-agents** (un modèle rapide — Sonnet,
  Haiku — suffit souvent pour les lots).
- **Travaille en parallèle (sous-agents)** : pour un lot de sous-tâches
  indépendantes — analyser les 20 PDF d'un dossier, balayer chaque dossier
  d'une routine, évaluer un lot de trames — l'attaché délègue à des
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
- **Ne lit jamais deux fois le même contenu (doublons exacts)** : chaque
  pièce porte l'**empreinte sha256 de son clair** — calculée dans le
  navigateur au téléversement, complétée par l'attaché pour le stock ancien
  (déchiffrement + hash en local, zéro jeton). Détection **STRICTE**
  uniquement : deux pièces ne sont dites « doublon » que sur contenu
  identique octet à octet — une version voisine reste une pièce à lire, rien
  n'est jamais écarté par approximation. Effets : le versement signale
  « contenu identique à … » dans son bilan (versée quand même — une jonction
  duplique légitimement), `dossier_arborescence` annote les copies
  (`copieExacteDe`), et les **chantiers d'analyse profonde** écartent les
  copies exactes des lots au devis (chaque contenu lu UNE fois — sur une
  jonction de procédures, une part substantielle des nuits et des jetons) en
  les nommant dans le devis et la synthèse.
- **Ingestion de fond (extraction + empreinte d'office)** : à chaque tick du
  service, les dossiers dont l'index a bougé passent à l'ingestion — patron
  eDiscovery : empreinte sha256 posée, texte extrait et mis en cache pour
  chaque pièce qui n'a ni copie MD/ du téléversement ni cache (pièces rangées
  par le majordome, reçues par mail, scans, stock ancien — OCR compris pour
  les scans entièrement muets, dans les bornes habituelles). CPU local
  uniquement, **zéro jeton**, hors gouverneur (ni nuit ni cap 5 h), par
  petits pas bornés (~15 extractions par passage) avec reprise au tick
  suivant. Un échec d'extraction est mémorisé et jamais re-tenté tant que la
  pièce n'est pas re-versée. Résultat : `pieces_chercher` couvre tout le
  dossier dès la première recherche, `lire_document` est instantané, le
  devis d'un chantier n'attend plus rien.
- **Registre des pièces — le sommaire vivant** : une entrée par pièce
  versée, constituée automatiquement, en deux étages. (1) **Entités
  déterministes** — téléphones, plaques, IBAN, adresses — extraites du texte
  pendant l'ingestion, par les MÊMES regex que la cartographie : zéro jeton,
  couverture totale de la masse. (2) **Mini-fiche IA** — type de pièce,
  date, PERSONNES (noms, alias, rôle — verbatim de la pièce), résumé de 2-3
  lignes — par lots courts (modèle économe, un seul tour, aucun outil), au
  fil de l'eau, même gouvernance de forfait que les descriptions ; les
  copies exactes héritent de la fiche du porteur. Chiffré (clé globale),
  consigné dans « Consommation IA », prompt réglable (socle « Registre des
  pièces » des consignes). Outils : `registre_lire` (sommaire filtrable —
  « où est l'audition de X ? » sans rien relire) et **`registre_recouper`**,
  le recoupement INTER-DOSSIERS par entité : numéros, plaques, IBAN,
  adresses et personnes présents dans au moins deux dossiers, chaque côté
  cité avec ses pièces exactes — les liens souvent cachés dans la masse des
  documents versés, servis à la cartographie à coût nul (la recherche
  profonde de la carto commence désormais par là).
- **Retrouve une information dans les pièces (`pieces_chercher`)** :
  recherche plein texte côté serveur — fiches de dépouillement d'abord (déjà
  synthétiques et cotées), puis le texte des pièces (copies markdown du
  téléversement, caches d'extraction ; les pièces jamais extraites le sont
  au passage, par lots bornés — chaque recherche étend la couverture,
  définitivement). Insensible casse/accents, mots exigés ensemble, doublons
  exacts fouillés une seule fois, extraits avec le chemin exact pour
  enchaîner sur `lire_document`. **Zéro jeton** : scan local, pas d'index
  vectoriel — cohérent avec la doctrine « recherche agentique ».
- **Montre où passent les jetons** : chaque run du CLI émet, en fin
  d'exécution, un bilan `usage` (jetons entrée/sortie/cache) et un
  `total_cost_usd` (équivalent au tarif API). Le service les consigne dans
  `attache/usage.jsonl` — **en clair** : ce ne sont que des nombres et des
  horodatages, aucune donnée d'enquête, lisibles même trousseau non remis.
  Paramètres → Attaché IA → **« Consommation IA »** les traduit pour un
  profane : deux jauges (fenêtre glissante de **5 h**, celle qui bride le
  plus vite, et **7 jours**) en **pourcentage du forfait**, la répartition
  par poste (conversations, mails, routines, classements,
  **sous-agents**), et l'équivalent crédits en euros. Le forfait sert de
  **repère ajustable** : l'abonnement ne publie pas ses plafonds en jetons
  (limites en messages/heures), donc les plafonds Pro / Max 5× / Max 20×
  sont des ordres de grandeur que le magistrat affine — les jetons mesurés,
  eux, sont exacts. Route interne `GET /usage`.
- **Priorité au magistrat (demandes + mails), le fond la nuit** : répondre
  aux demandes (chat) et traiter les mails transférés (rédaction d'actes) est
  la priorité — ces runs ne sont **jamais** différés ni bridés, et leurs
  sous-agents gardent toute leur qualité même forfait tendu. Les travaux
  de **fond lourds** (étude du corpus d'actes, consolidation de l'apprentissage)
  sont **réservés à une fenêtre de nuit** (`SIRAL_ATTACHE_NIGHT_START` /
  `_END`, défaut 22 h → 7 h) : hors de la journée de travail, ils ne disputent
  jamais le forfait aux actes. Les boutons du panneau
  (« Étudier mes actes maintenant », « Consolider maintenant ») forcent
  l'exécution à tout moment. Pour un balayage régulier sans exploser la fenêtre
  de 5 h : le planifier en **routine de nuit**.
- **« Où passent vos jetons », lisible** : le panneau Consommation IA
  **attribue chaque sous-agent au run qui l'a lancé** (routine, mails, étude…) —
  fini le sac fourre-tout « lots parallèles » : on voit d'où vient la dépense. Un volet **« Derniers runs »** liste, horodatés, les runs récents et
  leurs jetons, pour repérer d'un coup d'œil ce qui a consommé et quand.
- **Gouverneur de consommation (bridage automatique)** : le garde-fou qui
  « jugule » le forfait tout seul, sans réglage. À chaque tick, le service
  compare la consommation récente aux plafonds du forfait (`config.cap5h` /
  `config.capHebdo`, renseignés par le choix de forfait) et agit à coût nul
  (le journal `usage.jsonl` n'est que des nombres) — il ne bride QUE les
  runs de fond, jamais le chat ni les mails :
  - **≥ 75 % de la fenêtre de 5 h** → les **lots de sous-agents** passent
    d'office en régime économe (modèle rapide, effort faible, ≤ 8 tours,
    concurrence ramenée à 2), quel que soit l'appelant (routine, étude, mail,
    chat) et **même si le mode économe est décoché** ;
  - **≥ 100 %** → les **runs autonomes** (routines, étude, consolidation) sont
    **différés** — rien n'est perdu, ils repartent seuls au
    prochain tick une fois la fenêtre redescendue ; les sous-agents encore
    lancés sont bridés au maximum (≤ 6 tours). Le **chat** et le **traitement
    des mails** (demande directe du magistrat) ne sont **jamais** mis en
    pause, seulement resserrés. Une note « Runs automatiques en pause » paraît
    au fil **UNE SEULE FOIS par mise en pause** — et non plus toutes les
    heures : avec un plafond *hebdomadaire* saturé, la pause dure des jours et
    la cadence horaire déposait des **centaines** de cartes identiques, qui
    chassaient le vrai travail hors des 200 entrées du fil. Le repère est
    persisté (un redémarrage du service ne relance pas de carte) et se referme
    dès que la consommation redescend. La carte dit désormais CE QUI est
    suspendu, POURQUOI ça coûte, QUAND ça repart (quelques heures pour la
    fenêtre de 5 h, plusieurs jours pour le plafond hebdomadaire — l'ancien
    texte annonçait toujours la fenêtre de 5 h, à tort) et QUOI faire. Le
    panneau « Consommation IA » affiche l'état du bridage. Sans plafond configuré, le gouverneur est
    inerte. Seuils réglables : `SIRAL_ATTACHE_BUDGET_SERRER_5H` (0,75),
    `SIRAL_ATTACHE_BUDGET_STOP_5H` (1,0), idem `…_7J`.
- **Mode économe (levier manuel)** : Paramètres → Attaché IA →
  « Consommation IA » → **Mode économe**. Les **sous-agents** sont le premier
  poste de dépense (un run complet par PDF/dossier, en parallèle) : le mode
  les bascule sur un **modèle rapide** (Haiku) avec **moins de tours**
  (8 au lieu de 10) et un **effort réduit**, et resserre le run principal
  (24 tours au lieu de 40). Les conversations gardent le modèle choisi.
  À activer pour forcer l'économie en permanence ; à couper pour un
  dépouillement lourd. Autres leviers permanents : choisir un **modèle de
  sous-agents** plus léger (« Cerveau »), baisser l'**effort**, borner la
  concurrence (`SIRAL_ATTACHE_SUBAGENT_CONCURRENCY`) et les tours des
  sous-agents (`SIRAL_ATTACHE_SUBAGENT_MAX_TURNS`, défaut 10), et laisser jouer
  le **cache de PDF** (ci-dessus) qui évite de re-payer l'extraction à chaque
  relecture.
- **Suit vos consignes permanentes** : un « prompt » libre, rédigé par le
  magistrat (Paramètres → Attaché IA → « Consignes permanentes » — l'équivalent
  de vos instructions Claude web : style, méthode, réflexes), relu au début de
  chaque intervention. Chiffré, versionné, modifiable à tout moment. Il
  complète la persona et les règles de gouvernance, il ne les remplace pas.
- **Et vous réglez ses prompts métier** : Paramètres → Attaché IA →
  « Consignes par domaine ». Chaque tâche automatique a un prompt (jusqu'ici
  figé dans le code) que vous LISEZ tel quel — le « socle » — et que vous
  **complétez** ou **remplacez** : rédaction de la description d'un dossier,
  détection des mis en cause, recherche profonde dans la cartographie
  (méthode de l'analyse transversale et cadrage du chat carto), et chacun des
  six étages des chantiers d'analyse profonde (fiche de lot, synthèse, table
  de signalements, rapport de recoupements, propositions carto, bilan carto).
  L'entête (dossier, lot, angle demandé) et les données jointes (liste des
  pièces, corpus de fiches) restent bâties par le moteur : une consigne change
  la méthode et le format, jamais l'acheminement du contexte. Chiffré,
  versionné ; une case vidée rend la tâche à son socle.
- **Skills, comme Claude web** : des méthodes réutilisables (nom +
  description + contenu markdown), gérées dans Paramètres → Attaché IA →
  « Skills ». Le dépôt fournit des **skills prêtes à téléverser** dans
  [docs/skills-attache/](skills-attache/README.md) — dont
  `bilan-semestriel-crimorg.skill` (bilan périodique d'activité complet :
  chiffres, graphiques commentés, tendances, affaires marquantes).
  **Téléversez directement vos fichiers `.skill` exportés de
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
  Bouton **« Classer »** (et classement incrémental au téléversement) : la
  **même passe rapide** que pour les trames/base — un appel modèle par lot,
  **sans sous-agent** — mais elle ne remplit que les descriptions **manquantes**
  (une skill collée en markdown nu) : le front-matter `description` d'un `.skill`
  n'est **jamais écrasé**. Chiffrées (clé globale), versionnées à chaque
  réécriture, suppression réversible. Différence avec les trames : la trame
  est un plan-type de document, la skill une méthode générale.
- **Recherche web en option** : décochée par défaut. Si le magistrat l'active
  (section « Cerveau »), l'attaché gagne WebSearch/WebFetch — comme Claude
  web, utile pour jurisprudence et textes — et RIEN d'autre : shell et
  fichiers restent interdits. Les requêtes de recherche partent alors vers
  l'extérieur : à activer en connaissance de cause, révocable d'un clic.
- **Le « brief quotidien » a été RETIRÉ** (widget, outil `majordome_publier`,
  balayage matinal, case « Brief quotidien automatique », route `/briefing` et
  `SIRAL_ATTACHE_BRIEFING_HOUR`). Il lançait **un sous-agent par dossier** sur
  *tous* les dossiers : de loin le premier poste de jetons, capable de vider la
  fenêtre de 5 h avant même que le magistrat ne travaille — pour un rendu qui
  doublonnait les widgets du tableau de bord (actes qui expirent, poses non
  confirmées, attentes JLD, tous déjà affichés sans lui). Ce que l'attaché a à
  dire arrive désormais **par le fil « pendant votre absence »** (une carte =
  un geste), les remises par **livrable**, et les écritures par **proposition
  ✓/✗**. Un balayage régulier se planifie en **routine** (Paramètres → Attaché
  IA), de préférence de nuit. Les relevés de consommation antérieurs gardent
  leur poste « Brief quotidien (retiré) » : l'historique reste lisible.
- **Tient la description à jour, TOUT SEUL** : la description (« l'objet »)
  d'un dossier se met à jour **progressivement, en arrière-plan**, au fil de
  ce qui l'alimente — **à chaque acte/document téléversé** (l'attaché lit la
  copie markdown générée au passage) **ou à chaque CR rédigé**. Le service
  compare, à chaque relève, une signature déterministe par dossier (nombre et
  date des CR, des documents, des actes — coût nul, aucun jeton) ; dès qu'un
  dossier a bougé, il attend une courte période de calme (les ajouts en rafale
  sont fusionnés) puis lance **un run COURT et ÉCONOME** (modèle rapide, effort
  faible, ≤ 12 tours) — **un seul dossier par relève**, lentement, pour un
  minimum de jetons. Il est **différé** si le forfait sature (gouverneur), et
  la consommation apparaît sous le poste **« Descriptions »** de « Consommation
  IA ». **Dossier volumineux** (≥ `SIRAL_ATTACHE_DESC_CHANTIER_SEUIL`, 100
  pièces déposées par défaut) : un run court n'y suffit pas — l'actualisation
  bascule alors sur un **CHANTIER** de dépouillement complet (pièce par pièce,
  en lots, cantonné à la nuit par défaut) plutôt que de tenter une lecture
  rapide vouée à l'échec ou trop superficielle. Le devis (pièces, lots, nuits
  estimées) est déposé **en attente de validation** — rien ne se lance sans le
  magistrat — et **dit franchement** ce qui se passe (icône et message de
  retour), pour ne pas laisser cliquer sur « Actualiser » sans comprendre
  pourquoi rien ne bouge. La description suit un **format en deux parties, en prise de notes**
  (rédigé à ~80 %, mots inutiles et verbes de liaison retirés, mais clair) :
  - **SYNTHÈSE** — la vision globale des faits, qui **s'enrichit et se
    reformule** à chaque passage (qualification, mode opératoire, lieux,
    période, mesures en cours, échéances) ;
  - **MIS EN CAUSE** — un par un les mis en cause **enregistrés** du dossier
    (jamais inventés), chacun suivi des **éléments à charge** relevés contre
    lui (ce que les CR, actes et pièces établissent).
  Une **icône « Actualiser »** à côté du titre *Description* (détail du
  dossier, admin seul) force la mise à jour **de suite** — en plus de
  l'automatique. L'ancienne description est archivée (`descriptionHistory`),
  rien n'est jamais perdu (en plus du versionnage du coffre).
- **Tient la section « Mis en cause » en cohérence** : la partie *MIS EN CAUSE*
  de la description ne parle que des personnes **enregistrées** — une passe qui
  relève un nom mis en cause absent du dossier le **propose** aussitôt (✓/✗),
  sans jamais l'écrire d'office. C'est le même geste dans les deux sens :
  - **icône « Actualiser » à côté du + de la section *Mis en cause*** (détail du
    dossier, admin seul) : l'attaché relit les CR, actes et documents et dépose
    les noms manquants en propositions — victimes, témoins, enquêteurs,
    magistrats, avocats et simples alias écartés ;
  - **actualisation de la description** : la même passe fait le travail, et le
    message de retour dit combien de mis en cause ont été proposés.
  Les deux runs sont **courts et économes** (modèle rapide, effort faible,
  ≤ 8 tours pour l'icône *Mis en cause*, ≤ 12 pour l'actualisation de la
  description) et apparaissent sous le poste **« Mis en cause (détection) »**
  de « Consommation IA ». Le **dédoublonnage** est vérifié au dépôt :
  - nom **déjà** aux mis en cause du dossier (ou déjà proposé) ⇒ **rien n'est
    déposé** ;
  - nom **très proche** — orthographe voisine (« LAACHIRA Medhi » /
    « LAACHIRRA Mehdi », inversions de lettres comprises), mêmes mots dans un
    autre ordre (« ABAZ YOUSSEF Selim » / « Selim ABAZ YOUSSEF »), prénom ou
    patronyme en moins (« KADER » / « KADER Marco Paulo ») ⇒ **déposé quand
    même, AVEC son avertissement** affiché sous la proposition ;
  - nom **identique (ou voisin) connu d'une AUTRE enquête** ⇒ déposé, avec le
    **numéro du dossier** où il figure déjà.
  Rien n'est bloqué sur un simple rapprochement : le magistrat voit le doublon
  possible et tranche lui-même d'un ✓ ou d'un ✗.
- **Relance les dossiers dormants** : `lister_dossiers` marque `dormant:true`
  tout dossier sans mouvement depuis plus de 2 mois — une routine de veille en
  tire un projet de mail de relance au directeur d'enquête, prêt à coller.
- **Voit TOUT le stock, archives comprises** : `lister_dossiers` est
  **compact, filtrable et paginé** — `portee:"archives"` rend les dossiers
  archivés **seuls** (la population la plus courte, celle qu'on veut passer au
  crible), `portee:"toutes"` l'ensemble, `filtre` cherche un numéro, un objet,
  un mis en cause ou un service, `offset`/`limit` déroulent les pages et la
  réponse dit toujours **combien il reste et à quel offset reprendre**.
  Motif : une réponse d'outil trop grosse n'est pas tronquée par le CLI, elle
  est **déversée dans un fichier** que l'attaché ne peut pas rouvrir (aucun
  outil de lecture de fichiers) — elle est donc *perdue*. C'est ce qui rendait
  le stock archivé inaccessible (« la liste n'a pas pu être extraite »).
  Chaque page est désormais bornée en caractères, quoi qu'on demande, et le
  plafond de sortie du CLI est relevé pour qu'une page pleine de
  `lire_document` passe sans déversement.
- **Dépose lui-même une « analyse profonde » quand le travail déborde de la
  conversation** : dépouiller un dossier entier, chercher une adresse ou une
  ligne dans les pièces de tous les dossiers, préparer un règlement. Il épuise
  d'abord les outils gratuits et exhaustifs (`registre_recouper`,
  `pieces_chercher`), puis dépose un **chantier en DEVIS**
  (`chantier_proposer`) dans la bande « Analyses profondes » de la page
  Assistant de justice : pièces, lots, jetons, **heures**, nuits. Rien ne
  démarre sans le clic du magistrat (« Valider le devis et lancer ») ; ensuite
  le moteur travaille **en arrière-plan, la nuit**, par lots, avec reprise
  automatique — l'app peut être fermée. `chantier_piloter` lance ou met en
  pause sur instruction explicite. Le devis déposé depuis une conversation est
  signalé comme tel dans l'atelier. Fini les réponses qui se terminent par une
  réserve d'exhaustivité sans issue : la réserve devient un devis.
- **Le graphe de la carte, CALCULÉ côté serveur (`carto_analyser`,
  `carto_chemin`)** : l'IA ne raisonne plus sur des listes — elle reçoit le
  **score d'importance de la carte** (même formule, mêmes pondérations que
  l'écran : module partagé `lib/carto/scoreCore.mjs` + coffre
  `cartographie-config`), décomposé composant par composant (dossiers,
  chefs, gravité NATINF, facteur temporel, entourage, bonus et rôles du
  magistrat) ; la **centralité d'intermédiarité** (Brandes — les courtiers
  par qui passent les chemins, souvent invisibles au degré) ; les
  **communautés** (Louvain — les cellules telles que la structure les
  dessine, à confronter aux camps cochés à la main) ; et `carto_chemin`
  répond à « qu'est-ce qui relie X à Y ? » par les plus courts chemins,
  chaque saut citant sa provenance (dossier partagé, lien tracé). Zéro
  jeton, zéro écriture. Il lit aussi les **signaux de la veille des
  recoupements** (`recoupements_lire` — pièces et OCR compris, filtres par
  dossier/nature, `inedits` pour les ponts sans aucun mis en cause commun).
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
  revue** présent à TROIS endroits : flottant en bas-gauche de la
  cartographie, dans le panneau de l'attaché, et **en tête de la page
  « Assistant de justice »** (bloc « Proposition à valider ») — c'est là que
  les cartes de l'attaché atterrissent, et l'on y trouve donc aussi de quoi
  trancher ce qu'une analyse a déposé. ✓ trace sur la carte (signé de son
  nom), ✗ refuse. Les propositions sont écrites **au fil de l'eau** : celles
  déjà déposées survivent à un run interrompu. Idéal en routine hebdomadaire.
- **Statistiques et bilans d'activité — il VOIT les courbes** : quatre outils
  donnent à l'attaché le même regard que le magistrat sur la page
  Statistiques — **par année civile comme à l'écran** (`stats_ecran`,
  `stats_annees`) ou sur une **période libre** (`stats_synthese`) :
  - **`stats_ecran`** — la page Statistiques telle qu'elle s'affiche pour une
    année, **section par section et carte par carte** : le titre exact de
    chaque carte, sa valeur, son détail et sa **règle de calcul**. C'est la
    réponse à « mes statistiques », à un chiffre lu à l'écran ou à un écart
    constaté : l'attaché cite la carte au lieu de refaire le calcul (et de
    tomber à côté, les règles de la page étant subtiles — terminées hors
    classements et OI, CRPC comptées par prévenu, défèrements à leur date
    réelle, saisies ≠ confiscations, année en cours arrêtée au mois courant).
    Couvre les quatre sections, instruction comprise (mesures de sûreté,
    dossiers à régler au 175, délai de clôture par cabinet).
  - **`stats_synthese`** — le bilan chiffré complet du contentieux, avec les
    MÊMES règles de calcul que la page Statistiques et le rapport PDF :
    procédures **terminées** depuis une date (chiffre-phare hors classements
    et OI, par mois, et la **liste des dossiers** — orientation, services,
    catégories d'infraction, durées), **défèrements** à leur date réelle
    (par mois + liste datée), ouvertures et stock, orientations
    (CRPC/CI/COPJ/OI/CDD/classements), peines (moyennes, prison ferme
    totale, amendes, interdictions), **saisies et confiscations** (véhicules,
    immeubles, avoirs, crypto), actes TSE, répartition par service et par
    catégorie (tendance mensuelle comprise), suivi **JIRS/PG**, photographie
    du module instruction, et **comparatif automatique avec la même période
    un an plus tôt**. Les listes permettent d'enchaîner sur `lire_dossier`
    (ou un lot de `sous_agents`) pour les dossiers marquants.
  - **`stats_graphique`** — les graphiques eux-mêmes, rendus en **PNG côté
    service** (aucune dépendance, aucun navigateur) et transmis à l'agent en
    **image**, un par un ou par **planche entière** (`graphiques[]`) sur une
    année ou une période : courbes des procédures terminées et des
    défèrements, histogrammes des ouvertures/condamnations/prison
    ferme/amendes, donuts d'orientation, de services (terminées ou toutes
    enquêtes), de catégories et de grands titres d'infraction, colonnes
    groupées saisies vs confiscations et peines moyennes par type d'audience,
    classements et OI par mois, mesures de sûreté à l'instruction,
    orientation par mois, et **tendance des catégories mois par mois** (la bascule « atteintes aux
    biens en début d'année → stupéfiants ensuite » se VOIT). Mêmes couleurs
    que l'app (source unique `lib/stats/chartCouleurs`), données chiffrées
    exactes jointes à chaque image : l'attaché décrit les dynamiques en
    regardant le graphe et cite les nombres sans jamais les estimer. De quoi
    produire un **bilan semestriel** ou un rapport de politique pénale
    complet — chiffres, visuels commentés, dossiers marquants anonymisés,
    contexte tiré de la base de connaissances — remis dans SIRAL
    (`remettre_livrable` / `produire_document`).
  - **Les graphiques s'insèrent TOUT SEULS dans le document final** : le
    bilan place chaque graphique par un marqueur texte
    `[GRAPHIQUE : nom | du=… | au=…]` (le document reste éditable en texte
    brut dans « Actes rédigés ») ; à l'**export PDF/Word**, chaque marqueur
    est remplacé automatiquement par l'image PNG régénérée par le service
    (route `/stats-graphique`, périmètre admin) — rien à copier-coller. Si le
    service est indisponible, une ligne de repli lisible remplace l'image,
    l'export n'échoue jamais.
  - **Les règles de calcul ne sont écrites qu'UNE fois** : l'écran, l'export
    PDF et l'attaché consomment les mêmes modules partagés
    (`lib/stats/audienceCore.mjs`, `lib/stats/actesCore.mjs`,
    `lib/natinf/nataffRegles.mjs`, `lib/stats/chartCouleurs.mjs`) — pas de
    triple implémentation à maintenir. Vérifié de bout en bout par
    `scripts/attache-stats.test.mjs` (coffre chiffré réel + serveur MCP en
    stdio, 30+ assertions).
- **Bureautique complète — présentations, diagrammes, Excel (parité Claude
  web, sans que rien ne sorte de SIRAL)** :
  - **Présentations PowerPoint** : « prépare-moi une présentation du bilan
    pour le procureur général » → l'attaché rédige un diaporama (type
    `presentation`) en texte structuré (`#` page de garde, `##` une
    diapositive, puces, tableaux, marqueurs de graphiques), rangé dans
    « Actes rédigés » comme les autres productions : relecture, retouche par
    le chat, édition à la main… puis bouton **« PowerPoint »** — un vrai
    fichier `.pptx` (généré dans le navigateur, aucune dépendance nouvelle),
    gabarit sobre 16:9 aux couleurs de l'app (page de garde, filets, tableaux
    zébrés, images des graphiques insérées, numérotation), lisible par
    PowerPoint, LibreOffice et Keynote.
  - **Diagrammes sur données libres** : en plus des `[GRAPHIQUE : …]` du
    catalogue statistique, l'attaché insère dans n'importe quel document un
    marqueur `[DIAGRAMME : colonnes | titre=… | Étiquette: valeur ; …]`
    (colonnes, barres, courbe, secteurs — données qu'il a lui-même
    dénombrées : dossier, tableur reçu, ventilation calculée). Aux exports
    **PDF, Word et PowerPoint**, le marqueur devient l'image du graphique
    (rendue localement — Chart.js, couleurs de l'app, aucun aller-retour
    serveur) ; à l'écran le document reste du texte brut éditable.
  - **Fichiers Excel lus partout** : les classeurs `.xlsx`/`.xls`/`.ods`
    téléversés (zones documents, base de connaissances, trames, dossier
    complet d'instruction) ou confiés (trombone du dépôt, pièce jointe d'un
    mail transféré) sont convertis en **tableaux markdown feuille par
    feuille** (navigateur au téléversement, serveur pour les mails/le dépôt —
    même conversion partagée `lib/tableur/classeurMarkdown.mjs`, SheetJS déjà
    en dépendance) : l'attaché lit un listing téléphonique, un état de
    saisies ou un tableau de gestion comme n'importe quelle pièce, recoupe,
    totalise et cite feuille et ligne. Classeurs volumineux tronqués avec
    mention explicite, jamais en silence.
  - **Export tableur** : tout tableau markdown d'une production s'exporte en
    classeur **Excel réel** (bouton « Tableur » — une feuille par tableau,
    nombres français reconnus donc triables et sommables, largeurs
    ajustées) : les décomptes et échéanciers remis par l'attaché deviennent
    des données exploitables, pas des copies d'écran.
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
  chaque trame est chiffrée et versionnée comme les autres. Bouton
  **« Classer la bibliothèque »** (et option « Faire classer » au
  téléversement) : une **passe de description rapide** — un seul appel modèle
  par lot d'une vingtaine de trames, **sans sous-agent**, en lecture de
  l'en-tête. Pour chaque trame, l'attaché écrit une **description d'une phrase**
  (type d'acte, cadre juridique, articles visés, régime droit commun ou
  dérogatoire 706-80) via `trame_decrire` — **le contenu n'est JAMAIS modifié** —
  et signale les **doublons manifestes**. Quelques secondes, quelques milliers
  de jetons (là où l'ancienne délégation d'une analyse approfondie à un
  sous-agent par trame était lente, souvent interrompue avant de rendre quoi que
  ce soit, et très gourmande). Le rapprochement entre la réponse du modèle et
  chaque trame est **tolérant** (forme normalisée du nom : le modèle n'a pas à
  recopier un slug de 60 caractères au caractère près), et toute trame qu'un lot
  n'aurait pas décrite est **reprise une par une** — plus aucune trame ne reste
  « pas encore classée » par un simple aléa de formatage. Pour une **analyse juridique en profondeur** d'une
  trame (contrôle de légalité fondement par fondement, nullités, propositions de
  réécriture) : la demander **dans le chat de l'attaché**, sur cette trame
  précise — ciblée et bornée. Le bouton indique clairement s'il faut d'abord
  remettre les clés et affiche l'état du lancement sur place.
- **Associations acte → trame + skill, suggérées en un clic** : la table que
  l'attaché consulte avant de rédiger (« pour ce type d'acte, cette trame + cette
  skill, d'office »). Elle se remplissait jusqu'ici uniquement en le disant en
  chat, une par une — d'où une table souvent vide. Le bouton **« Suggérer »**
  (Paramètres → Attaché IA → Associations) lance une passe rapide (un appel
  modèle, sans sous-agent) qui lit les noms + descriptions des trames et des
  skills et **propose** les liens. Les suggestions arrivent en **lignes de
  brouillon** : vous vérifiez, ajustez, puis **« Enregistrer »** — **rien n'est
  appliqué à une rédaction tant que vous n'avez pas validé** (les noms sont
  vérifiés contre la bibliothèque réelle ; les types d'acte déjà présents ne sont
  pas re-suggérés). Classez d'abord la bibliothèque (« Classer ») pour des
  suggestions plus fines.
- **Base de connaissances — le cerveau documentaire** (pensez Obsidian
  branché sur l'IA) : le fond durable du cabinet — jurisprudences,
  conventions et circulaires, modes opératoires, fiches réflexes, contacts —
  versé par **dossiers entiers, sous-pochettes comprises** (sélecteur de
  dossier ou glisser-déposer récursif : l'arborescence d'origine est
  préservée), converti en **markdown dans le navigateur** (seul le texte est
  conservé : place et tokens économisés) puis chiffré. Le panneau l'affiche
  **comme un explorateur Windows** : pochettes repliables, lecture d'une
  entrée au clic, édition, suppression par fichier ou par pochette.
  L'attaché en est le **bibliothécaire** : « Faire ranger toute la base »
  (au téléversement ou sur toute la base) est la **même passe de description
  rapide** que pour les trames — un appel modèle par lot, **sans sous-agent**,
  en lecture de l'en-tête : pour chaque entrée, l'attaché écrit sa description,
  fixe catégorie et rangement (`kb_decrire` — le contenu n'est jamais modifié)
  et signale doublons et textes périmés.
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
  En chat, « ajoute à la base de connaissances » fonctionne aussi : un TEXTE
  collé/dicté via `kb_enregistrer`, et surtout un **FICHIER confié** (pièce
  jointe d'un mail transféré ou pièce du dépôt) via **`kb_ranger_piece`** —
  « ci-joint ce memento / cette documentation du ministère, intègre-le à ta
  base et classe-le dès réception ». L'attaché en **extrait le texte côté
  serveur** (PDF/ODT/DOCX/RTF — comme le navigateur au téléversement), n'en
  conserve que le texte chiffré, et le **classe à la réception** (catégorie,
  pochette, description, ★ réflexe au besoin). Chiffrée (clé globale),
  versionnée, réversible.
  PDF scannés (image, sans texte) : détectés et signalés au téléversement
  comme au rangement par mail (`kb_ranger_piece` **refuse** alors la pièce,
  rien n'est enregistré) — passez-les par un OCR avant.
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
  Une routine de veille anticipe aussi les échéances instruction : DML en
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
  - **Contrôles de cohérence intégrés** : l'analyse confronte chaque document
    au dossier — **numéro de procédure divergent** (pièce téléversée dans le
    mauvais dossier ?), **NATINF visés absents** de la fiche, **dates
    incohérentes** — et l'affiche en tête des résultats. Elle **suggère un CR
    de réception** (prise de notes courte : ce que les pièces apportent),
    classé au dossier d'un clic, signé de votre nom.
  - **Accessible sur le web** : au téléversement d'une pièce dans une zone
    d'actes (Actes, Geoloc, Écoutes, DML), une bannière « Analyser (IA) »
    apparaît au-dessus des zones (admin + attaché actif) — le texte a déjà
    été converti dans le navigateur, l'analyse part en un clic. Rien ne se
    lance tout seul.
  - Les mêmes contrôles (numéro de procédure, NATINF, CR de réception) font
    partie des **réflexes de l'attaché** pour toute pièce reçue par mail ou
    par le dépôt : rien n'entre dans un dossier sans avoir été confronté à ce
    que SIRAL sait déjà.
- **Propose au lieu d'écrire quand il DÉTECTE** : à la lecture d'une pièce
  (document, PV, mail), un nom nouveau → proposition de **mis en cause**
  (dédoublonnage automatique, casse/accents compris) ; une mesure évoquée →
  **acte pré-construit** (jusqu'à la demande JLD) ; des éléments nouveaux →
  **CR en prise de notes**. Les propositions apparaissent en bandeau dans le
  détail du dossier, pour le seul administrateur, avec **✓** (appliquer) et
  **✗** (refuser) discrets. Rien n'est écrit avant le ✓. L'écriture directe
  reste réservée aux instructions explicites du magistrat. Le **✗ ouvre un
  champ « motif » facultatif** : dites en un mot POURQUOI (hors sujet,
  doublon, mauvaise qualification…) — le motif part en signal
  d'apprentissage, la consolidation en tire la règle, comme pour un acte
  refusé.
- **Ne laisse AUCUNE trace dans les données partagées** : les CR et
  écritures sont signés **du nom de l'administrateur** (jamais « Attaché
  IA »), y compris le `modifiedBy` de la synchronisation. L'attribution
  réelle de chaque action vit dans le journal d'audit chiffré, visible du
  seul administrateur. Les routes répondent 404 aux non-admins : la
  fonctionnalité est indistinguable d'une route inexistante.
- **Routines** : consignes récurrentes définies par le magistrat
  (quotidiennes à HH:MM ou toutes les N heures), gérées dans Paramètres →
  Attaché IA — créer, suspendre, exécuter immédiatement, supprimer. **Et
  gérées en conversation** : « chaque matin vérifie les échéances », « toutes
  les semaines cherche les liens cachés » → l'attaché enregistre la routine
  lui-même (`routine_enregistrer`, prompt autonome, heure de nuit pour les
  balayages lourds), la suspend, la réactive ou la supprime sur demande
  (`routine_suspendre` / `routine_supprimer`) — et confirme toujours nom +
  cadence. Une routine qui échoue laisse une carte d'alerte au fil, qui dit
  **combien de propositions avaient déjà été déposées** avant l'interruption et
  **où les trancher** — un run tué à mi-course a presque toujours déjà écrit
  quelque chose, et « interrompue » tout court laissait croire le contraire.
  **Plafond de durée** : une routine n'est pas un run de chat — elle balaye et
  délègue à des sous-agents, sans personne devant l'écran. Elle héritait
  pourtant des 20 min d'un run de chat et se faisait tuer avant d'avoir déposé
  son travail. Elle dispose désormais de `SIRAL_ATTACHE_ROUTINE_TIMEOUT_MIN`
  (défaut **60 min**), et les routines qui balayent la **cartographie**
  reçoivent d'office le plafond carto (`SIRAL_ATTACHE_CARTO_TIMEOUT_MIN`,
  défaut **90 min**) — le même que le chat carto, qui l'avait déjà pour cette
  raison exacte.
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
  **NATINF enregistrés du dossier**). **La destination désignée par le
  magistrat prime toujours** : « rédige la synthèse du dossier X et verse-la
  dans les actes rédigés de l'enquête Y », « fais cet acte du dossier A mais
  range-le hors dossier » — l'attaché exécute ce rangement-là, tel quel, même
  s'il paraît incohérent avec le contenu (c'est un choix d'organisation du
  magistrat, pas une erreur à corriger) : ni refus, ni question de
  confirmation, au plus une phrase de récapitulatif. Les contrôles de
  cohérence et l'identification rigoureuse du dossier ne jouent que lorsque
  l'attaché doit trouver la destination lui-même. Seul filet (non bloquant) :
  un numéro qui ne correspond à aucune enquête déclenche un avertissement à
  l'agent — l'acte est enregistré mais n'apparaîtrait dans aucun dossier. Le magistrat les visionne, demande à
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
  masquée quand vide) — mêmes exports officiels, même validation ✓. Le
  rangement hors dossier vaut aussi **sur simple demande** : « fais cet acte
  et range-le hors dossier » suffit, même quand une procédure correspondante
  existe — la consigne de rangement du magistrat prime.
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
   # facultatif : autres expéditeurs autorisés à donner des consignes
   # (secrétariat…) — tout expéditeur hors liste est ignoré et signalé
   SIRAL_ATTACHE_ALLOWED_SENDERS=
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

   **Quand cette connexion tombe** (elle expire), l'attaché ne répond plus
   rien d'utile : chaque échange est refusé par le CLI. Le panneau le dit
   maintenant explicitement — Paramètres → Attaché IA → **Connexion Claude
   Code** : pastille rouge, motif du refus, bouton *Tester* (un « ping »
   minuscule chez Claude, sans outils). Deux façons de rebrancher :

   - depuis le serveur, comme ci-dessus (`docker compose exec -it attache
     claude`) ;
   - **sans toucher au serveur** : sur une machine de confiance connectée à
     Claude, `claude setup-token`, puis coller la ligne `sk-ant-…` dans
     *Coller un jeton*. Le jeton est confié au service attaché qui le chiffre
     avec sa clé-maître (l'app ne le stocke jamais) et l'injecte dans
     l'environnement de chaque run ; *Effacer* revient à la session du
     serveur. Les conversations en cours ne sont pas perdues.

   Tant que la connexion est rompue, le fil de conversation affiche une panne
   nommée (avec le remède) et non plus la ligne brute du CLI « Not logged in ·
   Please run /login » — qui se lisait comme une réponse de l'attaché, alors
   que `/login` n'existe pas dans ce mode.

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

## Connecteur Claude web (optionnel)

Les MÊMES outils que l'attaché, pilotés **depuis claude.ai** (connecteur MCP
personnalisé) : lecture des dossiers, statistiques, écritures réversibles et
auditées — sans attendre que le panneau intégré rattrape chaque nouveauté de
Claude web. OAuth réservé à l'administrateur (session passkey +
consentement), désactivé par défaut, activation dans Paramètres → Attaché IA
→ **Connecteur Claude web**, révocation un clic. Deux outils sont exclus du
connecteur : `sous_agents` et `poser_question` — pour un travail de masse,
Claude web dépose un **chantier d'analyse profonde** (`chantier_proposer`),
exécuté par le serveur, plutôt que de tout lire dans sa conversation. Guide complet :
**[CONNECTEUR-CLAUDE-WEB.md](CONNECTEUR-CLAUDE-WEB.md)**.

## « Je n'ai plus d'assistant de justice »

Tout le module — entrée de menu, page, onglet **Paramètres → Attaché IA**,
raccourci, actes rédigés — est commandé par une seule sonde : `GET
/api/attache/status?sonde=1`. Ce qu'elle répond décide de ce que voit le
magistrat.

| Réponse | Sens | Ce que fait l'app |
|---|---|---|
| `200` | service vivant | module complet |
| `404` | fonctionnalité absente **pour ce compte** : non-admin, `SIRAL_ATTACHE_URL` vide, ou TJ actif ≠ `SIRAL_ATTACHE_TJ` | module invisible (voulu — l'attaché n'existe pour personne d'autre) |
| `401` | secret de pont dépareillé entre l'app et le service | module VISIBLE, marqué injoignable |
| `503` | conteneur `attache` arrêté, en redémarrage, ou saturé | module VISIBLE, marqué injoignable |

La distinction `404` / reste est le point important : la garde admin est passée
avant tout code ≠ 404, donc le module existe bel et bien pour ce magistrat — il
reste affiché, avec son écran de diagnostic, et la sonde se relance toutes les
60 s pour se raccrocher seule. Les **actes rédigés**, eux, se lisent alors
directement depuis le volume partagé (`attache/productions/`) : ils restent
consultables en lecture seule ; validation, édition et retouche IA attendent le
retour du service.

Sur le serveur, dans l'ordre :

```bash
docker compose ps attache                 # tourne-t-il ?
docker compose logs --tail=50 attache     # redémarre-t-il en boucle ?
docker compose up -d attache
```

Trois causes reviennent : le conteneur arrêté (ou en boucle de redémarrage après
une mise à jour), un `SIRAL_SECRET` changé d'un côté seulement — app et service
en dérivent le même secret de pont, ils doivent donc redémarrer ENSEMBLE — et le
TJ actif qui n'est pas le TJ confié (l'attaché n'existe que sur
`SIRAL_ATTACHE_TJ` : basculer de tribunal le fait disparaître, sans erreur).

La sonde est délibérément **brève** (`?bref=1` côté service) : elle ne lance ni
`claude --version` ni lecture de boîte, et n'attend que 8 s. Un service occupé
par un run de nuit ne doit jamais faire disparaître l'assistant par simple
lenteur.

### Le diagnostic, dans l'application

**Paramètres → Attaché IA** est désormais TOUJOURS offert à l'administrateur —
service éteint, mauvais tribunal, fonctionnalité désactivée, peu importe. C'est
l'écran qui répond à « pourquoi je ne le vois plus » : il coche ou barre les
quatre conditions, une à une, avec la valeur en cause.

```
✅ Fonctionnalité activée sur le serveur
❌ Tribunal actif = tribunal confié — vous êtes sur amiens, l'attaché n'existe que sur default
✅ Secret de pont app ↔ service
❌ Service attaché joignable — réponse 503 : Service attaché injoignable
```

Il s'appuie sur `GET /api/attache/diagnostic`, rendu à une session
**administrateur** seulement ; tout autre appelant reçoit le 404 d'une route
inexistante — l'attaché reste indevinable des autres comptes.

## Masquer toutes les fonctionnalités IA

Même écran, en tête : un interrupteur **« Masquer toutes les fonctionnalités
IA »**. Coché, l'application redevient exactement celle d'avant l'attaché :

| Disparaît | Reste |
|---|---|
| entrée de menu « Assistant de justice » et sa page | l'onglet Paramètres → Attaché IA |
| raccourci de la barre du haut, panneau latéral, pastille de chantier | le service, qui poursuit son travail de fond |
| « Actes rédigés » des fiches dossier et hors dossier | les actes eux-mêmes, intacts sur le serveur |
| chat de dossier et chat carto | |
| propositions de renseignement, barre de propositions, chronologie | |
| « Détecter les camps (attaché) » et « Enrichir (attaché) » de la cartographie | |

L'onglet des paramètres ne se masque jamais : c'est de là que l'on décoche. Le
drapeau est tenu par l'**app** (`ia-visibilite.json` dans l'espace du TJ actif,
`GET`/`PUT /api/attache/visibilite`, administrateur seul) : il se règle service
éteint, et il vaut sur tous les appareils du magistrat — le `localStorage` n'en
est qu'un cache de premier rendu, pour que rien ne clignote au chargement.

Masquer n'est pas révoquer : le service continue de tourner, de lire et
d'écrire. Pour l'arrêter vraiment, voir la révocation ci-dessous.

## Révocation & réversibilité

| Geste | Effet |
|---|---|
| Paramètres → Attaché IA → **Révoquer** | l'attaché ne déchiffre plus rien, immédiatement |
| Changer `SIRAL_ATTACHE_MASTER_KEY` | trousseau illisible = révoqué de fait |
| Vider `SIRAL_ATTACHE_URL` | fonctionnalité totalement absente de l'app |
| Paramètres → Attaché IA → **Masquer toutes les fonctionnalités IA** | l'attaché disparaît de l'interface, mais continue de travailler (affichage seul) |
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
connecté (`claude login`) sur la machine qui exécute le service — ou recevoir
un jeton d'abonnement (`CLAUDE_CODE_OAUTH_TOKEN`, ou saisi dans Paramètres →
Attaché IA → Connexion Claude Code).

Tests ciblés : `node scripts/attache-auth.test.mjs` (connexion du CLI :
requalification des refus, rangement chiffré du jeton, état rendu au panneau).
