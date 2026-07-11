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
- **L'agent n'a ni shell, ni fichiers, ni web** : uniquement les outils MCP
  SIRAL (liste blanche + liste noire explicite). Chaque outil d'écriture est
  audité.
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
