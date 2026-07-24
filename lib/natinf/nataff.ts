// Résolution NATINF → catégorie métier (statistiques).
//
// Axe principal : la taxonomie du Mémento parquet (Lebreton), c'est-à-dire le
// langage du parquet — libellés courts et parlants (Vol, Stupéfiants,
// Proxénétisme, Blanchiment, Armes ILA…), regroupés sous un « grand titre »
// (Atteintes aux personnes / aux biens / à l'autorité de l'État…).
//
// Les RÈGLES (catégories, thèmes → catégories, découpages par libellé, repli
// mot-clé, overrides ILE) vivent dans le module PARTAGÉ
// lib/natinf/nataffRegles.mjs — source unique, également consommée par le
// service attaché (scripts/attache/nataff.mjs) pour que les agrégats des
// bilans portent exactement les mêmes libellés que la page Statistiques.
// Ce fichier n'apporte que le typage et le roll-up NATAFF N1.
//
// NATAFF (champ nataffN1 de chaque catégorie) n'est plus l'axe d'affichage : il
// est conservé uniquement comme roll-up officiel A→L, pour un éventuel export
// vers les nomenclatures de l'État (cf. data/natinf/nataff.json).

import type { NatinfEntry } from '@/types/natinf';
import type { GrandTitre, StatCategory, CategoryResolution, NataffN1 } from '@/types/nataff';
import nataffData from '@/data/natinf/nataff.json';
import {
  GRAND_TITRES as GRAND_TITRES_CORE,
  STAT_CATEGORIES as STAT_CATEGORIES_CORE,
  resolveCategoryCode,
} from '@/lib/natinf/nataffRegles.mjs';

export const NATAFF_N1 = nataffData.n1 as NataffN1[];
const NATAFF_N1_BY_CODE = new Map(NATAFF_N1.map((x) => [x.code, x]));

// ── Grands titres (axe macro d'affichage) ─────────────────────────────────────
export const GRAND_TITRES: GrandTitre[] = GRAND_TITRES_CORE as GrandTitre[];
const GRAND_TITRE_BY_CODE = new Map(GRAND_TITRES.map((g) => [g.code, g]));

// ── Catégories métier ─────────────────────────────────────────────────────────
export const STAT_CATEGORIES: StatCategory[] = STAT_CATEGORIES_CORE as StatCategory[];
const CAT_BY_CODE = new Map(STAT_CATEGORIES.map((c) => [c.code, c]));

/** Catégorie métier + grand titre d'un NATINF, ou undefined si non classé. */
export function categoryForEntry(
  entry: Pick<NatinfEntry, 'code' | 'theme' | 'libelle'> | undefined | null,
): CategoryResolution | undefined {
  if (!entry) return undefined;
  const code = resolveCategoryCode(entry);
  if (!code) return undefined;
  const category = CAT_BY_CODE.get(code);
  if (!category) return undefined;
  const grandTitre = GRAND_TITRE_BY_CODE.get(category.grandTitre);
  if (!grandTitre) return undefined;
  return { category, grandTitre };
}

/** Grande catégorie NATAFF (N1) d'une catégorie métier, pour l'export officiel. */
export function nataffN1ForCategory(category: StatCategory): NataffN1 | undefined {
  return NATAFF_N1_BY_CODE.get(category.nataffN1);
}
