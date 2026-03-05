// types/electron.d.ts (compléter le fichier existant)

// Ajouter ces interfaces aux déclarations existantes

import { SyncData, SyncMetadata } from './dataSyncTypes';

declare global {
  interface Window {
    electronAPI: {
      // ... (APIs existantes) ...
      
      // 🆕 APIs pour la synchronisation des données
      dataSync_checkAccess: () => Promise<boolean>;
      dataSync_pull: () => Promise<{ data: SyncData; metadata: SyncMetadata } | null>;
      dataSync_push: (data: SyncData, metadata: SyncMetadata) => Promise<boolean>;
      getCurrentUser: () => Promise<{ displayName: string; computerName: string }>;
    };
  }
}

export {};
