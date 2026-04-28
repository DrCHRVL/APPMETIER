// utils/dataSync/ContentieuxAlertsSyncService.ts
//
// Synchronisation des règles d'alertes partagées par contentieux.
// Un fichier par contentieux : `contentieux-alerts/{contentieuxId}.json`.
// Les règles y sont partagées par toute l'équipe d'un contentieux (seuils
// CR, expiration actes, âge enquête, prolongation, AIR). Seul un magistrat
// affecté au contentieux ou un admin devrait les éditer (garde UI).
// Chaque utilisateur s'abonne via `UserPreferencesFile.subscribedContentieuxAlerts`.

import { ElectronBridge } from '@/utils/electronBridge';
import { AlertRule } from '@/types/interfaces';
import { ContentieuxAlertsSyncFile } from '@/types/globalSyncTypes';
import { ContentieuxId } from '@/types/userTypes';
import { getCurrentUserInfo, buildMetadata, emitSyncCompleted } from './globalSyncCommon';

const PUSH_DEBOUNCE_MS = 800;
const PERIODIC_SYNC_MS = 45_000;

function localCacheKey(contentieuxId: ContentieuxId): string {
  return `shared_alerts_ctx_${contentieuxId}`;
}

function isServiceAvailable(): boolean {
  return typeof window !== 'undefined'
    && !!window.electronAPI?.globalSync_pullContentieuxAlerts
    && !!window.electronAPI?.globalSync_pushContentieuxAlerts;
}

function rulesDiffer(a: AlertRule[], b: AlertRule[]): boolean {
  if (a.length !== b.length) return true;
  const mapB = new Map(b.map(r => [r.id, r]));
  return a.some(r => {
    const match = mapB.get(r.id);
    return !match || JSON.stringify(match) !== JSON.stringify(r);
  });
}

async function readLocal(contentieuxId: ContentieuxId): Promise<AlertRule[]> {
  const raw = await ElectronBridge.getData<AlertRule[]>(localCacheKey(contentieuxId), []);
  return Array.isArray(raw) ? raw : [];
}

async function writeLocal(contentieuxId: ContentieuxId, rules: AlertRule[]): Promise<void> {
  await ElectronBridge.setData(localCacheKey(contentieuxId), rules);
}

async function pullServer(contentieuxId: ContentieuxId): Promise<ContentieuxAlertsSyncFile | null> {
  if (!window.electronAPI?.globalSync_pullContentieuxAlerts) return null;
  return (await window.electronAPI.globalSync_pullContentieuxAlerts(contentieuxId)) || null;
}

async function pushServer(contentieuxId: ContentieuxId, payload: ContentieuxAlertsSyncFile): Promise<boolean> {
  if (!window.electronAPI?.globalSync_pushContentieuxAlerts) return false;
  return await window.electronAPI.globalSync_pushContentieuxAlerts(contentieuxId, payload);
}

/** Entrée par contentieux — un état indépendant par id. */
interface ContentieuxState {
  serverVersion: number;
  pushTimer: ReturnType<typeof setTimeout> | null;
  periodicTimer: ReturnType<typeof setInterval> | null;
  inFlight: Promise<void> | null;
  dirty: boolean;
  initialized: boolean;
}

export class ContentieuxAlertsSyncService {
  private static instance: ContentieuxAlertsSyncService;
  private states = new Map<ContentieuxId, ContentieuxState>();

  static getInstance(): ContentieuxAlertsSyncService {
    if (!ContentieuxAlertsSyncService.instance) {
      ContentieuxAlertsSyncService.instance = new ContentieuxAlertsSyncService();
    }
    return ContentieuxAlertsSyncService.instance;
  }

  private getState(contentieuxId: ContentieuxId): ContentieuxState {
    let state = this.states.get(contentieuxId);
    if (!state) {
      state = {
        serverVersion: 0,
        pushTimer: null,
        periodicTimer: null,
        inFlight: null,
        dirty: false,
        initialized: false,
      };
      this.states.set(contentieuxId, state);
    }
    return state;
  }

  startPeriodic(contentieuxId: ContentieuxId): void {
    const state = this.getState(contentieuxId);
    if (state.periodicTimer) return;
    state.periodicTimer = setInterval(() => {
      this.sync(contentieuxId).catch(err =>
        console.error(`ContentieuxAlertsSync[${contentieuxId}].periodic`, err)
      );
    }, PERIODIC_SYNC_MS);
  }

  stopPeriodic(contentieuxId: ContentieuxId): void {
    const state = this.getState(contentieuxId);
    if (state.periodicTimer) {
      clearInterval(state.periodicTimer);
      state.periodicTimer = null;
    }
  }

  async sync(contentieuxId: ContentieuxId): Promise<void> {
    if (!isServiceAvailable()) return;
    const state = this.getState(contentieuxId);
    if (state.inFlight) {
      await state.inFlight;
      return;
    }
    state.inFlight = this.performSync(contentieuxId).finally(() => {
      state.inFlight = null;
    });
    await state.inFlight;
  }

  private async performSync(contentieuxId: ContentieuxId): Promise<void> {
    const state = this.getState(contentieuxId);
    try {
      const [serverFile, localRules] = await Promise.all([
        pullServer(contentieuxId),
        readLocal(contentieuxId),
      ]);

      state.serverVersion = serverFile?.version ?? 0;

      if (serverFile) {
        // Le serveur est la source de vérité pour les règles partagées.
        // Si le cache local diffère, on l'aligne et on émet un event de
        // resync pour que l'UI rafraîchisse.
        if (rulesDiffer(localRules, serverFile.rules)) {
          await writeLocal(contentieuxId, serverFile.rules);
          emitSyncCompleted(`contentieuxAlerts:${contentieuxId}`);
        }
        // Si le local a été marqué dirty par une édition récente,
        // on pousse (le serveur est repris en base pour le build).
        if (state.dirty && rulesDiffer(localRules, serverFile.rules)) {
          const user = await getCurrentUserInfo();
          const payload: ContentieuxAlertsSyncFile = {
            ...buildMetadata(state.serverVersion, user),
            contentieuxId,
            rules: localRules,
          };
          const ok = await pushServer(contentieuxId, payload);
          if (ok) {
            state.serverVersion = payload.version;
            state.dirty = false;
          }
        } else {
          state.dirty = false;
        }
      } else {
        // Pas de fichier serveur → on ne fait rien ici ; le seed est
        // responsable de créer le fichier depuis les clés legacy.
      }

      state.initialized = true;
    } catch (error) {
      console.error(`❌ ContentieuxAlertsSync[${contentieuxId}] sync échouée:`, error);
    }
  }

  /**
   * Persiste un nouveau jeu de règles pour un contentieux. Écrit le cache
   * local, programme un push serveur et émet un event.
   */
  async saveRules(contentieuxId: ContentieuxId, rules: AlertRule[]): Promise<void> {
    await writeLocal(contentieuxId, rules);
    const state = this.getState(contentieuxId);
    state.dirty = true;
    emitSyncCompleted(`contentieuxAlerts:${contentieuxId}`);
    if (!isServiceAvailable()) return;

    // Push immédiat (pas de debounce ici : l'édition de règles est peu fréquente).
    try {
      const user = await getCurrentUserInfo();
      const payload: ContentieuxAlertsSyncFile = {
        ...buildMetadata(state.serverVersion, user),
        contentieuxId,
        rules,
      };
      const ok = await pushServer(contentieuxId, payload);
      if (ok) {
        state.serverVersion = payload.version;
        state.dirty = false;
      }
    } catch (error) {
      console.error(`ContentieuxAlertsSync[${contentieuxId}].saveRules`, error);
    }
  }

  /**
   * Seed idempotent : si le fichier serveur n'existe pas encore pour ce
   * contentieux, on y pose les règles fournies (issues des clés legacy
   * `ctx_X_alertRules` ou `alert_rules`). No-op sinon.
   * Ne doit être appelé que par un utilisateur habilité à créer la config
   * (magistrat du contentieux ou admin).
   */
  async seedFromLegacy(contentieuxId: ContentieuxId, rules: AlertRule[]): Promise<boolean> {
    if (!isServiceAvailable()) return false;
    const server = await pullServer(contentieuxId);
    if (server) return false;
    const user = await getCurrentUserInfo();
    const state = this.getState(contentieuxId);
    const payload: ContentieuxAlertsSyncFile = {
      ...buildMetadata(0, user),
      contentieuxId,
      rules,
    };
    const ok = await pushServer(contentieuxId, payload);
    if (ok) {
      await writeLocal(contentieuxId, rules);
      state.serverVersion = payload.version;
      state.dirty = false;
      emitSyncCompleted(`contentieuxAlerts:${contentieuxId}`);
    }
    return ok;
  }

  async getRules(contentieuxId: ContentieuxId): Promise<AlertRule[]> {
    return readLocal(contentieuxId);
  }

  schedulePush(contentieuxId: ContentieuxId): void {
    const state = this.getState(contentieuxId);
    state.dirty = true;
    if (!isServiceAvailable()) return;
    if (state.pushTimer) clearTimeout(state.pushTimer);
    state.pushTimer = setTimeout(() => {
      state.pushTimer = null;
      this.sync(contentieuxId).catch(err =>
        console.error(`ContentieuxAlertsSync[${contentieuxId}].schedulePush`, err)
      );
    }, PUSH_DEBOUNCE_MS);
  }

  async flushPending(contentieuxId: ContentieuxId): Promise<void> {
    const state = this.getState(contentieuxId);
    if (state.pushTimer) {
      clearTimeout(state.pushTimer);
      state.pushTimer = null;
      await this.sync(contentieuxId);
    } else if (state.inFlight) {
      await state.inFlight;
    }
  }

  isInitialized(contentieuxId: ContentieuxId): boolean {
    return this.getState(contentieuxId).initialized;
  }
}

export const contentieuxAlertsSyncService = ContentieuxAlertsSyncService.getInstance();
