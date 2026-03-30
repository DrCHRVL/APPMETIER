// hooks/useOverboardData.ts
// Charge les enquêtes de tous les contentieux accessibles pour la vue Overboard.
// Lecture seule — pas de sauvegarde, juste un snapshot pour l'affichage transversal.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Enquete } from '@/types/interfaces';
import { ContentieuxId, ContentieuxDefinition } from '@/types/userTypes';
import { ElectronBridge } from '@/utils/electronBridge';

function storageKey(contentieuxId: ContentieuxId): string {
  return `ctx_${contentieuxId}_enquetes`;
}

export const useOverboardData = (contentieuxDefs: ContentieuxDefinition[]) => {
  const [enquetesByContentieux, setEnquetesByContentieux] = useState<Map<ContentieuxId, Enquete[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  // Stabiliser la liste des IDs pour éviter les boucles infinies
  const contentieuxIds = useMemo(
    () => contentieuxDefs.map(d => d.id).sort().join(','),
    [contentieuxDefs]
  );
  const prevIdsRef = useRef(contentieuxIds);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    const result = new Map<ContentieuxId, Enquete[]>();

    await Promise.all(
      contentieuxDefs.map(async (def) => {
        try {
          const data = await ElectronBridge.getData<Enquete[]>(storageKey(def.id), []);
          result.set(def.id, Array.isArray(data) ? data : []);
        } catch {
          result.set(def.id, []);
        }
      })
    );

    setEnquetesByContentieux(result);
    setIsLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentieuxIds]);

  useEffect(() => {
    if (contentieuxDefs.length > 0) {
      loadAll();
    }
  }, [loadAll, contentieuxDefs.length]);

  return { enquetesByContentieux, isLoading, refresh: loadAll };
};
