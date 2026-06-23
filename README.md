# SIRAL

**Suivi Intégré des Réseaux criminels et Affaires Liées**

Application métier de gestion de service pour parquet : enquêtes préliminaires,
instructions judiciaires, suivi des autorisations JLD, poses techniques, suivi AIR,
cartographie des réseaux, audiences, statistiques — par contentieux (CRIM ORG, ECOFI,
ENVIRO).

> ⚠️ Application à usage interne. Ne pas diffuser.

## Édition web (édition de référence)

Application web hébergée — chiffrement de bout en bout côté client,
authentification WebAuthn/passkeys, multi-tribunaux, PWA installable
(desktop + iPhone). C'est la **seule édition activement maintenue**.

```bash
npm install
npm run dev        # Next.js en développement
npm run build      # build production
npm run start      # serveur standalone
```

Déploiement serveur (Docker + HTTPS automatique + mises à jour in-app) :

```bash
cp .env.exemple .env   # puis remplir les valeurs
docker compose up -d --build
```

L'architecture et la migration sont décrites dans
**[docs/PLAN-MIGRATION-WEB.md](docs/PLAN-MIGRATION-WEB.md)** et le déploiement dans
**[docs/TUTO-DEPLOIEMENT.md](docs/TUTO-DEPLOIEMENT.md)**.

## Édition Electron desktop — archivée

L'ancienne édition Electron portable (Windows, données dans `data/` synchronisées
sur le partage réseau du service) **n'est plus maintenue**. Ses fichiers ont été
déplacés dans **[`archive/electron-desktop/`](archive/electron-desktop/)** et sont
exclus des builds. Voir le README de ce dossier pour le détail et la procédure de
restauration éventuelle.

---

Conçu par A. Chevalier — Parquet d'Amiens.
