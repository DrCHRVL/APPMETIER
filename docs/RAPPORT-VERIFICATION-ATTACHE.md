# Rapport de vérification — Attaché de justice (IA)

*Audit complet du 23/07/2026, mené de bout en bout sur le code (service, serveur
MCP, app web), suivi des corrections et extensions décrites plus bas. Tout ce
qui est marqué « corrigé » ou « ajouté » est dans ce commit.*

---

## 1. Ce qui fonctionne — vérifié dans le code

| Capacité demandée | État | Où |
|---|---|---|
| Réception des mails transférés (5 min), pièces jointes, statuts reçu → en cours → traité, toasts | ✅ | `mail.mjs`, `attache-service.mjs`, `InboxWidget` |
| Identification rigoureuse de l'enquête (n° de procédure du PV → titre d'enquête, sinon recoupement par mis en cause/faits, question si doute) | ✅ | prompt système `agent.mjs` (MÉTHODE mail, étape 2) + `recouper_personnes` |
| Compréhension des consignes (le corps du transfert vaut instruction) | ✅ | `agent.mjs` + prompt proactif |
| Lien type d'acte → trame + skill, appliqué d'office | ✅ | table associations (`associations.mjs`), étape 0-2 de la MÉTHODE DE RÉDACTION, bouton « Suggérer » |
| Acte rédigé visible dans le détail d'enquête (« Actes rédigés »), hors-dossier au tableau de bord | ✅ | `produire_document` → `productions.mjs` → `ProductionsSection` |
| Métadonnées d'acte (kind, catégorie légale des 12 TSE, durée, cible/objet, attente JLD) alignées sur la saisie manuelle | ✅ (2 bugs corrigés, voir §2) | `acteMeta` → `productionActe.ts` ; catalogues `config/acteTypes.ts` ↔ `scripts/attache/acteTypes.mjs` vérifiés entrée par entrée : **identiques** |
| Validation ✓ → création d'un acte identique à la saisie manuelle ; les deux surfaces (détail d'enquête, page assistant) passent par le **même code** (`syncProductionActe`) | ✅ (2 bugs corrigés) | `ProductionsSection.valider` et `ProductionPopup.valider` → même appel |
| Base de connaissances : recherche agentique, documents réflexes ★, rangement de pièces reçues (`kb_ranger_piece`), classement par lots | ✅ | `kb.mjs`, `classer.mjs`, `depot.mjs` |
| Apprentissage : 8 types de signaux tous réellement déposés (édition à la main **avec diff exact**, refus d'acte **avec motif**, propositions ✓/✗, portes de qualité, corrections en chat par heuristique), consolidation bornée, étude du corpus → trames `modele-*`, propositions de méthode ✓/✗, métriques 30 j | ✅ | `apprentissage.mjs`, `etude.mjs`, `propositions.mjs`, PUT `/production` |
| CR / mis en cause / actes proposés à la détection, dédoublonnage au dépôt ET à l'application, jamais d'écriture d'office | ✅ | `propositions.mjs`, `PropositionsBar` |
| Routines (quotidiennes / toutes les N h), brief majordome incrémental, gouverneur de consommation, fenêtre de nuit, sous-agents lecture seule | ✅ | `routines.mjs`, `attache-service.mjs`, `subagents.mjs` |
| Légalité : NATINF du dossier imposés dans les actes, fiche légale des 12 catégories TSE (durée, autorité JLD/procureur, plafond de prolongations), chaîne légale évaluée à l'analyse des PDF | ✅ | prompt + `acteTypes`, `analyse.mjs` |
| Dissimulation (signatures du magistrat, jamais « IA » dans les données partagées), audit chiffré, versionnage de toutes les écritures | ✅ | `journal.mjs`, `qualite.mjs`, coffres |

## 2. Incohérences et bugs trouvés — TOUS corrigés

1. **Validation d'une requête art. 76 → acte faux** *(le plus grave)*. Le
   dérivateur client (`utils/productionActe.ts`) testait « sans durée » AVANT
   « en attente JLD » : une requête art. 76 validée créait un acte **« en
   cours » sans date de début**, hors suivi JLD — à l'inverse de la saisie
   manuelle et du miroir serveur. → Ordre des tests inversé + date de début
   posée : l'art. 76 naît « autorisation en attente » (ou « en cours » daté si
   déjà autorisé), comme partout ailleurs.
2. **Co-saisine : validation sans effet.** `syncProductionActe` ne cherchait
   que dans les enquêtes du contentieux actif : valider l'acte d'une enquête
   **partagée** le marquait « traité » sans jamais créer l'acte. → Écriture
   dans le contentieux d'origine (même mécanique qu'`ajoutCR`), idempotente,
   avec entrée de modification.
3. **`cible`/`objet` perdus** pour les actes de rubrique « autre » à la
   validation (l'information structurée fournie par l'IA était jetée). →
   Reportés dans la description de l'acte.
4. **Statut des mis en cause divergent** : « actif » à la main, « mis en
   cause » via l'IA — deux populations pour le même champ. → Harmonisé sur
   « actif » partout (ajout direct, propositions, création de dossier).
5. **CR de l'attaché sans `contentieuxSource`** (contrairement aux CR saisis
   dans l'app) — attribution ambiguë en co-saisine. → Posé.
6. **Boîte mail sans contrôle d'expéditeur** : quiconque découvrait l'adresse
   de la boîte dédiée pouvait donner des « consignes » (le transfert vaut
   instruction !), jusqu'à créer des dossiers. → Filtre d'expéditeur :
   `SIRAL_ATTACHE_OWNER_EMAIL` + `SIRAL_ATTACHE_ALLOWED_SENDERS` ; expéditeur
   inconnu = ignoré + audité + carte d'alerte (ses instructions n'entrent
   jamais dans un run).
7. **Reprises de mails en échec : abandon silencieux après ~2 essais**, alors
   que le widget affichait « sera retenté » (le jeu `recentlyQueued` n'était
   jamais purgé). → Reprises pilotées : jusqu'à `SIRAL_ATTACHE_MAIL_MAX_ATTEMPTS`
   (défaut 3) à délai croissant, puis **abandon explicite** (carte au fil) ;
   la relève manuelle remet le compteur à zéro ; libellé du widget corrigé.
8. **Échecs sans compte-rendu** : une exception pendant un run mail, un brief
   ou une routine qui cassait ne laissaient AUCUNE carte (juste un badge). →
   Carte d'alerte systématique sur les trois chemins.
9. **Mail > 40 Mo avalé sans trace** (marqué lu, jamais relevé) et **pièce
   jointe > 15 Mo droppée en silence** (l'agent ignorait qu'une pièce
   manquait). → Carte d'alerte pour le premier ; fiche « omise » conservée
   pour la seconde (l'agent sait qu'elle manque et le dit, `boite_lire_piece`
   et le rangement expliquent le refus).
10. **Refus de proposition muet** : le ✗ n'apprenait presque rien (à la
    différence du refus d'acte, qui porte un motif). → Le ✗ ouvre un champ
    « motif » facultatif ; le motif part dans le signal d'apprentissage.
11. **Analyse de documents : trois angles morts** — n° de procédure du PDF
    jamais confronté à l'enquête (les données n'étaient même pas transmises au
    modèle), NATINF non extraits, aucun CR de réception. → Le contexte
    d'enquête (numéros + NATINF) part avec l'analyse ; le modèle rend
    `incoherences` (numéro divergent = « ce PDF est-il dans le bon dossier ? »,
    NATINF absents, dates incohérentes) et `crSuggere` (CR de réception en
    prise de notes, classé d'un clic, signé de votre nom).
12. **Analyse IA inaccessible sur le web** : l'auto-analyse au téléversement
    était désactivée, le bouton réservé à Electron, et le message du modal
    promettait une analyse automatique qui n'existait plus. → Bannière
    « Analyser (IA) » après tout téléversement dans une zone d'actes (admin +
    attaché actif, texte déjà converti dans le navigateur, un clic, jamais
    automatique) ; message corrigé.

## 3. Capacités ajoutées (« autant qu'un utilisateur réel », autonomie qui rend compte)

- **`creer_dossier` au niveau du formulaire** : directeur d'enquête, unité(s),
  n° parquet, n° IDJ, NATINF (vérifiés au référentiel) — « crée un dossier X
  avec tel enquêteur en directeur d'enquête et telle unité » fonctionne
  désormais tel quel. `proposer_dossier` porte les mêmes champs.
- **`modifier_dossier`** (directeur d'enquête, services, date de début,
  n° parquet/IDJ — chaque changement tracé dans les modifications récentes du
  dossier) et **`archiver_dossier`** (archiver/désarchiver, réversible).
- **`modifier_acte`** — le cycle de vie complet, calqué sur les boutons de
  l'app : autorisation JLD accordée (l'art. 76 passe « en cours », les mesures
  à durée passent « pose en attente »), refus JLD, pose (date de fin
  recalculée depuis la pose), pose avortée, fin de mesure, correction de
  champs. Un mail « le JLD a signé » met enfin l'échéancier à jour.
- **`ajouter_mec` / `modifier_mec`** (rôle, statut, victime) sur instruction
  explicite — la détection reste une proposition ✓/✗.
- **`terminer_todo`** (+ ids affichés dans l'aperçu) : l'attaché coche une
  tâche faite, y compris quand son propre travail vient de l'accomplir.
  `ajouter_todo` rappelle la sobriété (jamais de liste-fleuve).
- **Routines gérées en conversation** : `routine_lister` / `routine_enregistrer`
  / `routine_suspendre` / `routine_supprimer` — « chaque semaine, cherche les
  liens cachés » s'enregistre tout seul, avec confirmation du nom et de la
  cadence.
- **Multi-actes verrouillé** : le prompt proactif impose de LISTER tous les
  actes demandés, une production par acte, vérification avant clôture, résumé
  qui les énumère.
- **Contrôles de cohérence érigés en réflexe** (prompt système) : numéro de
  procédure de toute pièce confronté au dossier, NATINF cités ajoutés ou
  divergences signalées, dates recalculées, CR de réception proposé pour tout
  acte reçu.
- **Gouvernance renforcée dans le code** : en run autonome (consolidation,
  étude), TOUTE écriture au dossier et toute gestion de routine sont refusées
  par le serveur MCP lui-même (comme l'était déjà la propriété des
  trames/skills) — l'autonomie s'exerce sur ses méthodes, jamais sur vos
  dossiers sans instruction.
- **Toujours rendre compte** : après toute écriture directe, récapitulatif
  d'une phrase (réponse en chat ou `signaler`) ; tout échec de run laisse une
  carte ; l'audit chiffré conserve le détail.

## 4. Limites assumées (inchangées, par conception)

- **Suppressions** (dossier, acte, CR, mis en cause) : manuelles uniquement —
  elles posent des marqueurs de suppression côté client (`trackDeleted*`) que
  le service ne sait pas poser ; l'attaché propose l'équivalent réversible.
- **Module instruction** : lecture seule (les réponses DML passent par
  « Actes rédigés »).
- **Détection ≠ écriture** : tout ce que l'attaché détecte seul reste une
  proposition ✓/✗ ; l'écriture directe exige votre instruction.
- **Consolidation/étude automatiques en fenêtre de nuit** (22 h → 7 h serveur,
  boutons manuels à toute heure) — voulu pour préserver le forfait.

## 5. Fichiers touchés

`utils/productionActe.ts` · `stores/useEnquetesStore.ts` ·
`utils/documents/ServerDocumentScanner.ts` · `components/modals/AnalyseDocumentsModal.tsx` ·
`components/sections/DocumentsSection.tsx` · `components/attache/PropositionsBar.tsx` ·
`components/attache/InboxWidget.tsx` · `app/api/attache/propositions/route.ts` ·
`app/api/attache/analyse-documents/route.ts` · `scripts/attache-mcp.mjs` ·
`scripts/attache-service.mjs` · `scripts/attache/agent.mjs` ·
`scripts/attache/dossier.mjs` · `scripts/attache/mail.mjs` ·
`scripts/attache/depot.mjs` · `scripts/attache/propositions.mjs` ·
`scripts/attache/analyse.mjs` · `docs/ATTACHE.md` · `.env.exemple`

Vérifications : `node --check` sur tous les modules du service, `tsc --noEmit`
sans erreur, build Next.js production complet ✅, démarrage du serveur MCP et
listing des 88 outils ✅.
