'use client';

import { useMemo, useCallback } from 'react';
import { useTags } from '@/hooks/useTags';
import { useNatinf } from '@/hooks/useNatinf';
import type { NatinfEntry, NatinfNature } from '@/types/natinf';

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

  return {
    isLoading,
    natinfForTag,
    natinfsForTag,
    natureForTag,
    themeForTag,
    hasAnyLink,
  };
}
