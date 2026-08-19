/**
 * SIRAL — Attaché de justice · résolution des RÉFÉRENTIELS de statistiques.
 *
 * Côté écran, ces résolutions viennent des hooks React (useInfractionNatinf,
 * useNatinf, useTags) ; côté serveur, elles viennent d'ici. Ce sont les seules
 * dépendances « environnement » du cœur partagé lib/stats/ecranCore.mjs : les
 * RÈGLES de calcul restent là-bas, ce module ne fait que dire, pour une
 * enquête, quelles infractions et quels services elle porte.
 *
 * Isolé de statistiques.mjs et statsEcran.mjs pour que les deux puissent
 * l'utiliser sans dépendance croisée.
 */
import { natinfEntry } from './natinf.mjs'
import { categorieNatinf } from './nataff.mjs'

/** Libellé d'un code NATINF (miroir de `getByCode(k)?.libelle ?? k`). */
export const libelleNatinf = (cle) => natinfEntry(cle)?.libelle || String(cle)

/**
 * Infractions canoniques d'une enquête — miroir EXACT de
 * `useInfractionNatinf().infractionsForEnquete` : codes NATINF migrés s'il y
 * en a, sinon tags d'infraction résolus via leur rattachement NATINF.
 */
export function infractionsDeEnquete(e, customTags = []) {
  const codes = Array.isArray(e.infractionNatinfCodes) ? e.infractionNatinfCodes : []
  if (codes.length > 0) {
    return codes.map((code) => {
      const entry = natinfEntry(code)
      return {
        label: entry?.libelle ?? `NATINF ${code}`,
        code: String(code),
        nature: entry?.nature,
        quantumLabel: entry?.quantumLabel,
        entry: entry || undefined,
        fromNatinf: true,
      }
    })
  }
  return (e.tags || []).filter((t) => t.category === 'infractions').map((t) => {
    const def = customTags.find((d) => d.category === 'infractions' && d.value === t.value)
    const entry = def?.natinfCodes?.[0] ? natinfEntry(def.natinfCodes[0]) : null
    return {
      label: t.value,
      code: entry?.code,
      nature: entry?.nature,
      quantumLabel: entry?.quantumLabel,
      entry: entry || undefined,
      fromNatinf: false,
    }
  })
}

/** Catégorie Mémento d'une infraction (miroir de `categoryForEntry`). */
export function categorieDeInfraction(inf) {
  const cat = categorieNatinf(inf?.entry)
  if (!cat) return null
  return {
    category: { code: cat.code, label: cat.label },
    grandTitre: { code: cat.grandTitre?.code || 'autres', label: cat.grandTitre?.label || 'Autres' },
  }
}

/** Services d'enquête d'une enquête (miroir de `getServicesFromTags`). */
export const servicesDeEnquete = (e) => (e.tags || [])
  .filter((t) => t.category === 'services').map((t) => t.value).filter(Boolean)
