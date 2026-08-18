// utils/documents/DocumentSyncManager.ts

import { DocumentEnquete } from '@/types/interfaces';

export interface SyncResult {
  totalInternal: number;
  totalExternal: number;
  addedToInternal: string[];
  addedToExternal: string[];
  // Documents importés depuis le dossier commun (web) avec leurs métadonnées,
  // à fusionner dans la liste de l'enquête. Absent en mode bureau.
  importedDocs?: DocumentEnquete[];
  // Chemins relatifs (ex. « Geoloc/fichier.pdf ») des documents présents en interne
  // mais introuvables / non copiés sur le dossier commun. Permet d'afficher un badge
  // « ✗ commun » rouge en face du document concerné.
  notOnCommun?: string[];
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
    if (!window.siralBridge || !externalPath) {
      return false;
    }
    
    try {
      return await window.siralBridge.validatePath(externalPath);
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
    if (!window.siralBridge) {
      return {
        totalInternal: 0,
        totalExternal: 0,
        addedToInternal: [],
        addedToExternal: [],
        errors: ['Pont de données indisponible'],
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

      // Synchroniser les documents via le pont de données
      const syncResult = await window.siralBridge.syncDocuments(
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
    if (!window.siralBridge) {
      return { newDocuments: [], errors: ['Pont de données indisponible'] };
    }

    try {
      const result = await window.siralBridge.scanForNewDocuments(
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