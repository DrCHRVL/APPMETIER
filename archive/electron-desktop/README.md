# Édition Electron desktop — ARCHIVÉE

> Cette édition **n'est plus maintenue ni distribuée**. Elle est conservée ici à
> titre de référence. L'édition de référence de SIRAL est désormais l'**édition
> web** (Next.js + serveur Docker, chiffrement E2EE, WebAuthn). Voir le
> [`README.md`](../../README.md) à la racine.

## Ce que contenait cette édition

Application de bureau Windows portable, construite avec Electron. Les données
vivaient dans `data/` (local) et se synchronisaient sur le partage réseau du
service (`P:\…`). Déploiement sur poste via des scripts `.bat`.

| Fichier | Rôle |
| --- | --- |
| `main.js` | Processus principal Electron : handlers `ipcMain`, accès disque/réseau, mises à jour, consultation-shell. |
| `preload.js` | Expose `window.electronAPI` au renderer via `contextBridge`. Reste la **source de vérité** du contrat que le pont web reproduit (cf. `scripts/check-bridge-surface.js`). |
| `installer.bat` | Télécharge/extrait Node.js + Electron portables sur le poste. |
| `launcher.bat` | Lance l'app (build + Electron), gère les mises à jour. |
| `import-instructions.bat` | Import d'instructions depuis un `.xlsx` vers `data/data.json`. |
| `settings.txt` | Configuration Node.js portable (chemins, proxy). |
| `scripts/build-consultation-shell.js` | Génère le « consultation-shell » embarqué (extraResources Electron). |

## Pourquoi c'est archivé et non supprimé

- `preload.js` documente la surface complète de `window.electronAPI`. Le pont web
  (`lib/web/bridge.ts`) doit la reproduire à 100 % ; `scripts/check-bridge-surface.js`
  s'appuie encore sur ce fichier comme référence.
- Historique et possibilité de reprise.

## Couplage avec l'édition web (à NE PAS confondre)

Ces fichiers du tronc commun **ne sont PAS** spécifiques à Electron malgré leur nom,
et restent utilisés par l'édition web — ne pas les déplacer ici :

- `utils/electronBridge.ts` — couche d'accès aux données côté frontend ; appelle
  `window.electronAPI`, peu importe qui le fournit (Electron *ou* le pont web).
- `services/storage/electronStorage.ts`, `types/electron.d.ts` — idem.
- En mode web, `app/layout.tsx` installe le pont web sur `window.electronAPI`.

## Restauration éventuelle

Les fichiers sont simplement déplacés (historique git préservé). Pour réactiver
l'édition Electron il faudrait notamment :

1. Remettre les fichiers à la racine.
2. Rétablir dans `package.json` : `"main": "main.js"`, le script `"electron"`, le
   script `"build:consultation-shell"`, la devDep `electron` et le bloc `"build"`
   (electron-builder).
3. Réajuster `scripts/check-bridge-surface.js` et `.dockerignore`.
