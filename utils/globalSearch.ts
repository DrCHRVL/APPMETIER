// utils/globalSearch.ts
//
// Moteur de la recherche GLOBALE (barre du header) : tape depuis n'importe
// quelle page → tous les objets de l'application en résultats (enquêtes de
// tous les contentieux, instructions, AIR, personnes, pages, actions).
//
// Contraintes assumées :
//  - zéro dépendance (pas de Fuse.js) : quelques kilo-octets, auditable ;
//  - insensible aux accents et à la casse ;
//  - TOLÉRANT AUX FAUTES DE FRAPPE : distance de Damerau-Levenshtein bornée
//    (« grivsenes » trouve « GRIVESNES »), calculée seulement quand les
//    correspondances exactes échouent — le coût reste négligeable ;
//  - instantané au clavier : l'index est prénormalisé UNE fois par changement
//    de données, chaque frappe ne fait que parcourir des chaînes prêtes.

// ──────────────────────────────────────────────
// NORMALISATION 1:1
// ──────────────────────────────────────────────

// Normalisation caractère par caractère : chaque caractère d'origine produit
// EXACTEMENT un caractère normalisé (minuscule, sans accent). Les index de la
// chaîne normalisée coïncident donc avec ceux de la chaîne d'origine — le
// surlignage et les extraits n'ont besoin d'aucune table de correspondance.
const charCache = new Map<string, string>();

function normChar(ch: string): string {
  let out = charCache.get(ch);
  if (out !== undefined) return out;
  const decomposed = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  out = (decomposed[0] || ch).toLowerCase();
  if (charCache.size < 5000) charCache.set(ch, out);
  return out;
}

/** Minuscules sans accents, longueur STRICTEMENT conservée. */
export function normalizeText(s: string): string {
  // Chemin rapide : chaîne 100 % ASCII → un simple toLowerCase natif.
  let ascii = true;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) { ascii = false; break; }
  }
  if (ascii) return s.toLowerCase();

  // Chaîne accentuée : toLowerCase global (natif, rapide) puis translittération
  // des seuls caractères non-ASCII. Si un toLowerCase exotique changeait la
  // longueur (rarissime, ex. « İ »), on repasse caractère par caractère pour
  // GARANTIR l'alignement des index avec la chaîne d'origine.
  const lowered = s.toLowerCase();
  if (lowered.length === s.length) {
    return lowered.replace(/[^\x00-\x7F]/g, normChar);
  }
  let out = '';
  for (let i = 0; i < s.length; i++) out += normChar(s[i]);
  return out;
}

/** Variante « écrasée » : alphanumérique pur (pour les numéros de dossier). */
export function squashAlnum(s: string): string {
  return normalizeText(s).replace(/[^a-z0-9]/g, '');
}

function isAlnum(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
}

// ──────────────────────────────────────────────
// DISTANCE D'ÉDITION BORNÉE (Damerau-Levenshtein / OSA)
// ──────────────────────────────────────────────

/**
 * Distance d'édition avec transpositions (OSA), bornée : renvoie maxDist+1
 * dès que la distance dépasse la borne (arrêt anticipé ligne par ligne).
 * Utilisée sur des MOTS courts uniquement — jamais sur du texte long.
 */
export function boundedEditDistance(a: string, b: string, maxDist: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;

  let prevPrev: number[] = [];
  let prev: number[] = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    const cur: number[] = new Array(lb + 1);
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (
        i > 1 && j > 1 &&
        ca === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        const t = prevPrev[j - 2] + 1;
        if (t < v) v = t;
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDist) return maxDist + 1;
    prevPrev = prev;
    prev = cur;
  }
  return prev[lb] <= maxDist ? prev[lb] : maxDist + 1;
}

/** Tolérance de frappe admise selon la longueur du terme tapé. */
function allowedTypos(tokenLength: number): number {
  if (tokenLength >= 8) return 2;
  if (tokenLength >= 4) return 1;
  return 0;
}

// ──────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────

export type GlobalDocKind =
  | 'enquete'
  | 'instruction'
  | 'air'
  | 'personne'
  | 'page'
  | 'action';

/** Un champ interrogeable d'un document indexé. */
export interface DocField {
  /** Texte normalisé (même longueur que `raw`). */
  norm: string;
  /** Texte d'origine (extraits, surlignage). */
  raw: string;
  /** Libellé montré quand la correspondance vient de ce champ (« Mis en cause »…). */
  label?: string;
  /** Poids du champ dans le score. */
  weight: number;
  /** Autoriser la tolérance aux fautes de frappe (réservé aux champs courts). */
  fuzzy: boolean;
  /** Cache paresseux de la variante alphanumérique (rempli à la première requête). */
  squashCache?: string;
}

/** Document de l'index global (une enquête, une page, une action…). */
export interface GlobalSearchDoc {
  key: string;
  kind: GlobalDocKind;
  title: string;
  subtitle?: string;
  /** Contentieux de rattachement (pastille couleur). */
  ctxId?: string;
  archived?: boolean;
  fields: DocField[];
  /** Charge utile d'exécution (ids, numéro, vue cible…). */
  data: Record<string, unknown>;
}

export interface GlobalHit {
  doc: GlobalSearchDoc;
  score: number;
  /** Plages [début, fin) à surligner dans `title`. */
  titleRanges: Array<[number, number]>;
  /** « Champ : extrait » quand la correspondance ne vient pas du titre. */
  matchLabel?: string;
}

export interface GlobalHitGroup {
  kind: GlobalDocKind;
  label: string;
  hits: GlobalHit[];
  /** Nombre total avant plafonnement (pour « n de plus »). */
  total: number;
}

// ──────────────────────────────────────────────
// FABRIQUE DE CHAMPS
// ──────────────────────────────────────────────

export function makeField(
  raw: string | undefined | null,
  weight: number,
  opts?: { label?: string; fuzzy?: boolean; maxLength?: number }
): DocField | null {
  if (!raw) return null;
  let text = String(raw);
  if (opts?.maxLength && text.length > opts.maxLength) text = text.slice(0, opts.maxLength);
  const trimmed = text.trim();
  if (!trimmed) return null;
  return {
    raw: text,
    norm: normalizeText(text),
    label: opts?.label,
    weight,
    fuzzy: opts?.fuzzy ?? false,
  };
}

// ──────────────────────────────────────────────
// CORRESPONDANCE D'UN TERME DANS UN CHAMP
// ──────────────────────────────────────────────

interface TokenFieldMatch {
  /** Score BRUT (avant pondération par le poids du champ). */
  score: number;
  start: number;
  end: number;
}

// Barème brut : mot exact > préfixe de mot > sous-chaîne > faute de frappe.
const SCORE_EXACT_WORD = 100;
const SCORE_WORD_PREFIX = 88;
const SCORE_INFIX = 60;
const SCORE_TYPO_BASE = 48; // -14 par faute supplémentaire

function matchTokenInField(
  token: string,
  squashedToken: string,
  field: DocField,
  /** Mémo distance d'édition PAR TERME de la requête : les mêmes mots (noms,
   *  communes, services…) reviennent dans des centaines de dossiers — on ne
   *  calcule la distance qu'une fois par mot distinct. */
  distMemo: Map<string, number>
): TokenFieldMatch | null {
  const norm = field.norm;

  // 1) Sous-chaîne exacte — priorité au début de mot.
  let best: TokenFieldMatch | null = null;
  let from = 0;
  for (let guard = 0; guard < 50; guard++) {
    const idx = norm.indexOf(token, from);
    if (idx < 0) break;
    const end = idx + token.length;
    const atWordStart = idx === 0 || !isAlnum(norm.charCodeAt(idx - 1));
    const atWordEnd = end >= norm.length || !isAlnum(norm.charCodeAt(end));
    const score = atWordStart
      ? (atWordEnd ? SCORE_EXACT_WORD : SCORE_WORD_PREFIX)
      : SCORE_INFIX;
    if (!best || score > best.score) best = { score, start: idx, end };
    if (score === SCORE_EXACT_WORD) return best; // rien de mieux possible
    from = idx + 1;
  }
  if (best) return best;

  // 2) Variante « écrasée » (numéros : « 85103843 » ⊂ « 85103/843/2026 »).
  if (squashedToken.length >= 4 && squashedToken !== token) {
    if (field.squashCache === undefined) {
      field.squashCache = norm.replace(/[^a-z0-9]/g, '');
    }
    if (field.squashCache.includes(squashedToken)) {
      return { score: SCORE_INFIX, start: 0, end: 0 };
    }
  }

  // 3) Tolérance aux fautes de frappe — mots courts, champs autorisés.
  const maxDist = allowedTypos(token.length);
  if (!field.fuzzy || maxDist === 0) return null;

  const t0 = token.charCodeAt(0);
  const t1 = token.length > 1 ? token.charCodeAt(1) : -1;
  const wordRe = /[a-z0-9]+/g;
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(norm)) !== null) {
    const word = m[0];
    if (word.length + maxDist < token.length) continue;
    // Garde bon marché avant la programmation dynamique : une faute de frappe
    // préserve presque toujours l'une des deux premières lettres.
    const w0 = word.charCodeAt(0);
    if (w0 !== t0 && word.charCodeAt(1) !== t0 && w0 !== t1) continue;

    let d = distMemo.get(word);
    if (d === undefined) {
      // Mot entier, puis préfixe du mot (faute au début d'un nom plus long).
      d = boundedEditDistance(token, word, maxDist);
      if (d > maxDist && word.length > token.length + maxDist) {
        d = boundedEditDistance(token, word.slice(0, token.length), maxDist);
      }
      distMemo.set(word, d);
    }
    if (d <= maxDist) {
      const score = SCORE_TYPO_BASE - (d - 1) * 14;
      if (!best || score > (best as TokenFieldMatch).score) {
        best = { score, start: m.index, end: m.index + word.length };
      }
    }
  }
  return best;
}

// ──────────────────────────────────────────────
// RECHERCHE
// ──────────────────────────────────────────────

interface ParsedToken {
  t: string;
  squashed: string;
}

export function parseQuery(query: string): ParsedToken[] {
  return normalizeText(query)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map(t => ({ t, squashed: t.replace(/[^a-z0-9]/g, '') }));
}

function fuseRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i][0] <= last[1]) last[1] = Math.max(last[1], sorted[i][1]);
    else out.push(sorted[i]);
  }
  return out;
}

/** Extrait lisible autour d'une correspondance (indices alignés norm/raw). */
function excerptAround(raw: string, start: number, end: number, radius = 34): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(raw.length, end + radius);
  let s = raw.slice(from, to).replace(/\s+/g, ' ').trim();
  if (from > 0) s = '…' + s;
  if (to < raw.length) s = s + '…';
  return s;
}

/**
 * Interroge une liste de documents. Sémantique ET : chaque terme tapé doit
 * correspondre quelque part dans le document. Renvoie les hits triés par
 * pertinence décroissante.
 */
export function searchDocs(
  docs: GlobalSearchDoc[],
  tokens: ParsedToken[],
  limit = 200
): GlobalHit[] {
  if (tokens.length === 0) return [];
  const hits: GlobalHit[] = [];
  // Un mémo de distances par terme de la requête, partagé entre tous les docs.
  const distMemos = tokens.map(() => new Map<string, number>());

  for (const doc of docs) {
    let total = 0;
    let failed = false;
    const titleRanges: Array<[number, number]> = [];
    let bestSecondary: { field: DocField; m: TokenFieldMatch; weighted: number } | null = null;

    for (let ti = 0; ti < tokens.length; ti++) {
      const token = tokens[ti];
      let bestWeighted = 0;
      let bestForToken: { field: DocField; m: TokenFieldMatch; idx: number } | null = null;

      for (let fi = 0; fi < doc.fields.length; fi++) {
        const field = doc.fields[fi];
        const m = matchTokenInField(token.t, token.squashed, field, distMemos[ti]);
        if (!m) continue;
        const weighted = m.score * field.weight;
        if (weighted > bestWeighted) {
          bestWeighted = weighted;
          bestForToken = { field, m, idx: fi };
          // Un mot exact dans le champ le plus lourd : inutile de continuer.
          if (m.score === SCORE_EXACT_WORD && fi === 0) break;
        }
      }

      if (!bestForToken) { failed = true; break; }
      total += bestWeighted;

      if (bestForToken.idx === 0 && bestForToken.m.end > bestForToken.m.start) {
        titleRanges.push([bestForToken.m.start, bestForToken.m.end]);
      } else if (bestForToken.idx > 0 && bestForToken.field.label) {
        if (!bestSecondary || bestWeighted > bestSecondary.weighted) {
          bestSecondary = { field: bestForToken.field, m: bestForToken.m, weighted: bestWeighted };
        }
      }
    }

    if (failed || total === 0) continue;

    const matchLabel = bestSecondary
      ? `${bestSecondary.field.label} : ${excerptAround(bestSecondary.field.raw, bestSecondary.m.start, bestSecondary.m.end)}`
      : undefined;

    hits.push({ doc, score: total, titleRanges: fuseRanges(titleRanges), matchLabel });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.length > limit ? hits.slice(0, limit) : hits;
}

/** Libellés des groupes de résultats, dans leur ordre de préséance à score égal. */
export const GROUP_LABELS: Array<{ kind: GlobalDocKind; label: string }> = [
  { kind: 'enquete', label: 'Enquêtes' },
  { kind: 'instruction', label: 'Instructions' },
  { kind: 'air', label: 'Suivi AIR' },
  { kind: 'personne', label: 'Personnes' },
  { kind: 'page', label: 'Navigation' },
  { kind: 'action', label: 'Actions' },
];

/**
 * Groupe les hits par nature. Les groupes sont ordonnés par leur meilleur
 * score (le groupe le plus pertinent remonte), à égalité par l'ordre métier.
 */
export function groupHits(hits: GlobalHit[], perGroup = 5): GlobalHitGroup[] {
  const byKind = new Map<GlobalDocKind, GlobalHit[]>();
  for (const h of hits) {
    const list = byKind.get(h.doc.kind);
    if (list) list.push(h);
    else byKind.set(h.doc.kind, [h]);
  }

  const groups: GlobalHitGroup[] = [];
  GROUP_LABELS.forEach(({ kind, label }) => {
    const list = byKind.get(kind);
    if (!list || list.length === 0) return;
    groups.push({ kind, label, hits: list.slice(0, Math.max(perGroup, 0)), total: list.length });
  });

  groups.sort((a, b) => {
    const d = (b.hits[0]?.score || 0) - (a.hits[0]?.score || 0);
    if (d !== 0) return d;
    return GROUP_LABELS.findIndex(g => g.kind === a.kind) - GROUP_LABELS.findIndex(g => g.kind === b.kind);
  });
  return groups;
}
