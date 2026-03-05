// hooks/useDataSync.ts

import { useState, useEffect, useCallback } from 'react';
import { dataSyncManager } from '@/utils/dataSync/DataSyncManager';
import { SyncStatus, SyncResult, ConflictResolution, ConflictAction } from '@/types/dataSyncTypes';

/**
 * Hook personnalisé pour gérer la synchronisation des données
 * Fournit l'état de synchronisation et les méthodes pour interagir avec le service
 */
export const useDataSync = () => {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);

  // Initialiser le service au montage du composant
  useEffect(() => {
    const initializeSync = async () => {
      try {
        await dataSyncManager.initialize();
        setSyncStatus(dataSyncManager.getStatus());
      } catch (error) {
        console.error('Erreur initialisation DataSync:', error);
      }
    };

    initializeSync();

    // Listener pour les changements de statut
    const statusListener = (status: SyncStatus) => {
      setSyncStatus(status);
      setIsSyncing(status.isSync);
    };

    dataSyncManager.addStatusListener(statusListener);

    // Cleanup
    return () => {
      dataSyncManager.removeStatusListener(statusListener);
    };
  }, []);

  /**
   * Déclenche une synchronisation manuelle
   */
  const triggerSync = useCallback(async (): Promise<SyncResult> => {
    setIsSyncing(true);
    
    try {
      const result = await dataSyncManager.triggerSync();
      setLastSyncResult(result);
      return result;
    } catch (error) {
      console.error('Erreur sync manuelle:', error);
      const errorResult: SyncResult = {
        success: false,
        timestamp: new Date().toISOString(),
        action: 'error',
        error: error instanceof Error ? error.message : 'Erreur inconnue'
      };
      setLastSyncResult(errorResult);
      return errorResult;
    } finally {
      setIsSyncing(false);
    }
  }, []);

  /**
   * 🆕 Résout les conflits avec sélection individuelle
   */
  const resolveConflicts = useCallback(async (
    selections: Map<number, ConflictAction>
  ): Promise<void> => {
    if (!lastSyncResult?.localData || !lastSyncResult?.serverData || !lastSyncResult?.conflicts) {
      throw new Error('Données manquantes pour résoudre les conflits');
    }

    setIsSyncing(true);

    try {
      await dataSyncManager.resolveConflicts(
        lastSyncResult.conflicts,
        selections,
        lastSyncResult.localData,
        lastSyncResult.serverData
      );
      
      // Déclencher une nouvelle sync pour vérifier
      const newResult = await dataSyncManager.triggerSync();
      setLastSyncResult(newResult);
    } catch (error) {
      console.error('Erreur résolution conflits:', error);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [lastSyncResult]);

  /**
   * @deprecated Utilisez resolveConflicts() à la place
   * Résout un conflit avec la stratégie choisie (ancienne API)
   */
  const resolveConflict = useCallback(async (
    resolution: ConflictResolution,
    result: SyncResult
  ): Promise<void> => {
    if (!result.localData || !result.serverData) {
      throw new Error('Données manquantes pour résoudre le conflit');
    }

    setIsSyncing(true);

    try {
      await dataSyncManager.resolveConflict(resolution, result.localData, result.serverData);
      
      // Déclencher une nouvelle sync pour vérifier
      const newResult = await dataSyncManager.triggerSync();
      setLastSyncResult(newResult);
    } catch (error) {
      console.error('Erreur résolution conflit:', error);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, []);

  /**
   * Vérifie l'accès au serveur
   */
  const checkServerAccess = useCallback(async (): Promise<boolean> => {
    return await dataSyncManager.checkServerAccess();
  }, []);

  /**
   * Arrête le service de synchronisation
   */
  const stopSync = useCallback(() => {
    dataSyncManager.stop();
  }, []);

  return {
    // État
    syncStatus,
    isSyncing,
    lastSyncResult,
    
    // Méthodes
    triggerSync,
    resolveConflicts,      // 🆕 Nouvelle API avec sélection
    resolveConflict,       // Ancienne API (dépréciée)
    checkServerAccess,
    stopSync,
    
    // Helpers
    isOnline: syncStatus?.isOnline ?? false,
    hasConflicts: lastSyncResult?.action === 'conflicts_detected',
    conflicts: lastSyncResult?.conflicts ?? []
  };
};