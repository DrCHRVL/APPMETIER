// Service d'accès au référentiel NATINF (lecture seule).
//
// Le référentiel (data/natinf/natinf.json) est chargé en import dynamique :
// il forme un chunk séparé, récupéré à la demande la première fois qu'une
// fonctionnalité NATINF est utilisée, et mis en cache mémoire ensuite. Cela
// évite d'alourdir le bundle principal, y compris quand le référentiel passe
// à l'export officiel complet (~17 000 codes).

import type { NatinfEntry, NatinfNature, NatinfRef } from '@/types/natinf';
import { fetchReferential } from './natinfApi';

let cache: NatinfEntry[] | null = null;
let loadPromise: Promise<NatinfEntry[]> | null = null;
// État de l'index de recherche (déclaré ici pour être visible de resetNatinfCache).
let indexedFor: NatinfEntry[] | null = null;
let indexed: IndexedEntry[] = [];

/**
 * Charge (une seule fois) le référentiel NATINF depuis le serveur (/api/natinf).
 * Le serveur sert la version publiée par un admin, ou le référentiel embarqué
 * en repli. Mis en cache mémoire pour la durée de la session.
 */
export async function loadNatinf(): Promise<NatinfEntry[]> {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = fetchReferential()
      .then((data) => {
        cache = data;
        return data;
      })
      .catch((err) => {
        loadPromise = null; // permet une nouvelle tentative
        throw err;
      });
  }
  return loadPromise;
}

/** Vide le cache mémoire (à appeler après publication d'une nouvelle version). */
export function resetNatinfCache(): void {
  cache = null;
  loadPromise = null;
  indexedFor = null;
  indexed = [];
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
  haystack: string; // libellé + thème normalisés (filtrage par mots)
  libNorm: string;  // libellé normalisé seul (classement par préfixe)
}

function getIndex(entries: NatinfEntry[]): IndexedEntry[] {
  if (indexedFor !== entries) {
    indexed = entries.map((entry) => {
      const libNorm = normalize(entry.libelle);
      return {
        entry,
        libNorm,
        haystack: `${libNorm} ${normalize(entry.theme || '')}`,
      };
    });
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

  // rang : plus petit = meilleur (correspondance la plus « en tête »)
  let ranked: { entry: NatinfEntry; rank: number }[];

  if (numeric) {
    ranked = [];
    for (const e of entries) {
      if (!passesFilters(e)) continue;
      const rank = e.code === q ? 0 : e.code.startsWith(q) ? 1 : e.code.includes(q) ? 2 : -1;
      if (rank >= 0) ranked.push({ entry: e, rank });
    }
  } else if (q.length === 0) {
    ranked = entries.filter(passesFilters).map((entry) => ({ entry, rank: 0 }));
  } else {
    const nq = normalize(q);
    const tokens = nq.split(/\s+/).filter(Boolean);
    const first = tokens[0] || '';
    ranked = getIndex(entries)
      .filter((ie) => passesFilters(ie.entry) && tokens.every((t) => ie.haystack.includes(t)))
      .map((ie) => {
        // Auto-complétion : le libellé qui COMMENCE par la saisie passe devant.
        const rank = ie.libNorm.startsWith(nq) ? 0 : ie.libNorm.startsWith(first) ? 1 : 2;
        return { entry: ie.entry, rank };
      });
  }

  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.entry.frequent !== b.entry.frequent) return a.entry.frequent ? -1 : 1;
    return parseInt(a.entry.code, 10) - parseInt(b.entry.code, 10);
  });
  return ranked.slice(0, limit).map((r) => r.entry);
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
