// utils/knownPersons.ts
//
// REGISTRE DES PERSONNES CONNUES DE L'APPLICATION.
//
// Une même personne est saisie à plusieurs endroits — mis en cause d'une
// enquête, mis en examen / suspect / victime d'un dossier d'instruction, fiche
// « ex nihilo » créée à la main dans la cartographie — et souvent avec des
// conventions différentes (« DUPONT Jean » / « Jean Dupont », une coquille, un
// composé recollé). Ce module rassemble tout ça en UNE liste dédupliquée qui
// alimente :
//   - les propositions de noms à la saisie (anti-doublon à la source) ;
//   - le rapprochement à l'import Cassiopée (on relie au nom déjà connu au
//     lieu de créer une seconde fiche).
//
// Le regroupement réutilise exactement les règles de la cartographie
// (`mecSortedKey` / `sameMecPerson`) : ce qui est fusionné ici est fusionné sur
// la carte, et réciproquement — sinon les propositions mentiraient.

import { mecSortedKey, normalizeMecName, sameMecPerson } from './mindmapGraph';

// ──────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────

/** Qualité sous laquelle une personne est connue quelque part dans l'app. */
export type PersonRole = 'mec' | 'mex' | 'suspect' | 'victime' | 'condamne' | 'carto';

/** Une occurrence brute, avant regroupement. */
export interface PersonEntry {
  nom: string;
  role: PersonRole;
  /** Dossier de rattachement (numéro d'enquête / d'instruction), pour compter. */
  dossier?: string;
  /** Cette occurrence est projetée sur la cartographie (nœud cliquable).
   *  Faux pour les victimes non cochées « sur la cartographie ». */
  carto?: boolean;
}

/** Une personne, toutes occurrences fusionnées. */
export interface KnownPerson {
  /** Clé de regroupement (mots normalisés triés) du premier variant rencontré. */
  key: string;
  /** Variante retenue pour l'affichage (la plus fréquente, la plus complète). */
  nom: string;
  /** Toutes les orthographes rencontrées (nom affiché inclus). */
  variants: string[];
  /** Qualités rencontrées, dans l'ordre de gravité décroissante. */
  roles: PersonRole[];
  /** Dossiers distincts où la personne apparaît. */
  dossiers: string[];
  /** La personne a un nœud sur la cartographie (au moins une occurrence). */
  onCarto: boolean;
  /** Résumé lisible : « mis en examen · 2 dossiers ». */
  hint: string;
}

/** Registre interrogeable (liste + accès direct tolérant aux variantes). */
export interface KnownPersonsIndex {
  persons: KnownPerson[];
  /** Noms affichés, triés — prêts pour un composant de suggestions. */
  names: string[];
  /** Nom affiché → résumé (`hint`), pour la ligne secondaire des suggestions. */
  hints: Record<string, string>;
  /** Retrouve la personne correspondant à un nom, variantes comprises. */
  find(nom: string): KnownPerson | undefined;
}

export const ROLE_LABEL: Record<PersonRole, string> = {
  mex: 'mis en examen',
  mec: 'mis en cause',
  suspect: 'suspect',
  condamne: 'condamné',
  victime: 'victime',
  carto: 'cartographie',
};

// Ordre de présentation : la qualité la plus « lourde » d'abord.
const ROLE_ORDER: PersonRole[] = ['mex', 'mec', 'suspect', 'condamne', 'victime', 'carto'];

// ──────────────────────────────────────────────
// CONSTRUCTION
// ──────────────────────────────────────────────

interface Bucket {
  key: string;
  /** variante → nombre d'occurrences et clé « mots triés » d'origine. */
  variants: Map<string, { count: number; key: string }>;
  roles: Set<PersonRole>;
  dossiers: Set<string>;
  onCarto: boolean;
}

/** Mots indexables d'un nom (≥ 3 lettres) — sert à limiter les comparaisons. */
function indexTokens(name: string): string[] {
  return normalizeMecName(name).split(' ').filter(t => t.length >= 3);
}

/**
 * Variante à afficher. On privilégie l'orthographe MAJORITAIRE : d'abord le
 * poids de son groupe « mêmes mots » (une coquille isolée ne doit pas
 * l'emporter sur deux saisies concordantes), puis son propre nombre
 * d'occurrences, puis la forme la plus complète, l'alphabet départageant pour
 * rester déterministe.
 */
function pickDisplayName(variants: Map<string, { count: number; key: string }>): string {
  const keyTotals = new Map<string, number>();
  variants.forEach(({ count, key }) => keyTotals.set(key, (keyTotals.get(key) || 0) + count));

  let best = '';
  let bestScore: [number, number, number] = [-1, -1, -1];
  variants.forEach(({ count, key }, variant) => {
    const score: [number, number, number] = [keyTotals.get(key) || 0, count, variant.length];
    for (let i = 0; i < score.length; i++) {
      if (score[i] > bestScore[i]) { best = variant; bestScore = score; return; }
      if (score[i] < bestScore[i]) return;
    }
    if (variant < best) { best = variant; bestScore = score; }
  });
  return best;
}

function buildHint(roles: PersonRole[], dossiers: number): string {
  const parts: string[] = [];
  const rolesSansCarto = roles.filter(r => r !== 'carto');
  if (rolesSansCarto.length > 0) parts.push(rolesSansCarto.map(r => ROLE_LABEL[r]).join(', '));
  if (dossiers > 0) parts.push(`${dossiers} dossier${dossiers > 1 ? 's' : ''}`);
  if (roles.includes('carto')) parts.push('fiche cartographie');
  return parts.join(' · ');
}

/**
 * Regroupe des occurrences en personnes distinctes.
 *
 * Deux passes :
 *   1. regroupement exact sur la clé « mots triés » (ordre Nom/Prénom
 *      indifférent) — le cas massif, en O(n) ;
 *   2. fusion des groupes que `sameMecPerson` juge identiques (coquille,
 *      composé recollé). Pour ne pas comparer tout avec tout, on ne compare que
 *      des groupes partageant au moins un mot de 3 lettres — deux orthographes
 *      d'une même personne partagent en pratique toujours le patronyme.
 */
export function buildKnownPersons(entries: Iterable<PersonEntry>): KnownPerson[] {
  const buckets = new Map<string, Bucket>();

  for (const entry of entries) {
    const nom = (entry.nom || '').trim();
    if (nom.length < 2) continue;
    const key = mecSortedKey(nom);
    if (!key) continue;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, variants: new Map(), roles: new Set(), dossiers: new Set(), onCarto: false };
      buckets.set(key, bucket);
    }
    bucket.variants.set(nom, { count: (bucket.variants.get(nom)?.count || 0) + 1, key });
    bucket.roles.add(entry.role);
    if (entry.dossier) bucket.dossiers.add(entry.dossier);
    if (entry.carto) bucket.onCarto = true;
  }

  const list = Array.from(buckets.values());
  if (list.length === 0) return [];

  // Union-find sur les groupes candidats (mot commun).
  const parent = list.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const displays = list.map(b => pickDisplayName(b.variants));
  const byToken = new Map<string, number[]>();
  displays.forEach((name, i) => {
    for (const token of indexTokens(name)) {
      const arr = byToken.get(token);
      if (arr) arr.push(i);
      else byToken.set(token, [i]);
    }
  });

  const compared = new Set<string>();
  displays.forEach((name, i) => {
    for (const token of indexTokens(name)) {
      // Un mot ultra-fréquent (rare sur des patronymes) ne doit pas dégénérer
      // en comparaison quadratique : on borne le voisinage examiné.
      const candidates = byToken.get(token) || [];
      if (candidates.length > 200) continue;
      for (const j of candidates) {
        if (j <= i) continue;
        const pairKey = `${i}:${j}`;
        if (compared.has(pairKey)) continue;
        compared.add(pairKey);
        if (find(i) === find(j)) continue;
        if (sameMecPerson(name, displays[j])) union(i, j);
      }
    }
  });

  // Fusion effective des groupes rattachés au même représentant.
  const merged = new Map<number, Bucket>();
  list.forEach((bucket, i) => {
    const root = find(i);
    const target = merged.get(root);
    if (!target) {
      merged.set(root, {
        key: bucket.key,
        variants: new Map(bucket.variants),
        roles: new Set(bucket.roles),
        dossiers: new Set(bucket.dossiers),
        onCarto: bucket.onCarto,
      });
      return;
    }
    bucket.variants.forEach((v, nom) => target.variants.set(nom, {
      count: (target.variants.get(nom)?.count || 0) + v.count,
      key: v.key,
    }));
    bucket.roles.forEach(r => target.roles.add(r));
    bucket.dossiers.forEach(d => target.dossiers.add(d));
    if (bucket.onCarto) target.onCarto = true;
  });

  const persons: KnownPerson[] = [];
  merged.forEach(bucket => {
    const nom = pickDisplayName(bucket.variants);
    if (!nom) return;
    const roles = ROLE_ORDER.filter(r => bucket.roles.has(r));
    persons.push({
      key: bucket.key,
      nom,
      variants: Array.from(bucket.variants.keys()),
      roles,
      dossiers: Array.from(bucket.dossiers),
      onCarto: bucket.onCarto,
      hint: buildHint(roles, bucket.dossiers.size),
    });
  });

  persons.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
  return persons;
}

// ──────────────────────────────────────────────
// INDEX INTERROGEABLE
// ──────────────────────────────────────────────

/** Enveloppe une liste de personnes pour la recherche et les suggestions. */
export function indexKnownPersons(persons: KnownPerson[]): KnownPersonsIndex {
  const byKey = new Map<string, KnownPerson>();
  const byToken = new Map<string, KnownPerson[]>();
  for (const person of persons) {
    for (const variant of person.variants) {
      const key = mecSortedKey(variant);
      if (key && !byKey.has(key)) byKey.set(key, person);
    }
    const seen = new Set<string>();
    for (const variant of person.variants) {
      for (const token of indexTokens(variant)) {
        if (seen.has(token)) continue;
        seen.add(token);
        const arr = byToken.get(token);
        if (arr) arr.push(person);
        else byToken.set(token, [person]);
      }
    }
  }

  const names = persons.map(p => p.nom);
  const hints: Record<string, string> = {};
  for (const person of persons) hints[person.nom] = person.hint;

  const find = (nom: string): KnownPerson | undefined => {
    const raw = (nom || '').trim();
    if (raw.length < 2) return undefined;
    const exact = byKey.get(mecSortedKey(raw));
    if (exact) return exact;
    // Repli tolérant : coquille / composé recollé, limité aux personnes
    // partageant un mot avec la saisie.
    const seen = new Set<KnownPerson>();
    for (const token of indexTokens(raw)) {
      for (const candidate of byToken.get(token) || []) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        if (candidate.variants.some(v => sameMecPerson(v, raw))) return candidate;
      }
    }
    return undefined;
  };

  return { persons, names, hints, find };
}

/** Registre vide — repli quand aucune source n'est encore chargée. */
export const EMPTY_KNOWN_PERSONS: KnownPersonsIndex = indexKnownPersons([]);
