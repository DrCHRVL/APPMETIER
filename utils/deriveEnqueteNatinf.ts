// utils/deriveEnqueteNatinf.ts
//
// Dérivation des codes NATINF d'une enquête à partir de ses tags d'infraction.
// Cœur (pur, sans dépendance React/UI) de la migration « tags → NATINF » :
//  - les ENQUÊTES stockent des instances de tag `{ id, value }` (cat. infractions) ;
//  - les DÉFINITIONS de tag portent le rattachement `natinfCodes` (cf.
//    TagManagementPage / assistant de réconciliation).
// On résout chaque tag d'infraction de l'enquête vers les codes NATINF de sa
// définition, en matchant d'abord par id (exact) puis par valeur (insensible à
// la casse) pour les instances dont l'id n'existe plus dans la nomenclature.

import type { Tag } from '@/types/interfaces';

/** Définition de tag minimale nécessaire à la dérivation. */
export interface TagNatinfDef {
  id: string;
  value: string;
  natinfCodes?: string[];
}

export interface InfractionNatinfDerivation {
  /** Codes NATINF dédupliqués, dans l'ordre de première rencontre. */
  codes: string[];
  /** Valeurs des tags d'infraction sans rattachement NATINF (à rattacher). */
  unresolved: string[];
}

const norm = (v: string | undefined): string => (v || '').trim().toLowerCase();

/**
 * Résout les tags d'infraction d'une enquête vers des codes NATINF.
 * @param infractionTags instances de tag de catégorie « infractions » de l'enquête
 * @param tagDefs définitions de tag d'infraction (avec leur rattachement NATINF)
 */
export function deriveInfractionNatinfCodes(
  infractionTags: Pick<Tag, 'id' | 'value'>[],
  tagDefs: TagNatinfDef[],
): InfractionNatinfDerivation {
  const byId = new Map<string, TagNatinfDef>();
  const byValueLc = new Map<string, TagNatinfDef>();
  for (const def of tagDefs) {
    byId.set(def.id, def);
    const v = norm(def.value);
    if (v && !byValueLc.has(v)) byValueLc.set(v, def);
  }

  const codes: string[] = [];
  const seen = new Set<string>();
  const unresolved: string[] = [];

  for (const t of infractionTags) {
    const byIdDef = byId.get(t.id);
    const byValueDef = byValueLc.get(norm(t.value));
    // Préférer une définition RÉELLEMENT rattachée : un match par id dont
    // `natinfCodes` est vide ne doit pas court-circuiter une définition de même
    // valeur qui, elle, porte des codes (sinon le tag est marqué « à rattacher »
    // alors qu'une résolution existe).
    const def =
      (byIdDef?.natinfCodes?.length ? byIdDef : undefined) ??
      (byValueDef?.natinfCodes?.length ? byValueDef : undefined) ??
      byIdDef ??
      byValueDef;
    const linked = def?.natinfCodes ?? [];
    if (linked.length === 0) {
      if (t.value && !unresolved.includes(t.value)) unresolved.push(t.value);
      continue;
    }
    for (const c of linked) {
      if (!seen.has(c)) {
        seen.add(c);
        codes.push(c);
      }
    }
  }

  return { codes, unresolved };
}

/** Filtre les tags d'infraction d'une liste de tags d'enquête. */
export function infractionTagsOf<T extends { category: string }>(tags: T[]): T[] {
  return tags.filter(t => t.category === 'infractions');
}
