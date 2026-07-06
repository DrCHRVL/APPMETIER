'use client';

import { useCallback, useMemo } from 'react';
import type { Enquete, Tag } from '@/types/interfaces';
import { useNatinf } from '@/hooks/useNatinf';
import { useInfractionNatinf } from '@/hooks/useInfractionNatinf';

/**
 * Filtre d'infractions ÉVOLUTIF.
 *
 * Problème résolu : après la bascule « tags d'infraction → NATINF », le
 * sélecteur de filtres continuait d'exposer l'intégralité du référentiel de
 * tags d'infraction historique (y compris des libellés devenus obsolètes,
 * conservés sur les dossiers pour rollback mais plus représentatifs).
 *
 * Ce hook construit la liste des infractions RÉELLEMENT présentes dans les
 * dossiers courants, sous leur représentation actuelle :
 *   - dossier migré → thème NATINF (« Stupéfiants (ILS) », « Vol »…), à défaut
 *     le libellé du code ;
 *   - dossier non migré dont les tags sont rattachés à un NATINF → même thème ;
 *   - tag legacy sans rattachement → sa valeur brute (transition).
 *
 * La liste se réduit donc automatiquement quand un type d'infraction n'est plus
 * utilisé, et bascule en nomenclature NATINF au fil de la migration.
 */
export function useInfractionFilter(enquetes: Enquete[]): {
  infractionTags: Tag[];
  resolveInfractionKeys: (e: Enquete) => Set<string>;
} {
  const { getByCode } = useNatinf();
  const { infractionsForEnquete } = useInfractionNatinf();

  // Clé de regroupement d'un item d'infraction résolu : thème NATINF si connu,
  // sinon libellé/valeur. Une seule source de vérité, partagée entre la
  // construction des chips et le matching, pour rester cohérent.
  const keyOf = useCallback(
    (item: { code?: string; label: string }): string => {
      if (item.code) {
        const theme = getByCode(item.code)?.theme;
        return theme && theme.trim() ? theme : item.label;
      }
      return item.label;
    },
    [getByCode],
  );

  const resolveInfractionKeys = useCallback(
    (e: Enquete): Set<string> => {
      const keys = new Set<string>();
      for (const item of infractionsForEnquete(e)) {
        const k = keyOf(item);
        if (k) keys.add(k);
      }
      return keys;
    },
    [infractionsForEnquete, keyOf],
  );

  const infractionTags = useMemo(() => {
    const seen = new Set<string>();
    const chips: Tag[] = [];
    for (const e of enquetes) {
      for (const item of infractionsForEnquete(e)) {
        const k = keyOf(item);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        chips.push({ id: `infra:${k}`, value: k, category: 'infractions' });
      }
    }
    return chips.sort((a, b) => a.value.localeCompare(b.value, 'fr'));
  }, [enquetes, infractionsForEnquete, keyOf]);

  return { infractionTags, resolveInfractionKeys };
}
