// utils/DataSyncService.ts

export interface SyncConflict {
  type: 'new' | 'modified';
  enqueteNumero: string;
  details: string[];
}

export interface SyncResult {
  success: boolean;
  conflicts: SyncConflict[];
  serverData?: any;
  action: 'first_sync' | 'conflicts_detected' | 'no_conflicts' | 'error';
  error?: string;
}

export class DataSyncService {
  
  /**
   * Vérifier si le serveur commun est accessible
   */
  static async isServerAccessible(): Promise<boolean> {
    if (!window.electronAPI) {
      return false;
    }
    
    try {
      return await window.electronAPI.checkCommonServerAccess();
    } catch (error) {
      console.error('Erreur vérification serveur:', error);
      return false;
    }
  }

  /**
   * Synchroniser les données avec détection de conflits
   */
  static async syncWithConflictDetection(): Promise<SyncResult> {
    if (!window.electronAPI) {
      return {
        success: false,
        conflicts: [],
        action: 'error',
        error: 'API Electron non disponible'
      };
    }

    try {
      const result = await window.electronAPI.syncWithConflictDetection();
      return result;
    } catch (error) {
      console.error('Erreur synchronisation:', error);
      return {
        success: false,
        conflicts: [],
        action: 'error',
        error: error instanceof Error ? error.message : 'Erreur inconnue'
      };
    }
  }

  /**
   * Forcer l'écriture des données locales sur le serveur
   */
  static async forcePushToServer(): Promise<boolean> {
    if (!window.electronAPI) {
      return false;
    }

    try {
      // Récupérer toutes les données locales
      const enquetes = await window.electronAPI.getData('enquetes', []);
      const customTags = await window.electronAPI.getData('customTags', {});
      const audienceResults = await window.electronAPI.getData('audienceResults', {});
      
      const dataToSync = {
        enquetes,
        customTags,
        audienceResults,
        lastSyncTimestamp: new Date().toISOString()
      };

      // Écrire sur le serveur
      const success = await window.electronAPI.syncWriteData(dataToSync);
      
      if (success) {
        console.log('✅ Données forcées sur le serveur commun');
      }
      
      return success;
    } catch (error) {
      console.error('❌ Erreur push forcé vers serveur:', error);
      return false;
    }
  }

  /**
   * Fusionner les données serveur avec les données locales
   */
  static async mergeServerData(serverData: any): Promise<boolean> {
    if (!window.electronAPI) {
      return false;
    }

    try {
      // Récupérer les données locales
      const localEnquetes = await window.electronAPI.getData('enquetes', []);
      const localCustomTags = await window.electronAPI.getData('customTags', {});
      const localAudienceResults = await window.electronAPI.getData('audienceResults', {});

      // Fusionner les enquêtes (dernier gagne par ID)
      const mergedEnquetes = this.mergeEnquetes(localEnquetes, serverData.enquetes || []);
      
      // Fusionner les tags (union)
      const mergedTags = { ...localCustomTags, ...(serverData.customTags || {}) };
      
      // Fusionner les résultats d'audience (dernier gagne par enqueteId)
      const mergedAudienceResults = { ...localAudienceResults, ...(serverData.audienceResults || {}) };

      // Sauvegarder les données fusionnées localement
      await window.electronAPI.setData('enquetes', mergedEnquetes);
      await window.electronAPI.setData('customTags', mergedTags);
      await window.electronAPI.setData('audienceResults', mergedAudienceResults);

      console.log('✅ Données fusionnées et sauvegardées localement');
      return true;
    } catch (error) {
      console.error('❌ Erreur fusion données:', error);
      return false;
    }
  }

  /**
   * Fusionner deux listes d'enquêtes (dernier gagne)
   */
  private static mergeEnquetes(localEnquetes: any[], serverEnquetes: any[]): any[] {
    const merged = new Map();
    
    // Ajouter toutes les enquêtes locales
    localEnquetes.forEach(enquete => {
      merged.set(enquete.id, enquete);
    });
    
    // Fusionner avec les enquêtes du serveur
    serverEnquetes.forEach(serverEnquete => {
      const localEnquete = merged.get(serverEnquete.id);
      
      if (!localEnquete) {
        // Nouvelle enquête du serveur
        merged.set(serverEnquete.id, serverEnquete);
      } else {
        // Comparer les dates de mise à jour si elles existent
        const localDate = new Date(localEnquete.dateMiseAJour || localEnquete.dateCreation || 0);
        const serverDate = new Date(serverEnquete.dateMiseAJour || serverEnquete.dateCreation || 0);
        
        if (serverDate > localDate) {
          // La version serveur est plus récente
          merged.set(serverEnquete.id, serverEnquete);
        }
        // Sinon, garder la version locale
      }
    });
    
    return Array.from(merged.values());
  }

  /**
   * Formater les conflits pour l'affichage
   */
  static formatConflictsMessage(conflicts: SyncConflict[]): string {
    if (conflicts.length === 0) return '';

    let message = '⚠️ Conflits détectés:\n\n';
    
    conflicts.forEach(conflict => {
      message += `📋 Enquête ${conflict.enqueteNumero}:\n`;
      conflict.details.forEach(detail => {
        message += `  • ${detail}\n`;
      });
      message += '\n';
    });
    
    message += 'Voulez-vous écraser la version serveur avec vos modifications ?';
    
    return message;
  }
}
