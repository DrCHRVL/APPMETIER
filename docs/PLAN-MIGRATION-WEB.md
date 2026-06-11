# Plan de bataille — Migration vers une app web sécurisée

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
- **Recommandé : WebAuthn / passkeys** (Windows Hello, Face ID, ou clé physique type
  YubiKey ~50 €). Standard, anti-phishing par construction, zéro mot de passe à retenir,
  support natif des navigateurs. C'est ce qu'il y a de plus fort *et* de plus simple à
  déployer pour une petite équipe.
- **Carte agent** : techniquement = authentification par certificat client (mTLS). Possible
  *si* la carte expose un certificat exploitable par le navigateur du poste, mais cela
  dépend du middleware installé par le ministère — à garder comme option de phase 2, pas
  comme fondation.
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

### 3.5 OCR / PDF
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
- [ ] Serveur : WebAuthn (inscription/connexion), stockage de blobs versionnés, journal d'accès, invitations/révocations
- [ ] Client : AES-GCM (WebCrypto) + Argon2id + key wrapping multi-utilisateurs par contentieux
- [ ] Script de migration `data.json` → coffre chiffré
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

### Risques principaux
| Risque | Parade |
|---|---|
| Perte de la phrase E2EE | Kit de récupération sous scellé + clé admin de secours |
| Édition simultanée → conflits | Versionnage des blobs + verrou doux par section (comme aujourd'hui, en plus fiable) |
| Indisponibilité serveur | Mode offline complet + export local = aucune interruption de travail |
| Conformité | E2EE strict, hébergeur FR, pseudonymisation, journal d'accès, validation RSSI |

---

## 6. Montée en gamme visuelle

Trois maquettes rendues en image dans `docs/presentation/maquettes-v2/` :

| Fichier | Direction |
|---|---|
| `01-dashboard-lumiere.png` | **« Lumière institutionnelle »** — thème clair raffiné, titres serif (Fraunces), KPI avec sparklines, table des dossiers prioritaires, panneau « Actions urgentes », timeline du jour |
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
