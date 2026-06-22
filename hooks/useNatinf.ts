'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NatinfEntry } from '@/types/natinf';
import {
  loadNatinf,
  searchNatinf,
  listThemes,
  indexByCode,
  type SearchOptions,
} from '@/lib/natinf/natinfData';

interface UseNatinfReturn {
  entries: NatinfEntry[];
  isLoading: boolean;
  error: boolean;
  /** Recherche par code ou libellé (voir searchNatinf) */
  search: (query: string, opts?: SearchOptions) => NatinfEntry[];
  /** Résolution rapide d'un code -> entrée */
  getByCode: (code: string | undefined | null) => NatinfEntry | undefined;
  /** Liste triée des thèmes disponibles */
  themes: string[];
}

/**
 * Charge le référentiel NATINF (une fois, partagé via le cache du service) et
 * expose recherche, résolution par code et liste des thèmes.
 */
export function useNatinf(): UseNatinfReturn {
  const [entries, setEntries] = useState<NatinfEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    loadNatinf()
      .then((data) => {
        if (mounted.current) {
          setEntries(data);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (mounted.current) {
          setError(true);
          setIsLoading(false);
        }
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  const byCode = useMemo(() => indexByCode(entries), [entries]);
  const themes = useMemo(() => listThemes(entries), [entries]);

  const search = useCallback(
    (query: string, opts?: SearchOptions) => searchNatinf(entries, query, opts),
    [entries],
  );

  const getByCode = useCallback(
    (code: string | undefined | null) => (code ? byCode.get(code) : undefined),
    [byCode],
  );

  return { entries, isLoading, error, search, getByCode, themes };
}
