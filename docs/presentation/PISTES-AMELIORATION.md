# SIRAL — Pistes d'amélioration

> Document de travail — produit projeté (édition web). Rédigé le 12 juin 2026.
> Complète `docs/PLAN-MIGRATION-WEB.md` (architecture & migration) : ici, on parle
> **produit** — ce qui rendra SIRAL plus utile, plus sûr, plus diffusable.

Les pistes sont classées en trois horizons : **quick wins** (jours), **moyen terme**
(semaines, après le déploiement web), **horizon** (à instruire avant d'engager).
Chaque piste indique le bénéficiaire principal : 👨‍⚖️ magistrat · 🧭 chef de service ·
🎓 juriste assistant · 🛡️ sécurité/conformité.

---

## 1. Quick wins (avant ou juste après le déploiement web)

### 1.1 Export PDF : couvrir aussi l'instruction 👨‍⚖️🧭
L'export PDF des statistiques (corrigé le 12/06) couvre enquêtes, audiences, actes,
services, infractions et déférements — mais **pas le module Instructions**
(`InstructionStats` est affiché à l'écran mais absent du rapport). Ajouter une
section « Instruction » au rapport : dossiers par cabinet, mesures de sûreté en
cours, échéances 175 jours, DML traitées. Le rapport devient alors le **vrai
« état du service » en un clic**.

### 1.2 Exports tableur (CSV/XLSX) 🧭
Les tableaux du rapport (orientations par mois, condamnations, services) exportables
en CSV : c'est ce que demandent les SG/chefs de juridiction pour retraiter dans
leurs propres trames. Coût très faible (les données sont déjà agrégées pour le PDF).

### 1.3 Rapport annuel « politique pénale » pré-rédigé 👨‍⚖️🧭
Au-delà des chiffres : un gabarit de **rapport annuel rédigé** (texte + chiffres
injectés) généré depuis les mêmes données — trame type « rapport de politique
pénale du contentieux ». Réutilise `generateStatsPdfHtml` ; seule la couche
éditoriale est à écrire.

### 1.4 Comparaison inter-années 🧭
Le sélecteur d'année existe ; ajouter une colonne « N-1 » et un delta (%) dans les
cartes de synthèse et le PDF. Donne immédiatement la tendance sans retraitement.

### 1.5 Accessibilité & RGAA (avec la refonte « Lumière ») 🛡️
La palette DSFR vise déjà les contrastes RGAA ; profiter de la refonte pour passer
les écrans clés (dashboard, modale enquête, stats) au crible : navigation clavier
complète, focus visibles, `aria-label` sur les badges de couleur (la couleur ne
doit jamais porter seule l'information — important pour les CR colorés par
catégorie).

### 1.6 Jeu de données de démonstration 🎓
Un bouton « base de démonstration » (données fictives réalistes) pour : former les
arrivants, faire des démos sans rien dévoiler (secret de l'enquête), et alimenter
les captures de la plaquette/présentation sans caviardage manuel (`redact.py`).

---

## 2. Moyen terme (après stabilisation du déploiement web)

### 2.1 Palette de commande Ctrl+K 👨‍⚖️
Annoncée dans la maquette « Lumière » : recherche transverse (dossiers, mis en
cause, PV), navigation et actions rapides (« nouvelle enquête CRIMORG »,
« stats ECOFI 2026 ») au clavier. Gros gain de fluidité perçue pour un coût
raisonnable (l'index de recherche transverse existe déjà pour l'overboard).

### 2.2 Notifications push chiffrées 👨‍⚖️🧭
La PWA permet le Web Push : échéances JLD/175 jours, DML déposée, modification d'un
dossier épinglé. Contrainte E2EE : le payload doit rester neutre (« 1 échéance
demain — ouvrir SIRAL ») ; le déchiffrement du détail se fait à l'ouverture.
Sur iPhone, requiert l'installation écran d'accueil (déjà le mode de déploiement).

### 2.3 Mode permanence mobile 👨‍⚖️
La `PermanencePage` au format téléphone : saisie ultra-rapide d'un défèrement ou
d'une OPJ en garde à vue depuis l'iPhone (gros boutons, dictée vocale du navigateur
pour les CR), synchronisée hors-ligne. C'est l'usage mobile à plus forte valeur.

### 2.4 Présence & édition concurrente 🧭
Le suivi « modifications non vues » existe ; l'étape suivante est la **présence en
temps réel** (« M. X est dans ce dossier ») et un verrou doux par section pour
éviter les écrasements sur le blob versionné. Préalable utile avant d'ouvrir
l'app à plus d'utilisateurs simultanés (essaimage).

### 2.5 Journal d'accès consultable par l'admin 🛡️
Le serveur tient déjà un journal d'accès ; l'exposer dans l'app (qui s'est
connecté, depuis quel appareil, quelles versions de coffre ont été lues/écrites).
Argument fort vis-à-vis du RSSI : traçabilité complète sans lisibilité des données.

### 2.6 Cartographie des réseaux : du dessin à l'analyse 👨‍⚖️
La mindmap relie déjà les dossiers ; deux extensions naturelles :
- **détection automatique de ponts** : mis en cause (ou alias/téléphone) communs à
  deux enquêtes non rapprochées → suggestion de lien, dans la continuité de la
  « mémoire transverse » des noms ;
- **export image/PDF** de la carte pour les réunions de service et les rapports.

### 2.7 Gestion dynamique des scellés et biens saisis 🧭
Le suivi saisies → confiscations existe ; ajouter les **alertes de gestion** :
véhicule saisi depuis > X mois sans décision (proposer la vente anticipée),
numéraire non consigné, etc. Transforme une statistique en outil de bonne
administration — argument différenciant du produit.

---

## 3. Horizon (à instruire avant d'engager)

### 3.1 Essaimage multi-parquets 🧭🛡️
L'architecture multi-tribunaux est prévue (champ tribunal par compte, cloisonnement
par clé). Pour passer de « l'outil d'Amiens » à un produit diffusable (JIRS,
autres parquets), il faudra : un **onboarding autonome** (création de tribunal,
premier admin, kit de récupération guidé), une **documentation d'exploitation**
(le `TUTO-DEPLOIEMENT.md` en version « autre service »), et une position claire
sur le statut (projet personnel mis à disposition / reprise institutionnelle —
la typographie Marianne et la palette DSFR préparent ce second scénario).

### 3.2 Conformité formalisée 🛡️
Avant tout essaimage : registre de traitement + AIPD (directive police-justice),
mentions d'information, politique de durée de conservation (l'archivage existe ;
le purge automatique documentée, non). L'E2EE est l'argument central — le
formaliser dans un dossier de 4-5 pages réutilisable à chaque présentation RSSI.

### 3.3 Interopérabilité (exploratoire)
Pas d'API Cassiopée accessible ; en revanche, un **import semi-automatique**
(coller un extrait, parsing des numéros parquet/PV) et un **export structuré
neutre** (JSON documenté) éviteraient l'enfermement des données et faciliteraient
un éventuel transfert institutionnel.

### 3.4 Aide à la rédaction embarquée (sans IA serveur)
La contrainte E2EE exclut tout traitement serveur. Des gabarits dynamiques
(réquisitions, soit-transmis) générés côté client depuis les données du dossier —
dans l'esprit du « récapitulatif de clôture » — apportent 80 % du gain d'une
« synthèse IA » (retirée car non fonctionnelle) sans aucune donnée sortante.

---

## 4. Dette & robustesse (fil continu)

- **Tests** : étendre les e2e (49 verts) aux parcours stats/exports — le bug de
  l'export PDF (PDF blanc) aurait été attrapé par un test de non-régression sur
  pixels rendus (le harnais headless utilisé pour le correctif du 12/06 est
  réutilisable tel quel).
- **Surveillance serveur** : uptime + alerte expiration TLS/domaine + espace
  disque des versions de coffre (rotation N versions à borner).
- **Parcours de récupération** : répéter en conditions réelles la perte de
  passkey et la restauration depuis `.backup` — c'est le scénario qui fait
  confiance ou défiance le jour J.

---

*Document compagnon : `docs/presentation/plaquette/PLAQUETTE-SIRAL.html` (plaquette
produit A4 recto-verso, charte « Lumière » palette Justice).*
