// Service d'accès au référentiel NATINF (lecture seule).
//
// Le référentiel (data/natinf/natinf.json) est chargé en import dynamique :
// il forme un chunk séparé, récupéré à la demande la première fois qu'une
// fonctionnalité NATINF est utilisée, et mis en cache mémoire ensuite. Cela
// évite d'alourdir le bundle principal, y compris quand le référentiel passe
// à l'export officiel complet (~17 000 codes).

import type { NatinfEntry, NatinfNature, NatinfRef } from '@/types/natinf';

let cache: NatinfEntry[] | null = null;
let loadPromise: Promise<NatinfEntry[]> | null = null;

/** Charge (une seule fois) le référentiel NATINF. */
export async function loadNatinf(): Promise<NatinfEntry[]> {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = import('@/data/natinf/natinf.json')
      .then((mod) => {
        cache = ((mod as any).default ?? mod) as NatinfEntry[];
        return cache;
      })
      .catch((err) => {
        loadPromise = null; // permet une nouvelle tentative
        throw err;
      });
  }
  return loadPromise;
}

/** Normalisation pour la recherche : minuscules, sans accents. */
export function normalize(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Index de recherche (construit paresseusement, mémoïsé sur l'identité du tableau).
interface IndexedEntry {
  entry: NatinfEntry;
  haystack: string; // libellé + thème normalisés
}
let indexedFor: NatinfEntry[] | null = null;
let indexed: IndexedEntry[] = [];

function getIndex(entries: NatinfEntry[]): IndexedEntry[] {
  if (indexedFor !== entries) {
    indexed = entries.map((entry) => ({
      entry,
      haystack: normalize(`${entry.libelle} ${entry.theme || ''}`),
    }));
    indexedFor = entries;
  }
  return indexed;
}

export interface SearchOptions {
  /** Filtre par thème exact */
  theme?: string;
  /** Filtre par nature */
  nature?: NatinfNature;
  /** Limiter aux infractions fréquentes (mémento) */
  frequentOnly?: boolean;
  /** Nombre maximum de résultats (défaut 30) */
  limit?: number;
}

/**
 * Recherche dans le référentiel.
 * - Requête numérique -> recherche par code (préfixe prioritaire).
 * - Requête textuelle -> tous les mots doivent figurer dans le libellé/thème.
 * Tri : fréquents d'abord, puis par code croissant.
 */
export function searchNatinf(
  entries: NatinfEntry[],
  query: string,
  opts: SearchOptions = {},
): NatinfEntry[] {
  const { theme, nature, frequentOnly, limit = 30 } = opts;
  const passesFilters = (e: NatinfEntry) =>
    (!theme || e.theme === theme) &&
    (!nature || e.nature === nature) &&
    (!frequentOnly || e.frequent);

  const q = (query || '').trim();
  const numeric = /^\d+$/.test(q);

  let results: NatinfEntry[];

  if (numeric) {
    const prefix: NatinfEntry[] = [];
    const contains: NatinfEntry[] = [];
    for (const e of entries) {
      if (!passesFilters(e)) continue;
      if (e.code === q) prefix.unshift(e);
      else if (e.code.startsWith(q)) prefix.push(e);
      else if (e.code.includes(q)) contains.push(e);
    }
    results = [...prefix, ...contains];
  } else if (q.length === 0) {
    results = entries.filter(passesFilters);
  } else {
    const tokens = normalize(q).split(/\s+/).filter(Boolean);
    results = getIndex(entries)
      .filter((ie) => passesFilters(ie.entry) && tokens.every((t) => ie.haystack.includes(t)))
      .map((ie) => ie.entry);
  }

  results.sort((a, b) => {
    if (a.frequent !== b.frequent) return a.frequent ? -1 : 1;
    return parseInt(a.code, 10) - parseInt(b.code, 10);
  });
  return results.slice(0, limit);
}

/** Liste triée des thèmes présents dans le référentiel. */
export function listThemes(entries: NatinfEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) if (e.theme) set.add(e.theme);
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
}

/** Construit une Map code -> entrée. */
export function indexByCode(entries: NatinfEntry[]): Map<string, NatinfEntry> {
  return new Map(entries.map((e) => [e.code, e]));
}

/** Réduit une entrée à une référence dénormalisée (snapshot). */
export function toRef(e: NatinfEntry): NatinfRef {
  return { code: e.code, libelle: e.libelle, nature: e.nature };
}
