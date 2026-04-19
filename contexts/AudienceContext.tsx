/**
 * AudienceContext — wrapper rétro-compatible autour du store Zustand.
 *
 * Le AudienceProvider initialise le store au montage.
 * useAudience() continue de fonctionner partout — aucun changement nécessaire
 * dans les 15 fichiers consommateurs.
 *
 * Avantage Zustand : le cleanup périodique (30s) ne re-rend plus les composants
 * qui n'ont pas de résultat d'audience.
 */

import React, { useEffect } from 'react';
import { useAudienceStore } from '@/stores/useAudienceStore';
import type { ResultatAudience } from '@/types/audienceTypes';

/**
 * Provider rétro-compatible.
 * Initialise le store au montage — pas de Context.Provider.
 */
export const AudienceProvider = ({ children }: { children: React.ReactNode }) => {
  const initialize = useAudienceStore(s => s.initialize);

  useEffect(() => {
    initialize();
    return () => {
      useAudienceStore.getState().stopCleanup();
    };
  }, [initialize]);

  return <>{children}</>;
};

/**
 * Hook rétro-compatible — délègue au store Zustand.
 * Les 15 fichiers consommateurs n'ont rien à changer.
 */
export const useAudience = () => {
  const resultats = useAudienceStore(s => s.resultats);
  const isLoading = useAudienceStore(s => s.isLoading);
  const saveResultat = useAudienceStore(s => s.saveResultat);
  const deleteResultat = useAudienceStore(s => s.deleteResultat);
  const getResultat = useAudienceStore(s => s.getResultat);
  const hasResultat = useAudienceStore(s => s.hasResultat);
  const deleteAudienceResultat = useAudienceStore(s => s.deleteResultat);

  return {
    audienceState: { resultats },
    saveResultat,
    deleteResultat,
    getResultat,
    hasResultat,
    deleteAudienceResultat,
    isLoading,
    toggleDebugMode: () => {
      if (typeof window !== 'undefined') {
        (window as any).audienceDebug = !(window as any).audienceDebug;
      }
    },
  };
};
