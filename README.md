# SIRAL

**Suivi Intégré des Réseaux criminels et Affaires Liées**

Application métier de gestion de service pour parquet : enquêtes préliminaires,
instructions judiciaires, suivi des autorisations JLD, poses techniques, suivi AIR,
cartographie des réseaux, audiences, statistiques — par contentieux (CRIM ORG, ECOFI,
ENVIRO).

> ⚠️ Application à usage interne. Ne pas diffuser.

## Édition web

Application web hébergée — chiffrement de bout en bout côté client,
authentification WebAuthn/passkeys, multi-tribunaux, PWA installable
(desktop + iPhone).

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

Le déploiement est décrit dans
**[docs/TUTO-DEPLOIEMENT.md](docs/TUTO-DEPLOIEMENT.md)**.

### Veille de recoupements

Signale, sans rien interrompre, les valeurs communes à plusieurs dossiers —
même personne, même patronyme, même adresse, même ligne, même véhicule, même
compte — y compris lorsqu'elles ne figurent que dans une pièce versée. Un
signalement, jamais une écriture : le magistrat vérifie et tranche.
Voir **[docs/RECOUPEMENTS.md](docs/RECOUPEMENTS.md)**.

### Attaché de justice (IA) — optionnel

Assistant intégré, réservé à l'administrateur (invisible des autres
utilisateurs, un seul TJ/contentieux) : lecture des dossiers, écritures
réversibles et journalisées, boîte mail dédiée avec traitement proactif,
mémoire corrigeable avec apprentissage progressif (il apprend de chaque
correction, à coût de jetons nul, et consolide périodiquement). Propulsé
par Claude Code via l'abonnement Claude (pas d'API).
Voir **[docs/ATTACHE.md](docs/ATTACHE.md)**.

### Connecteur Claude web — optionnel

Piloter SIRAL **depuis claude.ai** (connecteur MCP personnalisé) : Claude
web obtient les mêmes outils que l'attaché — lecture des dossiers,
statistiques, écritures réversibles et auditées. OAuth réservé à
l'administrateur (session passkey + consentement), désactivé par défaut,
révocable en un clic.
Voir **[docs/CONNECTEUR-CLAUDE-WEB.md](docs/CONNECTEUR-CLAUDE-WEB.md)**.

---

Conçu par A. Chevalier — Parquet d'Amiens.
