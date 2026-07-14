# Cowork → SIRAL : vers un véritable partenaire de travail

> Note de recherche & feuille de route. Objectif : recenser ce que
> **Claude Cowork** sait faire (source officielle Anthropic + retours
> communauté), le confronter à ce que l'**Attaché de justice** de SIRAL fait
> déjà, et lister les briques qui manquent — **subagents**, **bibliothèque de
> trames**, **base de connaissances**, **convertisseur PDF → texte**.
>
> Date : 2026-07-14. Auteur : A. Chevalier (Parquet d'Amiens).

---

## 0. Point de départ — ce que l'attaché fait DÉJÀ

Beaucoup de « Cowork » est **déjà dans SIRAL**. À garder en tête avant de
ré-inventer : ce n'est pas une page blanche, c'est un socle à étendre.

| Brique Cowork | État dans l'attaché SIRAL | Où |
|---|---|---|
| **Skills** (méthodes réutilisables, divulgation progressive) | ✅ Fait | `skill_lire`, `skills_lister`, `skill_enregistrer` |
| **Trames** (plans-types de documents) | ✅ Fait (par magistrat) | `trame_lire`, `trames_lister`, `trame_enregistrer` |
| **Tâches planifiées / scheduled tasks** | ✅ Fait (Routines + brief quotidien) | Paramètres → Attaché IA → Routines |
| **Mémoire persistante** (globale + par dossier) | ✅ Fait | `memoire_noter`, `memoire_dossier_noter` |
| **Consignes permanentes** (global instructions) | ✅ Fait | Paramètres → « Consignes permanentes » |
| **Deliverables réels** (documents produits, export PDF/Word, parapheur) | ✅ Fait | Atelier des actes rédigés, `produire_document` |
| **Traitement proactif / boîte mail** | ✅ Fait | Relève IMAP 5 min, fil « Pendant votre absence » |
| **Recherche web** (option) | ✅ Fait (opt-in) | Section « Cerveau » |
| **Connecteurs** (Slack, Drive, Gmail, Agenda…) | ❌ Non (et volontairement borné) | — |
| **Subagents** (Claude parallèles pour sous-tâches) | ❌ **Manque** | — |
| **Base de connaissances documentaire** (jurisprudence, circulaires, mémos) | ❌ **Manque** | — |
| **Ingestion PDF optimisée** (convertir une fois, relire pas cher) | ⚠️ Partiel — re-parse à chaque lecture | `readDocumentText` (`dossier.mjs`) |

**Conclusion** : les 3 chantiers que tu cites (trames, base de connaissances,
PDF → txt) + les **subagents** sont exactement les manques réels. Le reste est
déjà là et mûr.

---

## 1. Les briques de Cowork (recherche)

Cowork, c'est l'architecture agentique de Claude Code **sans terminal**, avec
exécution distante sur les serveurs d'Anthropic. Les capacités phares :

- **Exécution multi-étapes** : Claude planifie, découpe en sous-tâches, exécute
  code/shell dans un environnement isolé, coordonne plusieurs flux en parallèle,
  et livre un vrai résultat avec **citations** vers les fichiers/messages sources.
- **Subagents** : face à des sous-tâches indépendantes, Cowork lance plusieurs
  instances Claude **concurrentes** qui agrègent leurs résultats. Retour
  communauté : « 10 fichiers traités en parallèle → ~30 min ramenés à ~4 min ».
  Limite connue : le *shared-state problem* — mauvais pour le travail
  interdépendant, excellent pour le batch réellement indépendant.
- **Agent templates** : un modèle d'agent empaquette **skills** (méthode +
  connaissances) + **connectors** (accès gouverné aux données) + **subagents**
  (sous-modèles appelés pour une sous-tâche précise : ex. sélection de
  comparables, contrôle de méthode).
- **Projects** : dossier dédié + instructions propres + **mémoire persistante
  entre sessions** + tâches planifiées. « La structure du projet EST la
  mémoire » : `references/`, `thoughts/`, `outputs/`, `done/`…
- **Scheduled tasks** : `/schedule`, cadence horaire / quotidienne / jours
  ouvrés / hebdo / à la demande. Ex. brief matinal, rapport du vendredi.
- **Connecteurs** : Gmail, Notion, Agenda, Drive, Slack, Figma… (hors périmètre
  souhaité pour SIRAL — l'attaché n'écrit qu'au magistrat, par choix de sécurité).
- **Base de connaissances** : pas de vecteurs. Le consensus 2026 (y compris
  l'équipe Claude Code) : la **recherche agentique sur des fichiers markdown
  structurés** (« LLM wiki » à la Karpathy) bat le RAG vectoriel pour les corpus
  non-code — pas d'index à maintenir, pas de pipeline d'embeddings, pas de
  synchronisation ni de fuite de permissions. Un index sémantique n'est utile
  que sur de très gros corpus / recherche par concept.

---

## 2. Ce qu'on peut ajouter à l'app (priorisé)

### A. Subagents — le vrai manque, gros gain immédiat

**Idée** : donner à l'attaché la capacité de **déléguer à des Claude parallèles**
les tâches batch réellement indépendantes. Cas d'usage concrets pour un parquet :

- **Brief quotidien** : aujourd'hui il balaye les dossiers en séquentiel. Avec
  N sous-agents (1 par dossier ou par lot), le brief passe de plusieurs minutes
  à quelques dizaines de secondes — chaque sous-agent renvoie un mini-diagnostic
  structuré (échéances, dormance, incohérences), l'agent principal synthétise.
- **Analyse automatique des documents** : quand un dossier a 20 PDF
  d'ordonnances, lancer l'extraction d'actes **en parallèle** (1 sous-agent par
  PDF) au lieu d'un tour long et fragile. Chaque sous-agent produit un objet
  `{type, cibles, durée, dates, tribunal, chaînage}` ; le principal dédoublonne
  et évalue la chaîne légale globale.
- **Revue de complétude d'un contentieux entier** : un sous-agent par dossier,
  agrégation en un tableau de bord « ce qui va expirer / attend le JLD / dort ».

**Comment** : côté service attaché (`scripts/attache-service.mjs`), un
orchestrateur qui `spawn` plusieurs runs `claude` avec un schéma de sortie
structuré (JSON validé), cap de concurrence (≈ cœurs − 2), agrégation. Modèle
**Haiku/Sonnet** pour les sous-agents (rapides, bon marché), **Opus** pour la
synthèse. Garde-fou : **uniquement pour du travail indépendant** (batch), jamais
pour de l'interdépendant (shared-state problem).

**Coût** : plus de tokens en pic, mais **moins de latence** et **meilleure
robustesse** (un PDF illisible ne casse pas tout le lot). Priorité **haute**.

### B. Base de connaissances documentaire — pattern « LLM wiki »

**Idée** : un corpus markdown structuré, chiffré comme le reste, que l'attaché
**lit à la demande** (recherche agentique, pas de vecteurs). Contenus typiques :

- **Jurisprudence** utile et **textes** (extraits de code, circulaires DACG,
  dépêches, mémentos) — anonymisés / non nominatifs.
- **Modes opératoires internes** : « comment on rédige une DML ici », délais TSE,
  seuils, réflexes contentieux (CRIM ORG / ECOFI / ENVIRO).
- **Fiches NATINF** enrichies, glossaire, annuaire des services d'enquête.
- **Modèles de raisonnement** (qualification, proportionnalité, motivation).

**Structure** (la structure = la mémoire) :

```
connaissances/
  INDEX.md                 ← sommaire lu en premier (titres + 1 ligne chacun)
  jurisprudence/*.md
  textes/*.md
  modes-operatoires/*.md
  fiches/*.md
```

**Accès** : nouveaux outils MCP `kb_chercher(requête)` (grep/titre sur l'index)
et `kb_lire(chemin)` — même divulgation progressive que les skills : l'attaché
voit l'`INDEX.md` en permanence, et ne charge le contenu qu'au besoin. Alimenté
depuis le panneau (« ajoute à la base : … ») **et** par le convertisseur PDF
(section C). Chiffré (clé globale), versionné, réversible — comme skills/trames.

**Pourquoi pas de RAG vectoriel** : corpus modeste, chiffré E2EE, permissions
strictes → un index externe serait « un système de plus » à synchroniser et une
surface de fuite. La recherche agentique sur markdown suffit et respecte le
modèle de sécurité. Priorité **haute**.

### C. Convertisseur PDF → texte / markdown (ingestion)

**Le problème actuel** : `readDocumentText` (`scripts/attache/dossier.mjs:174`)
**ré-extrait le PDF à chaque lecture** via `pdf-parse`, plafonné à 200 000
caractères, sans OCR. Chaque relecture = CPU + tokens gaspillés, et les PDF
scannés (ordonnances signées) ressortent vides.

**Idée — convertir une fois, relire pas cher** :

1. À l'import d'un document (ou en tâche de fond), produire un **jumeau texte**
   `.md` à côté du PDF (chiffré, dans la zone documents du dossier / dans
   `connaissances/`).
2. **Texte natif** : `pdf-parse` / `pdfjs-dist` (déjà dans `package.json`).
   **Scanné** : bascule OCR (`tesseract`, fr) — sinon l'ordonnance est perdue.
3. **Nettoyer & compacter** : dé-hyphénation, colonnes, en-têtes/pieds
   répétitifs, tableaux → markdown. On stocke le `.md`, **pas** le PDF, pour la
   relecture IA.
4. **Découper** en sections titrées (le markdown devient sa propre table des
   matières → lecture ciblée, pas « tout le document »).

**Gains** : **place serveur** (un `.md` pèse une fraction du PDF ; on peut même
ne garder que le texte pour le corpus de connaissances) et **tokens** (relecture
d'un extrait ciblé au lieu de 200 k caractères re-parsés). Base existante à
réutiliser : `scripts/parse-memento-pdf.py`, `pdf-parse`, `pdfjs-dist`.

**Où** : un module `scripts/attache/ingest.mjs` + un outil MCP `document_ingerer`
(ou hook à l'import). Cache : si le `.md` existe et le PDF n'a pas changé (hash),
on ne reconvertit pas. Priorité **haute** (débloque B et allège tout le reste).

### D. Bibliothèque de trames — partagée, structurée, à variables

**Aujourd'hui** : trames par magistrat, texte libre (`trame_enregistrer`). Ça
marche mais reste plat. **Évolutions** :

- **Catégorisation** : par type d'acte (DML, réquisition TSE, saisine, réponse
  JLD, soit-transmis…) et par contentieux → `trames_lister(categorie)`.
- **Variables / champs** : `{{numero_dossier}}`, `{{mis_en_cause}}`,
  `{{date}}`, `{{fondement}}`… pré-remplis depuis le dossier au moment du
  `produire_document`. Une trame devient un **gabarit**, pas juste un exemple.
- **Bibliothèque partagée** (optionnelle) : un socle commun (versionné) +
  surcouche personnelle du magistrat. Utile si plusieurs magistrats un jour.
- **Trames ⇄ base de connaissances** : la trame décrit *la forme* d'un acte, la
  base décrit *le fond* (jurisprudence, motivations types) → le
  `produire_document` lit les deux.

Priorité **moyenne** (le socle existe, c'est de l'enrichissement).

### E. Pistes Cowork complémentaires

- **Projets / dossiers persistants** : la mémoire par dossier existe déjà ;
  l'étendre en « espace de travail » (sous-dossiers `productions/`, `notes/`,
  `references/` dédiés) pour coller au pattern Cowork « structure = mémoire ».
- **Citations systématiques** : que chaque affirmation de l'attaché pointe la
  cote / le CR / le document source (Cowork le fait nativement) — renforce la
  confiance et la vérifiabilité.
- **Deliverables planifiés** : générer automatiquement, à cadence, des livrables
  types (point d'étape hebdo par dossier actif, tableau des échéances du mois).
- **Connecteurs** : volontairement **écartés** (l'attaché n'écrit qu'au
  magistrat). À garder ainsi tant que le périmètre de sécurité prime.

---

## 3. Feuille de route proposée

| # | Chantier | Valeur | Effort | Priorité |
|---|---|---|---|---|
| 1 | **Convertisseur PDF → md** + cache | Débloque tout, ↓ place & tokens | Moyen | 🔴 Haute |
| 2 | **Base de connaissances** (LLM-wiki + `kb_*`) | Fond juridique réutilisable | Moyen | 🔴 Haute |
| 3 | **Subagents** (brief + analyse docs en parallèle) | ↓ latence, ↑ robustesse | Moyen-élevé | 🔴 Haute |
| 4 | **Trames → gabarits** (catégories + variables) | Rédaction plus rapide | Faible-moyen | 🟠 Moyenne |
| 5 | **Projets/dossiers persistants** enrichis | Continuité du travail | Faible | 🟢 Basse |
| 6 | **Citations systématiques** | Confiance / vérifiabilité | Faible | 🟢 Basse |

**Séquence recommandée** : 1 → 2 → 3 (le convertisseur alimente la base ;
les subagents accélèrent l'analyse et le brief une fois le corpus prêt).

Tout ceci reste dans le modèle de sécurité actuel : chiffré (clé globale),
versionné, réversible, journalisé, **admin-only**, l'attaché n'écrit qu'au
magistrat, aucune trace « Attaché IA » dans les données partagées.

---

## Sources

- [Get started with Claude Cowork — Claude Help Center](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork)
- [Claude Cowork — Anthropic (page produit)](https://www.anthropic.com/product/claude-cowork)
- [The Claude Cowork product guide — Claude by Anthropic](https://claude.com/blog/the-claude-cowork-product-guide)
- [Agents for financial services (agent templates : skills + connectors + subagents) — Anthropic](https://www.anthropic.com/news/finance-agents)
- [Claude Cowork Guide for Power Users : Plugins, Skills, Sub-Agents, Memory — K. Zieminski](https://karozieminski.substack.com/p/claude-cowork-guide-plugins-memory-sub-agents-tips)
- [Claude Cowork scheduled tasks : 6 ways to automate — aiblewmymind](https://aiblewmymind.substack.com/p/claude-cowork-scheduled-tasks-6-ways)
- [Claude Cowork : use cases by profession — aiblewmymind](https://aiblewmymind.substack.com/p/claude-cowork-use-cases-guide)
- [Building Agents with Claude : Skills to Scheduled Tasks and Routines — Hatchworks](https://hatchworks.com/blog/claude/building-agents-with-claude/)
- [Why Claude Code dropped vector-DB RAG (agentic search vs RAG) — SmartScope](https://smartscope.blog/en/ai-development/practices/rag-debate-agentic-search-code-exploration/)
- [LLM Knowledge Base for Coding Agents : Beyond RAG — Verdent](https://www.verdent.ai/guides/llm-knowledge-base-coding-agents)
- [How Claude Code works in large codebases — Claude by Anthropic](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start)
