import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { ResultatAudience } from '@/types/audienceTypes';
import { cleanupAudienceResults } from '@/utils/audienceStats';
import { useEnquetes } from '@/hooks/useEnquetes';
import { electronStorage } from '@/services/storage/electronStorage';

const AUDIENCE_STORAGE_KEY = 'audience_resultats';
const CLEANUP_INTERVAL = 30000;
const DEBUG_MODE = false;

interface AudienceState {
  resultats: Record<string, ResultatAudience>;
}

interface AudienceContextType {
  audienceState: AudienceState;
  saveResultat: (resultat: ResultatAudience) => Promise<boolean>;
  deleteResultat: (enqueteId: number) => Promise<boolean>;
  getResultat: (enqueteId: number) => ResultatAudience | null;
  hasResultat: (enqueteId: number) => boolean;
  deleteAudienceResultat: (enqueteId: number) => Promise<boolean>;
  isLoading: boolean;
  toggleDebugMode: () => void;
}

const AudienceContext = createContext<AudienceContextType | undefined>(undefined);

// Lecture fraîche depuis le storage (source de vérité)
const readFreshFromStorage = async (): Promise<Record<string, ResultatAudience>> => {
  try {
    const data = await electronStorage.read<Record<string, ResultatAudience>>(AUDIENCE_STORAGE_KEY);
    return data || {};
  } catch {
    return {};
  }
};

export const AudienceProvider = ({ children }: { children: React.ReactNode }) => {
  const [audienceState, setAudienceState] = useState<AudienceState>({ resultats: {} });
  const [isLoading, setIsLoading] = useState(true);
  const { enquetes } = useEnquetes();

  // Chargement initial
  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const savedResultats = await readFreshFromStorage();
        setAudienceState({ resultats: savedResultats });
      } catch (error) {
        if (DEBUG_MODE) console.error('Error loading audience results:', error);
        setAudienceState({ resultats: {} });
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  // Écouter les événements de mise à jour externe (sync serveur, etc.)
  useEffect(() => {
    const handleExternalUpdate = () => {
      if (DEBUG_MODE) console.log('External audience update detected, reloading');
      readFreshFromStorage().then(freshData => {
        setAudienceState({ resultats: freshData });
      });
    };

    window.addEventListener('audience-stats-update', handleExternalUpdate);
    return () => {
      window.removeEventListener('audience-stats-update', handleExternalUpdate);
    };
  }, []);

  // Cleanup périodique - lecture fraîche du storage avant nettoyage
  useEffect(() => {
    if (!enquetes || isLoading) return;

    const timer = setTimeout(async () => {
      const freshResultats = await readFreshFromStorage();
      if (Object.keys(freshResultats).length === 0) return;

      const cleanedResultats = cleanupAudienceResults(freshResultats, enquetes);

      // Toujours synchroniser l'état local avec le storage frais
      setAudienceState({ resultats: cleanedResultats });

      // Ne persister que si le cleanup a supprimé des entrées
      if (Object.keys(cleanedResultats).length !== Object.keys(freshResultats).length) {
        if (DEBUG_MODE) console.log('Audience cleanup: removed stale entries');
        electronStorage.createOrUpdate(AUDIENCE_STORAGE_KEY, cleanedResultats);
      }
    }, CLEANUP_INTERVAL);

    return () => clearTimeout(timer);
  }, [enquetes?.length, isLoading]);

  const saveResultat = useCallback(async (resultat: ResultatAudience): Promise<boolean> => {
    // Lire les données fraîches pour ne pas écraser les changements concurrents
    const freshResultats = await readFreshFromStorage();

    const newResultats = {
      ...freshResultats,
      [resultat.enqueteId]: resultat
    };

    if (DEBUG_MODE) console.log('Saving resultat:', resultat);

    const success = await electronStorage.createOrUpdate(AUDIENCE_STORAGE_KEY, newResultats);

    if (success) {
      setAudienceState({ resultats: newResultats });
      return true;
    }
    throw new Error('Échec de la sauvegarde');
  }, []);

  const deleteResultat = useCallback(async (enqueteId: number): Promise<boolean> => {
    const freshResultats = await readFreshFromStorage();
    const newResultats = { ...freshResultats };
    delete newResultats[enqueteId];

    const success = await electronStorage.createOrUpdate(AUDIENCE_STORAGE_KEY, newResultats);

    if (success) {
      setAudienceState({ resultats: newResultats });
      return true;
    }
    throw new Error('Échec de la suppression');
  }, []);

  const getResultat = useCallback((enqueteId: number): ResultatAudience | null => {
    return audienceState.resultats[enqueteId] || null;
  }, [audienceState.resultats]);

  const resultatsCache = useMemo(() => {
    const cache = new Map<number, boolean>();
    Object.keys(audienceState.resultats).forEach(key => {
      cache.set(parseInt(key), true);
    });
    return cache;
  }, [audienceState.resultats]);

  const hasResultat = useCallback((enqueteId: number): boolean => {
    return resultatsCache.has(enqueteId);
  }, [resultatsCache]);

  const deleteAudienceResultat = useCallback(async (enqueteId: number): Promise<boolean> => {
    try {
      return await deleteResultat(enqueteId);
    } catch (error) {
      if (DEBUG_MODE) console.error('Error deleting audience resultat:', error);
      return false;
    }
  }, [deleteResultat]);

  const toggleDebugMode = useCallback(() => {
    if (typeof window !== 'undefined') {
      (window as any).audienceDebug = !DEBUG_MODE;
      console.log(`Audience debug mode: ${(window as any).audienceDebug ? 'ON' : 'OFF'}`);
    }
  }, []);

  const value = useMemo(() => ({
    audienceState,
    saveResultat,
    deleteResultat,
    getResultat,
    hasResultat,
    deleteAudienceResultat,
    isLoading,
    toggleDebugMode
  }), [audienceState, saveResultat, deleteResultat, getResultat, hasResultat, deleteAudienceResultat, isLoading, toggleDebugMode]);

  return (
    <AudienceContext.Provider value={value}>
      {children}
    </AudienceContext.Provider>
  );
};

export const useAudience = (): AudienceContextType => {
  const context = useContext(AudienceContext);
  if (!context) {
    throw new Error('useAudience must be used within an AudienceProvider');
  }
  return context;
};
