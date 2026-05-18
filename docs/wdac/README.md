# Dossier WDAC — Déblocage d'APPMETIER sur poste Justice

## Objet

Sur les postes Justice où **Windows Defender Application Control (WDAC)** est
appliqué en mode *enforced*, l'application APPMETIER ne peut pas démarrer :
les binaires Node.js et Electron qu'elle embarque sont refusés à l'exécution
avec le message :

> *Votre entreprise a utilisé le contrôle d'application Windows Defender pour
> bloquer cette application.*

Ce document fournit à la DSI les éléments nécessaires pour créer une exception
ciblée, sans élargir la politique au-delà de ce qui est strictement requis.

## Périmètre — Quels binaires sont concernés

APPMETIER est une application Next.js empaquetée Electron. Au lancement, le
launcher exécute :

1. `node.exe` — interpréteur JavaScript portable (v20.11.1, x64).
2. `electron.exe` — runtime Chromium/Node de l'application graphique (v30.5.1, x64),
   accompagné de 6 bibliothèques DLL chargées dynamiquement.
3. `next-swc.win32-x64-msvc.node` — compilateur Rust natif chargé par Next.js au
   moment du build/runtime (techniquement une DLL renommée).

Soit **9 fichiers PE** au total. Les hashes SHA-256 exhaustifs sont dans
[`binaires.txt`](./binaires.txt) (format directement exploitable par les outils
WDAC `New-CIPolicyRule -FilePathRules` ou équivalent).

## État des signatures

| Binaire | Éditeur (Authenticode) | Stratégie de whitelist recommandée |
|---|---|---|
| `node.exe` | **OpenJS Foundation** (CA : DigiCert) | par éditeur OU par hash |
| `d3dcompiler_47.dll` | **Microsoft Corporation** | normalement déjà autorisé |
| `electron.exe` | **non signé** | **par hash uniquement** |
| `ffmpeg.dll` (Electron) | non signé | par hash |
| `libEGL.dll` (Electron) | non signé | par hash |
| `libGLESv2.dll` (Electron) | non signé | par hash |
| `vk_swiftshader.dll` (Electron) | non signé | par hash |
| `vulkan-1.dll` (Electron) | non signé | par hash |
| `next-swc.win32-x64-msvc.node` | non signé | par hash |

**Point important :** la distribution officielle Electron (`electron.exe` et ses
DLL) n'est pas signée par GitHub ni par Microsoft — c'est par conception. Le
projet Electron laisse chaque application en aval (VS Code, Slack, Discord, …)
appliquer sa propre signature de code. Pour APPMETIER, l'unique voie sans
acquisition d'un certificat de signature est donc **la whitelist par hash**.

## Provenance et reproductibilité

Tous les binaires listés proviennent **exclusivement** des canaux de
distribution officiels :

| Source | URL | SHA-256 de l'archive |
|---|---|---|
| Node.js | `https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip` | `bc032628d77d206ffa7f133518a6225a9c5d6d9210ead30d67e294ff37044bda` |
| Electron | `https://github.com/electron/electron/releases/download/v30.5.1/electron-v30.5.1-win32-x64.zip` | `443119bb559fc2ca297a57cf79f2bce532e853ada070c1e71460c9657c13b4b3` |
| @next/swc | `https://registry.npmjs.org/@next/swc-win32-x64-msvc/-/swc-win32-x64-msvc-13.5.4.tgz` | `75aad2771482ad4f204565f1596496ffb4bd7c3288e7b216cf0a0b3aad9cbb37` |

Les SHASUMS officiels publiés par les projets en amont permettent une
re-vérification indépendante :

- Node.js : <https://nodejs.org/dist/v20.11.1/SHASUMS256.txt>
- Electron : `SHASUMS256.txt` joint à chaque release GitHub

## Demandes à formuler auprès de la DSI

Par ordre de précision croissante (et donc d'acceptabilité croissante d'un
point de vue politique de sécurité) :

### Option 1 — Règles par hash (recommandée)

Ajouter à la politique WDAC en vigueur les 9 règles de type
`Hash` listées dans [`binaires.txt`](./binaires.txt). C'est l'option la
plus restrictive : seuls **ces fichiers exacts**, octet pour octet, seront
autorisés. Toute modification (mise à jour, altération, substitution
malveillante) invalide l'exception et redéclenche le blocage.

Inconvénient : chaque montée de version d'APPMETIER (changement de Node,
d'Electron ou de Next.js) nécessite une mise à jour de la politique.

### Option 2 — Mixte : éditeur pour Node, hash pour Electron

Si la DSI accepte les règles par éditeur :

- `node.exe` : règle `Publisher` sur **CN=OpenJS Foundation, O=OpenJS
  Foundation, L=San Francisco, ST=California, C=US** (CA DigiCert Trusted G4
  Code Signing RSA4096 SHA384 2021 CA1).
- Les 7 autres binaires : règles par hash (cf. `binaires.txt`).

Avantage : autorise les futures versions de Node.js publiées par OpenJS sans
nouvelle demande, tout en gardant un contrôle strict sur Electron.

### Option 3 — Signature interne par la DSI

Si la DSI dispose d'une PKI et d'un certificat de signature de code interne,
la solution la plus pérenne est de **signer les binaires Electron avec ce
certificat** avant déploiement, puis d'autoriser cet éditeur interne dans
WDAC. Cette voie supprime la maintenance des hashes mais demande un workflow
de signature côté DSI.

## Pour aller plus loin

- Le courrier à recopier dans le ticket DSI est dans
  [`courrier-dsi.md`](./courrier-dsi.md).
- La liste technique au format exploitable est dans
  [`binaires.txt`](./binaires.txt).
- Le script [`diagnostic.ps1`](./diagnostic.ps1) — à exécuter en lecture seule
  sur le poste bloqué — produit un rapport `diagnostic-wdac.txt` qui certifie
  l'état WDAC du poste, extrait les derniers événements de blocage du
  journal Windows et calcule les hashes/signatures des binaires APPMETIER
  effectivement présents. Le joindre au ticket évite tout aller-retour avec
  la DSI sur "êtes-vous bien sûr que c'est WDAC ?".
