# SIRAL

**Suivi Intégré des Réseaux criminels et Affaires Liées**

Application métier de gestion de service pour parquet : enquêtes préliminaires,
instructions judiciaires, suivi des autorisations JLD, poses techniques, suivi AIR,
cartographie des réseaux, audiences, statistiques — par contentieux (CRIM ORG, ECOFI,
ENVIRO).

> ⚠️ Application à usage interne. Ne pas diffuser.

## Édition actuelle (Electron portable)

```bash
npm install
npm run dev        # Next.js en développement
npm run electron   # app desktop
npm run build      # build production
```

Les données vivent dans `data/` (local) et se synchronisent sur le partage réseau du
service. Voir `launcher.bat` / `installer.bat` pour le déploiement sur poste.

## Édition web (en préparation)

La migration vers une application web hébergée — chiffrement de bout en bout côté
client, authentification WebAuthn/passkeys, multi-tribunaux, PWA installable
(desktop + iPhone) — est décrite dans **[docs/PLAN-MIGRATION-WEB.md](docs/PLAN-MIGRATION-WEB.md)**.
Les maquettes de la nouvelle interface sont dans `docs/presentation/maquettes-v2/`.

---

Conçu par A. Chevalier — Parquet d'Amiens.
