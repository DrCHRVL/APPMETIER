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
- **N'écrit à l'extérieur qu'au magistrat** : l'unique sortie du système est
  un mail vers `SIRAL_ATTACHE_OWNER_EMAIL`. Le destinataire n'est pas un
  paramètre de l'outil : il est câblé côté serveur.
- **Retient** : une mémoire markdown (préférences, réflexes appris) relue à
  chaque intervention — lisible, corrigeable et effaçable depuis le panneau.
- **Se règle comme Claude web** : choix du **modèle** (Fable 5, Opus 4.8,
  Sonnet 5, Haiku 4.5 — ou le défaut de l'abonnement) et du **niveau
  d'effort** de raisonnement (faible → maximal), depuis le composer du chat
  ou Paramètres → Attaché IA (section « Cerveau »). Le réglage est persisté
  et vaut pour TOUS les runs : chat, mails transférés, brief, routines.
- **Suit vos consignes permanentes** : un « prompt » libre, rédigé par le
  magistrat (Paramètres → Attaché IA → « Consignes permanentes » — l'équivalent
  de vos instructions Claude web : style, méthode, réflexes), relu au début de
  chaque intervention. Chiffré, versionné, modifiable à tout moment. Il
  complète la persona et les règles de gouvernance, il ne les remplace pas.
- **Skills, comme Claude web** : des méthodes réutilisables (nom +
  description + contenu markdown), gérées dans Paramètres → Attaché IA →
  « Skills » — vos skills Claude web s'y collent telles quelles. Même
  divulgation progressive que Claude web : l'attaché voit en permanence la
  liste (nom + description) dans son prompt, et charge le contenu complet
  (outil `skill_lire`) dès qu'une tâche correspond. En chat, « enregistre
  cette skill » fonctionne aussi (`skill_enregistrer`). Chiffrées (clé
  globale), versionnées à chaque réécriture, suppression réversible.
  Différence avec les trames : la trame est un plan-type de document, la
  skill une méthode générale.
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
  suivant les trames, via l'outil `produire_document`). Le magistrat les
  visionne, demande à l'IA de les retoucher (chat du dossier), les **édite
  légèrement à la main** (puis Enregistrer — le navigateur rechiffre, l'app
  ne voit jamais le clair), les **exporte en PDF / Word**, et surtout les
  **glisse directement vers son parapheur** (portail de signature) grâce à
  la puce « parapheur » (après « Préparer pour signature », qui génère le
  PDF joint au glisser-déposer).

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
