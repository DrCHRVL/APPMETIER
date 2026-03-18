import { useState, useEffect, useCallback, useMemo } from 'react';
import { ResultatAudience } from '@/types/audienceTypes';
import { cleanupAudienceResults } from '@/utils/audienceStats';
import { useEnquetes } from './useEnquetes';
import { electronStorage } from '@/services/storage/electronStorage';
import { APP_CONFIG } from '@/config/constants';

const AUDIENCE_STORAGE_KEY = 'audience_resultats';
const CLEANUP_INTERVAL = 30000; // 30 secondes
const DEBUG_MODE = false;

// Événement custom pour synchroniser toutes les instances de useAudience
const AUDIENCE_SYNC_EVENT = 'audience-data-sync';

interface AudienceState {
  resultats: Record<string, ResultatAudience>;
}

// Fonction utilitaire : lire les résultats frais depuis le storage
const readFreshFromStorage = async (): Promise<Record<string, ResultatAudience>> => {
  try {
    const data = await electronStorage.read<Record<string, ResultatAudience>>(AUDIENCE_STORAGE_KEY);
    return data || {};
  } catch {
    return {};
  }
};

export const useAudience = () => {
  const [audienceState, setAudienceState] = useState<AudienceState>({ resultats: {} });
  const [isLoading, setIsLoading] = useState(true);
  const { enquetes } = useEnquetes();

  const loadResultats = useCallback(async () => {
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
  }, []);

  // Chargement initial
  useEffect(() => {
    loadResultats();
  }, [loadResultats]);

  // Écouter les événements de synchronisation des autres instances
  // et aussi l'événement audience-stats-update existant
  useEffect(() => {
    const handleSync = () => {
      if (DEBUG_MODE) console.log('Audience sync event received, reloading from storage');
      readFreshFromStorage().then(freshData => {
        setAudienceState({ resultats: freshData });
      });
    };

    window.addEventListener(AUDIENCE_SYNC_EVENT, handleSync);
    window.addEventListener('audience-stats-update', handleSync);
    return () => {
      window.removeEventListener(AUDIENCE_SYNC_EVENT, handleSync);
      window.removeEventListener('audience-stats-update', handleSync);
    };
  }, []);

  // Cleanup : lire les données fraîches du storage avant de nettoyer
  useEffect(() => {
    if (!enquetes || isLoading) return;

    const timer = setTimeout(async () => {
      // Toujours lire les données fraîches du storage pour éviter d'écraser
      // les résultats sauvegardés par d'autres instances de useAudience
      const freshResultats = await readFreshFromStorage();

      if (Object.keys(freshResultats).length === 0) return;

      const cleanedResultats = cleanupAudienceResults(freshResultats, enquetes);

      // Mettre à jour l'état local avec les données fraîches (même si pas de cleanup)
      setAudienceState({ resultats: cleanedResultats });

      // Ne persister que si le cleanup a effectivement supprimé des entrées
      if (Object.keys(cleanedResultats).length !== Object.keys(freshResultats).length) {
        if (DEBUG_MODE) console.log('Audience state updated after cleanup');
        electronStorage.createOrUpdate(AUDIENCE_STORAGE_KEY, cleanedResultats);
      }
    }, CLEANUP_INTERVAL);

    return () => clearTimeout(timer);
  }, [enquetes?.length, isLoading]);

  const saveResultat = async (resultat: ResultatAudience) => {
    try {
      // Lire les données fraîches du storage pour éviter d'écraser
      // les résultats sauvegardés par d'autres instances
      const freshResultats = await readFreshFromStorage();

      const newResultats = {
        ...freshResultats,
        [resultat.enqueteId]: resultat
      };

      if (DEBUG_MODE) {
        console.log('Saving resultat:', resultat);
        console.log('New resultats:', newResultats);
      }

      const success = await electronStorage.createOrUpdate(AUDIENCE_STORAGE_KEY, newResultats);

      if (success) {
        if (DEBUG_MODE) console.log('Save successful, updating audience state');
        setAudienceState({ resultats: newResultats });
        // Notifier toutes les autres instances de useAudience
        window.dispatchEvent(new Event(AUDIENCE_SYNC_EVENT));
        return true;
      } else {
        if (DEBUG_MODE) console.log('Save failed');
        throw new Error('Échec de la sauvegarde');
      }
    } catch (error) {
      if (DEBUG_MODE) console.error('Error saving resultat:', error);
      throw error;
    }
  };

  const deleteResultat = async (enqueteId: number) => {
    try {
      // Lire les données fraîches du storage
      const freshResultats = await readFreshFromStorage();
      const newResultats = { ...freshResultats };
      delete newResultats[enqueteId];

      const success = await electronStorage.createOrUpdate(AUDIENCE_STORAGE_KEY, newResultats);

      if (success) {
        setAudienceState({ resultats: newResultats });
        // Notifier toutes les autres instances
        window.dispatchEvent(new Event(AUDIENCE_SYNC_EVENT));
        return true;
      } else {
        throw new Error('Échec de la suppression');
      }
    } catch (error) {
      if (DEBUG_MODE) console.error('Error deleting resultat:', error);
      throw error;
    }
  };

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

  const deleteAudienceResultat = async (enqueteId: number) => {
    try {
      const success = await deleteResultat(enqueteId);
      return success;
    } catch (error) {
      if (DEBUG_MODE) console.error('Error deleting audience resultat:', error);
      return false;
    }
  };

  const toggleDebugMode = () => {
    if (typeof window !== 'undefined') {
      (window as any).audienceDebug = !DEBUG_MODE;
      console.log(`Audience debug mode: ${(window as any).audienceDebug ? 'ON' : 'OFF'}`);
    }
  };

  return {
    audienceState,
    saveResultat,
    deleteResultat,
    getResultat,
    hasResultat,
    deleteAudienceResultat,
    isLoading,
    toggleDebugMode
  };
};
