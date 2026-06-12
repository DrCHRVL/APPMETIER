// hooks/useMultiSyncStatus.ts

import { useState, useEffect } from 'react';
import { MultiSyncManager } from '@/utils/dataSync/MultiSyncManager';
import { SyncStatus } from '@/types/dataSyncTypes';

/**
 * Expose à l'interface le statut consolidé de la synchronisation multi-contentieux.
 *
 * On interroge périodiquement MultiSyncManager.getAggregateStatus() : les instances
 * de sync sont créées de façon asynchrone au démarrage (via le UserStore) et peuvent
 * être recréées, donc un sondage léger est plus robuste qu'un abonnement figé sur
 * des instances qui n'existent pas encore.
 */
export const useMultiSyncStatus = (intervalMs = 2000) => {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    const refresh = () => {
      try {
        const next = MultiSyncManager.getInstance().getAggregateStatus();
        // getAggregateStatus retourne un objet neuf à chaque appel : sans cette
        // comparaison, TOUTE l'app re-rend à chaque tick (2 s) pour rien.
        setSyncStatus((prev) => {
          if (prev && next
            && prev.isSync === next.isSync
            && prev.isOnline === next.isOnline
            && prev.lastSyncAttempt === next.lastSyncAttempt
            && prev.lastSuccessfulSync === next.lastSuccessfulSync
            && prev.hasPendingChanges === next.hasPendingChanges) {
            return prev;
          }
          return next;
        });
      } catch {
        // Non bloquant
      }
    };

    refresh();
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return {
    syncStatus,
    isSyncing: syncStatus?.isSync ?? false,
    isOnline: syncStatus?.isOnline ?? false,
  };
};
