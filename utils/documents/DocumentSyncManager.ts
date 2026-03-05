// utils/documents/DocumentSyncManager.ts

import { DocumentEnquete } from '@/types/interfaces';

export interface SyncResult {
  totalInternal: number;
  totalExternal: number;
  addedToInternal: string[];
  addedToExternal: string[];
  errors: string[];
  externalAccessible: boolean;
}

export interface ScanResult {
  newDocuments: DocumentEnquete[];
  errors: string[];
}

export class DocumentSyncManager {
  /**
   * Vérifie si le chemin externe est accessible
   */
  static async isExternalPathAccessible(externalPath: string | null): Promise<boolean> {
    if (!window.electronAPI || !externalPath) {
      return false;
    }
    
    try {
      return await window.electronAPI.validatePath(externalPath);
    } catch (error) {
      console.error('Erreur lors de la vérification du chemin externe:', error);
      return false;
    }
  }
  
  /**
   * Synchronise les documents entre le stockage interne et externe
   */
  static async synchronizeDocuments(
    enqueteNumero: string,
    externalPath: string | null,
    useSubfolder: boolean = true
  ): Promise<SyncResult> {
    if (!window.electronAPI) {
      return {
        totalInternal: 0,
        totalExternal: 0,
        addedToInternal: [],
        addedToExternal: [],
        errors: ['API Electron non disponible'],
        externalAccessible: false
      };
    }

    if (!externalPath) {
      return {
        totalInternal: 0,
        totalExternal: 0,
        addedToInternal: [],
        addedToExternal: [],
        errors: ['Aucun chemin externe configuré'],
        externalAccessible: false
      };
    }
    
    // Vérifier d'abord si le chemin externe est accessible
    const isAccessible = await DocumentSyncManager.isExternalPathAccessible(externalPath);
    
    if (!isAccessible) {
      return {
        totalInternal: 0,
        totalExternal: 0,
        addedToInternal: [],
        addedToExternal: [],
        errors: ['Chemin externe inaccessible actuellement'],
        externalAccessible: false
      };
    }

    try {
      const result: SyncResult = {
        totalInternal: 0,
        totalExternal: 0,
        addedToInternal: [],
        addedToExternal: [],
        errors: [],
        externalAccessible: true
      };

      // Appeler l'API Electron pour synchroniser les documents
      const syncResult = await window.electronAPI.syncDocuments(
        enqueteNumero,
        externalPath,
        useSubfolder
      );
      
      if (syncResult) {
        return { 
          ...syncResult, 
          externalAccessible: true 
        };
      }
      
      return result;
    } catch (error) {
      console.error('Erreur lors de la synchronisation des documents:', error);
      return {
        totalInternal: 0,
        totalExternal: 0,
        addedToInternal: [],
        addedToExternal: [],
        errors: [error instanceof Error ? error.message : 'Erreur inconnue'],
        externalAccessible: true // L'erreur est survenue après avoir vérifié l'accessibilité
      };
    }
  }

  /**
   * Recherche de nouveaux documents ajoutés manuellement dans le système de fichiers
   */
  static async scanForNewDocuments(
    enqueteNumero: string,
    existingDocuments: DocumentEnquete[]
  ): Promise<ScanResult> {
    if (!window.electronAPI) {
      return { newDocuments: [], errors: ['API Electron non disponible'] };
    }

    try {
      const result = await window.electronAPI.scanForNewDocuments(
        enqueteNumero,
        existingDocuments.map(doc => doc.cheminRelatif)
      );

      return result || { newDocuments: [], errors: [] };
    } catch (error) {
      console.error('Erreur lors de la recherche de nouveaux documents:', error);
      return {
        newDocuments: [],
        errors: [error instanceof Error ? error.message : 'Erreur inconnue']
      };
    }
  }
}