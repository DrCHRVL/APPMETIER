'use client';

import { useMemo, useCallback } from 'react';
import { useTags } from '@/hooks/useTags';
import { useNatinf } from '@/hooks/useNatinf';
import type { NatinfEntry, NatinfNature } from '@/types/natinf';

/** Élément d'infraction d'une enquête au format d'affichage unifié (NATINF natif
 *  ou tag résolu). */
export interface EnqueteInfractionItem {
  /** Libellé à afficher : libellé NATINF si disponible, sinon valeur du tag. */
  label: string;
  /** Code NATINF rattaché, si résolu. */
  code?: string;
  nature?: NatinfNature;
  quantumLabel?: string;
  entry?: NatinfEntry;
  /** True si l'item provient du champ migré `infractionNatinfCodes`. */
  fromNatinf: boolean;
}

/**
 * Résout le rattachement « tag d'infraction → NATINF » et le rend exploitable
 * partout (affichage, filtres, statistiques) SANS modifier la donnée stockée :
 * les enquêtes et les chefs continuent de référencer les tags par leur valeur ;
 * le NATINF est résolu à la volée via TagDefinition.natinfCodes.
 *
 * Un tag peut être relié à plusieurs codes ; le premier sert de représentant
 * (nature/quantum/thème pour les agrégats), tous restent accessibles.
 */
export function useInfractionNatinf() {
  const { tags } = useTags();
  const { getByCode, isLoading } = useNatinf();

  // valeur du tag -> entrées NATINF rattachées
  const byTagValue = useMemo(() => {
    const map = new Map<string, NatinfEntry[]>();
    for (const t of tags) {
      if (t.category !== 'infractions' || !t.natinfCodes?.length) continue;
      const entries = t.natinfCodes
        .map((c) => getByCode(c))
        .filter((e): e is NatinfEntry => Boolean(e));
      if (entries.length) map.set(t.value, entries);
    }
    return map;
  }, [tags, getByCode]);

  /** NATINF représentant d'un tag (le premier rattaché), ou undefined. */
  const natinfForTag = useCallback(
    (tagValue: string): NatinfEntry | undefined => byTagValue.get(tagValue)?.[0],
    [byTagValue],
  );

  /** Tous les NATINF rattachés à un tag. */
  const natinfsForTag = useCallback(
    (tagValue: string): NatinfEntry[] => byTagValue.get(tagValue) || [],
    [byTagValue],
  );

  /** Nature (crime/délit/contravention…) du tag via son NATINF représentant. */
  const natureForTag = useCallback(
    (tagValue: string): NatinfNature | undefined => byTagValue.get(tagValue)?.[0]?.nature,
    [byTagValue],
  );

  /** Thème NATINF du tag (ex. « Stupéfiants (ILS) »). */
  const themeForTag = useCallback(
    (tagValue: string): string | undefined => byTagValue.get(tagValue)?.[0]?.theme,
    [byTagValue],
  );

  /** Vrai si au moins un tag d'infraction est rattaché à un NATINF. */
  const hasAnyLink = byTagValue.size > 0;

  /**
   * Infractions canoniques d'une enquête, au format d'affichage unifié.
   * Préfère le champ migré `infractionNatinfCodes` (NATINF natif) ; à défaut,
   * retombe sur les tags d'infraction résolus à la volée. Sert de source unique
   * pour les écrans (cartes, en-tête, stats, archives, PDF) afin que la bascule
   * « tags → NATINF » soit transparente, dossier migré ou non.
   */
  const infractionsForEnquete = useCallback(
    (enquete: {
      tags?: { value: string; category: string }[];
      infractionNatinfCodes?: string[];
    }): EnqueteInfractionItem[] => {
      // Présence du champ (même tableau vide) = dossier migré → fait foi.
      // `undefined` = non migré → on retombe sur les tags d'infraction.
      if (Array.isArray(enquete.infractionNatinfCodes)) {
        return enquete.infractionNatinfCodes.map((code) => {
          const entry = getByCode(code);
          return {
            label: entry?.libelle ?? `NATINF ${code}`,
            code,
            nature: entry?.nature,
            quantumLabel: entry?.quantumLabel,
            entry,
            fromNatinf: true,
          };
        });
      }
      const infra = (enquete.tags || []).filter((t) => t.category === 'infractions');
      return infra.map((t) => {
        const n = byTagValue.get(t.value)?.[0];
        return {
          label: t.value,
          code: n?.code,
          nature: n?.nature,
          quantumLabel: n?.quantumLabel,
          entry: n,
          fromNatinf: false,
        };
      });
    },
    [getByCode, byTagValue],
  );

  return {
    isLoading,
    natinfForTag,
    natinfsForTag,
    natureForTag,
    themeForTag,
    hasAnyLink,
    infractionsForEnquete,
  };
}
