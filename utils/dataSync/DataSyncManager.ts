// utils/dataSync/DataSyncManager.ts

import { ElectronBridge } from '../electronBridge';
import { DataMergeService } from './DataMergeService';
import { 
  SyncData, 
  SyncStatus, 
  SyncResult, 
  SyncMetadata,
  SyncConfig,
  ConflictResolution
} from '@/types/dataSyncTypes';
import { APP_CONFIG } from '@/config/constants';

/**
 * Gestionnaire principal de la synchronisation des données
 * 
 * 🆕 FUSION INTELLIGENTE :
 * - Nouveautés automatiques (toasts de confirmation)
 * - Modal uniquement pour VRAIS conflits
 * - Suppressions d'enquête TOUJOURS en modal
 */
export class DataSyncManager {
  private static instance: DataSyncManager;
  
  // État de synchronisation
  private isSync = false;
  private isOnline = false;
  private lastSyncAttempt: string | null = null;
  private lastSuccessfulSync: string | null = null;
  private currentUser = 'Utilisateur Inconnu';
  private computerName = 'Ordinateur Inconnu';
  
  // Gestion des échecs
  private consecutiveFailures = 0;
  private readonly MAX_FAILURES = 3;
  private readonly BACKOFF_TIME = 5 * 60 * 1000; // 5 minutes
  private backoffUntil: Date | null = null;
  
  // Configuration
  private config: SyncConfig = {
    serverPath: 'P:\\TGI\\Parquet\\P17 - STUP - CRIM ORG\\GESTION DE SERVICE\\10_App METIER',
    syncInterval: 5 * 60 * 1000, // 5 minutes
    autoSync: true,
    conflictStrategy: 'ask',
    maxRetries: 3,
    retryDelay: 2000
  };
  
  // Listeners
  private statusListeners: Array<(status: SyncStatus) => void> = [];
  private syncInterval: NodeJS.Timeout | null = null;
  
  // 🆕 Toast callback
  private toastCallback: ((message: string, type: 'success' | 'info' | 'error') => void) | null = null;

  private constructor() {}

  public static getInstance(): DataSyncManager {
    if (!DataSyncManager.instance) {
      DataSyncManager.instance = new DataSyncManager();
    }
    return DataSyncManager.instance;
  }

  /**
   * 🆕 Définit le callback pour afficher les toasts
   */
  public setToastCallback(callback: (message: string, type: 'success' | 'info' | 'error') => void): void {
    this.toastCallback = callback;
  }

  /**
   * 🆕 Affiche un toast
   */
  private showToast(message: string, type: 'success' | 'info' | 'error' = 'info'): void {
    if (this.toastCallback) {
      this.toastCallback(message, type);
    }
  }

  /**
   * Initialise le service de synchronisation
   */
  public async initialize(): Promise<void> {
    if (!ElectronBridge.isAvailable()) {
      console.warn('⚠️ DataSync: Electron API non disponible');
      return;
    }

    try {
      console.log('🚀 DataSync: Initialisation...');
      
      await this.identifyUser();
      await this.checkServerAccess();
      
      if (this.isOnline) {
        console.log('🔄 DataSync: Synchronisation initiale...');
        await this.performSync();
      }
      
      if (this.config.autoSync) {
        this.startAutoSync();
      }
      
      console.log('✅ DataSync: Service initialisé');
      this.notifyStatusChange();
      
    } catch (error) {
      console.error('❌ DataSync: Erreur initialisation:', error);
      this.handleSyncFailure();
    }
  }

  public stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    console.log('🛑 DataSync: Service arrêté');
  }

  private async identifyUser(): Promise<void> {
    try {
      if (window.electronAPI?.getCurrentUser) {
        const userInfo = await window.electronAPI.getCurrentUser();
        this.currentUser = userInfo.displayName;
        this.computerName = userInfo.computerName;
        console.log(`🔐 DataSync: Utilisateur identifié: ${this.currentUser} (${this.computerName})`);
      }
    } catch (error) {
      console.warn('⚠️ DataSync: Impossible d\'identifier l\'utilisateur');
    }
  }

  public async checkServerAccess(): Promise<boolean> {
    try {
      if (!window.electronAPI?.dataSync_checkAccess) {
        this.isOnline = false;
        return false;
      }

      this.isOnline = await window.electronAPI.dataSync_checkAccess();
      
      if (this.isOnline) {
        console.log('🌐 DataSync: Serveur accessible');
      } else {
        console.log('🚫 DataSync: Serveur inaccessible');
      }
      
      this.notifyStatusChange();
      return this.isOnline;
      
    } catch (error) {
      console.error('❌ DataSync: Erreur vérification serveur:', error);
      this.isOnline = false;
      this.notifyStatusChange();
      return false;
    }
  }

  private startAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(async () => {
      if (this.isInBackoff()) {
        console.log('⏸️ DataSync: Sync ignorée (backoff)');
        return;
      }

      if (this.isSync) return;

      if (!this.isOnline) {
        await this.checkServerAccess();
      }

      if (this.isOnline) {
        await this.performSync();
      }
    }, this.config.syncInterval);
  }

  private isInBackoff(): boolean {
    if (!this.backoffUntil) return false;
    
    const now = new Date();
    if (now < this.backoffUntil) {
      return true;
    }
    
    this.backoffUntil = null;
    this.consecutiveFailures = 0;
    return false;
  }

  private handleSyncFailure(): void {
    this.consecutiveFailures++;
    
    if (this.consecutiveFailures >= this.MAX_FAILURES) {
      this.backoffUntil = new Date(Date.now() + this.BACKOFF_TIME);
      console.warn(`⏸️ DataSync: Backoff activé jusqu'à ${this.backoffUntil.toLocaleTimeString()}`);
      this.showToast('Synchronisation temporairement désactivée (erreurs répétées)', 'error');
    }
    
    this.notifyStatusChange();
  }

  private handleSyncSuccess(): void {
    if (this.consecutiveFailures > 0) {
      console.log(`✅ DataSync: Succès après ${this.consecutiveFailures} échec(s)`);
    }
    this.consecutiveFailures = 0;
    this.backoffUntil = null;
    this.notifyStatusChange();
  }

  /**
   * 🆕 FUSION INTELLIGENTE - Effectue une synchronisation complète
   */
  private async performSync(): Promise<SyncResult> {
    this.isSync = true;
    this.lastSyncAttempt = new Date().toISOString();
    this.notifyStatusChange();

    try {
      const localData = await this.getLocalData();
      const serverResponse = await this.getServerData();
      
      // Première sync
      if (!serverResponse) {
        console.log('📤 DataSync: Première synchronisation');
        await this.pushToServer(localData);
        
        this.lastSuccessfulSync = new Date().toISOString();
        this.handleSyncSuccess();
        this.showToast('Données synchronisées avec le serveur', 'success');
        
        return {
          success: true,
          timestamp: this.lastSuccessfulSync,
          action: 'first_sync'
        };
      }

      // 🆕 FUSION INTELLIGENTE
      const { merged, conflicts, stats } = DataMergeService.intelligentMerge(
        localData,
        serverResponse.data
      );

      // Si conflits détectés → modal
      if (conflicts.length > 0) {
        console.warn(`⚠️ DataSync: ${conflicts.length} conflit(s) nécessitent intervention`);
        
        return {
          success: true,
          timestamp: new Date().toISOString(),
          action: 'conflicts_detected',
          conflicts,
          serverData: serverResponse.data,
          localData
        };
      }

      // Fusion automatique réussie
      await this.saveLocalData(merged);
      await this.pushToServer(merged);
      
      this.lastSuccessfulSync = new Date().toISOString();
      this.handleSyncSuccess();

      // 🆕 Toast avec statistiques
      const messages: string[] = [];
      if (stats.newFromServer > 0) {
        messages.push(`${stats.newFromServer} enquête(s) récupérée(s)`);
      }
      if (stats.newFromLocal > 0) {
        messages.push(`${stats.newFromLocal} enquête(s) envoyée(s)`);
      }
      if (stats.merged > 0) {
        messages.push(`${stats.merged} enquête(s) fusionnée(s)`);
      }

      if (messages.length > 0) {
        this.showToast(`✅ Synchronisation : ${messages.join(', ')}`, 'success');
      }
      
      return {
        success: true,
        timestamp: this.lastSuccessfulSync,
        action: 'auto_merged',
        stats
      };

    } catch (error) {
      console.error('❌ DataSync: Erreur synchronisation:', error);
      this.handleSyncFailure();
      
      return {
        success: false,
        timestamp: new Date().toISOString(),
        action: 'error',
        error: error instanceof Error ? error.message : 'Erreur inconnue'
      };
      
    } finally {
      this.isSync = false;
      this.notifyStatusChange();
    }
  }

  /**
   * Déclenche une synchronisation manuelle
   */
  public async triggerSync(): Promise<SyncResult> {
    if (this.isInBackoff()) {
      this.showToast('Service temporairement indisponible', 'error');
      return {
        success: false,
        timestamp: new Date().toISOString(),
        action: 'error',
        error: 'Service temporairement indisponible (trop d\'échecs consécutifs)'
      };
    }

    if (this.isSync) {
      return {
        success: false,
        timestamp: new Date().toISOString(),
        action: 'error',
        error: 'Synchronisation déjà en cours'
      };
    }

    const serverAccessible = await this.checkServerAccess();
    if (!serverAccessible) {
      this.showToast('Serveur commun inaccessible', 'error');
      return {
        success: false,
        timestamp: new Date().toISOString(),
        action: 'error',
        error: 'Serveur commun inaccessible'
      };
    }

    return await this.performSync();
  }

  /**
   * 🆕 Résout les conflits avec sélection individuelle
   */
  public async resolveConflicts(
    conflicts: SyncConflict[],
    selections: Map<number, ConflictAction>,
    localData: SyncData,
    serverData: SyncData
  ): Promise<void> {
    // Construire les données fusionnées en fonction des sélections
    const resolvedData: SyncData = {
      enquetes: [],
      audienceResultats: {},
      customTags: localData.customTags,
      alertRules: localData.alertRules,
      version: Math.max(localData.version || 0, serverData.version || 0) + 1
    };

    // Maps pour faciliter la recherche
    const localEnqueteMap = new Map((localData.enquetes || []).map(e => [e.id, e]));
    const serverEnqueteMap = new Map((serverData.enquetes || []).map(e => [e.id, e]));
    const processedEnqueteIds = new Set<number>();

    // Traiter chaque conflit selon la sélection
    conflicts.forEach((conflict, index) => {
      const action = selections.get(index) || 'merge';
      
      if (conflict.type === 'enquete_modified' || conflict.type === 'enquete_deleted') {
        const enqueteId = conflict.enqueteId!;
        processedEnqueteIds.add(enqueteId);

        switch (action) {
          case 'skip':
            // Ne rien faire avec cette enquête
            break;
            
          case 'keep_local':
            const localEnquete = localEnqueteMap.get(enqueteId);
            if (localEnquete) {
              resolvedData.enquetes.push(localEnquete);
            }
            break;
            
          case 'keep_server':
            const serverEnquete = serverEnqueteMap.get(enqueteId);
            if (serverEnquete) {
              resolvedData.enquetes.push(serverEnquete);
            }
            break;
            
          case 'merge':
            // Fusion intelligente pour cette enquête
            const local = localEnqueteMap.get(enqueteId);
            const server = serverEnqueteMap.get(enqueteId);
            
            if (local && server) {
              const mergeResult = DataMergeService.tryMergeEnquete(local, server);
              resolvedData.enquetes.push(mergeResult.merged || local);
            } else if (local) {
              resolvedData.enquetes.push(local);
            } else if (server) {
              resolvedData.enquetes.push(server);
            }
            break;
        }
      }
      
      // Gérer les résultats d'audience
      if (conflict.type === 'audience_modified' && conflict.enqueteId) {
        const enqueteId = conflict.enqueteId.toString();
        const action = selections.get(index) || 'merge';
        
        switch (action) {
          case 'skip':
            break;
          case 'keep_local':
            if (localData.audienceResultats[enqueteId]) {
              resolvedData.audienceResultats[enqueteId] = localData.audienceResultats[enqueteId];
            }
            break;
          case 'keep_server':
            if (serverData.audienceResultats[enqueteId]) {
              resolvedData.audienceResultats[enqueteId] = serverData.audienceResultats[enqueteId];
            }
            break;
          case 'merge':
            // Pour les résultats d'audience, prendre le local par défaut
            resolvedData.audienceResultats[enqueteId] = 
              localData.audienceResultats[enqueteId] || serverData.audienceResultats[enqueteId];
            break;
        }
      }
    });

    // Ajouter toutes les enquêtes non-conflictuelles
    localData.enquetes?.forEach(enquete => {
      if (!processedEnqueteIds.has(enquete.id)) {
        resolvedData.enquetes.push(enquete);
      }
    });

    serverData.enquetes?.forEach(enquete => {
      if (!processedEnqueteIds.has(enquete.id)) {
        resolvedData.enquetes.push(enquete);
      }
    });

    // Fusionner les résultats d'audience non-conflictuels
    Object.entries(localData.audienceResultats || {}).forEach(([id, result]) => {
      if (!resolvedData.audienceResultats[id]) {
        resolvedData.audienceResultats[id] = result;
      }
    });

    Object.entries(serverData.audienceResultats || {}).forEach(([id, result]) => {
      if (!resolvedData.audienceResultats[id]) {
        resolvedData.audienceResultats[id] = result;
      }
    });

    // Sauvegarder et synchroniser
    await this.saveLocalData(resolvedData);
    await this.pushToServer(resolvedData);
    
    this.lastSuccessfulSync = new Date().toISOString();
    this.handleSyncSuccess();
    
    const mergedCount = Array.from(selections.values()).filter(a => a === 'merge').length;
    this.showToast(`✅ ${mergedCount} conflit(s) résolu(s)`, 'success');
  }

  /**
   * @deprecated Utilisez resolveConflicts() à la place
   */
  public async resolveConflict(
    resolution: ConflictResolution,
    localData: SyncData,
    serverData: SyncData
  ): Promise<void> {
    let resolvedData: SyncData;

    switch (resolution) {
      case 'keep_local':
        resolvedData = DataMergeService.resolveKeepLocal(localData, serverData);
        break;
        
      case 'keep_server':
        resolvedData = DataMergeService.resolveKeepServer(localData, serverData);
        break;
        
      case 'merge':
        const { merged } = DataMergeService.intelligentMerge(localData, serverData);
        resolvedData = merged;
        break;
        
      default:
        throw new Error('Stratégie de résolution invalide');
    }

    await this.saveLocalData(resolvedData);
    await this.pushToServer(resolvedData);
    
    this.lastSuccessfulSync = new Date().toISOString();
    this.handleSyncSuccess();
    this.showToast('Conflit résolu avec succès', 'success');
  }

  private async getLocalData(): Promise<SyncData> {
    const enquetes = await ElectronBridge.getData('enquetes', []);
    const audienceResultats = await ElectronBridge.getData('audience_resultats', {});
    const customTags = await ElectronBridge.getData('customTags', {});
    const alertRules = await ElectronBridge.getData(APP_CONFIG.STORAGE_KEYS.ALERT_RULES, []);

    return {
      enquetes: Array.isArray(enquetes) ? enquetes : [],
      audienceResultats: audienceResultats || {},
      customTags: customTags || {},
      alertRules: Array.isArray(alertRules) ? alertRules : [],
      version: 1
    };
  }

  private async saveLocalData(data: SyncData): Promise<void> {
    await ElectronBridge.setData('enquetes', data.enquetes);
    await ElectronBridge.setData('audience_resultats', data.audienceResultats);
    await ElectronBridge.setData('customTags', data.customTags);
    await ElectronBridge.setData(APP_CONFIG.STORAGE_KEYS.ALERT_RULES, data.alertRules);
  }

  private async getServerData(): Promise<{ data: SyncData; metadata: SyncMetadata } | null> {
    if (!window.electronAPI?.dataSync_pull) {
      throw new Error('API dataSync_pull non disponible');
    }

    return await window.electronAPI.dataSync_pull();
  }

  private async pushToServer(data: SyncData): Promise<void> {
    if (!window.electronAPI?.dataSync_push) {
      throw new Error('API dataSync_push non disponible');
    }

    const metadata: SyncMetadata = {
      lastModified: new Date().toISOString(),
      modifiedBy: this.currentUser,
      computerName: this.computerName,
      version: data.version
    };

    const success = await window.electronAPI.dataSync_push(data, metadata);
    
    if (!success) {
      throw new Error('Échec envoi vers serveur');
    }
  }

  public getStatus(): SyncStatus {
    return {
      isOnline: this.isOnline && !this.isInBackoff(),
      isSync: this.isSync,
      lastSyncAttempt: this.lastSyncAttempt,
      lastSuccessfulSync: this.lastSuccessfulSync,
      currentUser: this.currentUser
    };
  }

  public addStatusListener(listener: (status: SyncStatus) => void): void {
    this.statusListeners.push(listener);
  }

  public removeStatusListener(listener: (status: SyncStatus) => void): void {
    const index = this.statusListeners.indexOf(listener);
    if (index > -1) {
      this.statusListeners.splice(index, 1);
    }
  }

  private notifyStatusChange(): void {
    const status = this.getStatus();
    this.statusListeners.forEach(listener => {
      try {
        listener(status);
      } catch (error) {
        console.error('DataSync: Erreur listener:', error);
      }
    });
  }
}

export const dataSyncManager = DataSyncManager.getInstance();