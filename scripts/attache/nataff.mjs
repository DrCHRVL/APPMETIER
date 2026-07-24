/**
 * SIRAL — Attaché de justice · NATINF → catégorie métier (statistiques).
 *
 * Adaptateur du module PARTAGÉ lib/natinf/nataffRegles.mjs — la MÊME
 * taxonomie et les MÊMES règles de découpage que la page Statistiques de
 * l'app (lib/natinf/nataff.ts les consomme aussi) : les agrégats par
 * catégorie d'infraction des bilans (stats_synthese) donnent exactement les
 * mêmes libellés que l'écran. Toute évolution des règles se fait dans
 * nataffRegles.mjs, une seule fois.
 */
import { GRAND_TITRES, STAT_CATEGORIES, resolveCategoryCode } from '../../lib/natinf/nataffRegles.mjs'

const GRAND_TITRE_BY_CODE = new Map(GRAND_TITRES.map((g) => [g.code, g]))
const CAT_BY_CODE = new Map(STAT_CATEGORIES.map((c) => [c.code, c]))

/**
 * Catégorie métier d'un NATINF ({ code, libelle, theme }) :
 * { code, label, grandTitre: { code, label } } — ou null si non classé.
 * Même résolution que categoryForEntry (lib/natinf/nataff.ts).
 */
export function categorieNatinf(entry) {
  if (!entry) return null
  const code = resolveCategoryCode(entry)
  if (!code) return null
  const category = CAT_BY_CODE.get(code)
  if (!category) return null
  const grandTitre = GRAND_TITRE_BY_CODE.get(category.grandTitre)
  return { code: category.code, label: category.label, grandTitre: grandTitre || null }
}

/** Libellé de catégorie, avec le même repli que l'app (« Autres / non classé »). */
export function labelCategorie(entry) {
  return categorieNatinf(entry)?.label || 'Autres / non classé'
}
