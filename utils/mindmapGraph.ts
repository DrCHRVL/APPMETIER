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
//   - Les personnes condamnées au résultat d'audience d'un dossier sont
//     projetées comme des personnes du dossier (arête 'condamne'), avec
//     anti-doublon : si le nom correspond à un mis en cause déjà présent
//     dans le dossier, aucun nœud ni arête supplémentaires ne sont créés.
//
// Le score d'un MEC (taille du nœud) est paramétrable depuis l'écran
// Paramètres > Module Cartographie. Formule de base :
//   score = (nb_dossiers × w_dossier)
//         + (nb_contentieux × w_contentieux)
//         + (nb_chefs × w_chef)   — chefs propres ET chefs des dossiers
//                                   auxquels un lien de renseignement rattache
//                                   la personne (implication au sens large)
//         + (nb_liens_renseignement × w_lien)
//         + bonus_infraction (somme par tag d'infraction associé)
//   × facteur_temporel (malus d'ancienneté × bonus de continuité)
//   + contamination_latente (poids reçu des MEC voisins, cf. infra)
//
// CONTAMINATION LATENTE — être dans l'entourage d'une figure lourde compte,
// que ce voisinage soit tracé à la main ou lu dans les dossiers. Chaque MEC
// transmet donc une fraction de son poids à ceux qui gravitent autour de lui,
// par DEUX routes de portée réglable (cf. propagateLatentScore) :
//   - lien de renseignement PERSONNE ↔ PERSONNE (`lienMecPropagationCoef`) ;
//   - CO-PRÉSENCE DANS UN DOSSIER (`dossierPropagationCoef`) : le dossier
//     relaie le poids de son membre le plus lourd vers les autres, qu'ils y
//     figurent comme mis en cause ou par un lien de renseignement.
// Sans la seconde, le lieutenant qu'on relie à la main au chef pesait plus
// lourd que ceux qui partagent réellement ses dossiers — l'inverse de ce que
// dit la procédure. La diffusion part des poids DIRECTS (ceux tirés des
// dossiers) : elle ne se ré-alimente pas d'elle-même, donc pas d'emballement
// en cercle.
//
// Le facteur temporel remplace l'ancien « multiplicateur récent » binaire :
// un MEC dont la dernière implication remonte à plusieurs années voit son
// score décroître progressivement, tandis qu'une activité étalée sur
// plusieurs années distinctes est bonifiée (cf. computeTemporalFactor).
//
// Les valeurs par défaut sont définies dans types/cartographieTypes.ts.

import { Enquete, MisEnCause } from '@/types/interfaces';
import type { MisEnExamen } from '@/types/instructionTypes';
import { ContentieuxId } from '@/types/userTypes';
import {
  DEFAULT_CARTO_TEMPORAL,
  DEFAULT_CARTO_WEIGHTS,
  type CartographieScoreWeights,
  type CartographieTemporalConfig,
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
  /** Total des chefs d'inculpation cumulés. Comprend les infractions des
   *  dossiers auxquels la personne est rattachée par un simple LIEN de
   *  renseignement : y être rattaché est une forme d'implication. */
  nbChefs: number;
  /** Part de `nbChefs` qui provient de dossiers rattachés par un lien de
   *  renseignement (et non d'une mise en cause). Affiché à part pour que le
   *  panneau latéral ne laisse pas croire à des chefs formellement retenus. */
  nbChefsViaLien: number;
  /** Nombre de liens renseignement (manuels) attachés au MEC. */
  nbLiensRenseignement: number;
  /** Bonus cumulé issu des tags d'infraction (pondéré par config). Pour
   *  chaque dossier ex nihilo (ou DI réelle) auquel le MEC est lié, on
   *  additionne les poids des tags d'infraction associés. La récidive
   *  est donc gratuite : 2× "trafic stups" = 2× le poids. */
  infractionWeight: number;
  /** A été mentionné au moins une fois dans les 12 derniers mois */
  recent: boolean;
  /** Années civiles DISTINCTES d'implication, triées croissant. Union des
   *  périodes d'activité des dossiers qui le concernent (cf.
   *  enqueteActivityYears / parseApproxYears). Vide si aucune date
   *  exploitable — le MEC reste alors temporellement neutre. */
  activityYears: number[];
  /** Année de la dernière implication connue (max de `activityYears`). */
  lastActivityYear?: number;
  /** Année de la première implication connue (min de `activityYears`). */
  firstActivityYear?: number;
  /** Facteur temporel effectivement appliqué au score (malus d'ancienneté ×
   *  bonus de continuité). 1 = neutre, < 1 = dormant, > 1 = actif en continu. */
  temporalFactor: number;
  /** CONTAMINATION LATENTE — points reçus de l'entourage : MEC reliés par un
   *  lien de renseignement personne ↔ personne, et MEC les plus lourds des
   *  dossiers partagés (avec décroissance par saut). Déjà pondéré
   *  temporellement à la source ; s'ajoute au score APRÈS le facteur temporel
   *  du receveur. 0 = aucun voisin porteur, ou propagation désactivée. */
  propagatedWeight: number;
  /** Nombre de MEC voisins (1er saut) reliés par un lien de renseignement.
   *  Sert à expliquer la contamination latente dans le panneau latéral. */
  nbMecVoisins: number;
  /** Principaux contributeurs à la contamination latente (3 au plus, du plus
   *  gros au plus petit), pour que le panneau latéral puisse dire D'OÙ vient
   *  le poids reçu — « via dossier » ou « via lien » — plutôt que d'afficher
   *  un total inexplicable. */
  propagationTop?: Array<{
    mecId: string;
    displayName: string;
    points: number;
    via: 'lien' | 'dossier';
  }>;
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
  /** Vrai si ce nœud n'est présent que comme condamné (résultat d'audience).
   *  Toute contribution mis en cause / suspect / victime du même nom canonique
   *  repasse ce drapeau à faux — la personne vit alors sur la carte par ses
   *  dossiers, l'étiquette « Condamné » restant réservée aux personnes issues
   *  uniquement d'un résultat d'audience. */
  isCondamne?: boolean;
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
  /** N° de parquet du dossier source (sert à la recherche). Absent pour les
   *  dossiers ex nihilo et les contributions distantes. */
  numeroParquet?: string;
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
   *  'suspect' = lien suspect → dossier d'instruction ;
   *  'condamne' = lien condamné → dossier (résultat d'audience). */
  kind: 'data' | 'renseignement' | 'suspect' | 'condamne';
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
    /** Départage deux entrées visant le même MEC (cf. boostByMec). */
    updatedAt?: number;
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
  /** Personnes condamnées au résultat d'audience du dossier (préliminaire ou
   *  instruction). Projetées sur la carte comme des personnes du dossier, en
   *  évitant le doublon avec les mis en cause déjà présents. */
  condamnes?: Array<{ nom: string }>;
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

// Amplitude maximale (en années) retenue pour un seul dossier. Garde-fou
// contre une date aberrante ("1998" saisi pour 2018) qui gonflerait
// artificiellement le bonus de continuité.
const MAX_DOSSIER_SPAN_YEARS = 25;
// Bornes de plausibilité d'une année judiciaire.
const MIN_PLAUSIBLE_YEAR = 1950;

/** Année d'une date ISO (ou d'un texte contenant une année). undefined si
 *  rien d'exploitable ou si l'année sort des bornes de plausibilité. */
function yearOfDate(value: string | undefined | null): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  let year: number;
  if (!Number.isNaN(parsed)) {
    year = new Date(parsed).getFullYear();
  } else {
    // Formats non ISO ("31/12/2019", "décembre 2019") : on récupère la
    // première année à 4 chiffres.
    const m = /(19|20|21)\d{2}/.exec(value);
    if (!m) return undefined;
    year = parseInt(m[0], 10);
  }
  if (!Number.isFinite(year) || year < MIN_PLAUSIBLE_YEAR || year > 2200) return undefined;
  return year;
}

/** Intervalle d'années [start..end] borné, sous forme de liste. */
function yearRange(start: number, end: number): number[] {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const clampedFrom = Math.max(from, to - MAX_DOSSIER_SPAN_YEARS);
  const out: number[] = [];
  for (let y = clampedFrom; y <= to; y++) out.push(y);
  return out;
}

/**
 * Années d'activité d'une ENQUÊTE réelle. On ne retient QUE des dates
 * judiciaires (début d'enquête, opérations d'interpellation, audience) :
 * `dateMiseAJour` est volontairement exclue, car une simple correction de
 * saisie ferait passer un dossier de 2014 pour une affaire de cette année.
 * À défaut de toute date judiciaire, on retombe sur la date de création.
 */
function enqueteActivityYears(enquete: Enquete, nowYear: number): number[] {
  const marks: number[] = [];
  const push = (v: string | undefined) => {
    const y = yearOfDate(v);
    if (y !== undefined) marks.push(y);
  };
  push(enquete.dateDebut);
  push(enquete.dateOP);
  for (const phase of enquete.opPhases || []) {
    push(phase.dateDebut);
    push(phase.dateFin);
  }
  push(enquete.dateAudience);
  if (marks.length === 0) push(enquete.dateCreation);
  if (marks.length === 0) return [];
  // Une audience programmée l'an prochain ne rend pas le dossier « futur » :
  // on borne au millésime courant.
  const end = Math.min(nowYear, Math.max(...marks));
  const start = Math.min(Math.min(...marks), end);
  return yearRange(start, end);
}

// Séparateurs qui expriment une PÉRIODE entre deux millésimes ("2018-2020",
// "2016 à 2019", "de 2015 au 2017").
const RANGE_SEPARATOR = /^[\s,]*(?:-|–|—|\/|à|a|au|jusqu['’]?\s*à|>)[\s,]*$/i;

/**
 * Extrait les années d'un champ « date approximative » saisi librement sur un
 * dossier manuel : "2018-2020", "2019 jugé", "2015 à 2017, appel 2018"…
 * Les millésimes séparés par un tiret (ou « à ») sont développés en période.
 */
export function parseApproxYears(text: string | undefined, nowYear: number): number[] {
  if (!text) return [];
  const re = /(19|20|21)\d{2}/g;
  const found: Array<{ year: number; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.push({ year: parseInt(m[0], 10), start: m.index, end: m.index + m[0].length });
  }
  if (found.length === 0) return [];
  const years = new Set<number>();
  for (let i = 0; i < found.length; i++) {
    const cur = found[i];
    if (cur.year >= MIN_PLAUSIBLE_YEAR) years.add(Math.min(cur.year, nowYear));
    const next = found[i + 1];
    if (!next) continue;
    const between = text.slice(cur.end, next.start);
    if (next.year > cur.year && RANGE_SEPARATOR.test(between)) {
      for (const y of yearRange(cur.year, Math.min(next.year, nowYear))) {
        if (y >= MIN_PLAUSIBLE_YEAR) years.add(y);
      }
    }
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * Facteur temporel appliqué au score brut :
 *
 *   facteur = malus_ancienneté × bonus_continuité
 *
 * `malus_ancienneté` vaut 1 tant que la dernière implication remonte à moins
 * de `freshYears`, descend linéairement jusqu'à `dormantMultiplier` à
 * `staleYears`, et y reste au-delà. `bonus_continuité` monte de 1 à
 * 1 + `continuityBonus` selon le nombre d'années d'activité distinctes.
 *
 * Un MEC sans aucune année connue reste à 1 : on ne pénalise pas une absence
 * d'information (fiche manuelle sans date, dossier sans millésime).
 */
export function computeTemporalFactor(
  years: number[],
  temporal: CartographieTemporalConfig,
  nowYear: number,
): number {
  if (!temporal.enabled || years.length === 0) return 1;

  const fresh = Math.max(0, temporal.freshYears);
  const stale = Math.max(fresh + 1, temporal.staleYears);
  const dormant = Math.max(0, temporal.dormantMultiplier);
  const age = Math.max(0, nowYear - years[years.length - 1]);

  let recency: number;
  if (age <= fresh) recency = 1;
  else if (age >= stale) recency = dormant;
  else recency = 1 + ((age - fresh) / (stale - fresh)) * (dormant - 1);

  const plateau = Math.max(1, temporal.continuityYears);
  const ratio = plateau <= 1 ? 1 : Math.min(1, (years.length - 1) / (plateau - 1));
  const continuity = 1 + Math.max(0, temporal.continuityBonus) * ratio;

  return recency * continuity;
}

/**
 * Poids DIRECT d'un MEC : ce qu'il tire de ses propres dossiers (dossiers,
 * transversalité, mises en examen, chefs, bonus d'infraction), hors points de
 * liens et hors bonus manuel.
 *
 * C'est la seule quantité qui se propage aux voisins (cf.
 * propagateLatentScore). On en exclut volontairement :
 *  - les points « par lien renseignement » — sinon deux personnes reliées se
 *    renverraient mutuellement des points tirés de leur seul lien ;
 *  - le bonus manuel — un arbitrage humain vaut pour la personne visée, il
 *    n'a pas à déteindre sur son entourage ;
 *  - la contamination déjà reçue — la diffusion part toujours des poids
 *    directs, ce qui la borne et la rend indépendante de l'ordre de calcul.
 */
function computeDirectWeight(
  mec: Omit<MecNode, 'score' | 'rawScore' | 'type'>,
  weights: CartographieScoreWeights,
): number {
  // Le nombre de MISES EN EXAMEN ne pèse plus : on s'en tient à la mise en
  // cause au sens large. Le compteur reste tenu et affiché, à titre indicatif.
  return (
    mec.dossierIds.length * weights.dossier +
    mec.contentieuxIds.length * weights.contentieux +
    mec.nbChefs * weights.chefDefault +
    mec.infractionWeight
  );
}

function computeRawScore(
  mec: Omit<MecNode, 'score' | 'rawScore' | 'type'>,
  weights: CartographieScoreWeights,
): number {
  const raw =
    computeDirectWeight(mec, weights) +
    mec.nbLiensRenseignement * weights.lienRenseignement;
  // La contamination latente s'ajoute APRÈS le facteur temporel : elle est
  // déjà pondérée à la source (par l'ancienneté du voisin qui l'émet), la
  // repasser par l'ancienneté du receveur la pénaliserait deux fois — et un
  // individu sans dossier n'a de toute façon aucune date à lui.
  return raw * mec.temporalFactor + mec.propagatedWeight;
}

/**
 * CONTAMINATION LATENTE — diffuse le poids des MEC dans leur entourage.
 *
 * Motif : peser quelque chose parce qu'on gravite autour d'une figure lourde,
 * quelle que soit la façon dont ce voisinage est établi. Deux routes, chacune
 * avec son coefficient de transmission :
 *
 *  1. LIEN DE RENSEIGNEMENT personne ↔ personne (`lienMecPropagationCoef`) —
 *     le voisinage tracé à la main, quand la procédure n'a pas permis mieux.
 *
 *  2. CO-PRÉSENCE DANS UN DOSSIER (`dossierPropagationCoef`) — le dossier
 *     relaie vers chacun de ses membres le poids du membre le PLUS LOURD des
 *     autres (le chef reçoit donc celui de son meilleur second). Sont membres
 *     aussi bien les mis en cause que les personnes rattachées au dossier par
 *     un lien de renseignement.
 *
 * Pourquoi le plus lourd, et non la somme des autres membres : sommer ferait
 * du score une mesure de la TAILLE des dossiers (trente comparses valant plus
 * qu'un chef), et exploserait sur les grosses procédures. Ce qui compte est
 * la pointure avec qui on figure, pas le nombre de gens autour.
 *
 * Mécanique commune : on remonte, depuis chaque MEC, les chemins d'entourage
 * jusqu'à `hops` sauts ; un voisin atteint à plusieurs chemins ne compte
 * qu'une fois, au MEILLEUR chemin (produit des coefficients le plus fort).
 * La quantité émise est toujours le poids DIRECT du voisin (jamais ce qu'il a
 * lui-même reçu) : la diffusion ne s'auto-amplifie pas, ne boucle pas, et ne
 * dépend pas de l'ordre de calcul.
 */
function propagateLatentScore(
  mecById: Map<string, MecNode>,
  voisinsByMec: Map<string, Set<string>>,
  mecsByDossier: Map<string, Set<string>>,
  weights: CartographieScoreWeights,
): void {
  const coefLien = weights.lienMecPropagationCoef ?? DEFAULT_CARTO_WEIGHTS.lienMecPropagationCoef;
  const coefDossier = weights.dossierPropagationCoef ?? DEFAULT_CARTO_WEIGHTS.dossierPropagationCoef;
  const hops = Math.floor(
    weights.lienMecPropagationHops ?? DEFAULT_CARTO_WEIGHTS.lienMecPropagationHops,
  );
  for (const [id, voisins] of voisinsByMec) {
    const mec = mecById.get(id);
    if (mec) mec.nbMecVoisins = voisins.size;
  }
  if (hops < 1 || (!(coefLien > 0) && !(coefDossier > 0))) return;

  // Poids émis par chaque MEC, figé AVANT toute diffusion.
  const emis = new Map<string, number>();
  for (const [id, mec] of mecById) {
    const direct = computeDirectWeight(mec, weights) * mec.temporalFactor;
    if (direct > 0) emis.set(id, direct);
  }
  if (emis.size === 0) return;

  // Arêtes d'entourage, orientées « qui reçoit ← qui émet ». Un même émetteur
  // peut apparaître par les deux routes (co-dossier ET lien) ou par plusieurs
  // dossiers : la relaxation ne retiendra que son meilleur coefficient, il
  // n'est donc jamais compté deux fois.
  type Source = { from: string; coef: number; via: 'lien' | 'dossier' };
  const sourcesByMec = new Map<string, Source[]>();
  const addSource = (to: string, source: Source) => {
    const list = sourcesByMec.get(to);
    if (list) list.push(source);
    else sourcesByMec.set(to, [source]);
  };

  if (coefLien > 0) {
    for (const [id, voisins] of voisinsByMec) {
      for (const v of voisins) addSource(id, { from: v, coef: coefLien, via: 'lien' });
    }
  }

  if (coefDossier > 0) {
    for (const membres of mecsByDossier.values()) {
      if (membres.size < 2) continue;
      // Les deux plus lourds du dossier suffisent : tout le monde reçoit du
      // premier, sauf le premier lui-même qui reçoit du second.
      let premier: string | undefined;
      let second: string | undefined;
      for (const m of membres) {
        const poids = emis.get(m) ?? 0;
        if (poids <= 0) continue;
        if (premier === undefined || poids > (emis.get(premier) ?? 0)) {
          second = premier;
          premier = m;
        } else if (second === undefined || poids > (emis.get(second) ?? 0)) {
          second = m;
        }
      }
      if (premier === undefined) continue;
      for (const m of membres) {
        const from = m === premier ? second : premier;
        if (from === undefined) continue;
        addSource(m, { from, coef: coefDossier, via: 'dossier' });
      }
    }
  }
  if (sourcesByMec.size === 0) return;

  for (const [id, cible] of mecById) {
    if (!sourcesByMec.has(id)) continue;

    // Relaxation par couches : `facteur` retient, pour chaque émetteur atteint,
    // le meilleur produit de coefficients trouvé jusqu'ici (les coefficients
    // valant ≤ 1, un chemin plus long ne peut que faire moins bien).
    const facteur = new Map<string, { coef: number; via: 'lien' | 'dossier' }>();
    let frontiere: Array<[string, number]> = [[id, 1]];
    for (let d = 0; d < hops && frontiere.length > 0; d++) {
      const suivante: Array<[string, number]> = [];
      for (const [noeud, acquis] of frontiere) {
        for (const src of sourcesByMec.get(noeud) ?? []) {
          if (src.from === id) continue;
          const combine = acquis * src.coef;
          const connu = facteur.get(src.from);
          if (connu && connu.coef >= combine) continue;
          facteur.set(src.from, { coef: combine, via: src.via });
          suivante.push([src.from, combine]);
        }
      }
      frontiere = suivante;
    }

    let recu = 0;
    const contributeurs: NonNullable<MecNode['propagationTop']> = [];
    for (const [from, { coef, via }] of facteur) {
      const points = (emis.get(from) ?? 0) * coef;
      if (points <= 0) continue;
      recu += points;
      contributeurs.push({
        mecId: from,
        displayName: mecById.get(from)?.displayName ?? from,
        points,
        via,
      });
    }
    cible.propagatedWeight = recu;
    if (contributeurs.length > 0) {
      cible.propagationTop = contributeurs.sort((a, b) => b.points - a.points).slice(0, 3);
    }
  }
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
  /** Pondération temporelle (malus d'ancienneté + bonus de continuité).
   *  Omise, les valeurs par défaut s'appliquent. */
  temporal?: CartographieTemporalConfig;
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
  const temporal = scoreConfig?.temporal ?? DEFAULT_CARTO_TEMPORAL;
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
  // Nombre d'infractions DISTINCTES mentionnées au dossier (réel ou ex nihilo).
  // Sert à créditer de ces chefs les personnes que seul un lien de
  // renseignement rattache au dossier (implication au sens large).
  const dossierChefsCountById = new Map<string, number>();
  // Années d'activité par dossier (réel ou ex nihilo) et union par MEC :
  // socle de la pondération temporelle (malus d'ancienneté / bonus continuité).
  const dossierYearsById = new Map<string, number[]>();
  const activityYearsByMec = new Map<string, Set<number>>();
  const addActivityYears = (mecId: string, years: number[]) => {
    if (years.length === 0) return;
    let set = activityYearsByMec.get(mecId);
    if (!set) {
      set = new Set<number>();
      activityYearsByMec.set(mecId, set);
    }
    for (const y of years) set.add(y);
  };
  // Voisinage PERSONNE ↔ PERSONNE issu des liens de renseignement : première
  // route de la contamination latente (cf. propagateLatentScore).
  const voisinsByMec = new Map<string, Set<string>>();
  // Membres de chaque dossier : seconde route de la contamination latente. On
  // y verse les personnes rattachées par un LIEN de renseignement ; les mis en
  // cause sont ajoutés ensuite depuis `dossierIds` (déjà tenu à jour).
  const mecsByDossier = new Map<string, Set<string>>();
  const addMembreDossier = (dossierId: string, mecId: string) => {
    let set = mecsByDossier.get(dossierId);
    if (!set) {
      set = new Set<string>();
      mecsByDossier.set(dossierId, set);
    }
    set.add(mecId);
  };
  const addVoisin = (a: string, b: string) => {
    let set = voisinsByMec.get(a);
    if (!set) {
      set = new Set<string>();
      voisinsByMec.set(a, set);
    }
    set.add(b);
  };
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
  const nowYear = new Date(now).getFullYear();

  for (const { enquete, contentieuxId, misEnExamen, condamnes } of sources) {
    const misEnCauseList = enquete.misEnCause || [];
    const condamnesList = (condamnes || []).filter(c => c.nom && c.nom.trim());
    if (misEnCauseList.length === 0 && condamnesList.length === 0) continue;

    const dossierId = `${contentieuxId}_${enquete.id}`;
    const dossierDate = new Date(enquete.dateMiseAJour || enquete.dateCreation).getTime();
    const isRecent = !Number.isNaN(dossierDate) && now - dossierDate <= RECENT_WINDOW_MS;
    // Période d'activité JUDICIAIRE du dossier (hors dateMiseAJour, qui ne
    // reflète qu'une saisie applicative) — cf. enqueteActivityYears.
    const dossierYears = enqueteActivityYears(enquete, nowYear);
    if (dossierYears.length > 0) dossierYearsById.set(dossierId, dossierYears);

    // Index des chefs d'inculpation par nom canonique (côté MisEnExamen).
    // En parallèle, on calcule le bonus "type d'infraction" pour chaque ME :
    // chaque qualification de chef est matchée best-effort contre la valeur
    // (lowercase) des tags d'infraction pondérés.
    const chefsByCanonical = new Map<string, number>();
    const infractionWeightByCanonical = new Map<string, number>();
    const examenedCanonical = new Set<string>();
    // Clés d'infraction déjà retenues CONTRE UNE PERSONNE (via sa mise en
    // examen) : servent à ne pas lui recompter, au titre du dossier, un chef
    // qu'elle porte déjà à titre personnel.
    const infractionKeysByCanonical = new Map<string, Set<string>>();
    // Clés d'infraction du DOSSIER, tous mis en examen confondus + celles
    // saisies sur l'enquête elle-même. C'est ce jeu qui définit « les
    // infractions mentionnées au dossier ».
    const dossierInfractionKeys = new Set<string>();
    const noteInfractionKey = (canonical: string | null, key: string) => {
      dossierInfractionKeys.add(key);
      if (!canonical) return;
      let set = infractionKeysByCanonical.get(canonical);
      if (!set) {
        set = new Set<string>();
        infractionKeysByCanonical.set(canonical, set);
      }
      set.add(key);
    };
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
            if (code) noteInfractionKey(canonical, 'natinf:' + code);
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
            if (!code) noteInfractionKey(canonical, 'qual:' + q);
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
      nbMec: misEnCauseList.length,
      numeroParquet: enquete.numeroParquet,
      services: enquete.services,
    };
    dossierById.set(dossierId, dossierNode);

    // Infractions saisies sur l'ENQUÊTE (NATINF). Elles valent pour le dossier
    // entier — c'est la seule source d'infractions d'une préliminaire, qui n'a
    // pas de mise en examen. Sans cela, pondérer une catégorie d'infraction
    // depuis l'écran Paramètres ne produisait aucun effet hors instruction.
    const enqueteInfractionKeys = new Set<string>();
    const enqueteInfractionWeights = new Map<string, number>();
    for (const code of enquete.infractionNatinfCodes || []) {
      if (!code) continue;
      const key = 'natinf:' + code;
      dossierInfractionKeys.add(key);
      enqueteInfractionKeys.add(key);
      const w = weightForNatinf(code);
      if (w) {
        enqueteInfractionWeights.set(key, w);
        dossierMatchedTagW.set(key, w);
      }
    }
    if (dossierInfractionKeys.size > 0) {
      dossierChefsCountById.set(dossierId, dossierInfractionKeys.size);
    }

    if (dossierMatchedTagW.size > 0) {
      let dossierBonus = 0;
      for (const w of dossierMatchedTagW.values()) dossierBonus += w;
      if (dossierBonus > 0) dossierInfractionBonusById.set(dossierId, dossierBonus);
    }

    // Parcours des MEC du dossier
    for (const mec of misEnCauseList) {
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
          nbChefs: 0,
          nbChefsViaLien: 0,
          nbLiensRenseignement: 0,
          infractionWeight: 0,
          recent: false,
          activityYears: [],
          temporalFactor: 1,
          propagatedWeight: 0,
          nbMecVoisins: 0,
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
      // Toute contribution issue des dossiers (MEC, suspect, victime) prime
      // sur l'étiquette « Condamné » — réservée aux personnes uniquement
      // présentes via un résultat d'audience.
      mecNode.isCondamne = false;

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
      addActivityYears(canonical, dossierYears);

      if (examenedCanonical.has(canonical)) {
        mecNode.nbChefs += chefsByCanonical.get(canonical) || 0;
        const w = infractionWeightByCanonical.get(canonical);
        if (w) mecNode.infractionWeight += w;
      }

      // Infractions de l'enquête : elles s'appliquent à chaque mis en cause du
      // dossier, sauf celles qu'il porte déjà à titre personnel (mise en examen).
      if (enqueteInfractionKeys.size > 0) {
        const siennes = infractionKeysByCanonical.get(canonical);
        for (const key of enqueteInfractionKeys) {
          if (siennes?.has(key)) continue;
          mecNode.nbChefs += 1;
          mecNode.infractionWeight += enqueteInfractionWeights.get(key) || 0;
        }
      }

      // Arête MEC ↔ Dossier (déduplique si plusieurs MisEnCause portent le même nom dans le dossier)
      const edgeKey = `${canonical}__${dossierId}`;
      if (!edgeKeys.has(edgeKey)) {
        edgeKeys.add(edgeKey);
        const isSuspectMec = !!(mec as { isSuspect?: boolean }).isSuspect;
        edges.push({ id: edgeKey, source: canonical, target: dossierId, kind: isSuspectMec ? 'suspect' : 'data' });
      }
    }

    // ── Condamnés (résultat d'audience) ───────
    // Projetés comme des personnes du dossier. Anti-doublon : si le nom
    // correspond à un protagoniste déjà présent dans CE dossier (tolérance
    // ordre des mots, coquille, nom partiel non ambigu), on ne crée ni nœud
    // ni arête — la personne est déjà sur la carte via son statut de mis en
    // cause. La fusion cross-dossiers par nom canonique s'applique ensuite
    // comme pour n'importe quel MEC.
    if (condamnesList.length > 0) {
      const nomsPresents = misEnCauseList.map(m => m.nom);
      for (const c of condamnesList) {
        const nom = c.nom.trim();
        const matches = nomsPresents.filter(existant => sameMecPerson(existant, nom, { allowSubset: true }));
        // Même règle d'ambiguïté que la fusion préliminaire → instruction :
        // candidat unique (ou match strict) = même personne → on ne remet pas.
        if (matches.length === 1 || matches.some(existant => sameMecPerson(existant, nom))) continue;
        nomsPresents.push(nom); // dédup entre condamnés homonymes du même dossier

        const canonical = resolveCanonical(nom);
        if (!canonical) continue;

        let variantsForId = variantCounts.get(canonical);
        if (!variantsForId) {
          variantsForId = new Map();
          variantCounts.set(canonical, variantsForId);
        }
        variantsForId.set(nom, (variantsForId.get(nom) || 0) + 1);

        let mecNode = mecById.get(canonical);
        if (!mecNode) {
          mecNode = {
            type: 'mec',
            id: canonical,
            displayName: nom,
            variants: [],
            dossierIds: [],
            contentieuxIds: [],
            nbChefs: 0,
            nbChefsViaLien: 0,
            nbLiensRenseignement: 0,
            infractionWeight: 0,
            recent: false,
            activityYears: [],
            temporalFactor: 1,
            propagatedWeight: 0,
            nbMecVoisins: 0,
            score: 0,
            rawScore: 0,
            manualBonus: 0,
            statuts: [],
            isCondamne: true,
          };
          mecById.set(canonical, mecNode);
        }
        if (!mecNode.dossierIds.includes(dossierId)) mecNode.dossierIds.push(dossierId);
        if (!mecNode.contentieuxIds.includes(contentieuxId)) mecNode.contentieuxIds.push(contentieuxId);
        if (!mecNode.statuts.includes('condamné')) mecNode.statuts.push('condamné');
        if (isRecent) mecNode.recent = true;
        addActivityYears(canonical, dossierYears);

        const edgeKey = `${canonical}__${dossierId}`;
        if (!edgeKeys.has(edgeKey)) {
          edgeKeys.add(edgeKey);
          edges.push({ id: edgeKey, source: canonical, target: dossierId, kind: 'condamne' });
          dossierNode.nbMec += 1;
        }
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
          nbChefs: 0,
          nbChefsViaLien: 0,
          nbLiensRenseignement: 0,
          infractionWeight: 0,
          recent: false,
          activityYears: [],
          temporalFactor: 1,
          propagatedWeight: 0,
          nbMecVoisins: 0,
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

      // Période d'activité du dossier manuel : millésimes lus dans la date
      // approximative libre ("2018-2020", "2019 jugé"). À défaut, on retombe
      // sur l'année de création de la fiche.
      const dossierYears = (() => {
        const parsed = parseApproxYears(d.dateApprox, nowYear);
        if (parsed.length > 0) return parsed;
        const created = yearOfDate(node.dateCreation);
        return created !== undefined ? [Math.min(created, nowYear)] : [];
      })();
      if (dossierYears.length > 0) dossierYearsById.set(d.id, dossierYears);

      // Calcule le bonus infraction du dossier. Appliqué une fois à chaque MEC
      // du dossier. Cible : codes NATINF (poids NATINF ou poids de catégorie) ;
      // legacy : anciens tags d'infraction pour les dossiers d'avant la bascule.
      let dossierInfractionBonus = 0;
      // Chefs du dossier manuel = ses infractions déclarées. Comptés pour ses
      // membres comme pour les personnes qu'un lien y rattache.
      let dossierChefs = 0;
      if (d.natinfCodes && d.natinfCodes.length > 0) {
        for (const code of d.natinfCodes) dossierInfractionBonus += weightForNatinf(code);
        dossierChefs += d.natinfCodes.length;
      }
      if (d.typeInfractionTagIds && d.typeInfractionTagIds.length > 0) {
        for (const tagId of d.typeInfractionTagIds) {
          const w = tagInfractionWeights[tagId];
          if (w) dossierInfractionBonus += w;
        }
        dossierChefs += d.typeInfractionTagIds.length;
      }
      if (dossierInfractionBonus > 0) dossierInfractionBonusById.set(d.id, dossierInfractionBonus);
      if (dossierChefs > 0) dossierChefsCountById.set(d.id, dossierChefs);

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
            nbChefs: 0,
            nbChefsViaLien: 0,
            nbLiensRenseignement: 0,
            infractionWeight: 0,
            recent: false,
            activityYears: [],
            temporalFactor: 1,
            propagatedWeight: 0,
            nbMecVoisins: 0,
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
        addActivityYears(canonical, dossierYears);
        if (dossierInfractionBonus > 0) mec.infractionWeight += dossierInfractionBonus;
        mec.nbChefs += dossierChefs;

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

      // Lien MEC ↔ MEC : mémorisé pour la contamination latente. Un tel lien
      // ne rapportait aucun point ; il en transmettra désormais une fraction
      // du poids de chaque extrémité vers l'autre.
      if (srcMec && tgtMec && source !== target) {
        addVoisin(source, target);
        addVoisin(target, source);
      }

      // Lien MEC ↔ dossier : la personne compte comme membre du dossier pour la
      // contamination latente (elle gravite autour des mis en cause, et
      // réciproquement) — c'est le cas de la figure qu'on n'a pas réussi à
      // impliquer formellement mais qu'on sait derrière la procédure.
      if (srcMec && dossierById.has(target)) addMembreDossier(target, source);
      if (tgtMec && dossierById.has(source)) addMembreDossier(source, target);

      // Lien MEC ↔ dossier : les infractions mentionnées au dossier comptent
      // dans ses chefs cumulés. Être rattaché à une procédure par un lien de
      // renseignement EST une forme d'implication : la personne qu'on n'a pas
      // pu mettre en cause formellement ne doit pas peser comme si le dossier
      // ne reprochait rien.
      if (srcMec && dossierById.has(target)) {
        const n = dossierChefsCountById.get(target) || 0;
        srcMec.nbChefs += n;
        srcMec.nbChefsViaLien += n;
      }
      if (tgtMec && dossierById.has(source)) {
        const n = dossierChefsCountById.get(source) || 0;
        tgtMec.nbChefs += n;
        tgtMec.nbChefsViaLien += n;
      }

      // Lien MEC ↔ dossier : on accorde au MEC une fraction (coef) du bonus
      // d'infraction du dossier — implication "indirecte", non comptée à plein.
      if (lienInfractionCoef > 0) {
        if (srcMec && dossierInfractionBonusById.has(target)) {
          srcMec.infractionWeight += dossierInfractionBonusById.get(target)! * lienInfractionCoef;
        } else if (tgtMec && dossierInfractionBonusById.has(source)) {
          tgtMec.infractionWeight += dossierInfractionBonusById.get(source)! * lienInfractionCoef;
        }
      }

      // Un MEC rattaché à un dossier par un lien de renseignement est daté par
      // ce dossier : sans cela, une figure connue uniquement par des liens
      // échapperait au malus d'ancienneté et coifferait les MEC réels.
      if (srcMec && dossierYearsById.has(target)) {
        addActivityYears(source, dossierYearsById.get(target)!);
      }
      if (tgtMec && dossierYearsById.has(source)) {
        addActivityYears(target, dossierYearsById.get(source)!);
      }
    }
  }

  // Index des boosts manuels par mecId canonique (pré-finalisation : on les
  // applique après la formule mais avant la normalisation max).
  // Deux entrées peuvent viser la même personne quand l'id stocké et l'id du
  // nœud diffèrent par l'ordre nom/prénom (« clement debus » vs « debus
  // clement ») : on garde la plus récente, sinon la valeur affichée dépendait
  // de l'ordre de la liste — qui change à chaque fusion serveur.
  const boostByMec = new Map<string, { bonus: number; reason?: string; updatedAt: number }>();
  if (overlay?.mecScoreBoosts) {
    for (const b of overlay.mecScoreBoosts) {
      const id = lookupCanonical(b.mecId) || b.mecId;
      if (!id) continue;
      const updatedAt = b.updatedAt || 0;
      const existing = boostByMec.get(id);
      if (existing && existing.updatedAt > updatedAt) continue;
      boostByMec.set(id, { bonus: b.bonus, reason: b.reason, updatedAt });
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
    // Pondération temporelle : années d'implication → malus d'ancienneté ×
    // bonus de continuité. Calculé AVANT le score, qui l'applique en facteur.
    const years = activityYearsByMec.get(canonical);
    mecNode.activityYears = years ? [...years].sort((a, b) => a - b) : [];
    mecNode.firstActivityYear = mecNode.activityYears[0];
    mecNode.lastActivityYear = mecNode.activityYears[mecNode.activityYears.length - 1];
    mecNode.temporalFactor = computeTemporalFactor(mecNode.activityYears, temporal, nowYear);
  }

  // Contamination latente : APRÈS les facteurs temporels (le poids émis en
  // dépend) et AVANT le score (qui l'additionne).
  for (const [canonical, mecNode] of mecById) {
    for (const dossierId of mecNode.dossierIds) addMembreDossier(dossierId, canonical);
  }
  propagateLatentScore(mecById, voisinsByMec, mecsByDossier, weights);

  for (const [canonical, mecNode] of mecById) {
    const boost = boostByMec.get(canonical);
    mecNode.manualBonus = boost?.bonus ?? 0;
    mecNode.manualBonusReason = boost?.reason;
    // Le bonus manuel s'ajoute APRÈS le facteur temporel : un arbitrage humain
    // explicite ne doit pas être rogné par l'ancienneté du dossier.
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
