/**
 * SIRAL — Attaché de justice · coffres GLOBAUX (hors contentieux).
 *
 * Toutes les données de l'app ne vivent pas dans le coffre `ctx-<contentieux>`.
 * Les catégories TRANSVERSES aux contentieux ont chacune leur propre coffre à
 * la racine, alimenté par son propre pipeline de synchronisation côté client
 * (utils/dataSync/*SyncService.ts) :
 *   - `audience` → les RÉSULTATS D'AUDIENCE (AudienceSyncService), source des
 *     cartes « Résultats d'audience » de la page Statistiques ;
 *   - `tags`     → les tags personnalisés (TagSyncService).
 *
 * Le coffre `ctx-<contentieux>` porte encore des champs `audienceResultats` et
 * `customTags` : ce sont des VESTIGES du stockage mono-contentieux. Plus rien
 * ne les alimente depuis la bascule vers les pipelines dédiés — ils figent
 * l'état du poste au jour de la migration. Les lire, c'est servir au magistrat
 * des chiffres d'audience périmés alors que ses enquêtes, elles, sont à jour.
 * On lit donc TOUJOURS le coffre dédié, et le coffre ctx ne sert que de repli
 * signalé (`repli: true`) quand le coffre dédié est absent ou illisible.
 *
 * Ces coffres relèvent du périmètre `global` du trousseau (cf. scopeOfVault) :
 * aucune remise de clés supplémentaire n'est nécessaire.
 */
import { attacheTj, readVault } from './store.mjs'
import { decryptJson } from './crypto.mjs'
import { migrateLegacyResultats } from '../../lib/audience/resultatsCles.mjs'

/** Déchiffre un coffre global, ou null s'il est absent / illisible. */
function lireCoffreGlobal(keys, nom) {
  const env = readVault(attacheTj(), nom)
  if (!env) return null
  try { return decryptJson(keys.global, env) || null } catch { return null }
}

/**
 * Résultats d'audience du coffre `audience` — CE QUE LIT L'ÉCRAN.
 * Rend le dictionnaire normalisé (clés composites `ctx__id`, comme le store)
 * et l'horodatage de la dernière écriture. Null si le coffre est absent.
 */
export function coffreAudience(keys) {
  const fichier = lireCoffreGlobal(keys, 'audience')
  const brut = fichier?.audienceResultats
  if (!brut || typeof brut !== 'object') return null
  return {
    resultats: migrateLegacyResultats(brut).migrated,
    majLe: fichier.updatedAt || null,
    par: fichier.updatedBy || null,
    version: fichier.version ?? null,
  }
}

/** Tags personnalisés du coffre `tags`. Null si le coffre est absent. */
export function coffreTags(keys) {
  const fichier = lireCoffreGlobal(keys, 'tags')
  if (!Array.isArray(fichier?.customTags)) return null
  return {
    customTags: fichier.customTags,
    majLe: fichier.updatedAt || null,
    par: fichier.updatedBy || null,
  }
}

/**
 * Ligne de provenance à joindre aux chiffres servis au magistrat : quel coffre
 * a été lu, quand il a été mis à jour pour la dernière fois — et, en repli, la
 * mise en garde explicite. Un écart avec l'écran doit se voir dans la réponse,
 * pas se découvrir en comparant les chiffres à la main.
 */
export function provenance(coffre, { nom, repli }) {
  if (!coffre) {
    return {
      coffre: repli,
      repli: true,
      alerte: `Coffre « ${nom} » absent ou illisible : chiffres repris du coffre « ${repli} », `
        + 'qui n\'est plus alimenté depuis la bascule multi-contentieux. Ils peuvent être '
        + 'PÉRIMÉS et diverger de la page Statistiques — le dire au magistrat avant de les citer.',
    }
  }
  return { coffre: nom, derniereMiseAJour: coffre.majLe, par: coffre.par }
}
