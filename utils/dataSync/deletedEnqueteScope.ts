// utils/dataSync/deletedEnqueteScope.ts
//
// Les identifiants d'enquête sont attribués PAR CONTENTIEUX (maxId + 1) :
// crimorg, ecofi et enviro ont donc chacun une enquête n° 1, n° 2, n° 3… Le
// tombstone de suppression d'une enquête doit par conséquent être rattaché à
// son contentieux. Sans ce rattachement (ancien format : un simple id global),
// supprimer l'enquête crimorg n° 2 posait un tombstone « 2 » qui, à la fusion
// de sync d'un AUTRE contentieux, faisait disparaître en silence une enquête
// ecofi n° 2 pourtant légitime (DataMergeService : « id supprimé → on
// n'ajoute pas l'enquête serveur »).
//
// Un tombstone SANS contentieux est un vestige du format global historique :
// on le fait valoir sur TOUS les contentieux, pour ne pas ressusciter ce qui
// avait été supprimé avant cette correction.

export interface ScopedEnqueteTombstone {
  id: number;
  contentieux?: string;
  deletedAt?: string;
}

/**
 * Clé de dédoublonnage d'un tombstone d'enquête : le couple (contentieux, id).
 * Le séparateur NUL ne peut pas apparaître dans un identifiant de contentieux,
 * donc deux couples distincts ne peuvent pas produire la même clé. Un vestige
 * sans contentieux garde une clé propre, distincte des tombstones rattachés.
 */
export function enqueteTombstoneKey(t: { id: number; contentieux?: string }): string {
  return `${t.contentieux ?? ''}\u0000${t.id}`;
}

/**
 * IDs d'enquête réputés supprimés POUR CE contentieux : ceux qui lui sont
 * rattachés, plus les vestiges globaux (sans contentieux). C'est exactement
 * l'ensemble que DataMergeService doit utiliser pour l'anti-résurrection, sans
 * jamais supprimer une enquête d'un autre contentieux portant le même numéro.
 */
export function scopeEnqueteTombstones(
  tombstones: ReadonlyArray<ScopedEnqueteTombstone> | undefined,
  contentieuxId: string,
): number[] {
  if (!Array.isArray(tombstones)) return [];
  const ids: number[] = [];
  for (const t of tombstones) {
    if (!t || typeof t.id !== 'number') continue;
    if (!t.contentieux || t.contentieux === contentieuxId) ids.push(t.id);
  }
  return ids;
}
