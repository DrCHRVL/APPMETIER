// utils/mindmapGraph.ts
// Construit le graphe biparti MEC ↔ Dossier pour le module Mindmap.
//
// Modèle :
//   - Un nœud "MEC" représente une personne mise en cause, identifiée par
//     un nom canonique (normalisé). Plusieurs MisEnCause de dossiers
//     différents portant le même nom canonique fusionnent en un seul nœud.
//   - Un nœud "Dossier" représente une enquête (en cours, archivée ou
//     instruction).
//   - Une arête relie un MEC à chaque dossier où il est cité.
//
// Le score d'un MEC (taille du nœud) est paramétrable depuis l'écran
// Paramètres > Module Cartographie. Formule de base :
//   score = (nb_dossiers × w_dossier)
//         + (nb_contentieux × w_contentieux)
//         + (nb_mises_en_examen × w_me)
//         + (nb_chefs × w_chef)
//         + (nb_liens_renseignement × w_lien)
//         + bonus_infraction (somme par tag d'infraction associé)
//   × multiplicateur_recent si au moins un dossier a été touché dans la
//     fenêtre glissante de 12 mois.
//
// Les valeurs par défaut sont définies dans types/cartographieTypes.ts.

import { Enquete, MisEnCause } from '@/types/interfaces';
import type { MisEnExamen } from '@/types/instructionTypes';
import { ContentieuxId } from '@/types/userTypes';
import {
  DEFAULT_CARTO_WEIGHTS,
  type CartographieScoreWeights,
} from '@/types/cartographieTypes';

// ──────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────

export interface MecNode {
  type: 'mec';
  /** Identifiant canonique (nom normalisé) — clé stable cross-dossiers */
  id: string;
  /** Nom d'affichage (forme la plus fréquente parmi les variantes) */
  displayName: string;
  /** Variantes orthographiques rencontrées */
  variants: string[];
  /** Dossiers où ce MEC apparaît */
  dossierIds: string[];
  /** Contentieux distincts dans lesquels il apparaît (signal de transversalité) */
  contentieuxIds: ContentieuxId[];
  /** Nombre de mises en examen formelles (via misEnExamen sur les instructions) */
  nbMisEnExamen: number;
  /** Total des chefs d'inculpation cumulés */
  nbChefs: number;
  /** Nombre de liens renseignement (manuels) attachés au MEC. */
  nbLiensRenseignement: number;
  /** Bonus cumulé issu des tags d'infraction (pondéré par config). Pour
   *  chaque dossier ex nihilo (ou DI réelle) auquel le MEC est lié, on
   *  additionne les poids des tags d'infraction associés. La récidive
   *  est donc gratuite : 2× "trafic stups" = 2× le poids. */
  infractionWeight: number;
  /** A été mentionné au moins une fois dans les 12 derniers mois */
  recent: boolean;
  /** Score composite normalisé entre 0 et 1 (max du graphe = 1) */
  score: number;
  /** Score brut avant normalisation */
  rawScore: number;
  /** Bonus de score appliqué manuellement (peut être négatif). 0 = pas de boost. */
  manualBonus: number;
  /** Justification du bonus manuel, libre. */
  manualBonusReason?: string;
  /** Statuts uniques rencontrés (pour coloration éventuelle) */
  statuts: string[];
  /** Vrai si ce nœud représente une victime projetée sur la carte (et non un
   *  vrai mis en cause). Le rendu affiche alors la mention « (Victime) ». Toute
   *  contribution d'un vrai MEC du même nom canonique repasse ce drapeau à faux. */
  isVictime?: boolean;
  /** Vrai si ce nœud est uniquement présent en tant que suspect (pas encore mis
   *  en examen). Un vrai MEC ou MEX du même nom canonique repasse ce drapeau à faux. */
  isSuspect?: boolean;
  /** Rôle présumé dans l'affaire (issu de la fiche suspect) */
  suspectRole?: string;
  /** Notes manuelles (issues d'une fiche ex nihilo) */
  manualNotes?: string;
  /** Alias manuels — fusionnés avec les variants */
  manualAlias?: string[];
  /** Statut renseigné manuellement */
  manualStatut?: string;
  /** True si le MEC n'apparaît dans aucun dossier réel */
  isManualOnly?: boolean;
}

export interface DossierNode {
  type: 'dossier';
  /** Identifiant unique. Pour un dossier réel : `${contentieuxId}_${enqueteId}`.
   *  Pour un dossier ex nihilo : préfixé `dexn_…`. */
  id: string;
  enqueteId: number;
  contentieuxId: ContentieuxId;
  /** Numéro de l'enquête ou label du dossier ex nihilo */
  numero: string;
  /** Statut : en_cours, archive, instruction (pour les dossiers réels) */
  statut: Enquete['statut'];
  /** Date de création (ISO) */
  dateCreation: string;
  /** Nombre de MEC dans ce dossier (taille du nœud dossier) */
  nbMec: number;
  /** True pour un dossier créé manuellement par l'utilisateur */
  isExNihilo?: boolean;
  /** Notes manuelles */
  notes?: string;
  /** Services d'enquête de l'enquête source. Sert d'ancrage zonal optionnel
   *  dans la cartographie (regroupement des galaxies par service dominant).
   *  Vide pour les dossiers ex nihilo. */
  services?: string[];
}

export type GraphNode = MecNode | DossierNode;

export interface GraphEdge {
  /** Identifiant unique. Pour les arêtes de données : `${mecId}__${dossierId}`.
   *  Pour les liens renseignement : `lien_…`. */
  id: string;
  source: string;
  target: string;
  /** 'data' = arête déduite des dossiers ; 'renseignement' = lien manuel ;
   *  'suspect' = lien suspect → dossier d'instruction. */
  kind: 'data' | 'renseignement' | 'suspect';
  /** Libellé optionnel (utile pour les liens renseignement) */
  label?: string;
  /** Notes manuelles (liens renseignement) */
  notes?: string;
}

// Snapshot des données overlay nécessaires à la construction du graphe.
// Importé sans référence circulaire vers le store.
export interface OverlayInput {
  mecsExNihilo?: Array<{
    id: string;
    displayName: string;
    alias?: string[];
    statut?: string;
    notes?: string;
  }>;
  dossiersExNihilo?: Array<{
    id: string;
    label: string;
    dateApprox?: string;
    mecIds: string[];
    /** Codes NATINF associés (cible). Pondère le score MEC via le poids NATINF
     *  ou, à défaut, le poids de la catégorie du NATINF (cf. ScoreConfigInput). */
    natinfCodes?: string[];
    /** Tags d'infraction associés (par id). LEGACY : conservé pour les dossiers
     *  créés avant la bascule NATINF. Pondère via tagInfractionWeights. */
    typeInfractionTagIds?: string[];
    notes?: string;
  }>;
  liensRenseignement?: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
    notes?: string;
  }>;
  /** Bonus de score manuels par MEC canonique. */
  mecScoreBoosts?: Array<{
    mecId: string;
    bonus: number;
    reason?: string;
  }>;
}

export interface MindmapGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  mecById: Map<string, MecNode>;
  dossierById: Map<string, DossierNode>;
}

// Source d'une enquête : enquête simple ou instruction (avec misEnExamen)
export interface EnqueteWithContext {
  enquete: Enquete;
  contentieuxId: ContentieuxId;
  misEnExamen?: MisEnExamen[];
}

// ──────────────────────────────────────────────
// NORMALISATION
// ──────────────────────────────────────────────

/**
 * Normalise un nom pour matching cross-dossiers.
 * Volontairement simple pour le MVP — on pourra raffiner avec Levenshtein
 * et une UI de fusion manuelle en V2 si on observe des faux négatifs.
 */
export function normalizeMecName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cl\u00e9 d'identit\u00e9 insensible \u00e0 l'ordre des mots : "VANHOVE K\u00e9vin" et
 * "K\u00e9vin VANHOVE" partagent la m\u00eame cl\u00e9. Sert \u00e0 fusionner les n\u0153uds MEC
 * saisis avec des conventions Nom/Pr\u00e9nom diff\u00e9rentes selon les dossiers.
 */
export function mecSortedKey(name: string): string {
  const canonical = normalizeMecName(name);
  if (!canonical) return '';
  return canonical.split(' ').sort().join(' ');
}

/** Distance d'\u00e9dition \u2264 1 entre deux mots ("miky"/"micky", "carol"/"carole").
 *  R\u00e9serv\u00e9e aux mots d'au moins 4 caract\u00e8res pour ne pas confondre des
 *  particules ou initiales courtes ("de"/"le", "j"/"p"). */
function tokensAlmostEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1); // substitution
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i); // insertion / suppression
}

/**
 * Apparie chaque mot de `a` \u00e0 un mot (ou deux mots adjacents recoll\u00e9s) de `b`,
 * sans r\u00e9utilisation. `mustCoverB` exige que tous les mots de `b` soient
 * consomm\u00e9s (comparaison compl\u00e8te) ; sinon `a` peut \u00eatre un sous-ensemble.
 * Backtracking \u2014 les noms font au plus 5-6 mots, co\u00fbt n\u00e9gligeable.
 */
function coverTokens(a: string[], b: string[], mustCoverB: boolean): boolean {
  const used = new Array<boolean>(b.length).fill(false);
  const step = (i: number): boolean => {
    if (i >= a.length) return !mustCoverB || used.every(Boolean);
    for (let j = 0; j < b.length; j++) {
      if (used[j]) continue;
      // mot \u2194 mot (tol\u00e9rance d'une coquille)
      if (tokensAlmostEqual(a[i], b[j])) {
        used[j] = true;
        if (step(i + 1)) return true;
        used[j] = false;
      }
      // compos\u00e9 recoll\u00e9 c\u00f4t\u00e9 a : "rosemarie" \u2194 "rose"+"marie"
      if (j + 1 < b.length && !used[j + 1] && a[i] === b[j] + b[j + 1]) {
        used[j] = used[j + 1] = true;
        if (step(i + 1)) return true;
        used[j] = used[j + 1] = false;
      }
    }
    // compos\u00e9 recoll\u00e9 c\u00f4t\u00e9 b : "rose"+"marie" \u2194 "rosemarie"
    if (i + 1 < a.length) {
      const merged = a[i] + a[i + 1];
      for (let j = 0; j < b.length; j++) {
        if (used[j]) continue;
        if (merged === b[j]) {
          used[j] = true;
          if (step(i + 2)) return true;
          used[j] = false;
        }
      }
    }
    return false;
  };
  return step(0);
}

/**
 * Vrai si deux noms d\u00e9signent tr\u00e8s probablement la m\u00eame personne :
 *   - m\u00eames mots dans un ordre diff\u00e9rent ("VANHOVE K\u00e9vin" / "K\u00e9vin VANHOVE")
 *   - une coquille par mot tol\u00e9r\u00e9e ("Micky"/"Miky", "Carole"/"Carol")
 *   - mots compos\u00e9s recoll\u00e9s ("Rose-Marie" / "Rosemarie")
 *   - avec `allowSubset` : nom partiel inclus dans le nom complet
 *     ("Shannon" \u2282 "MELLAH MAGREZ Shannon") \u2014 \u00e0 r\u00e9server aux contextes o\u00f9
 *     l'appelant l\u00e8ve l'ambigu\u00eft\u00e9 (un seul candidat possible).
 * Utilis\u00e9 pour d\u00e9dupliquer les protagonistes d'un m\u00eame dossier (fusion
 * enqu\u00eate pr\u00e9liminaire \u2192 dossier d'instruction), o\u00f9 les m\u00eames personnes ont
 * \u00e9t\u00e9 saisies deux fois avec des conventions diff\u00e9rentes.
 */
export function sameMecPerson(a: string, b: string, opts?: { allowSubset?: boolean }): boolean {
  const na = normalizeMecName(a);
  const nb = normalizeMecName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(' ');
  const tb = nb.split(' ');
  const [shortT, longT] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return coverTokens(shortT, longT, !opts?.allowSubset);
}

// ──────────────────────────────────────────────
// SCORE COMPOSITE
// ──────────────────────────────────────────────
//
// Formule "réseau" : récompense la transversalité (apparaître dans
// plusieurs contentieux distincts pèse plus qu'être ME plusieurs fois
// sur le même dossier). Les pondérations sont éditables par l'utilisateur
// depuis Paramètres > Module Cartographie.

const RECENT_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

function computeRawScore(
  mec: Omit<MecNode, 'score' | 'rawScore' | 'type'>,
  weights: CartographieScoreWeights,
): number {
  let raw =
    mec.dossierIds.length * weights.dossier +
    mec.contentieuxIds.length * weights.contentieux +
    mec.nbMisEnExamen * weights.miseEnExamen +
    mec.nbChefs * weights.chefDefault +
    mec.nbLiensRenseignement * weights.lienRenseignement +
    mec.infractionWeight;
  if (mec.recent) raw *= weights.recentMultiplier;
  return raw;
}

// ──────────────────────────────────────────────
// CONSTRUCTION DU GRAPHE
// ──────────────────────────────────────────────

/**
 * Configuration de scoring passée à buildMindmapGraph. Si `weights` est
 * omis, les valeurs par défaut s'appliquent (formule MVP historique).
 */
export interface ScoreConfigInput {
  weights?: CartographieScoreWeights;
  /** Pondérations par tag d'infraction (clé = Tag.id). LEGACY. */
  tagInfractionWeights?: Record<string, number>;
  /** Map id → value des tags d'infraction. Sert à matcher les
   *  qualifications libres des `MisEnExamen.infractions[].qualification`
   *  (best-effort : on cherche la valeur du tag comme sous-chaîne). LEGACY. */
  tagInfractionValueById?: Record<string, string>;
  /** Pondération de BASE par catégorie d'infraction (clé = code StatCategory du
   *  Mémento parquet). Chaque NATINF hérite du poids de sa catégorie. */
  categoryWeights?: Record<string, number>;
  /** Résout un code NATINF vers son code de catégorie (StatCategory). Fourni par
   *  l'appelant (qui dispose du référentiel NATINF + de categoryForEntry). */
  natinfCategoryOf?: (natinfCode: string) => string | undefined;
  /** Pondérations par code NATINF (clé = code). AFFINAGE : prioritaire sur le
   *  poids de catégorie, matché exactement sur `InfractionReproche.natinfCode`. */
  natinfWeights?: Record<string, number>;
}

/**
 * Construit le graphe biparti à partir d'une liste d'enquêtes contextualisées,
 * éventuellement enrichi par les données overlay (MEC ex nihilo, dossiers ex
 * nihilo, liens renseignement).
 *
 * Les MEC portant le même nom normalisé sont fusionnés en un seul nœud — un MEC
 * ex nihilo qui partage son canonical avec un MEC réel se fond dans le nœud
 * existant et lui apporte ses notes/alias/statut manuels.
 */
export function buildMindmapGraph(
  sources: EnqueteWithContext[],
  overlay?: OverlayInput,
  scoreConfig?: ScoreConfigInput,
): MindmapGraph {
  const weights = scoreConfig?.weights ?? DEFAULT_CARTO_WEIGHTS;
  const tagInfractionWeights = scoreConfig?.tagInfractionWeights ?? {};
  const tagInfractionValueById = scoreConfig?.tagInfractionValueById ?? {};
  // Cible : pondération par code NATINF (affinage), prioritaire sur le poids de
  // catégorie ; le poids de catégorie sert de base par défaut.
  const natinfWeights = scoreConfig?.natinfWeights ?? {};
  const categoryWeights = scoreConfig?.categoryWeights ?? {};
  const natinfCategoryOf = scoreConfig?.natinfCategoryOf;
  /**
   * Poids d'un code NATINF : l'affinage NATINF prime ; à défaut, le poids de la
   * catégorie (Mémento parquet) du NATINF s'applique comme base. 0 si rien.
   */
  const weightForNatinf = (code: string | undefined): number => {
    if (!code) return 0;
    const exact = natinfWeights[code];
    if (exact !== undefined) return exact;
    const cat = natinfCategoryOf?.(code);
    if (cat && categoryWeights[cat] !== undefined) return categoryWeights[cat];
    return 0;
  };
  /** Pré-calcule [valueLowerCase, weight] pour matcher les qualifications. */
  const tagWeightByValueLc: Array<[string, number]> = [];
  for (const [tagId, w] of Object.entries(tagInfractionWeights)) {
    const v = tagInfractionValueById[tagId];
    if (!v || !w) continue;
    tagWeightByValueLc.push([v.toLowerCase(), w]);
  }
  const lienInfractionCoef =
    weights.lienRenseignementInfractionCoef ??
    DEFAULT_CARTO_WEIGHTS.lienRenseignementInfractionCoef;
  const mecById = new Map<string, MecNode>();
  const dossierById = new Map<string, DossierNode>();
  // Bonus d'infraction "au niveau dossier" (réel ou ex nihilo). Sert à
  // accorder une fraction (coef) de ce bonus aux MEC rattachés au dossier
  // par un simple lien de renseignement.
  const dossierInfractionBonusById = new Map<string, number>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();

  // Fusion insensible à l'ordre des mots : "VANHOVE Kévin" et "Kévin VANHOVE"
  // désignent la même personne (conventions Nom/Prénom différentes entre une
  // préliminaire et son instruction, ou entre dossiers). Le premier canonical
  // rencontré sert d'id de nœud ; les variantes réordonnées s'y rattachent.
  const canonicalBySortedKey = new Map<string, string>();
  const resolveCanonical = (name: string): string => {
    const canonical = normalizeMecName(name);
    if (!canonical) return '';
    const key = canonical.split(' ').sort().join(' ');
    const existing = canonicalBySortedKey.get(key);
    if (existing) return existing;
    canonicalBySortedKey.set(key, canonical);
    return canonical;
  };
  // Résolution en lecture seule pour les références stockées (boosts, liens
  // renseignement) : rattache un id "ancien ordre" au nœud existant sans
  // créer de nouvelle entrée d'alias.
  const lookupCanonical = (id: string): string => {
    const canonical = normalizeMecName(id);
    if (!canonical) return id;
    return canonicalBySortedKey.get(canonical.split(' ').sort().join(' ')) || canonical;
  };

  const variantCounts = new Map<string, Map<string, number>>(); // canonicalId → variant → count
  const now = Date.now();

  for (const { enquete, contentieuxId, misEnExamen } of sources) {
    if (!enquete.misEnCause || enquete.misEnCause.length === 0) continue;

    const dossierId = `${contentieuxId}_${enquete.id}`;
    const dossierDate = new Date(enquete.dateMiseAJour || enquete.dateCreation).getTime();
    const isRecent = !Number.isNaN(dossierDate) && now - dossierDate <= RECENT_WINDOW_MS;

    // Index des chefs d'inculpation par nom canonique (côté MisEnExamen).
    // En parallèle, on calcule le bonus "type d'infraction" pour chaque ME :
    // chaque qualification de chef est matchée best-effort contre la valeur
    // (lowercase) des tags d'infraction pondérés.
    const chefsByCanonical = new Map<string, number>();
    const infractionWeightByCanonical = new Map<string, number>();
    const examenedCanonical = new Set<string>();
    // Tags d'infraction distincts rencontrés dans tout le dossier (chacun
    // compté une fois) → bonus "au niveau dossier" pour les liens renseignement.
    const dossierMatchedTagW = new Map<string, number>();
    if (misEnExamen) {
      for (const exa of misEnExamen) {
        const canonical = resolveCanonical(exa.nom);
        if (!canonical) continue;
        examenedCanonical.add(canonical);
        chefsByCanonical.set(
          canonical,
          (chefsByCanonical.get(canonical) || 0) + (exa.infractions?.length || 0),
        );
        if (exa.infractions) {
          let bonus = 0;
          for (const inf of exa.infractions) {
            // 1) Cible : poids NATINF (affinage) ou, à défaut, poids de la
            //    catégorie d'infraction du NATINF (base Mémento parquet).
            const code = inf.natinfCode;
            const wN = weightForNatinf(code);
            if (wN) {
              bonus += wN;
              dossierMatchedTagW.set('natinf:' + code, wN);
              continue;
            }
            // 2) Legacy : match best-effort sur la valeur du tag d'infraction
            //    (uniquement pour les anciens dossiers sans NATINF configuré).
            if (tagWeightByValueLc.length === 0) continue;
            const q = (inf.qualification || '').toLowerCase();
            if (!q) continue;
            for (const [tagValueLc, w] of tagWeightByValueLc) {
              if (q.includes(tagValueLc)) {
                bonus += w;
                dossierMatchedTagW.set(tagValueLc, w);
              }
            }
          }
          if (bonus > 0) {
            infractionWeightByCanonical.set(
              canonical,
              (infractionWeightByCanonical.get(canonical) || 0) + bonus,
            );
          }
        }
      }
    }

    // Crée le nœud dossier
    const dossierNode: DossierNode = {
      type: 'dossier',
      id: dossierId,
      enqueteId: enquete.id,
      contentieuxId,
      numero: enquete.numero,
      statut: enquete.statut,
      dateCreation: enquete.dateCreation,
      nbMec: enquete.misEnCause.length,
      services: enquete.services,
    };
    dossierById.set(dossierId, dossierNode);

    if (dossierMatchedTagW.size > 0) {
      let dossierBonus = 0;
      for (const w of dossierMatchedTagW.values()) dossierBonus += w;
      if (dossierBonus > 0) dossierInfractionBonusById.set(dossierId, dossierBonus);
    }

    // Parcours des MEC du dossier
    for (const mec of enquete.misEnCause) {
      const canonical = resolveCanonical(mec.nom);
      if (!canonical) continue;

      // Compte les variantes pour choisir le displayName le plus fréquent
      let variantsForId = variantCounts.get(canonical);
      if (!variantsForId) {
        variantsForId = new Map();
        variantCounts.set(canonical, variantsForId);
      }
      variantsForId.set(mec.nom, (variantsForId.get(mec.nom) || 0) + 1);

      // Nœud MEC (création paresseuse)
      let mecNode = mecById.get(canonical);
      if (!mecNode) {
        mecNode = {
          type: 'mec',
          id: canonical,
          displayName: mec.nom,
          variants: [],
          dossierIds: [],
          contentieuxIds: [],
          nbMisEnExamen: 0,
          nbChefs: 0,
          nbLiensRenseignement: 0,
          infractionWeight: 0,
          recent: false,
          score: 0,
          rawScore: 0,
          manualBonus: 0,
          statuts: [],
          isVictime: !!mec.isVictime,
          isSuspect: !!(mec as { isSuspect?: boolean }).isSuspect,
          suspectRole: (mec as { suspectRole?: string }).suspectRole,
        };
        mecById.set(canonical, mecNode);
      }
      // Un vrai mis en cause portant le même nom qu'une victime prime : on retire
      // l'étiquette « Victime » dès qu'une contribution non-victime apparaît.
      if (!mec.isVictime) mecNode.isVictime = false;
      // Un vrai MEX ou MEC prime sur le statut suspect.
      if (!(mec as { isSuspect?: boolean }).isSuspect) mecNode.isSuspect = false;

      if (!mecNode.dossierIds.includes(dossierId)) {
        mecNode.dossierIds.push(dossierId);
      }
      if (!mecNode.contentieuxIds.includes(contentieuxId)) {
        mecNode.contentieuxIds.push(contentieuxId);
      }
      if (mec.statut && !mecNode.statuts.includes(mec.statut)) {
        mecNode.statuts.push(mec.statut);
      }
      if (isRecent) mecNode.recent = true;

      if (examenedCanonical.has(canonical)) {
        mecNode.nbMisEnExamen += 1;
        mecNode.nbChefs += chefsByCanonical.get(canonical) || 0;
        const w = infractionWeightByCanonical.get(canonical);
        if (w) mecNode.infractionWeight += w;
      }

      // Arête MEC ↔ Dossier (déduplique si plusieurs MisEnCause portent le même nom dans le dossier)
      const edgeKey = `${canonical}__${dossierId}`;
      if (!edgeKeys.has(edgeKey)) {
        edgeKeys.add(edgeKey);
        const isSuspectMec = !!(mec as { isSuspect?: boolean }).isSuspect;
        edges.push({ id: edgeKey, source: canonical, target: dossierId, kind: isSuspectMec ? 'suspect' : 'data' });
      }
    }
  }

  // ── Overlay : MEC ex nihilo ─────────────────
  // Création ou fusion (par canonical) avec les MEC déjà extraits des dossiers.
  if (overlay?.mecsExNihilo) {
    for (const m of overlay.mecsExNihilo) {
      const canonical = resolveCanonical(m.id || m.displayName);
      if (!canonical) continue;
      let mecNode = mecById.get(canonical);
      if (!mecNode) {
        mecNode = {
          type: 'mec',
          id: canonical,
          displayName: m.displayName,
          variants: m.alias ? [...m.alias] : [],
          dossierIds: [],
          contentieuxIds: [],
          nbMisEnExamen: 0,
          nbChefs: 0,
          nbLiensRenseignement: 0,
          infractionWeight: 0,
          recent: false,
          score: 0,
          rawScore: 0,
          manualBonus: 0,
          statuts: [],
          isManualOnly: true,
        };
        mecById.set(canonical, mecNode);
      }
      mecNode.manualNotes = m.notes;
      mecNode.manualAlias = m.alias;
      mecNode.manualStatut = m.statut;
      // Enrichit la liste des variants pour la recherche
      if (m.alias && m.alias.length > 0) {
        const merged = new Set([...mecNode.variants, ...m.alias]);
        mecNode.variants = Array.from(merged).filter(v => v !== mecNode!.displayName);
      }
    }
  }

  // ── Overlay : dossiers ex nihilo ────────────
  if (overlay?.dossiersExNihilo) {
    for (const d of overlay.dossiersExNihilo) {
      const node: DossierNode = {
        type: 'dossier',
        id: d.id,
        enqueteId: -1,
        contentieuxId: 'autre' as ContentieuxId,
        numero: d.label,
        statut: 'archive',
        dateCreation: d.dateApprox || new Date().toISOString(),
        nbMec: d.mecIds.length,
        isExNihilo: true,
        notes: d.notes,
      };
      dossierById.set(d.id, node);

      // Calcule le bonus infraction du dossier. Appliqué une fois à chaque MEC
      // du dossier. Cible : codes NATINF (poids NATINF ou poids de catégorie) ;
      // legacy : anciens tags d'infraction pour les dossiers d'avant la bascule.
      let dossierInfractionBonus = 0;
      if (d.natinfCodes && d.natinfCodes.length > 0) {
        for (const code of d.natinfCodes) dossierInfractionBonus += weightForNatinf(code);
      }
      if (d.typeInfractionTagIds && d.typeInfractionTagIds.length > 0) {
        for (const tagId of d.typeInfractionTagIds) {
          const w = tagInfractionWeights[tagId];
          if (w) dossierInfractionBonus += w;
        }
      }
      if (dossierInfractionBonus > 0) dossierInfractionBonusById.set(d.id, dossierInfractionBonus);

      for (const rawMecId of d.mecIds) {
        const canonical = resolveCanonical(rawMecId) || rawMecId;
        if (!canonical) continue;
        // Crée un nœud MEC fantôme si le canonical n'existe pas encore (cas rare,
        // ex. on a référencé un MEC ex nihilo qui a été supprimé entre-temps).
        if (!mecById.has(canonical)) {
          mecById.set(canonical, {
            type: 'mec',
            id: canonical,
            displayName: rawMecId,
            variants: [],
            dossierIds: [],
            contentieuxIds: [],
            nbMisEnExamen: 0,
            nbChefs: 0,
            nbLiensRenseignement: 0,
            infractionWeight: 0,
            recent: false,
            score: 0,
            rawScore: 0,
            manualBonus: 0,
            statuts: [],
            isManualOnly: true,
          });
        }
        const mec = mecById.get(canonical)!;
        if (!mec.dossierIds.includes(d.id)) mec.dossierIds.push(d.id);
        // Le fait d'être lié à un dossier (même ex nihilo) annule l'isolement
        mec.isManualOnly = false;
        if (dossierInfractionBonus > 0) mec.infractionWeight += dossierInfractionBonus;

        const edgeKey = `${canonical}__${d.id}`;
        if (!edgeKeys.has(edgeKey)) {
          edgeKeys.add(edgeKey);
          edges.push({ id: edgeKey, source: canonical, target: d.id, kind: 'data' });
        }
      }
    }
  }

  // ── Overlay : liens renseignement ───────────
  // Filtrés : les endpoints doivent exister dans le graphe.
  // En passant on incrémente le compteur de liens renseignement attaché à
  // chaque MEC concerné (pour la pondération du score).
  if (overlay?.liensRenseignement) {
    for (const l of overlay.liensRenseignement) {
      // Rattache les endpoints MEC stockés sous une variante réordonnée du nom
      // au nœud fusionné correspondant (les ids de dossier passent tels quels).
      const source = mecById.has(l.source) || dossierById.has(l.source)
        ? l.source
        : lookupCanonical(l.source);
      const target = mecById.has(l.target) || dossierById.has(l.target)
        ? l.target
        : lookupCanonical(l.target);
      const sourceExists = mecById.has(source) || dossierById.has(source);
      const targetExists = mecById.has(target) || dossierById.has(target);
      if (!sourceExists || !targetExists) continue;
      edges.push({
        id: l.id,
        source,
        target,
        kind: 'renseignement',
        label: l.label,
        notes: l.notes,
      });
      const srcMec = mecById.get(source);
      if (srcMec) srcMec.nbLiensRenseignement += 1;
      const tgtMec = mecById.get(target);
      if (tgtMec) tgtMec.nbLiensRenseignement += 1;

      // Lien MEC ↔ dossier : on accorde au MEC une fraction (coef) du bonus
      // d'infraction du dossier — implication "indirecte", non comptée à plein.
      if (lienInfractionCoef > 0) {
        if (srcMec && dossierInfractionBonusById.has(target)) {
          srcMec.infractionWeight += dossierInfractionBonusById.get(target)! * lienInfractionCoef;
        } else if (tgtMec && dossierInfractionBonusById.has(source)) {
          tgtMec.infractionWeight += dossierInfractionBonusById.get(source)! * lienInfractionCoef;
        }
      }
    }
  }

  // Index des boosts manuels par mecId canonique (pré-finalisation : on les
  // applique après la formule mais avant la normalisation max).
  const boostByMec = new Map<string, { bonus: number; reason?: string }>();
  if (overlay?.mecScoreBoosts) {
    for (const b of overlay.mecScoreBoosts) {
      const id = lookupCanonical(b.mecId) || b.mecId;
      if (!id) continue;
      boostByMec.set(id, { bonus: b.bonus, reason: b.reason });
    }
  }

  // Finalisation : displayName le plus fréquent + score normalisé
  let maxRaw = 0;
  for (const [canonical, mecNode] of mecById) {
    const variants = variantCounts.get(canonical);
    if (variants && variants.size > 0) {
      let bestName = mecNode.displayName;
      let bestCount = 0;
      for (const [name, count] of variants) {
        if (count > bestCount) {
          bestCount = count;
          bestName = name;
        }
      }
      mecNode.displayName = bestName;
      mecNode.variants = Array.from(variants.keys()).filter(v => v !== bestName);
    }
    const boost = boostByMec.get(canonical);
    mecNode.manualBonus = boost?.bonus ?? 0;
    mecNode.manualBonusReason = boost?.reason;
    mecNode.rawScore = Math.max(0, computeRawScore(mecNode, weights) + mecNode.manualBonus);
    if (mecNode.rawScore > maxRaw) maxRaw = mecNode.rawScore;
  }

  if (maxRaw > 0) {
    for (const mecNode of mecById.values()) {
      mecNode.score = mecNode.rawScore / maxRaw;
    }
  }

  return {
    nodes: [...mecById.values(), ...dossierById.values()],
    edges,
    mecById,
    dossierById,
  };
}

// ──────────────────────────────────────────────
// SOUS-GRAPHE EN MODE FOCUS
// ──────────────────────────────────────────────

/**
 * Extrait le sous-graphe centré sur un nœud, à `depth` sauts.
 * - depth=1 : le nœud + ses voisins directs
 * - depth=2 : + les voisins des voisins
 */
export function extractFocusSubgraph(
  graph: MindmapGraph,
  centerId: string,
  depth: number = 1,
): MindmapGraph {
  if (!graph.mecById.has(centerId) && !graph.dossierById.has(centerId)) {
    return { nodes: [], edges: [], mecById: new Map(), dossierById: new Map() };
  }

  // BFS sur les voisins
  const adj = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, new Set());
    if (!adj.has(edge.target)) adj.set(edge.target, new Set());
    adj.get(edge.source)!.add(edge.target);
    adj.get(edge.target)!.add(edge.source);
  }

  const visited = new Set<string>([centerId]);
  let frontier = new Set<string>([centerId]);
  for (let i = 0; i < depth; i++) {
    const next = new Set<string>();
    for (const id of frontier) {
      const neighbors = adj.get(id);
      if (!neighbors) continue;
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          next.add(n);
        }
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  const mecById = new Map<string, MecNode>();
  const dossierById = new Map<string, DossierNode>();
  const nodes: GraphNode[] = [];

  for (const id of visited) {
    const mec = graph.mecById.get(id);
    if (mec) {
      mecById.set(id, mec);
      nodes.push(mec);
      continue;
    }
    const dossier = graph.dossierById.get(id);
    if (dossier) {
      dossierById.set(id, dossier);
      nodes.push(dossier);
    }
  }

  const edges = graph.edges.filter(e => visited.has(e.source) && visited.has(e.target));

  return { nodes, edges, mecById, dossierById };
}

// ──────────────────────────────────────────────
// TOP 10
// ──────────────────────────────────────────────

/**
 * Retourne les MEC à afficher dans le Top, strictement triés par rawScore
 * décroissant. L'épinglage n'influence plus l'ordre : il sert uniquement
 * de marqueur de visibilité sur la carte (anneau rouge sur le nœud).
 */
export function getTopMec(graph: MindmapGraph, limit: number = 10): MecNode[] {
  return [...graph.mecById.values()]
    .sort((a, b) => b.rawScore - a.rawScore)
    .slice(0, limit);
}
