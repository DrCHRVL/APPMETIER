// utils/dataSync/globalSyncCommon.ts
//
// Helpers partagés par les sync globaux dédiés (tag-data.json,
// audience-data.json). Chaque fichier a son propre pipeline isolé : pas
// de détection de changement basée sur les enquêtes, pas de fichier
// fourre-tout, pas de dépendance au vieux DataSyncManager racine.

import { GlobalSyncMetadata } from '@/types/globalSyncTypes';

export interface SyncUserInfo {
  displayName: string;
  computerName: string;
}

export async function getCurrentUserInfo(): Promise<SyncUserInfo> {
  try {
    if (window.electronAPI?.getCurrentUser) {
      const info = await window.electronAPI.getCurrentUser();
      return {
        displayName: info.displayName || 'inconnu',
        computerName: info.computerName || 'inconnu',
      };
    }
  } catch {
    // Non bloquant
  }
  return { displayName: 'inconnu', computerName: 'inconnu' };
}

export function buildMetadata(
  previousVersion: number,
  user: SyncUserInfo,
): GlobalSyncMetadata {
  return {
    version: previousVersion + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: user.displayName,
    computerName: user.computerName,
  };
}

/**
 * Retourne `true` si l'API Electron globalSync_* est disponible.
 * Les sessions navigateur (dev Next.js sans Electron) tombent en no-op.
 */
export function isGlobalSyncAvailable(): boolean {
  return typeof window !== 'undefined'
    && !!window.electronAPI?.globalSync_pullTags
    && !!window.electronAPI?.globalSync_pushTags;
}

/**
 * Déclenche un event `global-sync-completed` que les stores/hooks
 * peuvent écouter pour ré-hydrater leur état mémoire.
 */
export function emitSyncCompleted(scope: 'tags' | 'audience'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('global-sync-completed', { detail: { scope } }));
}
