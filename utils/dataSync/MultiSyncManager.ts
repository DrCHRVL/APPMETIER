// utils/dataSync/MultiSyncManager.ts
//
// Orchestrateur de synchronisation multi-contentieux.
// Instancie un ContentieuxSyncInstance par contentieux accessible,
// chaque instance pointant vers son propre dossier serveur.
// Les instances read_only ne pushent jamais vers le serveur.

import { DataMergeService } from './DataMergeService';
import { ElectronBridge } from '../electronBridge';
import { ContentieuxManager } from '../contentieuxManager';
import {
  SyncData,
  SyncStatus,
  SyncResult,
  SyncMetadata,
  SyncConflict,
  ConflictAction,
} from '@/types/dataSyncTypes';
import { ContentieuxId, ContentieuxDefinition } from '@/types/userTypes';
import { APP_CONFIG } from '@/config/constants';

// ──────────────────────────────────────────────
// INSTANCE DE SYNC PAR CONTENTIEUX
// ──────────────────────────────────────────────

/**
 * Instance de synchronisation pour un seul contentieux.
 * Non-singleton : on en crée une par contentieux accessible.
 */
class ContentieuxSyncInstance {
  private isSync = false;
  private isOnline = false;
  private lastSyncAttempt: string | null = null;
  private lastSuccessfulSync: string | null = null;
  private currentUser = 'Utilisateur Inconnu';
  private computerName = 'Ordinateur Inconnu';

  private consecutiveFailures = 0;
  private readonly MAX_FAILURES = 3;
  private readonly BACKOFF_TIME = 5 * 60 * 1000;
  private backoffUntil: Date | null = null;

  private syncInterval: NodeJS.Timeout | null = null;
  private postSaveDebounceTimer: NodeJS.Timeout | null = null;
  private readonly POST_SAVE_DEBOUNCE_MS = 5000;
  private readonly SYNC_INTERVAL_MS = 30 * 1000;

  private statusListeners: Array<(contentieuxId: ContentieuxId, status: SyncStatus) => void> = [];
  private toastCallback: ((message: string, type: 'success' | 'info' | 'error') => void) | null = null;

  constructor(
    public readonly contentieuxId: ContentieuxId,
    public readonly definition: ContentieuxDefinition,
    public readonly syncMode: 'read_write' | 'read_only'
  ) {}

  // ──────────── LIFECYCLE ────────────

  public async initialize(): Promise<void> {
    if (!ElectronBridge.isAvailable()) return;

    try {
      await this.identifyUser();
      await this.checkServerAccess();

      if (this.isOnline) {
        await this.performSync();
      }

      this.startAutoSync();
    } catch (error) {
      console.error(`❌ Sync[${this.contentieuxId}]: Erreur initialisation:`, error);
      this.handleSyncFailure();
    }
  }

  public stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    if (this.postSaveDebounceTimer) {
      clearTimeout(this.postSaveDebounceTimer);
      this.postSaveDebounceTimer = null;
    }
  }

  public setToastCallback(cb: (message: string, type: 'success' | 'info' | 'error') => void): void {
    this.toastCallback = cb;
  }

  public addStatusListener(listener: (contentieuxId: ContentieuxId, status: SyncStatus) => void): void {
    this.statusListeners.push(listener);
  }

  public removeStatusListener(listener: (contentieuxId: ContentieuxId, status: SyncStatus) => void): void {
    this.statusListeners = this.statusListeners.filter(l => l !== listener);
  }

  // ──────────── SYNC TRIGGER ────────────

  public triggerPostSaveSync(): void {
    if (this.syncMode === 'read_only') return;
    if (this.postSaveDebounceTimer) clearTimeout(this.postSaveDebounceTimer);
    this.postSaveDebounceTimer = setTimeout(async () => {
      this.postSaveDebounceTimer = null;
      if (!this.isOnline || this.isSync || this.isInBackoff()) return;
      await this.performSync();
    }, this.POST_SAVE_DEBOUNCE_MS);
  }

  public async triggerSync(): Promise<SyncResult> {
    if (this.isInBackoff() || this.isSync) {
      return { success: false, timestamp: new Date().toISOString(), action: 'error', error: 'Sync indisponible' };
    }
    const online = await this.checkServerAccess();
    if (!online) {
      return { success: false, timestamp: new Date().toISOString(), action: 'error', error: 'Serveur inaccessible' };
    }
    return this.performSync();
  }

  public getStatus(): SyncStatus {
    return {
      isOnline: this.isOnline && !this.isInBackoff(),
      isSync: this.isSync,
      lastSyncAttempt: this.lastSyncAttempt,
      lastSuccessfulSync: this.lastSuccessfulSync,
      currentUser: this.currentUser,
    };
  }

  public getIsSync(): boolean { return this.isSync; }

  // ──────────── CORE SYNC ────────────

  private async performSync(): Promise<SyncResult> {
    this.isSync = true;
    this.lastSyncAttempt = new Date().toISOString();
    this.notifyStatus();

    try {
      const localData = await this.getLocalData();
      const serverResponse = await this.getServerData();

      // Première sync
      if (!serverResponse) {
        if (this.syncMode === 'read_write') {
          await this.pushToServer(localData);
        }
        this.lastSuccessfulSync = new Date().toISOString();
        this.handleSyncSuccess();
        return { success: true, timestamp: this.lastSuccessfulSync, action: 'first_sync' };
      }

      const { merged, conflicts, stats, hasLocalChanges, hasServerChanges } =
        DataMergeService.intelligentMerge(localData, serverResponse.data);

      if (conflicts.length > 0) {
        return {
          success: true,
          timestamp: new Date().toISOString(),
          action: 'conflicts_detected',
          conflicts,
          serverData: serverResponse.data,
          localData,
        };
      }

      if (!hasLocalChanges && !hasServerChanges) {
        this.lastSuccessfulSync = new Date().toISOString();
        this.handleSyncSuccess();
        return { success: true, timestamp: this.lastSuccessfulSync, action: 'no_conflicts', stats };
      }

      // Écrire local si le serveur a des nouveautés
      if (hasServerChanges) {
        await this.saveLocalData(merged);
      }

      // Push seulement si read_write et si le local a changé
      if (hasLocalChanges && this.syncMode === 'read_write') {
        await this.pushToServer(merged);
      }

      this.lastSuccessfulSync = new Date().toISOString();
      this.handleSyncSuccess();

      // Toast
      const messages: string[] = [];
      if (stats.newFromServer > 0) messages.push(`${stats.newFromServer} récupérée(s)`);
      if (stats.newFromLocal > 0) messages.push(`${stats.newFromLocal} envoyée(s)`);
      if (stats.merged > 0) messages.push(`${stats.merged} fusionnée(s)`);
      if (messages.length > 0) {
        this.showToast(`[${this.definition.label}] Sync : ${messages.join(', ')}`, 'success');
      }

      return { success: true, timestamp: this.lastSuccessfulSync, action: 'auto_merged', stats };
    } catch (error) {
      console.error(`❌ Sync[${this.contentieuxId}]:`, error);
      this.handleSyncFailure();
      return {
        success: false,
        timestamp: new Date().toISOString(),
        action: 'error',
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    } finally {
      this.isSync = false;
      this.notifyStatus();
    }
  }

  // ──────────── DATA I/O ────────────

  private prefix(key: string): string {
    return `ctx_${this.contentieuxId}_${key}`;
  }

  private async getLocalData(): Promise<SyncData> {
    const enquetes = await ElectronBridge.getData(this.prefix('enquetes'), []);
    const audienceResultats = await ElectronBridge.getData(this.prefix('audienceResultats'), {});
    const customTags = await ElectronBridge.getData(this.prefix('customTags'), {});
    const alertRules = await ElectronBridge.getData(this.prefix('alertRules'), []);
    const alertValidations = await ElectronBridge.getData(this.prefix('alertValidations'), {});

    return {
      enquetes: Array.isArray(enquetes) ? enquetes : [],
      audienceResultats: audienceResultats || {},
      customTags: customTags || {},
      alertRules: Array.isArray(alertRules) ? alertRules : [],
      alertValidations: alertValidations || {},
      version: 1,
    };
  }

  private async saveLocalData(data: SyncData): Promise<void> {
    await ElectronBridge.setData(this.prefix('enquetes'), data.enquetes);
    await ElectronBridge.setData(this.prefix('audienceResultats'), data.audienceResultats);
    await ElectronBridge.setData(this.prefix('customTags'), data.customTags);
    await ElectronBridge.setData(this.prefix('alertRules'), data.alertRules);
    if (data.alertValidations) {
      const local = await ElectronBridge.getData(this.prefix('alertValidations'), {});
      await ElectronBridge.setData(this.prefix('alertValidations'), { ...local, ...data.alertValidations });
    }

    // Mettre à jour le ContentieuxManager
    ContentieuxManager.getInstance().replaceData(this.contentieuxId, {
      enquetes: data.enquetes,
      customTags: data.customTags,
      alertRules: data.alertRules,
      alertValidations: data.alertValidations || {},
      audienceResultats: data.audienceResultats,
    });
  }

  private async getServerData(): Promise<{ data: SyncData; metadata: SyncMetadata } | null> {
    if (!(window as any).electronAPI?.dataSync_pullContentieux) {
      throw new Error('API dataSync_pullContentieux non disponible');
    }
    try {
      return await (window as any).electronAPI.dataSync_pullContentieux(this.contentieuxId);
    } catch (error) {
      if (error instanceof Error && (
        error.message.includes('Unexpected end of JSON') ||
        error.message.includes('Unexpected token') ||
        error.message.includes('is not valid JSON')
      )) {
        console.error(`❌ Sync[${this.contentieuxId}]: Fichier serveur corrompu`);
        this.showToast(`[${this.definition.label}] Fichier serveur corrompu`, 'error');
      }
      throw error;
    }
  }

  private async pushToServer(data: SyncData): Promise<void> {
    if (!(window as any).electronAPI?.dataSync_pushContentieux) {
      throw new Error('API dataSync_pushContentieux non disponible');
    }

    // Backup avant push
    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const backupFilename = `${this.contentieuxId}-backup-${timestamp}.json`;
      await (window as any).electronAPI?.dataSync_backupContentieux?.(this.contentieuxId, backupFilename);
    } catch {
      // Non-bloquant
    }

    const metadata: SyncMetadata = {
      lastModified: new Date().toISOString(),
      modifiedBy: this.currentUser,
      computerName: this.computerName,
      version: data.version,
    };

    const success = await (window as any).electronAPI.dataSync_pushContentieux(this.contentieuxId, data, metadata);
    if (!success) throw new Error('Échec envoi vers serveur');
  }

  // ──────────── UTILITIES ────────────

  private async identifyUser(): Promise<void> {
    try {
      if ((window as any).electronAPI?.getCurrentUser) {
        const info = await (window as any).electronAPI.getCurrentUser();
        this.currentUser = info.displayName;
        this.computerName = info.computerName;
      }
    } catch {}
  }

  private async checkServerAccess(): Promise<boolean> {
    try {
      if (!(window as any).electronAPI?.dataSync_checkContentieuxAccess) {
        this.isOnline = false;
        return false;
      }
      this.isOnline = await (window as any).electronAPI.dataSync_checkContentieuxAccess(this.contentieuxId);
      this.notifyStatus();
      return this.isOnline;
    } catch {
      this.isOnline = false;
      this.notifyStatus();
      return false;
    }
  }

  private startAutoSync(): void {
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.syncInterval = setInterval(async () => {
      if (this.isInBackoff() || this.isSync) return;
      if (!this.isOnline) await this.checkServerAccess();
      if (this.isOnline) await this.performSync();
    }, this.SYNC_INTERVAL_MS);
  }

  private isInBackoff(): boolean {
    if (!this.backoffUntil) return false;
    if (new Date() < this.backoffUntil) return true;
    this.backoffUntil = null;
    this.consecutiveFailures = 0;
    return false;
  }

  private handleSyncFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.MAX_FAILURES) {
      this.backoffUntil = new Date(Date.now() + this.BACKOFF_TIME);
    }
    this.notifyStatus();
  }

  private handleSyncSuccess(): void {
    this.consecutiveFailures = 0;
    this.backoffUntil = null;
    this.notifyStatus();
  }

  private showToast(message: string, type: 'success' | 'info' | 'error'): void {
    this.toastCallback?.(message, type);
  }

  private notifyStatus(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      try { listener(this.contentieuxId, status); } catch {}
    }
  }
}

// ──────────────────────────────────────────────
// MULTI SYNC MANAGER
// ──────────────────────────────────────────────

/**
 * Orchestre la synchronisation de tous les contentieux accessibles.
 * Singleton qui gère N ContentieuxSyncInstance.
 */
export class MultiSyncManager {
  private static instance: MultiSyncManager;
  private instances = new Map<ContentieuxId, ContentieuxSyncInstance>();
  private toastCallback: ((message: string, type: 'success' | 'info' | 'error') => void) | null = null;

  private constructor() {}

  public static getInstance(): MultiSyncManager {
    if (!MultiSyncManager.instance) {
      MultiSyncManager.instance = new MultiSyncManager();
    }
    return MultiSyncManager.instance;
  }

  /**
   * Initialise toutes les instances de sync.
   * Appelé après que le UserManager et ContentieuxManager sont prêts.
   */
  public async initialize(
    definitions: ContentieuxDefinition[],
    accessibleIds: ContentieuxId[],
    syncModes: Map<ContentieuxId, 'read_write' | 'read_only'>
  ): Promise<void> {
    // Arrêter les instances précédentes
    this.stopAll();

    for (const def of definitions) {
      if (!accessibleIds.includes(def.id)) continue;
      const mode = syncModes.get(def.id) || 'read_only';

      const instance = new ContentieuxSyncInstance(def.id, def, mode);
      if (this.toastCallback) instance.setToastCallback(this.toastCallback);

      this.instances.set(def.id, instance);
    }

    // Initialiser toutes les instances en parallèle
    await Promise.allSettled(
      Array.from(this.instances.values()).map(inst => inst.initialize())
    );
  }

  public stopAll(): void {
    for (const instance of this.instances.values()) {
      instance.stop();
    }
    this.instances.clear();
  }

  public setToastCallback(cb: (message: string, type: 'success' | 'info' | 'error') => void): void {
    this.toastCallback = cb;
    for (const instance of this.instances.values()) {
      instance.setToastCallback(cb);
    }
  }

  /** Déclenche un post-save sync pour un contentieux spécifique */
  public triggerPostSaveSync(contentieuxId: ContentieuxId): void {
    this.instances.get(contentieuxId)?.triggerPostSaveSync();
  }

  /** Déclenche un sync manuel pour un contentieux spécifique */
  public async triggerSync(contentieuxId: ContentieuxId): Promise<SyncResult> {
    const inst = this.instances.get(contentieuxId);
    if (!inst) {
      return { success: false, timestamp: new Date().toISOString(), action: 'error', error: 'Contentieux non chargé' };
    }
    return inst.triggerSync();
  }

  /** Déclenche un sync manuel pour tous les contentieux */
  public async triggerSyncAll(): Promise<Map<ContentieuxId, SyncResult>> {
    const results = new Map<ContentieuxId, SyncResult>();
    await Promise.allSettled(
      Array.from(this.instances.entries()).map(async ([id, inst]) => {
        results.set(id, await inst.triggerSync());
      })
    );
    return results;
  }

  /** Retourne le statut de sync d'un contentieux */
  public getStatus(contentieuxId: ContentieuxId): SyncStatus | null {
    return this.instances.get(contentieuxId)?.getStatus() || null;
  }

  /** Vérifie si au moins une sync est en cours */
  public isAnySyncing(): boolean {
    for (const inst of this.instances.values()) {
      if (inst.getIsSync()) return true;
    }
    return false;
  }

  /** Ajoute un listener de statut sur tous les contentieux */
  public addStatusListener(listener: (contentieuxId: ContentieuxId, status: SyncStatus) => void): void {
    for (const inst of this.instances.values()) {
      inst.addStatusListener(listener);
    }
  }

  public removeStatusListener(listener: (contentieuxId: ContentieuxId, status: SyncStatus) => void): void {
    for (const inst of this.instances.values()) {
      inst.removeStatusListener(listener);
    }
  }
}
