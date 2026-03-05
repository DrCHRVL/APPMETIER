import { useState, useEffect, useCallback, useMemo } from 'react';
import { ResultatAudience } from '@/types/audienceTypes';
import { cleanupAudienceResults } from '@/utils/audienceStats';
import { useEnquetes } from './useEnquetes';
import { electronStorage } from '@/services/storage/electronStorage';
import { APP_CONFIG } from '@/config/constants';

const AUDIENCE_STORAGE_KEY = 'audience_resultats';
const CLEANUP_INTERVAL = 30000; // 30 secondes au lieu de 1 seconde
const DEBUG_MODE = false; // Flag pour activer/désactiver les logs

interface AudienceState {
  resultats: Record<string, ResultatAudience>;
}

export const useAudience = () => {
  const [audienceState, setAudienceState] = useState<AudienceState>({ resultats: {} });
  const [isLoading, setIsLoading] = useState(true);
  const { enquetes } = useEnquetes();

  useEffect(() => {
    loadResultats();
  }, []);

  const loadResultats = async () => {
    setIsLoading(true);
    try {
      const savedResultats = await electronStorage.read<Record<string, ResultatAudience>>(AUDIENCE_STORAGE_KEY);
      if (savedResultats) {
        setAudienceState({ resultats: savedResultats });
      } else {
        setAudienceState({ resultats: {} });
      }
    } catch (error) {
      if (DEBUG_MODE) console.error('Error loading audience results:', error);
      setAudienceState({ resultats: {} });
    } finally {
      setIsLoading(false);
    }
  };

  // Optimisation : cleanup moins fréquent et memoization
  useEffect(() => {
    if (!audienceState?.resultats || !enquetes || isLoading) return;

    const timer = setTimeout(() => {
      const cleanedResultats = cleanupAudienceResults(audienceState.resultats, enquetes);
      
      if (Object.keys(cleanedResultats).length !== Object.keys(audienceState.resultats).length) {
        if (DEBUG_MODE) console.log('Audience state updated after cleanup');
        setAudienceState({ resultats: cleanedResultats });
        electronStorage.createOrUpdate(AUDIENCE_STORAGE_KEY, cleanedResultats);
      }
    }, CLEANUP_INTERVAL);

    return () => clearTimeout(timer);
  }, [enquetes?.length, Object.keys(audienceState?.resultats || {}).length, isLoading]); // Dépendances optimisées

  const saveResultat = async (resultat: ResultatAudience) => {
    try {
      const newResultats = {
        ...audienceState.resultats,
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
      const newResultats = { ...audienceState.resultats };
      delete newResultats[enqueteId];
      
      const success = await electronStorage.createOrUpdate(AUDIENCE_STORAGE_KEY, newResultats);
      
      if (success) {
        setAudienceState({ resultats: newResultats });
        return true;
      } else {
        throw new Error('Échec de la suppression');
      }
    } catch (error) {
      if (DEBUG_MODE) console.error('Error deleting resultat:', error);
      throw error;
    }
  };

  // Suppression du log répétitif et optimisation avec useMemo
  const getResultat = useCallback((enqueteId: number): ResultatAudience | null => {
    return audienceState.resultats[enqueteId] || null;
  }, [audienceState.resultats]);

  // Optimisation : memoization des résultats hasResultat pour éviter les recalculs
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

  // Fonction utilitaire pour activer/désactiver les logs en développement
  const toggleDebugMode = () => {
    // Cette fonction peut être appelée depuis la console pour activer les logs temporairement
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
    toggleDebugMode // Pour debug si nécessaire
  };
};