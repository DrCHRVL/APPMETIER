# Analyse du module Instruction

> Document de travail — rédigé le 15 juin 2026.
> Portée : module « Instructions » (dossiers d'information judiciaire), distinct
> des enquêtes préliminaires et des audiences. Couvre trois volets demandés :
> **(1)** bugs / incohérences / pertes de données potentielles, **(2)** pistes
> d'amélioration UX — notamment la liaison au type de contentieux, **(3)** le
> fichier de statistiques instruction et son intégration à l'export PDF.

Convention de gravité : 🔴 élevée · 🟠 moyenne · 🟡 faible.
Chaque point cite `fichier:ligne`. Les points marqués *(vérifié)* ont été
relus dans le code ; ceux marqués *(à confirmer)* méritent un test ciblé avant
correction.

---

## 1. Bugs, incohérences et pertes de données potentielles

### 1.1 🔴 Les dossiers sans `contentieuxId` disparaissent des statistiques *(vérifié)*

`app/page.tsx:1507`
```ts
instructions={instructions.filter(d => (d.contentieuxId || '') === currentContentieuxId)}
```
`contentieuxId` est **optionnel** (`types/instructionTypes.ts:410`). Pour un
dossier sans contentieux (legacy, import, ou saisi « — non précisé — »),
`d.contentieuxId || ''` vaut `''`, qui n'est jamais égal à un identifiant réel
(`crimorg`, `ecofi`, …). **Ces dossiers ne sont donc comptés dans aucune
statistique, pour aucun contentieux.**

C'est l'incohérence centrale du module : la liste des instructions
(`app/page.tsx:1449`) et les archives (`:1464`) reçoivent **tous** les dossiers
sans filtrage, alors que les stats (`:1507`) et la cartographie (`:890`)
filtrent. Conséquence concrète : un dossier visible dans la liste peut
n'apparaître dans **aucun** écran de statistiques. C'est une perte de
visibilité, pas une perte de donnée stockée — mais l'effet perçu est le même.

**Correctif recommandé** : décider d'une valeur de repli unique (voir §2.1) et
l'appliquer ici comme ailleurs, par ex. `(d.contentieuxId || LEGACY) === ctx`,
ou exposer un bucket « non précisé » plutôt que de les faire disparaître.

### 1.2 🟠 Repli de `contentieuxId` incohérent entre enquêtes et instructions *(vérifié)*

- Résultats d'audience **enquêtes** : repli sur `'crimorg'`
  (`utils/audienceLegacy.ts` — `LEGACY_CONTENTIEUX_ID = 'crimorg'`).
- Résultats d'audience **instructions** : repli sur `'instructions'`
  (`stores/useInstructionResultatsStore.ts` — `FALLBACK_CONTENTIEUX = 'instructions'`).
- Cartographie : **aucun** repli, exclusion stricte
  (`app/page.tsx:890` — `if (!inst.contentieuxId) continue;`).
- Stats : repli implicite sur `''` (cf. §1.1).

Quatre comportements différents pour la même question « que faire d'un dossier
sans contentieux ? ». Il faut une règle unique, documentée et partagée.

### 1.3 🟠 Stockage des instructions non cloisonné par contentieux *(vérifié)*

`hooks/useInstructions.ts:27-29` — clé de stockage unique par utilisateur :
`instructions__<windowsUsername>`. Les **enquêtes**, elles, sont cloisonnées par
contentieux (clés `ctx_<contentieuxId>_…`). Conséquence : au changement de
contentieux courant, la liste d'instructions n'est pas re-scopée ; tout le
filtrage repose sur le champ `contentieuxId` en mémoire. Ce n'est pas un bug en
soi, mais c'est la cause structurelle de §1.1/§1.2 : tant que le champ est
optionnel et le filtrage divergent, des dossiers « tombent entre les mailles ».

### 1.4 🟡 Génération d'`id` de dossier sans aléa *(vérifié)*

`hooks/useInstructions.ts:160` — `id: Date.now()`. Deux dossiers créés dans la
même milliseconde partagent le même `id`, ce qui peut provoquer une collision à
la fusion/synchro. Les MEX et victimes utilisent déjà
`Date.now() + Math.floor(Math.random() * 1000)`
(`components/modals/InstructionDetailModal.tsx`). **Correctif** : aligner le
dossier sur le même schéma (ou un UUID). Probabilité faible en usage réel
(création unitaire), mais le correctif est trivial.

### 1.5 🟠 Synthèses d'acte indexées sur des identifiants éphémères *(à confirmer)*

`acteSyntheses?: Record<string, string>` (`types/instructionTypes.ts:453`) est
indexé par la clé de l'item de timeline (`evt-<id>`, `dp-debut-<mexId>-<periodeId>`,
…). Si un MEX ou une période est supprimé puis recréé, son `id` change et la
synthèse pré-rédigée pour le réquisitoire définitif devient orpheline (perte
silencieuse de texte rédigé). À vérifier sur le parcours « supprimer puis
re-créer un MEX » ; si confirmé, prévoir un nettoyage des clés orphelines et/ou
un avertissement avant suppression d'un MEX porteur de synthèses.

### 1.6 🟠 `motivationRenforceeRequise` peut taire une alerte légale *(à confirmer)*

`utils/instructionUtils.ts` — la fonction renvoie `false` si `casDPId` est absent
ou pointe vers un cas de DP inexistant, **même si** la durée cumulée de détention
dépasse le seuil de motivation renforcée. Une donnée de config manquante masque
alors une échéance légale. **Correctif suggéré** : journaliser un avertissement
et, par prudence, considérer l'alerte comme due en cas de cas DP indéterminé
pour un détenu.

### 1.7 🟠 Throttle recréé à chaque changement de dépendances *(à confirmer)*

`hooks/useInstructionAlerts.ts` — motif `useCallback(throttle(fn), [deps])` : à
chaque changement de `dossiers`/`rules`, une **nouvelle** fonction throttlée est
créée, ce qui réinitialise l'état du throttle. À l'inverse, `useInstructions.ts`
utilise correctement `useCallback(throttle(fn), [])` en lisant des refs. À
homogénéiser : `const throttled = useMemo(() => throttle(refresh, D), [refresh])`.

### 1.8 🟡 Sauvegarde au démontage en « best-effort » asynchrone *(vérifié)*

`hooks/useInstructions.ts:195-208` — au démontage, la sauvegarde est lancée sans
`await` (promesse non attendue). Une fermeture immédiate après modification peut
l'interrompre. Le débounce `persist` (2,5 s) couvre le cas courant ; le risque
résiduel concerne la toute dernière modification suivie d'une fermeture instantanée.

### 1.9 🟡 Champ `verifications` legacy conservé mais non éditable *(vérifié)*

`types/instructionTypes.ts:435-439` — l'onglet a été retiré de l'UI, les données
restent stockées « pour rétrocompat ». Aucune perte aujourd'hui, mais toute
future suppression du champ doit s'accompagner d'une migration (vers `notesPerso`
par ex.) sous peine de perdre les anciens points de vérification.

### 1.10 ✅ Point vérifié et **écarté** : édition des infos de base

L'`editData` de `InstructionDetailModal.tsx:95-108` n'initialise qu'un
sous-ensemble de champs. Ce **n'est pas** une perte de données : `updateDossier`
fusionne (`{ ...d, ...updates, id: d.id }`, `hooks/useInstructions.ts:175`), donc
les champs absents de `editData` (tags, `enquetePreliminaireId`, `origine`, …)
sont préservés. Aucune action requise.

---

## 2. Pistes d'amélioration UX — liaison au type de contentieux

Constat produit : aujourd'hui les instructions sont **générales**, parfois non
rattachées à un contentieux. À terme, chaque instruction devra **obligatoirement**
être liée à un contentieux (c'est une donnée structurante : filtrage, stats,
cartographie, cloisonnement). Trajectoire proposée, sans casser les dossiers
existants :

### 2.1 Choisir une règle de repli unique (préalable à tout)
Décider d'une valeur canonique pour « contentieux non renseigné ». Recommandé :
un identifiant explicite et visible (`'non_precise'`) plutôt que `''`/`undefined`,
de façon à ce que ces dossiers forment un **groupe affiché** (et non un trou).
Appliquer cette règle aux quatre endroits de §1.2.

### 2.2 Rendre le champ obligatoire à la création (étape douce)
`components/modals/NewInstructionModal.tsx` : pré-sélectionner le contentieux
**courant** comme valeur par défaut (au lieu de « — non précisé — ») et désactiver
le bouton « Créer » tant qu'aucun contentieux n'est choisi, dès lors qu'au moins
un contentieux est défini. Gain immédiat : plus aucun **nouveau** dossier orphelin.

### 2.3 Résorber le stock legacy
Outil de migration (admin) listant les dossiers sans contentieux et permettant
de les affecter en masse ou un par un. `InstructionDetailModal` affiche déjà un
avertissement ambre « Contentieux non précisé » : le compléter par un compteur
global et un accès direct à la liste des dossiers concernés.

### 2.4 Aligner toutes les vues une fois le stock résorbé
Quand le champ est garanti renseigné : filtrer la **liste** et les **archives**
par contentieux courant (comme les enquêtes), pour que liste, stats et
cartographie montrent exactement le même périmètre. Tant que le stock n'est pas
résorbé, conserver un bucket « non précisé » visible plutôt que de masquer.

### 2.5 Cible structurelle (horizon)
Cloisonner le stockage des instructions par contentieux
(`ctx_<contentieuxId>_instructions__<user>`), à l'image des enquêtes — supprime
par construction la classe de bugs §1.1/§1.2/§1.3.

> Recommandation d'ordonnancement : **2.1 → 2.2 → 2.3 → 2.4 → 2.5**. Les trois
> premières étapes sont des quick wins à faible risque ; les deux dernières
> attendent que le stock soit propre.

---

## 3. Statistiques instruction & export PDF *(implémenté dans cette itération)*

Avant : l'écran Statistiques affichait bien `InstructionStats`, mais le **rapport
PDF** couvrait enquêtes, actes, services, audiences, infractions et déférements —
**pas l'instruction** (cf. `PISTES-AMELIORATION.md §1.1`). Le rapport n'était donc
pas un véritable « état du service ».

### Ce qui a été fait
1. **Fonction de calcul pure** : extraction de `computeInstructionStats(dossiers)`
   depuis le hook `useInstructionStats` (`hooks/useInstructionStats.ts`). Le hook
   l'appelle dans son `useMemo` ; l'export PDF l'appelle directement (un hook ne
   peut pas être invoqué hors React). **Source unique** pour l'écran et le PDF.
2. **Section « Instruction » dans le PDF** (`utils/generateStatsPdf.ts`) : nouvelle
   page dédiée reprenant fidèlement l'écran —
   - cartes de synthèse du stock (dossiers actifs/archivés, MEX et mesures de
     sûreté, âge moyen, volume procédural, au règlement, DML, à régler art. 175) ;
   - camembert des mesures de sûreté (mêmes couleurs que l'app) ;
   - barres des principaux types de faits (top 8) ;
   - tableau des échéances de règlement (détenu, 1 mois après 175 rendu) ;
   - tableau du délai moyen de clôture par cabinet (pondéré par nb de MEX).
3. **Branchement** : `ExportPdfButton` reçoit les `instructions` (déjà filtrées
   par contentieux par `StatsPage`), calcule les stats et les libellés/couleurs
   de cabinets, et les transmet à `exportStatsPdf`. La section est **omise** s'il
   n'y a aucun dossier pour le contentieux exporté.

### Limite connue (héritée de §1.1)
Le PDF reçoit la **même liste filtrée** que l'écran (`app/page.tsx:1507`). Il est
donc cohérent avec l'affichage, mais hérite de la même exclusion des dossiers sans
contentieux. La résorption passe par le volet §2, pas par l'export lui-même.

### Fichiers modifiés
- `hooks/useInstructionStats.ts` — extraction de `computeInstructionStats`.
- `utils/generateStatsPdf.ts` — type `instruction` + section de rendu.
- `components/pdf/ExportPdfButton.tsx` — calcul et passage des données.
- `components/pages/StatsPage.tsx` — transmission des `instructions` au bouton.
