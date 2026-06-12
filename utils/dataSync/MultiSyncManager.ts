// utils/dataSync/MultiSyncManager.ts
//
// Orchestrateur de synchronisation multi-contentieux.
// Instancie un ContentieuxSyncInstance par contentieux accessible,
// chaque instance pointant vers son propre dossier serveur.
// Les instances read_only ne pushent jamais vers le serveur.

import { DataMergeService } from './DataMergeService';
import { ElectronBridge } from '../electronBridge';
import { ContentieuxManager } from '../contentieuxManager';
import { tagSyncService } from './TagSyncService';
import { audienceSyncService } from './AudienceSyncService';
import { alertSyncService } from './AlertSyncService';
import { deletedIdsSyncService } from './DeletedIdsSyncService';
import { contentieuxAlertsSyncService } from './ContentieuxAlertsSyncService';
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

  // Sentinelle anti-crash : posée avant chaque écriture serveur, levée après.
  // Si elle subsiste au démarrage, la dernière écriture de cette machine a été
  // interrompue → le fichier serveur de ce contentieux est peut-être corrompu
  // par cette machine, qui devient responsable de sa réparation.
  private selfCausedCorruption = false;

  private consecutiveFailures = 0;
  private readonly MAX_FAILURES = 3;
  private readonly BACKOFF_TIME = 5 * 60 * 1000;
  private backoffUntil: Date | null = null;

  private syncInterval: NodeJS.Timeout | null = null;
  private postSaveDebounceTimer: NodeJS.Timeout | null = null;
  private readonly POST_SAVE_DEBOUNCE_MS = 5000;
  private readonly SYNC_INTERVAL_MS = 120 * 1000;

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
      await this.checkWriteSentinel();
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
    // Deux onglets SIRAL ouverts = deux boucles de sync concurrentes sur les
    // mêmes coffres. Le verrou navigateur sérialise les cycles entre onglets.
    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
      return (navigator as Navigator & { locks: LockManager }).locks.request(
        `siral-sync-${this.contentieuxId}`,
        () => this.performSyncInner(),
      ) as Promise<SyncResult>;
    }
    return this.performSyncInner();
  }

  private async performSyncInner(): Promise<SyncResult> {
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
      const msg = error instanceof Error ? error.message : '';
      const serverCorrupted =
        msg.includes('JSON') || msg.includes('Unexpected token') || msg.includes('Unexpected end');

      // Si le fichier serveur est illisible ET que cette machine est responsable
      // (sentinelle d'écriture interrompue), on le répare avec les données locales.
      // Sinon, on n'écrit rien pour ne pas écraser les données d'un collègue.
      if (serverCorrupted && this.selfCausedCorruption && this.syncMode === 'read_write') {
        try {
          const localData = await this.getLocalData();
          await this.pushToServer(localData);
          this.selfCausedCorruption = false;
          this.lastSuccessfulSync = new Date().toISOString();
          this.handleSyncSuccess();
          this.showToast(`[${this.definition.label}] Fichier serveur réparé et synchronisé`, 'success');
          return { success: true, timestamp: this.lastSuccessfulSync, action: 'first_sync' };
        } catch {
          // Réparation échouée : ne pas réessayer d'écraser à l'aveugle
          this.selfCausedCorruption = false;
        }
      }

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
    // Les tombstones (deleted_*_ids) sont stockés en clés globales, gérés par
    // DeletedIdsSyncService qui les maintient synchronisés avec deleted-ids.json.
    // On les relit ici pour que DataMergeService.mergeEnquetes puisse filtrer
    // correctement les éléments supprimés (anti-résurrection).
    const [
      enquetes,
      audienceResultats,
      customTags,
      alertRules,
      alertValidations,
      deletedEnq,
      deletedActe,
      deletedCR,
      deletedMEC,
    ] = await Promise.all([
      ElectronBridge.getData(this.prefix('enquetes'), []),
      ElectronBridge.getData(this.prefix('audienceResultats'), {}),
      ElectronBridge.getData(this.prefix('customTags'), []),
      ElectronBridge.getData(this.prefix('alertRules'), []),
      ElectronBridge.getData(this.prefix('alertValidations'), {}),
      ElectronBridge.getData<Array<{ id: number }>>('deleted_ids', []),
      ElectronBridge.getData<Array<{ id: number }>>('deleted_acte_ids', []),
      ElectronBridge.getData<Array<{ id: number }>>('deleted_cr_ids', []),
      ElectronBridge.getData<Array<{ id: number }>>('deleted_mec_ids', []),
    ]);

    const toIds = (entries: unknown): number[] =>
      Array.isArray(entries)
        ? (entries as Array<{ id: number }>).map(e => e?.id).filter((n): n is number => typeof n === 'number')
        : [];

    return {
      enquetes: Array.isArray(enquetes) ? enquetes : [],
      audienceResultats: audienceResultats || {},
      customTags: Array.isArray(customTags) ? customTags : [],
      alertRules: Array.isArray(alertRules) ? alertRules : [],
      alertValidations: alertValidations || {},
      deletedIds:     toIds(deletedEnq),
      deletedActeIds: toIds(deletedActe),
      deletedCRIds:   toIds(deletedCR),
      deletedMECIds:  toIds(deletedMEC),
      version: 1,
    };
  }

  private async saveLocalData(data: SyncData): Promise<void> {
    const saveOps = [
      ElectronBridge.setData(this.prefix('enquetes'), data.enquetes),
      ElectronBridge.setData(this.prefix('audienceResultats'), data.audienceResultats),
      ElectronBridge.setData(this.prefix('customTags'), data.customTags),
      ElectronBridge.setData(this.prefix('alertRules'), data.alertRules),
    ];

    if (data.alertValidations) {
      const local = await ElectronBridge.getData(this.prefix('alertValidations'), {});
      saveOps.push(ElectronBridge.setData(this.prefix('alertValidations'), { ...local, ...data.alertValidations }));
    }

    await Promise.all(saveOps);

    // Propager les tombstones fraîchement fusionnés vers les clés globales
    // pour que les prochaines fusions per-contentieux en tiennent compte
    // immédiatement, sans attendre le prochain DeletedIdsSyncService.
    await this.mergeTombstonesToLocal('deleted_ids',      data.deletedIds);
    await this.mergeTombstonesToLocal('deleted_acte_ids', data.deletedActeIds);
    await this.mergeTombstonesToLocal('deleted_cr_ids',   data.deletedCRIds);
    await this.mergeTombstonesToLocal('deleted_mec_ids',  data.deletedMECIds);

    // Mettre à jour le ContentieuxManager
    ContentieuxManager.getInstance().replaceData(this.contentieuxId, {
      enquetes: data.enquetes,
      customTags: data.customTags,
      alertRules: data.alertRules,
      alertValidations: data.alertValidations || {},
      audienceResultats: data.audienceResultats,
    });
  }

  /** Union locale + IDs fournis par le merge, en conservant la date la plus
   *  récente. L'appel est non bloquant si `ids` est vide/undefined. */
  private async mergeTombstonesToLocal(key: string, ids: number[] | undefined): Promise<void> {
    if (!ids || ids.length === 0) return;
    const existing = await ElectronBridge.getData<Array<{ id: number; deletedAt: string }>>(key, []);
    const arr = Array.isArray(existing) ? existing : [];
    const byId = new Map<number, { id: number; deletedAt: string }>();
    for (const t of arr) if (t && typeof t.id === 'number') byId.set(t.id, t);
    const now = new Date().toISOString();
    for (const id of ids) {
      if (!byId.has(id)) byId.set(id, { id, deletedAt: now });
    }
    if (byId.size !== arr.length) {
      await ElectronBridge.setData(key, Array.from(byId.values()));
    }
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

    // Poser la sentinelle AVANT d'écrire : si l'app plante pendant l'écriture,
    // on le détectera au prochain démarrage (checkWriteSentinel).
    await ElectronBridge.setData(this.sentinelKey(), {
      timestamp: new Date().toISOString(),
      user: this.currentUser,
    });

    const success = await (window as any).electronAPI.dataSync_pushContentieux(this.contentieuxId, data, metadata);
    if (!success) throw new Error('Échec envoi vers serveur');

    // Écriture réussie : lever la sentinelle.
    await ElectronBridge.setData(this.sentinelKey(), null);
    this.selfCausedCorruption = false;
  }

  private sentinelKey(): string {
    return `ctx_${this.contentieuxId}_sync_write_sentinel`;
  }

  private async checkWriteSentinel(): Promise<void> {
    try {
      const sentinel = await ElectronBridge.getData<{ timestamp: string; user: string } | null>(
        this.sentinelKey(),
        null
      );
      if (sentinel) {
        this.selfCausedCorruption = true;
        this.showToast(
          `[${this.definition.label}] La dernière synchronisation a été interrompue. ` +
          'Le fichier partagé sera réparé automatiquement si nécessaire.',
          'error'
        );
        // Nettoyer maintenant (réécrite si on re-push)
        await ElectronBridge.setData(this.sentinelKey(), null);
      }
    } catch {
      // Non bloquant
    }
  }

  // ──────────── CONFLITS & RÉCUPÉRATION ────────────

  /** Résout les conflits avec les décisions de l'utilisateur (mirroring de l'ancien
   *  DataSyncManager mais sur le fichier app-data.json de ce contentieux). */
  public async resolveConflicts(
    conflicts: SyncConflict[],
    selections: Map<number, ConflictAction>,
    localData: SyncData,
    serverData: SyncData
  ): Promise<void> {
    this.isSync = true;
    this.notifyStatus();
    try {
      const { merged: resolvedData } = DataMergeService.intelligentMerge(localData, serverData);

      conflicts.forEach((conflict, index) => {
        const action = selections.get(index) || 'merge';
        if (conflict.type === 'enquete_deleted' && conflict.enqueteId) {
          const enqueteId = conflict.enqueteId;
          if (action === 'keep_server' || action === 'skip') {
            resolvedData.enquetes = resolvedData.enquetes.filter(e => e.id !== enqueteId);
          }
        }
      });

      await this.saveLocalData(resolvedData);
      if (this.syncMode === 'read_write') {
        await this.pushToServer(resolvedData);
      }

      this.lastSuccessfulSync = new Date().toISOString();
      this.handleSyncSuccess();
      this.showToast(`[${this.definition.label}] ${conflicts.length} conflit(s) résolu(s)`, 'success');
    } finally {
      this.isSync = false;
      this.notifyStatus();
    }
  }

  /** Liste les fichiers backup de ce contentieux (<contentieux>/backups/). */
  public async listBackups(): Promise<string[]> {
    const api = (window as any).electronAPI;
    if (!api?.dataSync_listContentieuxBackups) return [];
    try {
      return await api.dataSync_listContentieuxBackups(this.contentieuxId);
    } catch {
      return [];
    }
  }

  /** Restaure ce contentieux depuis un de ses backups (écrase local + serveur). */
  public async restoreFromBackup(filename: string): Promise<boolean> {
    if (this.isSync) return false;
    const online = await this.checkServerAccess();
    if (!online) return false;
    const api = (window as any).electronAPI;
    if (!api?.dataSync_readContentieuxBackup) return false;

    this.isSync = true;
    this.notifyStatus();
    try {
      const backup = await api.dataSync_readContentieuxBackup(this.contentieuxId, filename);
      if (!backup) return false;
      const data: SyncData = backup.data || backup;
      await this.saveLocalData(data);
      if (this.syncMode === 'read_write') {
        await this.pushToServer(data);
      }
      this.lastSuccessfulSync = new Date().toISOString();
      this.handleSyncSuccess();
      this.showToast(`[${this.definition.label}] Données restaurées depuis "${filename}"`, 'success');
      return true;
    } catch (error) {
      console.error(`❌ Sync[${this.contentieuxId}]: Échec restauration backup:`, error);
      return false;
    } finally {
      this.isSync = false;
      this.notifyStatus();
    }
  }

  /** Force l'écriture des données locales sur le serveur (réparation manuelle). */
  public async repairWithLocalData(): Promise<boolean> {
    if (this.isSync) return false;
    if (this.syncMode !== 'read_write') return false;
    const online = await this.checkServerAccess();
    if (!online) return false;

    this.isSync = true;
    this.notifyStatus();
    try {
      const localData = await this.getLocalData();
      await this.pushToServer(localData);
      this.selfCausedCorruption = false;
      this.lastSuccessfulSync = new Date().toISOString();
      this.handleSyncSuccess();
      this.showToast(`[${this.definition.label}] Serveur réparé avec vos données locales`, 'success');
      return true;
    } catch (error) {
      console.error(`❌ Sync[${this.contentieuxId}]: Échec réparation serveur:`, error);
      return false;
    } finally {
      this.isSync = false;
      this.notifyStatus();
    }
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

    // Avant de lancer les sync per-contentieux, on tire les tombstones
    // globaux depuis deleted-ids.json. Indispensable pour que le premier
    // cycle per-contentieux voie les suppressions faites par d'autres postes
    // et ne ressuscite pas les éléments correspondants.
    try {
      await deletedIdsSyncService.sync();
    } catch {}

    // Initialiser les instances de sync avec un délai progressif entre chaque
    // pour éviter un pic de charge I/O au démarrage ou au retour d'app
    const instances = Array.from(this.instances.values());
    for (let i = 0; i < instances.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 1500));
      try { await instances[i].initialize(); } catch {}
    }

    // Démarrer les autres pipelines globaux (tag-data.json, audience-data.json,
    // alerts-data.json legacy, et contentieux-alerts/{id}.json par contentieux).
    // Chaque service a son propre fichier serveur, sa propre fusion et son
    // propre timer. alertSyncService reste pour le seed legacy → laissé en
    // arrière-plan, sera retiré quand tous les postes auront migré.
    try {
      await Promise.allSettled([
        tagSyncService.sync(),
        audienceSyncService.sync(),
        alertSyncService.sync(),
        ...accessibleIds.map(id => contentieuxAlertsSyncService.sync(id)),
      ]);
    } catch {}
    tagSyncService.startPeriodic();
    audienceSyncService.startPeriodic();
    alertSyncService.startPeriodic();
    deletedIdsSyncService.startPeriodic();
    for (const id of accessibleIds) {
      contentieuxAlertsSyncService.startPeriodic(id);
    }
  }

  public stopAll(): void {
    for (const id of this.instances.keys()) {
      contentieuxAlertsSyncService.stopPeriodic(id);
    }
    for (const instance of this.instances.values()) {
      instance.stop();
    }
    this.instances.clear();
    tagSyncService.stopPeriodic();
    audienceSyncService.stopPeriodic();
    alertSyncService.stopPeriodic();
    deletedIdsSyncService.stopPeriodic();
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

  /**
   * Statut consolidé de tous les contentieux, pour l'indicateur global du bandeau.
   * - online si au moins un contentieux est joignable
   * - sync en cours si au moins un contentieux synchronise
   * - dates : la plus récente parmi tous les contentieux
   * Retourne null tant qu'aucune instance n'existe (affiche « Initialisation… »).
   */
  public getAggregateStatus(): SyncStatus | null {
    const statuses = Array.from(this.instances.values()).map(i => i.getStatus());
    if (statuses.length === 0) return null;
    const mostRecent = (dates: Array<string | null>): string | null =>
      dates.filter((d): d is string => !!d).sort().reverse()[0] || null;
    return {
      isOnline: statuses.some(s => s.isOnline),
      isSync: statuses.some(s => s.isSync),
      lastSyncAttempt: mostRecent(statuses.map(s => s.lastSyncAttempt)),
      lastSuccessfulSync: mostRecent(statuses.map(s => s.lastSuccessfulSync)),
      currentUser: statuses[0].currentUser,
    };
  }

  /** Résout les conflits d'un contentieux (décisions utilisateur). */
  public async resolveConflicts(
    contentieuxId: ContentieuxId,
    conflicts: SyncConflict[],
    selections: Map<number, ConflictAction>,
    localData: SyncData,
    serverData: SyncData
  ): Promise<void> {
    const inst = this.instances.get(contentieuxId);
    if (!inst) throw new Error('Contentieux non chargé');
    return inst.resolveConflicts(conflicts, selections, localData, serverData);
  }

  /** Liste les backups d'un contentieux. */
  public async listBackups(contentieuxId: ContentieuxId): Promise<string[]> {
    return this.instances.get(contentieuxId)?.listBackups() ?? [];
  }

  /** Restaure un contentieux depuis un de ses backups. */
  public async restoreFromBackup(contentieuxId: ContentieuxId, filename: string): Promise<boolean> {
    const inst = this.instances.get(contentieuxId);
    return inst ? inst.restoreFromBackup(filename) : false;
  }

  /** Répare le fichier serveur d'un contentieux avec les données locales. */
  public async repairWithLocalData(contentieuxId: ContentieuxId): Promise<boolean> {
    const inst = this.instances.get(contentieuxId);
    return inst ? inst.repairWithLocalData() : false;
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
