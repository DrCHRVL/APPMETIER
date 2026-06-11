# Plan de bataille — SIRAL : migration vers une app web sécurisée

> **SIRAL — Suivi Intégré des Réseaux criminels et Affaires Liées** (nouveau nom de
> l'app, acté le 11 juin 2026). Décision actée : **dépôt unique** — l'édition web est
> développée ici même, l'app Electron restant fonctionnelle pendant toute la transition.
>
> Évaluation du passage de l'app portable Electron vers une application web hébergée,
> avec chiffrement côté client, identification forte, double stockage (serveur + secours local)
> et, à terme, un accès mobile iPhone. Rédigé le 11 juin 2026.

---

## 1. Constat : pourquoi le modèle actuel arrive au bout

L'app actuelle est une app **Electron portable Windows** : Next.js embarqué, données dans
`data.json` local, synchronisation par copie de fichiers sur le partage réseau du TGI
(`P:\TGI\Parquet\...`), mises à jour par `launcher.bat`.

Limites structurelles constatées (et déjà subies — cf. les correctifs « anti-érosion de
data.json », la sérialisation des écritures, les gardes anti-corruption) :

| Limite | Conséquence |
|---|---|
| Synchro par fichiers sur partage réseau | Conflits, corruption, dépendance au réseau interne, pas d'accès hors site |
| `data.json` monolithique | Fragile, toute écriture concurrente est un risque |
| Distribution portable + launcher.bat | MAJ artisanales, parc hétérogène, version par poste |
| Electron | Pas de mobile, pas d'accès navigateur, ~200 Mo par poste |
| `main.js` (~150 Ko) | Toute la logique fichiers/OCR/PDF est soudée au desktop |

**Conclusion : l'orientation web est la bonne.** Et l'atout majeur est que l'app est *déjà*
une app Next.js — le frontend (composants, stores, écrans) est réutilisable quasi tel quel.
Le chantier réel, c'est remplacer la couche Electron (`main.js` + `preload.js` + IPC) par
une API serveur et une couche de stockage chiffrée.

---

## 2. ⚠️ Préalable non technique : la nature des données

Les données manipulées sont des **données d'enquêtes pénales nominatives** (mis en cause,
opérations en cours, interceptions, JLD…). C'est couvert par le secret de l'enquête
(art. 11 CPP) et par le régime RGPD / directive « police-justice ». Héberger cela sur un
serveur loué à titre personnel est d'abord une **question juridique et déontologique**,
avant d'être technique. Trois garde-fous :

1. **Le chiffrement de bout en bout (E2EE) n'est pas une option, c'est la condition
   d'existence du projet.** Le serveur ne doit stocker que des blobs chiffrés côté client ;
   l'hébergeur (et même l'admin du serveur) ne doit jamais pouvoir lire quoi que ce soit.
   Architecture « zéro connaissance ».
2. **Hébergeur français/UE uniquement**, idéalement qualifié **SecNumCloud** (OVHcloud,
   Outscale) ou à défaut un acteur FR/UE sérieux (Scaleway, Clever Cloud). Éviter tout
   cloud soumis au Cloud Act américain.
3. **Valider le principe avec le RSSI / la PSSI du ministère** si possible. Plan B tout à
   fait viable : héberger la même app sur une machine *interne* accessible en intranet —
   l'architecture proposée ci-dessous fonctionne à l'identique dans les deux cas.

Mesure complémentaire peu coûteuse : **pseudonymisation à la source** (numéros de dossier
et noms d'opération plutôt que les identités complètes quand c'est possible).

---

## 3. Architecture cible

```
┌────────────────────────┐        HTTPS (TLS)         ┌──────────────────────────┐
│  Navigateur (Edge/     │  blobs chiffrés AES-GCM    │  Serveur VPS FR/UE       │
│  Chrome/Safari)        │ ─────────────────────────► │  · Auth WebAuthn         │
│  · App Next.js (PWA)   │ ◄───────────────────────── │  · Stockage blobs        │
│  · Chiffrement WebCrypto│                           │    versionnés (opaques)  │
│  · Cache IndexedDB     │                            │  · Journal d'accès       │
│    (chiffré, offline)  │                            │  · Invitations/révocation│
└──────────┬─────────────┘                            └──────────────────────────┘
           │ export manuel/planifié
           ▼
   Sauvegarde locale chiffrée (.backup sur disque / clé USB)
```

### 3.1 Frontend — le plus simple du chantier
- **La même app Next.js**, servie par le serveur au lieu d'être embarquée dans Electron.
- **PWA installable** : sur PC, Edge/Chrome proposent « Installer l'application » (icône,
  fenêtre dédiée, raccourci — l'expérience reste « comme une app ») ; sur iPhone,
  « Ajouter à l'écran d'accueil » donne une vraie app plein écran, **sans App Store, sans
  compte développeur Apple**. C'est exactement l'objectif « app téléchargeable depuis le
  serveur ».

### 3.2 Authentification forte
- **Décision actée : WebAuthn / passkeys** (Windows Hello, Face ID, ou clé physique type
  YubiKey ~50 €). Standard, anti-phishing par construction, zéro mot de passe à retenir,
  support natif des navigateurs. C'est ce qu'il y a de plus fort *et* de plus simple à
  déployer pour une petite équipe.
- ~~Carte agent (certificat client / mTLS)~~ — **écartée** : dépendante du middleware du
  ministère, complexité disproportionnée pour le gain.
- **Séparation des rôles** : la passkey **authentifie** (qui entre), une **phrase secrète
  distincte déchiffre** (qui lit). Le serveur ne voit jamais la phrase. Variante élégante :
  l'extension **PRF de WebAuthn** permet de dériver la clé de chiffrement directement de la
  passkey (une seule cérémonie de connexion) — supportée par les navigateurs récents.

### 3.3 Chiffrement côté client (E2EE)
- **WebCrypto API** (native navigateur) : AES-256-GCM pour les données, **Argon2id** pour
  dériver la clé depuis la phrase secrète.
- **Multi-utilisateurs** : une clé de coffre par contentieux (crimorg/ecofi/enviro),
  *enveloppée* (key wrapping) pour chaque membre avec sa clé personnelle. L'admin invite et
  révoque sans jamais exposer la clé au serveur.
- **Modèle de données** : conserver dans un premier temps le modèle « un coffre = un blob
  JSON versionné » (c'est le `data.json` actuel, chiffré et versionné côté serveur).
  C'est trivial à chiffrer E2EE, ça réutilise tout le code existant, et le serveur garde
  un historique de versions (= sauvegardes automatiques). Le passage à une vraie base
  champ-par-champ ne se justifiera que si la volumétrie ou la concurrence d'édition
  l'exigent.
- **Risque assumé à documenter** : phrase secrète perdue = données irrécupérables.
  Prévoir un **kit de récupération** imprimé (clé de secours) conservé sous scellé au
  service.

### 3.4 Double stockage (reproduction du schéma actuel, en mieux)
- **Serveur** : chaque sauvegarde pousse un blob chiffré versionné (historique N versions).
- **Local (secours)** : cache **IndexedDB chiffré** → l'app fonctionne **entièrement
  hors-ligne** et resynchronise au retour du réseau (file d'attente d'écritures) ;
  - **export chiffré téléchargeable** (`.backup`) planifiable, à poser sur disque/clé USB ;
  - la **File System Access API** (Edge/Chrome) permet même d'écrire automatiquement la
    sauvegarde dans un dossier local choisi une fois pour toutes.

### 3.5 Agenda — intégration Google Calendar (lecture seule)
Objectif : voir dans le panneau « Aujourd'hui » les RDV enquêteurs fixés depuis l'iPhone
sur Google Agenda, fusionnés avec les échéances internes de l'app (audiences JLD,
échéances de dossiers).

- **Sens unique, lecture seule** : l'app *lit* le Google Agenda (OAuth 2 ou, plus simple,
  l'« adresse secrète iCal » du calendrier) et affiche les événements à côté des échéances
  internes, avec un badge « G » pour distinguer la source.
- **Règle d'or : rien ne part vers Google.** Les échéances d'enquêtes ne sont jamais
  écrites dans Google Calendar (serveurs US, hors E2EE). La fusion ne se fait que dans le
  navigateur, à l'affichage.
- **Discipline côté téléphone** : garder des intitulés neutres dans Google
  (« RDV Cne Durand » plutôt qu'un nom d'opération) — c'est le seul point qui dépend de
  l'utilisateur, pas de la technique.
- Option ultérieure : un calendrier *interne* à l'app (chiffré E2EE comme le reste) +
  abonnement iCal sortant volontairement minimal si besoin de rappels sur téléphone.

### 3.6 OCR / PDF
`tesseract.js`, `pdfjs-dist` et `pdf-parse` tournent déjà en JavaScript : ils peuvent
s'exécuter **dans le navigateur** (Web Workers). Indispensable de toute façon : avec
l'E2EE, le serveur ne peut pas traiter le contenu — tout traitement reste côté client.

---

## 4. Hébergement & budget

| Option | Acteur | Coût/mois | Remarque |
|---|---|---|---|
| VPS infogéré soi-même | OVHcloud VPS (FR) | 6–12 € | Souveraineté, SecNumCloud sur certaines gammes |
| VPS économique | Hetzner (DE) | 5–8 € | UE, très fiable, pas SecNumCloud |
| PaaS français | Clever Cloud | 15–25 € | Moins d'administration, MAJ gérées |
| Domaine | OVH/Gandi | ~1 €/mois | `app-metier.fr` ou sous-domaine |

**Budget réaliste : 10–20 €/mois tout compris** (serveur + domaine + snapshots de
sauvegarde). Durcissement minimal du serveur : reverse-proxy Caddy (TLS automatique),
seul le port 443 ouvert, MAJ automatiques, fail2ban, sauvegardes chiffrées off-site.
Important : grâce à l'E2EE, **la compromission du serveur ne révèle aucune donnée** —
le serveur n'est qu'un coffre-fort de blobs illisibles.

---

## 5. Plan de bataille par phases

### Phase 0 — Cadrage (1 semaine)
- [ ] Trancher la question conformité (échange RSSI **ou** décision assumée : E2EE strict + hébergeur FR + pseudonymisation)
- [ ] Choisir hébergeur + réserver le domaine
- [ ] Inventaire exhaustif des appels Electron (`preload.js`, `ipcRenderer`) → liste des fonctions à porter

### Phase 1 — Découplage Electron (le gros morceau, ~3-4 semaines de travail)
- [ ] Définir une interface de stockage unique (`services/storage` existe déjà — la formaliser)
- [ ] Deux implémentations : `ElectronFsAdapter` (actuel, inchangé) et `HttpApiAdapter` (nouveau)
- [ ] Porter OCR/extraction PDF en Web Workers navigateur
- [ ] L'app Electron continue de fonctionner normalement pendant toute cette phase

### Phase 2 — Backend minimal + E2EE (~2-3 semaines)
- [ ] Serveur : WebAuthn (inscription/connexion), stockage de blobs versionnés **immuables**, journal d'accès, invitations/révocations
- [ ] Auth derrière une interface OIDC enfichable (préparation ProConnect, cf. §6)
- [ ] Modèle multi-tenant dès le schéma initial : tribunal → contentieux → coffres (cf. §7.2)
- [ ] Client : AES-GCM (WebCrypto) + Argon2id + key wrapping multi-utilisateurs par contentieux
- [ ] Script de migration couvrant **tout l'inventaire §8.1** avec rapport de complétude (comptages + checksums), répété sur copie avant le réel
- [ ] Kit de récupération (clé de secours imprimable)

### Phase 3 — PWA, offline, sauvegarde locale (~2 semaines)
- [ ] Manifest + service worker (app installable Edge/Chrome)
- [ ] Cache IndexedDB chiffré + file de synchronisation hors-ligne
- [ ] Export `.backup` chiffré manuel + planifié (+ File System Access API)

### Phase 4 — Mobile iPhone (~2 semaines)
- [ ] Vues responsives prioritaires : tableau de bord, alertes/urgences, agenda, consultation de dossier
- [ ] Installation PWA iOS (« Ajouter à l'écran d'accueil »), test Face ID/passkey

### Phase 5 — Bascule
- [ ] Double fonctionnement (Electron + web) sur 1-2 mois
- [ ] L'app portable devient le « mode secours », puis est retirée (la PWA assure le offline)

### Rétro-planning (bascule visée : 2 novembre 2026)

Inventaire technique réalisé le 11 juin : **105 appels IPC** exposés par `preload.js`,
**102 handlers** dans `main.js`, en 9 familles — `dataSync_*` (16), `globalSync_*` (15),
`instructionSync_*` (5), `consultation_*` (5), documents/casiers/fichiers, PDF/OCR,
mises à jour, audit, chemins/réseau. C'est le contrat de la phase 1.

| Phase | Période | Livrable testable (« gate » de sortie) |
|---|---|---|
| **0 — Cadrage** | 11 → 19 juin | Hébergeur + domaine choisis ; inventaire IPC ✅ ; décisions actées ✅ |
| **1 — Découplage Electron** | 22 juin → 17 juil | L'app Electron tourne **entièrement** sur la nouvelle couche `StorageAdapter`, zéro régression |
| · S1 | 22–26 juin | Interface `StorageAdapter` + adaptateur Electron branché (lecture/écriture cœur) |
| · S2 | 29 juin – 3 juil | Familles `dataSync_*` et `globalSync_*` derrière l'interface |
| · S3 | 6–10 juil | `instructionSync_*`, documents/casiers, `paths_*`, consultation |
| · S4 | 13–17 juil | OCR + extraction PDF en Web Workers navigateur |
| **2 — Serveur + E2EE** | 20 juil → 21 août | **Migration blanche 100 % verte** (rapport de complétude §8.2) |
| · S1–S2 | 20 juil – 31 juil | Serveur déployé : WebAuthn, coffres versionnés immuables, journal, invitations |
| · S3 | 3–7 août | Crypto client : AES-GCM, Argon2id, key wrapping par contentieux |
| · S4 | 10–14 août | Script de migration + rapport de complétude, répétitions sur copie réelle |
| · S5 | 17–21 août | Kit de récupération, test de restauration, durcissement serveur |
| **3 — PWA + offline + sauvegardes** | 24 août → 11 sept | Travail complet hors-ligne + export local chiffré automatique |
| **4 — UI « Lumière » + iPhone** | 14 sept → 2 oct | Nouveau visuel appliqué ; PWA installée et utilisable sur iPhone |
| **5 — Double fonctionnement** | 5 oct → 30 oct | Équipe sur le web, Electron en secours synchronisé, corrections |
| **Bascule** | **2 novembre 2026** | Electron archivé (resté restaurable), SIRAL web devient l'outil principal |

Hypothèses de rythme : le développement avance par sessions ; le facteur limitant est
**ta validation de chaque gate** (~1 h en fin de jalon). Si un gate échoue, la phase ne
se ferme pas — le planning glisse plutôt que de basculer du non-vérifié.

**À faire côté Audran (chemin critique)** :
- avant le 20 juillet : commander le VPS (OVH, gamme avec snapshots) + le domaine —
  non bloquant avant la phase 2 ;
- avant le 10 août : fournir une copie réelle des données du service (clé USB chiffrée
  ou dépôt direct) pour la répétition générale de migration ;
- à chaque fin de jalon : tester le livrable et valider le gate.

### Risques principaux
| Risque | Parade |
|---|---|
| Perte de la phrase E2EE | Kit de récupération sous scellé + clé admin de secours |
| Édition simultanée → conflits | Versionnage des blobs + verrou doux par section (comme aujourd'hui, en plus fiable) |
| Indisponibilité serveur | Mode offline complet + export local = aucune interruption de travail |
| Conformité | E2EE strict, hébergeur FR, pseudonymisation, journal d'accès, validation RSSI |

---

## 6. Compatibilité future avec les serveurs du ministère

Objectif : pouvoir un jour « rebrancher » l'app sur l'infrastructure du ministère sans
réécriture. Trois choix d'architecture le garantissent :

1. **Stack auto-hébergeable et banale** : tout tient dans un `docker compose up`
   (app Next.js + base + reverse-proxy). Aucune dépendance à un service cloud
   propriétaire (pas de Firebase, pas de S3 AWS, pas de SaaS d'auth). Toute machine
   Linux fait l'affaire : VPS perso aujourd'hui, VM du ministère demain — seul le
   fichier de configuration change.
2. **Authentification enfichable (OIDC)** : WebAuthn/passkeys est implémenté comme un
   *fournisseur d'identité* parmi d'autres. Le jour venu, on ajoute **ProConnect**
   (ex-AgentConnect, la fédération d'identité des agents de l'État, protocole OpenID
   Connect standard) comme second fournisseur — les comptes existants sont rattachés,
   rien d'autre ne bouge. C'est la vraie réponse moderne à l'idée « carte agent ».
3. **E2EE indépendant de l'hébergeur** : le chiffrement étant fait côté client, changer
   de serveur = déplacer des blobs opaques. La migration vers le ministère est un
   `rsync` + bascule DNS, sans phase de déchiffrement, et le niveau de protection des
   données ne dépend jamais de la confiance dans la machine hôte.

À éviter dès maintenant pour ne pas se fermer la porte : tout couplage du code à un
hébergeur précis (API spécifiques, stockage exotique), et tout secret en dur.

---

## 7. Multi-utilisateurs et multi-tribunaux

### 7.1 Multi-utilisateurs (au sein d'un tribunal)
L'app a déjà les bons concepts (`users.json` : rôles, `accessibleContentieux`,
permissions par module — Overboard, mindmap…, validation des inscriptions par l'admin).
On les formalise côté serveur :

- **Comptes individuels**, plusieurs passkeys par compte (PC bureau + iPhone + clé de
  secours).
- **Rôles et permissions reprises du modèle actuel** : admin de service, magistrat,
  lecture seule ; accès par contentieux et par module. Le badge « inscriptions en
  attente » des Paramètres devient un vrai workflow d'invitation/approbation.
- **Cryptographie alignée sur les permissions** : la clé d'un coffre (contentieux)
  n'est *enveloppée* que pour les membres qui y ont accès. Pas membre = pas de clé =
  rien à lire, même en cas de bug serveur.
- **Révocation propre** : départ d'un membre → rotation de la clé du coffre, ré-enveloppe
  pour les membres restants. (Procédure automatisée, un clic admin.)
- **Journal d'accès** par compte (qui a ouvert quoi, quand, depuis quel appareil) —
  l'`audit_log.json` actuel devient un journal serveur infalsifiable (append-only).

### 7.2 Multi-tribunaux (multi-tenant)
Si l'app est distribuée à d'autres juridictions, chaque tribunal est un **« tenant »
étanche** :

```
Instance serveur
├── Tribunal d'Amiens          ← tenant 1 (ton service)
│   ├── Utilisateurs + admin propres
│   ├── Coffre CRIM ORG · Coffre ECOFI · Coffre ENVIRO
│   └── Clés de chiffrement propres
├── Tribunal de Lille          ← tenant 2
│   ├── Utilisateurs + admin propres
│   └── Coffres + clés propres
└── …
```

- **Étanchéité cryptographique, pas seulement logique** : chaque tribunal a ses propres
  clés de coffre, enveloppées uniquement pour ses membres. Un mélange de dossiers entre
  tribunaux est *mathématiquement* impossible, pas seulement interdit par le code. Même
  une erreur de requête serveur ne produirait que des blobs indéchiffrables.
- **Toi-même, opérateur du serveur, tu ne peux rien lire** des autres tribunaux (zéro
  connaissance). Argument décisif pour distribuer l'app sereinement : tu héberges, tu ne
  vois rien.
- Chaque tribunal a **son admin local** qui gère ses membres et ses contentieux — tu
  n'administres pas leurs services à leur place.
- **Une seule instance suffit** au départ (coût marginal d'un tribunal supplémentaire ≈
  nul). Si un tribunal exige son propre serveur un jour, la stack Docker se duplique
  telle quelle (cf. §6.1) — y compris sur une machine du ministère.

---

## 8. Migration zéro perte & sauvegarde « à mort »

### 8.1 Inventaire exhaustif de ce qui doit survivre
Recensé dans le code actuel (`main.js`) — c'est la **check-list contractuelle** de la
migration, rien ne bascule tant que chaque ligne n'est pas verte :

| Donnée | Source actuelle |
|---|---|
| Enquêtes préliminaires + résultats | `data.json` / `app-data.json` (par contentieux) |
| Instructions judiciaires + résultats | `*-instructions.json`, stores instruction |
| Cartographie (y compris nœuds/ajouts *ex nihilo*) | `cartographie-overlays.json` + config carto |
| Audiences | `audience-data.json` |
| Tags | `tag-data.json` |
| Alertes | `alerts-data.json` |
| Suppressions (tombstones, anti-résurrection) | `deleted-ids.json` |
| Documents d'enquête (PDF, pièces) | `data/documentenquete/`, `data/casiers/` |
| Utilisateurs, rôles, permissions par module/contentieux | `users.json` |
| Paramètres généraux + par contentieux + serveur | `server-config.json`, settings divers |
| Journal | `audit_log.json` |
| Historique | `data/backups/` (conservé tel quel, archivé) |

### 8.2 Protocole de migration (aucune suppression avant validation)
1. **Gel + sauvegarde complète horodatée** de tout `data/` + partage réseau (copie froide
   conservée indéfiniment, c'est l'assurance-vie).
2. **Répétition générale sur copie** : le script d'import tourne d'abord sur un clone,
   jamais directement sur les données vivantes.
3. **Import idempotent avec rapport de complétude** : le script compte tout côté source
   et côté destination (N enquêtes, N résultats, N nœuds carto dont ex nihilo, N
   instructions, N documents avec **checksum fichier par fichier**, N tags, N audiences,
   N utilisateurs, N paramètres) et refuse de conclure si un seul compteur diverge.
   Le rapport est archivé.
4. **Double fonctionnement** : l'app Electron reste opérationnelle (et resynchronisée)
   pendant 4 à 8 semaines. La bascule est un choix, jamais un saut dans le vide.
5. **Rien n'est supprimé** : l'ancien système est archivé chiffré, pas effacé.

### 8.3 Sauvegarde permanente : règle 3-2-1 (3 copies, 2 supports, 1 hors site)
1. **Serveur — versionnage immuable** : chaque sauvegarde d'un coffre crée une *nouvelle
   version* horodatée (append-only, N versions conservées + 1/jour sur 30 j + 1/semaine
   sur 1 an). Une corruption ou une mauvaise manip n'écrase jamais l'historique — c'est
   la leçon de l'érosion de `data.json`, réglée par construction.
2. **Hébergeur — snapshots quotidiens** de la machine entière (option à ~2 €/mois),
   restauration complète en minutes.
3. **Local — export chiffré automatique** : à chaque session de travail, l'app écrit une
   sauvegarde chiffrée dans un dossier local choisi une fois (File System Access API) ;
   copie manuelle mensuelle sur clé USB conservée au service.
4. **Tests de restauration trimestriels** : une sauvegarde non testée n'existe pas. La
   procédure de restauration (depuis serveur, depuis snapshot, depuis export local) est
   documentée et chronométrée.
5. **Kit de récupération des clés** sous scellé (sans quoi les sauvegardes chiffrées ne
   valent rien), dupliqué en deux lieux.

---

## 9. Montée en gamme visuelle

Trois maquettes rendues en image dans `docs/presentation/maquettes-v2/` :

**Direction retenue : « Lumière institutionnelle »** (maquette 01, v2 après retours) :
sidebar complète (dont Overboard, Cartographie, Statistiques globales, Paramètres),
panneaux détaillés « Autorisations JLD en attente » et « Poses en attente », agenda du
jour fusionné avec Google Calendar (lecture seule, badge « G » par événement).

| Fichier | Direction |
|---|---|
| `01-dashboard-lumiere.png` | **« Lumière institutionnelle » — retenue** — thème clair raffiné, titres serif (Fraunces), KPI avec sparklines, table des dossiers prioritaires, panneaux détail JLD/poses, « Actions urgentes », agenda fusionné Google |
| `02-dashboard-nuit.png` | **« Nuit d'audience »** — mode sombre pour les permanences, accents verts lumineux, mêmes composants |
| `03-vision-web-mobile.png` | **Vision cible** — écran de connexion web (passkey + déverrouillage E2EE) dans un navigateur, et la PWA iPhone à côté |

Améliorations transverses proposées (indépendantes de la migration, applicables dès
maintenant à l'app Electron) :

1. **Typographie de caractère** : une serif d'apparat (Fraunces/Source Serif) pour les
   titres → identité « institution judiciaire » immédiate, là où tout-Inter fait générique.
2. **KPI vivants** : sparklines de tendance, deltas (« ▲ 3 ce mois »), cartes teintées
   selon la criticité (ambre = attente JLD, rouge = poses).
3. **Palette de commande `Ctrl+K`** : recherche globale dossiers/personnes/actions — le
   plus gros gain d'« expérience pro » pour le moindre coût.
4. **Chips de filtre persistantes** (Attente JLD, échéance < 7 j, mes dossiers) au lieu de
   menus déroulants.
5. **Timeline « Aujourd'hui »** : audiences, points OPJ, échéances en rail vertical.
6. **Panneau « Actions urgentes »** à fort contraste (le rouge sombre attire l'œil sans
   crier).
7. **Avatars d'équipe** sur chaque dossier → on voit qui suit quoi d'un coup d'œil.
8. **Micro-finitions** : skeletons au chargement, états vides illustrés, hover-lift sur
   les cartes (déjà ébauché), transitions 150 ms, badges thématiques par contentieux
   (rouge/bleu/vert déjà présents dans `MultiSideBar`).
9. **Mode sombre** complet (le `darkMode: class` de Tailwind est déjà configuré, inutilisé).
10. **Densité réglable** (confortable/compact) pour les gros tableaux.
