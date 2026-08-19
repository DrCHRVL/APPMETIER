# Connecteur Claude web (serveur MCP distant)

Brancher **claude.ai** directement sur SIRAL : depuis n'importe quelle
conversation Claude web (ou l'app mobile Claude), le magistrat administrateur
dispose des **mêmes outils que l'attaché** — lecture des dossiers, pièces et
chronologies, statistiques et graphiques, écritures réversibles (actes, CR,
à-faire, NATINF, dossiers…), livrables remis dans SIRAL — sans avoir à faire
évoluer l'assistant intégré à chaque nouveauté de Claude web.

> ⚠️ Réservé à l'**administrateur**, sur le TJ/contentieux confié à
> l'attaché. Fonctionnalité **désactivée par défaut** ; tant qu'elle ne l'est
> pas, aucune route n'existe côté Internet (404 indistinguable).

## Ce que Claude web sait faire une fois connecté

- « Fais-moi le point sur le dossier 2026/000123 » → `lire_dossier`,
  `chronologie_lire`, `verifier_completude` ;
- « Mes statistiques 2026, ça donne quoi ? » → `stats_ecran` : **la page
  Statistiques telle que vous la voyez**, carte par carte (voir plus bas) ;
- « Sors-moi le bilan du semestre avec les graphiques » → `stats_synthese`,
  `stats_graphique` (Claude VOIT les courbes) ;
- « Extrais tous les mis en cause liés au réseau X et leurs actes » →
  lectures croisées, recoupements ;
- « Enregistre l'autorisation d'écoute signée ce matin » → `modifier_acte`
  (écriture versionnée, auditée) ;
- « Rédige la prolongation et range-la dans le dossier » →
  `produire_document` (atelier « Actes rédigés », exports officiels).

Deux outils de l'attaché sont volontairement absents du connecteur :
`sous_agents` (lancerait des runs CLI parallèles sur l'abonnement — Claude
web orchestre déjà ses lectures) et `poser_question` (vous êtes déjà dans la
conversation). Les suppressions restent, comme pour l'attaché, manuelles.

## Statistiques : les mêmes chiffres qu'à l'écran

La page Statistiques de l'app raisonne par **année civile** (le sélecteur en
haut) et applique des règles serrées : procédures terminées **hors**
classements sans suite et ouvertures d'information, orientations comptées une
fois par dossier *mais une fois par prévenu en CRPC*, défèrements rattachés à
leur **date réelle** et non à la date d'audience, saisies d'enquête distinctes
des confiscations d'audience, année en cours arrêtée au mois courant. Un
agent qui refait ces calculs « au bon sens » à partir des listes de dossiers
tombe forcément à côté.

Trois outils, un seul jeu de règles :

| Question | Outil | Ce qu'il rend |
| --- | --- | --- |
| « mes stats », un chiffre de la page, une année | `stats_ecran` (`annee`) | Les 4 sections de la page — Générales · Types d'infractions · Résultats d'audience · Instruction — **carte par carte** : titre exact, valeur affichée, détail et **règle de calcul** |
| un semestre, un trimestre, « depuis mars » | `stats_synthese` (`du`/`au`) | Le même bilan sur période libre, listes de dossiers comprises |
| « montre-moi mes graphiques » | `stats_graphique` (`graphiques[]`, `annee`) | Les visuels en PNG, mêmes couleurs que l'app, **avec** les nombres exacts en regard |
| quelles années ont des données | `stats_annees` | Le contenu du sélecteur « Année » |

Les consignes du connecteur interdisent explicitement à Claude de recalculer
un chiffre déjà rendu ou de le reconstituer en additionnant des listes : il
cite la carte et sa valeur. Deux nombres voisins qui diffèrent (« déférements »
de l'orientation vs « Évolution des déférements ») ne sont pas une
incohérence — chaque carte porte la règle qui l'explique.

Côté code, **aucune règle n'est réécrite pour le connecteur** : les cartes
sont calculées par les cœurs partagés avec l'écran —
`lib/stats/ecranCore.mjs` (les cartes), `lib/stats/audienceCore.mjs` (peines,
orientations, saisies), `lib/stats/actesCore.mjs` (actes TSE),
`lib/stats/instructionCore.mjs` (onglet instruction) et
`lib/natinf/nataffRegles.mjs` (catégories d'infraction). La page Statistiques
de l'app consomme exactement les mêmes fonctions : si une règle évolue, elle
évolue des deux côtés à la fois.

## Modèle de sécurité

```
 claude.ai ──HTTPS/OAuth──►  App Next (AUCUNE clé)          Service attaché
                             /api/mcp + OAuth 2.1     ─────► POST /mcp (réseau interne,
                             jetons hashés, PKCE S256        secret de pont) : outils,
                             session admin + consentement    trousseau, audit
```

- **OAuth 2.1 complet** : enregistrement dynamique (RFC 7591), métadonnées
  (RFC 8414/9728), PKCE S256 **obligatoire**, jetons opaques stockés
  **hashés** (sha256), accès 2 h, rafraîchissement 90 j à **rotation
  stricte**. Adresses de retour bornées aux domaines Claude
  (`claude.ai` / `claude.com`).
- **Autorisation = votre session** : la fenêtre d'autorisation exige une
  session **administrateur** (passkey) sur le TJ confié, puis un
  **consentement explicite**. Personne d'autre ne peut aboutir — un compte
  membre reste sur une page « connexion administrateur requise ».
- **Revérification à chaque appel** : jeton valide ET compte toujours admin
  du TJ confié. Rétrogradation, désactivation ou révocation = coupure
  immédiate.
- **Écritures auditées** : chaque outil d'écriture appelé depuis Claude web
  est journalisé dans l'audit chiffré (contexte « connecteur ») — même
  visibilité que les actions de l'attaché ; données partagées signées de
  votre nom, jamais « IA ».
- **Trousseau inchangé** : le service attaché reste le seul à déchiffrer, et
  le recharge à **chaque message** — révoquer le trousseau aveugle aussi le
  connecteur, sur-le-champ.
- **Révocation un clic** : Paramètres → Attaché IA → Connecteur Claude web —
  par connexion ou totale ; désactiver le connecteur révoque tout.

## Mise en service (2 minutes)

1. **Prérequis** : l'attaché est installé (voir `docs/ATTACHE.md`), le
   trousseau remis, et vous êtes connecté en **admin** sur le TJ confié.
2. **Activer** : Paramètres → **Attaché IA** → **Connecteur Claude web** →
   *Activer*. L'URL du serveur MCP s'affiche :
   `https://<votre-domaine>/api/mcp` — bouton *Copier*.
3. **Côté claude.ai** (abonnement Pro/Max) : Paramètres → **Connecteurs** →
   **Ajouter un connecteur personnalisé** → collez l'URL → *Ajouter* →
   **Se connecter**. Une fenêtre SIRAL s'ouvre :
   - si vous n'êtes pas connecté : « Ouvrir SIRAL », connectez-vous
     (passkey) dans l'onglet ouvert, revenez, « réessayer » ;
   - écran de consentement → **Autoriser**.
4. **Utiliser** : dans une conversation Claude web, activez le connecteur
   (menu recherche/outils) et parlez normalement : « liste mes dossiers en
   cours », « prépare le bilan semestriel »… Sur l'app mobile Claude, le
   connecteur suit automatiquement.
5. **Recommandé** : téléversez dans claude.ai la skill
   [`mobilisation-siral.skill`](skills-claude-web/) (Paramètres → Capacités
   → Skills) — elle apprend à Claude web la MÉTHODE : identifier le bon
   dossier, lire en économe (aperçus, sections paginées), recouper une
   pièce versée (PV → NATINF, mis en cause, échéances), suivre vos trames
   et remettre les actes dans SIRAL avec les bonnes métadonnées.

## Révocation & réversibilité

| Geste | Effet |
|---|---|
| Paramètres → Attaché IA → Connecteur → **révoquer une connexion** | les jetons de ce client meurent immédiatement |
| **Désactiver** le connecteur | toutes les connexions révoquées + routes 404 |
| Révoquer le **trousseau** de l'attaché | le connecteur ne déchiffre plus rien (comme l'attaché) |
| Supprimer le connecteur côté claude.ai | Claude n'appelle plus SIRAL (les jetons expirent) |
| Annuler une écriture | Sauvegardes → versions du coffre (chaque écriture archive la précédente) |
| Voir tout ce qui a été fait | Journal d'audit (contexte « connecteur ») + journal du panneau |

## Détails techniques

- Transport MCP : **streamable HTTP sans état** (`POST /api/mcp`, réponses
  JSON directes ; pas de flux SSE serveur→client — `GET` répond 405).
- Panne du service attaché : l'app répond **200 + erreur JSON-RPC motivée**,
  jamais un 5xx — sur ce transport, un 5xx fait conclure au client que l'URL
  n'est pas un serveur MCP et masque le vrai motif. La poignée de main
  (`initialize`, `ping`, `*/list`) coupe à 25 s, les outils à 180 s.
- Découverte OAuth : `/.well-known/oauth-protected-resource` et
  `/.well-known/oauth-authorization-server` (réécritures Next vers
  `/api/mcp/oauth/*`).
- Endpoints : `/api/mcp/oauth/register` (enregistrement dynamique),
  `/api/mcp/oauth/authorize` (session admin + consentement),
  `/api/mcp/oauth/token` (échange + refresh).
- État côté serveur : `mcp-connecteur.json` dans l'espace du TJ confié —
  clients, codes et jetons **hashés**, journal borné. Aucune donnée
  d'enquête n'y transite.
- Le service attaché exécute les outils via le MÊME module que les runs CLI
  (`scripts/attache-mcp.mjs`, importé par `attache-service.mjs`) — une seule
  implémentation, un seul audit.
- Client MCP de test (hors Claude) : ajouter son hôte de redirection dans
  `SIRAL_MCP_REDIRECT_HOSTS` (liste d'hôtes séparés par des virgules ;
  `http://` toléré pour localhost uniquement).

## Dépannage

> **Premier réflexe** : Paramètres → Attaché IA → Connecteur Claude web →
> **Tester**. Le bouton rejoue en lecture seule le trajet exact de Claude une
> fois autorisé (`initialize` puis `tools/list` jusqu'au service attaché) et
> nomme la panne. Claude, lui, ne sait dire que « Impossible de se connecter
> au serveur » quelle qu'en soit la cause.

- **« Votre compte a été autorisé, mais SIRAL a renvoyé une erreur lors de la
  connexion » / « Vérifiez que l'URL pointe vers un serveur MCP valide »** :
  l'OAuth a réussi (la connexion apparaît dans le panneau) — c'est l'appel MCP
  qui échoue, en aval. Lancez **Tester** : le message précise lequel des trois
  cas s'applique — conteneur `attache` arrêté ou en redémarrage en boucle
  (clé-maître absente), image de l'attaché **plus ancienne** que celle de
  l'app (le point d'entrée `/mcp` n'y existe pas encore → relancez Paramètres
  → **Mise à jour**, qui reconstruit les deux), ou `SIRAL_SECRET` divergent
  entre les deux conteneurs.
- **« Introuvable » / 404 partout** : connecteur non activé dans le panneau,
  ou `SIRAL_ATTACHE_URL` absent côté app (le connecteur suppose l'attaché).
- **La fenêtre d'autorisation dit « connexion requise » en boucle** :
  connectez-vous dans l'onglet SIRAL **du même navigateur**, sur le **TJ
  confié** (sélecteur de TJ en haut), puis « réessayer ».
- **Claude affiche « erreur d'authentification »** : révoquez la connexion
  dans le panneau ET supprimez le connecteur côté claude.ai, puis refaites
  l'ajout (nouvel enregistrement propre).
- **Outils qui répondent « Trousseau non remis »** : remettez les clés
  (Paramètres → Attaché IA → Remettre les clés).
- **Écriture refusée « PORTE DE QUALITÉ »** : normal — mêmes contrôles que
  l'attaché (marqueurs d'inachèvement, HTML, acte squelettique…) ; Claude
  corrige et re-soumet.
