# Audit — Actualisation des descriptions de dossier

Comment l'attaché de justice tient à jour la description (« l'objet ») d'un
dossier : déclenchement, format imposé, durée, ressources (modèle IA,
jetons), garde-fous. Lecture du code au 2026-08-27 (`scripts/attache-service.mjs`,
`scripts/attache/dossier.mjs`, `scripts/attache/consignes.mjs`,
`scripts/attache-mcp.mjs`, `app/api/attache/actualiser-description/route.ts`).

## 1. Deux déclencheurs, un seul moteur

| | Automatique | À la demande |
|---|---|---|
| Déclencheur | un CR est rédigé, ou un acte/document est téléversé | icône **« Actualiser »** à côté du titre *Description* (détail du dossier, admin seul) |
| Fréquence | vérifié à chaque tick (~5 min), 1 seul dossier tiré par tick | immédiat |
| Différé si forfait saturé | **oui** (`autonomousOnHold`) | **non** — le clic du magistrat n'est jamais bridé |
| Réponse navigateur | aucune (silencieux, aucune carte) | awaitée : la fiche affiche la nouvelle description dès la fin du run |

Les deux passent par la **même fonction** `runActualiserDescription()`
(`scripts/attache-service.mjs:534`) — même prompt, même modèle, même limite
de tours.

## 2. Détection du changement — coût nul

`dossierSyntheseSignals()` (`scripts/attache/dossier.mjs:1627`) calcule pour
chaque dossier non archivé une **signature déterministe**, sans appel modèle :

```
[nb CR, date du CR le plus récent,
 nb documents (client), date la plus récente,
 nb documents (serveur, hors copies markdown), date la plus récente,
 nb actes + écoutes + géolocalisations]
```

Elle est comparée d'un tick à l'autre (`maybeScheduledDescriptions()`,
`scripts/attache-service.mjs:671`). Point de conception notable : la
signature **exclut volontairement la description elle-même** — l'écriture
d'une nouvelle description ne fait donc jamais bouger sa propre signature, ce
qui évite une boucle d'auto-déclenchement.

## 3. Cadence — volontairement lente

- **Période de calme** : `SIRAL_ATTACHE_DESC_QUIET_MIN` (défaut **3 min**) —
  un dossier qui vient de changer n'est actualisé qu'après 3 min sans nouveau
  mouvement (les ajouts en rafale sont fusionnés en une seule actualisation).
- **Anti-rafale par dossier** : `SIRAL_ATTACHE_DESC_MIN_INTERVAL_MIN` (défaut
  **20 min**) — jamais deux actualisations automatiques du même dossier à
  moins de 20 min d'écart.
- **Un seul dossier par tick** : même si plusieurs dossiers sont « mûrs »
  simultanément, un seul est traité par passage (~toutes les 5 min, décalé de
  20 s dans le cycle pour étaler la charge avec les autres tâches de fond).
  Conséquence directe sur le temps de bout en bout : si N dossiers changent au
  même moment, le dernier de la file attend environ **N × 5 min** avant sa
  propre actualisation — le choix assumé du code est la lenteur en arrière-plan
  contre la dépense en jetons, jamais l'inverse.
- **Verrou global** : un seul run de description actif dans tout le service à
  la fois (`descriptionRunning`), qu'il soit auto ou manuel — évite que deux
  runs écrivent en même temps sur le même coffre chiffré.
- **Premier passage silencieux** : au tout premier tick suivant la mise en
  service (ou l'ajout d'un nouveau dossier), aucune actualisation n'est
  déclenchée — une simple ligne de référence est posée. Le stock existant
  n'est donc jamais « rafraîchi » d'un coup ; seuls les changements
  **ultérieurs** déclenchent un run.

## 4. Le run lui-même — modèle et budget

Extrait de `runActualiserDescription()` :

```js
model: economicalModel(agentConfig()),  // sous-agent RAPIDE, jamais le modèle du chat
effort: 'low',
maxTurns: 8,
timeoutMs: 8 * 60 * 1000,               // 8 min (auto)
```

- **Modèle** (`economicalModel()`, `scripts/attache/subagents.mjs:54`) :
  celui choisi par le magistrat pour les sous-agents (« Cerveau » →
  Paramètres), sinon **Haiku 4.5** si le « mode économe » est activé, sinon
  par défaut **`claude-sonnet-5`** (`SIRAL_ATTACHE_SUBAGENT_MODEL`) — jamais
  le modèle réglé pour le chat principal (qui peut être Opus) : la
  description est délibérément traitée comme une tâche de sous-agent, même
  si elle tourne sur l'agent principal.
- **Effort** : faible.
- **8 tours d'outils maximum**, timeout 8 min (déclenchement auto) — la route
  HTTP côté navigateur (`app/api/attache/actualiser-description/route.ts`)
  tolère jusqu'à **9 min** côté réseau (`timeoutMs`) et **10 min**
  (`maxDuration = 600`) côté fonction serveur pour le déclenchement manuel.
- **Aucun sous-agent délégué** : contrairement aux chantiers d'analyse
  profonde, ce run ne lance pas de `sous_agents` — un seul agent, en lecture
  ciblée.
- **Suivi de consommation** : chaque run pousse ses jetons dans
  `attache/usage.jsonl` (`runLabel: 'description'`), affiché dans
  Paramètres → Attaché IA → **« Consommation IA »**, poste **« Descriptions »**
  (distinct du poste « Mis en cause (détection) », qui compte les runs de
  l'icône « Actualiser » de la section Mis en cause).
- **Gouverneur de forfait** : seul le déclenchement **automatique** est
  différé si la fenêtre de 5 h ou le plafond hebdomadaire du forfait Claude
  est saturé (`autonomousOnHold`) — rien n'est perdu, le dossier reste « en
  attente » et repart au tick suivant une fois la fenêtre redescendue. Le
  déclenchement **manuel** (icône) n'est jamais bridé.

## 5. La méthode imposée à l'agent (prompt)

Socle `description` de `scripts/attache/consignes.mjs:32` — modifiable par le
magistrat (Paramètres → Attaché IA → « Consignes par domaine », en
complément ou en remplacement du socle ; l'entête et les données restent
toujours bâties par le moteur) :

1. `lire_dossier` — aperçu compact (faits, mis en cause **enregistrés**,
   actes, index des CR, documents).
2. Lecture **ciblée** des seuls CR/actes/documents récents non encore
   reflétés (jamais une relecture intégrale du dossier) — pour un acte,
   `dossier_arborescence` puis `lire_document`, qui sert la copie markdown
   déjà générée (jamais de ré-extraction du PDF).
3. `actualiser_description` — réécrit la description en la faisant
   **progresser** à partir de l'existant (elle ne repart jamais de zéro).
4. **Cohérence des mis en cause** : tout nom mis en cause relevé au passage
   et absent de la section « Mis en cause » du dossier est **proposé**
   (`recouper_personnes` puis `proposer_mec`) — jamais ajouté d'office
   (`ajouter_mec` interdit ici). Le dédoublonnage (nom identique, nom
   voisin, nom connu d'un autre dossier) est vérifié au dépôt de la
   proposition.
5. **Si rien de neuf** : l'agent n'écrit pas — il termine sans appeler
   `actualiser_description`. Ni carte, ni signalement, ni question : cette
   tâche ne doit **jamais** produire de bruit pour le magistrat.

## 6. Format imposé de la description

Défini à la fois dans le prompt (consigne) et dans la description de l'outil
MCP `actualiser_description` (`scripts/attache-mcp.mjs:768`) — donc appliqué
même si le magistrat modifie le socle :

- **Texte brut**, jamais d'HTML ni de `<br>` (la fiche l'affiche en
  `white-space: pre-wrap`).
- **Deux parties, titres en MAJUSCULES sur leur propre ligne** :
  - **SYNTHÈSE** — vision globale des faits à l'instant T : qualification,
    mode opératoire, lieux, période, état des mesures, échéances qui
    pressent. Elle **s'enrichit et se reformule** à chaque passage (repart
    de l'existant, ne le jette pas).
  - **MIS EN CAUSE** — un par un, uniquement les mis en cause **enregistrés**
    (jamais inventés), chacun suivi des **éléments à charge** relevés (rôle,
    faits, liens, saisies).
- **Style « prise de notes »** : rédigé à ~80 %, mots inutiles et verbes de
  liaison retirés, phrases nominales courtes — mais lisible par un collègue
  qui découvre le dossier. Aucune autre rubrique.
- **Rien n'est jamais perdu** : l'ancienne description part dans
  `descriptionHistory` (plafonné aux 20 dernières versions dans cet index —
  l'historique complet reste dans le coffre versionné) avant écrasement.

## 7. Traçabilité et droits

- Route API réservée à l'**administrateur du TJ confié** —
  `requireAttacheAdmin` renvoie 404 pour tout autre compte.
- `actualiser_description` figure dans la liste des **outils d'écriture**
  du serveur MCP (`scripts/attache-mcp.mjs:135-142`), donc soumis aux mêmes
  garde-fous que les autres écritures de l'attaché.
- Chaque run est **audité** (`audit(keys, 'description_actualisee', { numero,
  trigger, ok, proposees, convId, erreur })`) — visible du seul
  administrateur dans le journal chiffré.
- **Pas de portes de qualité** (marqueurs `[À COMPLÉTER]`/HTML/auto-désignation
  IA) sur ce run : ces contrôles ne s'appliquent qu'aux **productions**
  remises par `produire_document`/`remettre_livrable` (actes, livrables) —
  la description n'en est pas une.

## 8. Ce que ce n'est pas

- Ce **n'est pas** un résumé généré une fois pour toutes : c'est un
  document **vivant**, réécrit incrémentalement, jamais régénéré à partir de
  zéro.
- Ce **n'est pas** un système temps réel : entre un CR rédigé et sa
  répercussion dans la description automatique, compter au minimum
  **3 minutes** (calme) + le délai du prochain tick, et jusqu'à
  **20 minutes** si le dossier vient d'être actualisé récemment — l'icône
  « Actualiser » reste le seul moyen d'obtenir la mise à jour immédiate.
- Ce **n'est pas** un poste de dépense significatif : modèle rapide, effort
  faible, 8 tours maximum, un seul dossier à la fois — le design vise
  explicitly le « minimum de jetons » (commentaire du code,
  `scripts/attache-service.mjs:501`).

## Sources

- `scripts/attache-service.mjs:492-723` (planification, exécution, verrou)
- `scripts/attache/dossier.mjs:1618-1652` (signature de changement)
- `scripts/attache/consignes.mjs:31-52` (socle du prompt)
- `scripts/attache-mcp.mjs:767-776` (outil `actualiser_description`, format imposé)
- `app/api/attache/actualiser-description/route.ts` (route à la demande)
- `docs/ATTACHE.md` (section « Tient la description à jour, TOUT SEUL »)
