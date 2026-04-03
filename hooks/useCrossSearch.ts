// hooks/useCrossSearch.ts
// Recherche dans les enquêtes des autres contentieux quand l'utilisateur tape 3+ caractères.
// Retourne un compteur de résultats par contentieux pour les pastilles sidebar.

import { useState, useEffect, useMemo, useRef } from 'react';
import { Enquete } from '@/types/interfaces';
import { ContentieuxId, ContentieuxDefinition } from '@/types/userTypes';
import { ElectronBridge } from '@/utils/electronBridge';

export interface CrossSearchResult {
  contentieuxId: ContentieuxId;
  count: number;
}

const MIN_SEARCH_LENGTH = 3;
const DEBOUNCE_MS = 400;

/** Même logique de matching que useFilterSort — vérifie si une enquête correspond au terme */
function matchesSearch(e: Enquete, term: string): boolean {
  return (
    e.numero.toLowerCase().includes(term) ||
    e.services?.some(s => s?.toLowerCase().includes(term)) ||
    e.tags?.some(t => t.value.toLowerCase().includes(term)) ||
    (e.description?.toLowerCase().includes(term) || false) ||
    e.misEnCause?.some(m =>
      m.nom.toLowerCase().includes(term) ||
      m.role?.toLowerCase().includes(term)
    ) ||
    e.dateDebut?.includes(term) ||
    e.comptesRendus?.some(cr =>
      cr.enqueteur.toLowerCase().includes(term) ||
      cr.description.toLowerCase().includes(term)
    ) ||
    e.geolocalisations?.some(geo =>
      geo.objet.toLowerCase().includes(term) ||
      geo.description?.toLowerCase().includes(term)
    ) ||
    e.ecoutes?.some(ec =>
      ec.numero.toLowerCase().includes(term) ||
      ec.cible?.toLowerCase().includes(term) ||
      ec.description?.toLowerCase().includes(term)
    ) ||
    e.actes?.some(a =>
      a.type.toLowerCase().includes(term) ||
      a.description.toLowerCase().includes(term)
    )
  );
}

export const useCrossSearch = (
  searchTerm: string,
  activeContentieux: ContentieuxId | null,
  contentieuxDefs: ContentieuxDefinition[]
) => {
  const [results, setResults] = useState<CrossSearchResult[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // IDs des autres contentieux (pas le contentieux actif)
  const otherContentieuxIds = useMemo(
    () => contentieuxDefs
      .filter(d => d.id !== activeContentieux && d.enabled !== false)
      .map(d => d.id),
    [contentieuxDefs, activeContentieux]
  );

  useEffect(() => {
    // Clear timer on every change
    if (timerRef.current) clearTimeout(timerRef.current);

    const term = searchTerm.toLowerCase().trim();

    // Pas assez de caractères → vider
    if (term.length < MIN_SEARCH_LENGTH || otherContentieuxIds.length === 0) {
      setResults([]);
      return;
    }

    // Debounce
    timerRef.current = setTimeout(async () => {
      const newResults: CrossSearchResult[] = [];

      await Promise.all(
        otherContentieuxIds.map(async (cId) => {
          try {
            const enquetes = await ElectronBridge.getData<Enquete[]>(`ctx_${cId}_enquetes`, []);
            if (!Array.isArray(enquetes)) return;

            // Ne compter que les enquêtes en cours (pas les archives)
            const count = enquetes.filter(
              e => e.statut === 'en_cours' && matchesSearch(e, term)
            ).length;

            if (count > 0) {
              newResults.push({ contentieuxId: cId, count });
            }
          } catch {}
        })
      );

      setResults(newResults);
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [searchTerm, otherContentieuxIds]);

  const totalOtherResults = useMemo(
    () => results.reduce((sum, r) => sum + r.count, 0),
    [results]
  );

  return { crossSearchResults: results, totalOtherResults };
};
