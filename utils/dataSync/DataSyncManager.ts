// utils/dataSync/DataSyncManager.ts

import { ElectronBridge } from '../electronBridge';
import { DataMergeService } from './DataMergeService';
import {
  SyncData,
  SyncStatus,
  SyncResult,
  SyncMetadata,
  SyncConfig,
  SyncConflict,
  ConflictResolution,
  ConflictAction
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

  // Indique si cette machine est responsable d'une écriture interrompue
  private selfCausedCorruption = false;

  // Clé de la sentinelle d'écriture en cours (détection de corruption)
  private static readonly SENTINEL_KEY = 'sync_write_sentinel';

  private constructor() {
    // Avertir l'utilisateur s'il tente de fermer l'app pendant une sync
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', (e) => {
        if (this.isSync) {
          const msg = 'Une synchronisation est en cours. Fermer maintenant peut corrompre le fichier partagé.';
          e.preventDefault();
          e.returnValue = msg;
          return msg;
        }
      });
    }
  }

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

      // Vérifier si la dernière écriture de cette machine a été interrompue
      await this.checkWriteSentinel();

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

  /**
   * Vérifie si la dernière écriture de cette machine a été interrompue.
   * Si oui, la machine est responsable du fichier corrompu sur le serveur.
   */
  private async checkWriteSentinel(): Promise<void> {
    try {
      const sentinel = await ElectronBridge.getData<{ timestamp: string; user: string } | null>(
        DataSyncManager.SENTINEL_KEY,
        null
      );

      if (sentinel) {
        console.warn(
          `⚠️ DataSync: Écriture interrompue détectée (${sentinel.user} à ${sentinel.timestamp}). ` +
          'Le fichier serveur est peut-être corrompu par cette machine.'
        );
        this.showToast(
          'Attention : la dernière synchronisation a été interrompue. ' +
          'Le fichier partagé sera réparé automatiquement.',
          'error'
        );
        // Marquer pour que performSync puisse décider d'écraser le serveur en cas de corruption
        this.selfCausedCorruption = true;
        // Nettoyer la sentinelle maintenant (elle sera réécrite si on re-push)
        await ElectronBridge.setData(DataSyncManager.SENTINEL_KEY, null);
      }
    } catch {
      // Pas bloquant
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
      // Fichier serveur corrompu
      if (error instanceof Error && error.name === 'ServerCorruptedError') {
        if (this.selfCausedCorruption) {
          // Cette machine est responsable de la corruption (sentinelle trouvée au démarrage)
          // On peut réparer en réécrivant depuis les données locales
          console.warn('⚠️ DataSync: Réparation du fichier serveur (corruption par cette machine)');
          try {
            const localData = await this.getLocalData();
            await this.pushToServer(localData);
            this.lastSuccessfulSync = new Date().toISOString();
            this.handleSyncSuccess();
            this.showToast('Fichier serveur réparé et synchronisé', 'success');
            return {
              success: true,
              timestamp: this.lastSuccessfulSync,
              action: 'first_sync'
            };
          } catch {
            // La réparation a échoué, continuer vers l'erreur générique
          }
        }

        // Un collègue est peut-être responsable, ou la réparation a échoué :
        // on n'écrit rien pour ne pas écraser ses données
        console.warn('⚠️ DataSync: Fichier serveur corrompu, sync annulée sans écriture');
        this.handleSyncFailure();
        this.showToast(
          'Fichier serveur illisible (corrompu ou écriture en cours). ' +
          'Réessayez dans quelques instants.',
          'error'
        );
        return {
          success: false,
          timestamp: new Date().toISOString(),
          action: 'error',
          error: 'Fichier serveur corrompu — aucune donnée écrasée'
        };
      }

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
    const mergedDeletedIds = Array.from(new Set([
      ...(localData.deletedIds || []),
      ...(serverData.deletedIds || [])
    ]));

    // Fusionner les validations d'alertes (union, la plus récente gagne)
    const mergedValidations: Record<string, any> = { ...(serverData.alertValidations || {}) };
    for (const [key, localVal] of Object.entries(localData.alertValidations || {})) {
      if (!mergedValidations[key]) {
        mergedValidations[key] = localVal;
      } else {
        const serverDate = new Date(mergedValidations[key].validatedAt ?? 0).getTime();
        const localDate = new Date(localVal.validatedAt ?? 0).getTime();
        if (localDate > serverDate) mergedValidations[key] = localVal;
      }
    }

    const resolvedData: SyncData = {
      enquetes: [],
      audienceResultats: {},
      customTags: localData.customTags,
      alertRules: localData.alertRules,
      alertValidations: mergedValidations,
      deletedIds: mergedDeletedIds,
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

  // Durée de rétention des IDs supprimés : 90 jours
  // Après ce délai, tous les collègues ont forcément syncé au moins une fois
  private static readonly DELETED_IDS_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

  // Nombre maximum de backups serveur conservés
  private static readonly MAX_SERVER_BACKUPS = 5;

  /** Lit les entrées supprimées depuis le stockage local (format {id, deletedAt}). */
  private async loadDeletedEntries(): Promise<Array<{ id: number; deletedAt: string }>> {
    const raw = await ElectronBridge.getData<Array<{ id: number; deletedAt: string } | number>>(
      'deleted_enquete_ids',
      []
    );
    if (!Array.isArray(raw)) return [];
    // Rétrocompatibilité : anciens enregistrements stockés comme simples nombres
    return raw.map(e => (typeof e === 'number' ? { id: e, deletedAt: new Date(0).toISOString() } : e));
  }

  /** Sauvegarde les IDs supprimés en associant un timestamp et en purgent les entrées trop anciennes. */
  private async saveDeletedEntries(ids: number[]): Promise<void> {
    const pruneThreshold = Date.now() - DataSyncManager.DELETED_IDS_RETENTION_MS;
    const existing = await this.loadDeletedEntries();
    const existingMap = new Map(existing.map(e => [e.id, e.deletedAt]));
    const now = new Date().toISOString();

    const entries = ids
      .map(id => ({ id, deletedAt: existingMap.get(id) ?? now }))
      .filter(e => new Date(e.deletedAt).getTime() > pruneThreshold);

    await ElectronBridge.setData('deleted_enquete_ids', entries);
  }

  private async getLocalData(): Promise<SyncData> {
    const enquetes = await ElectronBridge.getData('enquetes', []);
    const audienceResultats = await ElectronBridge.getData('audience_resultats', {});
    const customTags = await ElectronBridge.getData('customTags', {});
    const alertRules = await ElectronBridge.getData(APP_CONFIG.STORAGE_KEYS.ALERT_RULES, []);
    const alertValidations = await ElectronBridge.getData<Record<string, any>>('alert_validations', {});
    const deletedEntries = await this.loadDeletedEntries();

    return {
      enquetes: Array.isArray(enquetes) ? enquetes : [],
      audienceResultats: audienceResultats || {},
      customTags: customTags || {},
      alertRules: Array.isArray(alertRules) ? alertRules : [],
      alertValidations: alertValidations || {},
      deletedIds: deletedEntries.map(e => e.id),
      version: 1
    };
  }

  private async saveLocalData(data: SyncData): Promise<void> {
    await ElectronBridge.setData('enquetes', data.enquetes);
    await ElectronBridge.setData('audience_resultats', data.audienceResultats);
    await ElectronBridge.setData('customTags', data.customTags);
    await ElectronBridge.setData(APP_CONFIG.STORAGE_KEYS.ALERT_RULES, data.alertRules);
    if (data.alertValidations) {
      // Fusionner avec les validations locales existantes : on ne perd jamais une validation déjà posée
      const localValidations = await ElectronBridge.getData<Record<string, any>>('alert_validations', {});
      const merged = { ...localValidations, ...data.alertValidations };
      await ElectronBridge.setData('alert_validations', merged);
    }
    await this.saveDeletedEntries(data.deletedIds || []);
  }

  private async getServerData(): Promise<{ data: SyncData; metadata: SyncMetadata } | null> {
    if (!window.electronAPI?.dataSync_pull) {
      throw new Error('API dataSync_pull non disponible');
    }

    try {
      return await window.electronAPI.dataSync_pull();
    } catch (error) {
      // Fichier serveur corrompu ou vide (JSON tronqué suite à une écriture interrompue)
      // On relance une erreur identifiable pour que performSync() l'intercepte
      // sans écraser le serveur (risque de perte des données du collègue)
      if (error instanceof Error && (
        error.message.includes('Unexpected end of JSON') ||
        error.message.includes('Erreur lecture serveur')
      )) {
        const corruptedError = new Error('SERVEUR_CORROMPU: ' + error.message);
        corruptedError.name = 'ServerCorruptedError';
        throw corruptedError;
      }
      throw error;
    }
  }

  /**
   * Extrait la date depuis un nom de fichier backup serveur.
   * Format attendu : app-data-backup-2026-03-09T14-30-00.000Z.json
   */
  private extractDateFromServerBackupFilename(filename: string): Date | null {
    const match = filename.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const date = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}`);
    return isNaN(date.getTime()) ? null : date;
  }

  /**
   * Rotation des backups serveur : conserve au plus MAX_SERVER_BACKUPS fichiers.
   * Règle de protection : ne jamais supprimer le backup le plus récent
   * qui date d'un jour calendaire différent d'aujourd'hui.
   */
  private async rotateServerBackups(): Promise<void> {
    try {
      const backups = await this.listServerBackups();
      if (backups.length <= DataSyncManager.MAX_SERVER_BACKUPS) return;

      // Trier du plus récent au plus ancien (le nom contient le timestamp ISO)
      const sorted = [...backups].sort().reverse();

      // Identifier le backup le plus récent venant d'un jour précédent (à protéger)
      const todayStr = new Date().toDateString();
      const newestPreviousDay = sorted.find(filename => {
        const date = this.extractDateFromServerBackupFilename(filename);
        return date !== null && date.toDateString() !== todayStr;
      });

      // Supprimer les backups au-delà de MAX, sans toucher au backup protégé
      const toDelete = sorted.slice(DataSyncManager.MAX_SERVER_BACKUPS);
      for (const filename of toDelete) {
        if (filename === newestPreviousDay) continue; // protégé
        await window.electronAPI?.dataSync_deleteServerBackup?.(filename);
        console.log(`🗑️ DataSync: Backup serveur supprimé (rotation) : ${filename}`);
      }
    } catch (error) {
      console.warn('⚠️ DataSync: Erreur rotation backups serveur:', error);
      // Non-bloquant
    }
  }

  private async pushToServer(data: SyncData): Promise<void> {
    if (!window.electronAPI?.dataSync_push) {
      throw new Error('API dataSync_push non disponible');
    }

    // Créer un backup daté avant d'écraser, puis effectuer la rotation
    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const backupFilename = `app-data-backup-${timestamp}.json`;
      await window.electronAPI?.dataSync_backupServer?.(backupFilename);
      await this.rotateServerBackups();
    } catch {
      // Non-bloquant : le backup est une sécurité, pas une condition à l'écriture
    }

    // Poser la sentinelle AVANT d'écrire : si l'app plante pendant l'écriture,
    // on le saura au prochain démarrage
    await ElectronBridge.setData(DataSyncManager.SENTINEL_KEY, {
      timestamp: new Date().toISOString(),
      user: this.currentUser
    });

    try {
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

      // Écriture réussie : lever la sentinelle
      await ElectronBridge.setData(DataSyncManager.SENTINEL_KEY, null);
      this.selfCausedCorruption = false;
    } catch (error) {
      // La sentinelle reste en place : elle sera détectée au prochain démarrage
      throw error;
    }
  }

  /**
   * Restaure les données depuis un fichier backup présent sur le serveur
   * (ex : app-data-backup-177....xxx.json créé automatiquement avant chaque push).
   * Écrase les données locales ET remet le fichier serveur principal à l'état du backup.
   * À utiliser pour récupérer des données après un écrasement accidentel.
   */
  public async restoreFromServerBackup(backupFilename: string): Promise<boolean> {
    if (this.isSync) {
      console.warn('⚠️ DataSync: Restauration impossible, sync déjà en cours');
      return false;
    }

    const serverAccessible = await this.checkServerAccess();
    if (!serverAccessible) {
      console.error('❌ DataSync: Serveur inaccessible, restauration impossible');
      return false;
    }

    if (!window.electronAPI?.dataSync_readServerBackup) {
      console.error('❌ DataSync: API dataSync_readServerBackup non disponible');
      return false;
    }

    this.isSync = true;
    this.notifyStatusChange();

    try {
      console.warn(`🔄 DataSync: Restauration depuis le backup serveur "${backupFilename}"...`);

      const backupContent = await window.electronAPI.dataSync_readServerBackup(backupFilename);
      if (!backupContent) {
        console.error('❌ DataSync: Fichier backup introuvable ou vide');
        this.showToast('Fichier backup introuvable sur le serveur', 'error');
        return false;
      }

      const backupData = backupContent.data;

      // Sauvegarder localement
      await this.saveLocalData(backupData);
      // Remettre le serveur dans cet état (push avec le backup comme données courantes)
      await this.pushToServer(backupData);

      this.lastSuccessfulSync = new Date().toISOString();
      this.consecutiveFailures = 0;
      this.backoffUntil = null;
      this.showToast(`✅ Données restaurées depuis "${backupFilename}"`, 'success');
      console.log('✅ DataSync: Restauration depuis backup serveur réussie');
      return true;
    } catch (error) {
      console.error('❌ DataSync: Échec de la restauration depuis backup serveur:', error);
      this.showToast('Échec de la restauration depuis le backup serveur', 'error');
      return false;
    } finally {
      this.isSync = false;
      this.notifyStatusChange();
    }
  }

  /**
   * Liste les fichiers backup disponibles sur le serveur.
   */
  public async listServerBackups(): Promise<string[]> {
    if (!window.electronAPI?.dataSync_listServerBackups) {
      return [];
    }
    try {
      return await window.electronAPI.dataSync_listServerBackups();
    } catch {
      return [];
    }
  }

  /**
   * Force l'écriture des données locales sur le serveur, même si le fichier serveur est corrompu.
   * À utiliser uniquement par la machine qui possède la version correcte des données.
   */
  public async repairServerWithLocalData(): Promise<boolean> {
    if (this.isSync) {
      console.warn('⚠️ DataSync: Réparation impossible, sync déjà en cours');
      return false;
    }

    const serverAccessible = await this.checkServerAccess();
    if (!serverAccessible) {
      console.error('❌ DataSync: Serveur inaccessible, réparation impossible');
      return false;
    }

    this.isSync = true;
    this.notifyStatusChange();

    try {
      console.warn('🔧 DataSync: Réparation forcée du serveur avec les données locales...');
      const localData = await this.getLocalData();
      await this.pushToServer(localData);

      this.lastSuccessfulSync = new Date().toISOString();
      this.consecutiveFailures = 0;
      this.backoffUntil = null;
      this.showToast('✅ Serveur réparé avec vos données locales', 'success');
      console.log('✅ DataSync: Serveur réparé avec succès');
      return true;
    } catch (error) {
      console.error('❌ DataSync: Échec de la réparation du serveur:', error);
      this.showToast('Échec de la réparation du serveur', 'error');
      return false;
    } finally {
      this.isSync = false;
      this.notifyStatusChange();
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