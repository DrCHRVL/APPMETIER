# Modèle de demande à la DSI Justice

> Texte à recopier (ou adapter) dans le ticket de support. Les champs entre
> chevrons `<…>` sont à compléter.

---

**Objet :** Demande d'exception WDAC pour application métier APPMETIER

**Demandeur :** <Prénom NOM> — <Service / Juridiction / Pôle>
**Poste concerné :** <Nom NetBIOS / numéro d'inventaire>
**Utilisateur impacté :** <Prénom NOM, login AD>

---

## Contexte

APPMETIER est une application métier interne développée pour appuyer
<préciser le périmètre métier : suivi d'enquêtes, audiences, instructions,
selon votre cas>. Elle est utilisée depuis <date / année> par <nombre>
agents de <service>. Le logiciel est portable (pas d'installation MSI, pas
d'élévation requise) et stocke ses données localement dans le dossier
utilisateur.

Lors de l'installation sur le poste cité ci-dessus, le lancement échoue
avec le message Windows :

> *Votre entreprise a utilisé le contrôle d'application Windows Defender
> pour bloquer cette application.*

Le diagnostic technique confirme que la politique WDAC du poste refuse
l'exécution des binaires Node.js et Electron embarqués par APPMETIER,
parce qu'ils ne figurent pas dans la liste des éditeurs autorisés. Le
même logiciel fonctionne sur les postes où la politique WDAC est en
mode *audit* ou non appliquée.

## Demande

Ajout dans la politique WDAC en vigueur d'une exception couvrant les **9
binaires** listés en annexe (fichier `binaires.txt`), tous provenant des
canaux de distribution officiels et publics suivants :

- Node.js v20.11.1 (1 fichier : `node.exe`)
  Source : `https://nodejs.org/dist/v20.11.1/`
  Signature : *OpenJS Foundation* via DigiCert.

- Electron v30.5.1 (7 fichiers : `electron.exe` + 6 DLL)
  Source : `https://github.com/electron/electron/releases/tag/v30.5.1`
  Signature : non signée (distribution upstream non signée par conception ;
  voir la documentation Electron sur la signature applicative en aval).
  Pour cette raison, la whitelist doit obligatoirement se faire par **hash
  SHA-256**.

- @next/swc-win32-x64-msvc 13.5.4 (1 fichier : `next-swc.win32-x64-msvc.node`)
  Source : `https://registry.npmjs.org/@next/swc-win32-x64-msvc/`
  Signature : non signée — whitelist par hash.

Les hashes SHA-256 exacts de chaque fichier, leur taille et leur chemin
d'installation sont fournis dans le fichier `binaires.txt` joint, dans un
format directement exploitable par les outils WDAC standard
(`New-CIPolicyRule -Level Hash` / `Merge-CIPolicy`).

## Garanties apportées

1. **Reproductibilité** : les hashes des archives originales (Node, Electron,
   @next/swc) sont vérifiables face aux SHASUMS publiés par les projets en
   amont. Les chaînes de hash de chaque fichier sont calculables sur tout
   poste après installation, ce qui permet un audit a posteriori.

2. **Restriction maximale** : la whitelist par hash n'autorise que **ces
   versions exactes** des binaires. Toute mise à jour (correctif de sécurité
   Node, montée de version Electron, etc.) nécessitera une nouvelle demande,
   ce qui maintient un contrôle continu.

3. **Périmètre limité** : aucune règle ne porte sur un chemin ou un éditeur
   global susceptible d'autoriser d'autres exécutables que ceux strictement
   nécessaires à APPMETIER.

4. **Pas d'élévation** : APPMETIER s'exécute entièrement dans le contexte
   utilisateur, sans service Windows, sans pilote, sans tâche planifiée
   privilégiée.

## Alternative à l'étude (le cas échéant)

Si la DSI dispose d'une PKI interne et d'un certificat de signature de code,
nous sommes disposés à intégrer ce certificat dans notre processus de
publication : les binaires Electron seraient alors signés en interne avant
diffusion, ce qui supprimerait la nécessité de maintenir une liste de
hashes à chaque montée de version. Cette option demande une concertation
préalable sur le format d'échange du certificat.

## Pièce jointe

- `binaires.txt` — liste exhaustive des 9 fichiers (hash SHA-256, taille,
  chemin), avec sources et empreintes des archives.

## Référent technique applicatif

<Prénom NOM> — <email> — <téléphone>
(à contacter pour toute question sur le contenu de l'application ou sur la
production de nouveaux hashes lors d'une mise à jour.)
