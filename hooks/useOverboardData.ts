// hooks/useOverboardData.ts
// Charge les enquêtes de tous les contentieux accessibles pour la vue Overboard.
// Lecture seule — pas de sauvegarde, juste un snapshot pour l'affichage transversal.

import { useState, useEffect, useCallback } from 'react';
import { Enquete } from '@/types/interfaces';
import { ContentieuxId, ContentieuxDefinition } from '@/types/userTypes';
import { ElectronBridge } from '@/utils/electronBridge';

function storageKey(contentieuxId: ContentieuxId): string {
  return `ctx_${contentieuxId}_enquetes`;
}

export const useOverboardData = (contentieuxDefs: ContentieuxDefinition[]) => {
  const [enquetesByContentieux, setEnquetesByContentieux] = useState<Map<ContentieuxId, Enquete[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

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
  }, [contentieuxDefs]);

  useEffect(() => {
    if (contentieuxDefs.length > 0) {
      loadAll();
    }
  }, [loadAll, contentieuxDefs]);

  return { enquetesByContentieux, isLoading, refresh: loadAll };
};
