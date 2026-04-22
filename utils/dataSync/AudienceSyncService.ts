// utils/dataSync/AudienceSyncService.ts
//
// Synchronisation dédiée des résultats d'audience (OI, CSS, CRPC, etc.).
// Fichier serveur : P:\...\10_App METIER\audience-data.json
// Backups        : P:\...\10_App METIER\admin\backups\audience-data-*.json

import { ElectronBridge } from '@/utils/electronBridge';
import { APP_CONFIG } from '@/config/constants';
import { ResultatAudience } from '@/types/audienceTypes';
import { AudienceSyncFile } from '@/types/globalSyncTypes';
import {
  getCurrentUserInfo,
  buildMetadata,
  emitSyncCompleted,
} from './globalSyncCommon';

const PUSH_DEBOUNCE_MS = 800;
const PERIODIC_SYNC_MS = 30_000;

function isAudienceSyncAvailable(): boolean {
  return typeof window !== 'undefined'
    && !!window.electronAPI?.globalSync_pullAudience
    && !!window.electronAPI?.globalSync_pushAudience;
}

// ─── Fusion par timestamp : le plus récent gagne par enqueteId ───────────────
function mergeByModifiedAt(
  local: Record<string, ResultatAudience>,
  server: Record<string, ResultatAudience>,
): Record<string, ResultatAudience> {
  const result: Record<string, ResultatAudience> = { ...server };
  for (const [key, localEntry] of Object.entries(local)) {
    const serverEntry = result[key];
    if (!serverEntry) {
      result[key] = localEntry;
      continue;
    }
    const a = localEntry.modifiedAt || '';
    const b = serverEntry.modifiedAt || '';
    result[key] = a >= b ? localEntry : serverEntry;
  }
  return result;
}

async function readLocal(): Promise<Record<string, ResultatAudience>> {
  const raw = await ElectronBridge.getData<any>(APP_CONFIG.STORAGE_KEYS.AUDIENCE_RESULTATS, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

async function writeLocal(data: Record<string, ResultatAudience>): Promise<void> {
  await ElectronBridge.setData(APP_CONFIG.STORAGE_KEYS.AUDIENCE_RESULTATS, data);
}

async function pullServer(): Promise<AudienceSyncFile | null> {
  if (!window.electronAPI?.globalSync_pullAudience) return null;
  return (await window.electronAPI.globalSync_pullAudience()) || null;
}

async function pushServer(payload: AudienceSyncFile): Promise<boolean> {
  if (!window.electronAPI?.globalSync_pushAudience) return false;
  return await window.electronAPI.globalSync_pushAudience(payload);
}

async function pullLegacyAudience(): Promise<Record<string, ResultatAudience>> {
  try {
    if (!window.electronAPI?.globalSync_readLegacyAppData) return {};
    const legacy = await window.electronAPI.globalSync_readLegacyAppData();
    if (!legacy || typeof legacy !== 'object') return {};
    const raw = legacy.audienceResultats;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function keysEqual(
  a: Record<string, ResultatAudience>,
  b: Record<string, ResultatAudience>,
): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const setB = new Set(kb);
  return ka.every(k => setB.has(k));
}

export class AudienceSyncService {
  private static instance: AudienceSyncService;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private serverVersion = 0;
  private initialized = false;
  private inFlight: Promise<void> | null = null;
  private dirty = false;

  static getInstance(): AudienceSyncService {
    if (!AudienceSyncService.instance) {
      AudienceSyncService.instance = new AudienceSyncService();
    }
    return AudienceSyncService.instance;
  }

  startPeriodic(): void {
    if (this.periodicTimer) return;
    this.periodicTimer = setInterval(() => {
      this.sync().catch(err => console.error('AudienceSync.periodic', err));
    }, PERIODIC_SYNC_MS);
  }

  stopPeriodic(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  async sync(): Promise<void> {
    if (!isAudienceSyncAvailable()) return;
    if (this.inFlight) {
      await this.inFlight;
      return;
    }
    this.inFlight = this.performSync().finally(() => {
      this.inFlight = null;
    });
    await this.inFlight;
  }

  private async performSync(): Promise<void> {
    try {
      const [serverFile, local, legacy] = await Promise.all([
        pullServer(),
        readLocal(),
        pullLegacyAudience(),
      ]);

      const server = serverFile?.audienceResultats ?? {};
      this.serverVersion = serverFile?.version ?? 0;

      // Migration one-shot : si le serveur n'existait pas, on intègre aussi
      // l'historique du vieux app-data.json racine
      const mergedFromLegacy = serverFile ? server : mergeByModifiedAt(legacy, server);
      const merged = mergeByModifiedAt(local, mergedFromLegacy);

      // Écrire le local si différent
      const localChanged = !keysEqual(merged, local)
        || Object.entries(merged).some(([k, v]) => local[k]?.modifiedAt !== v.modifiedAt);

      if (localChanged) {
        await writeLocal(merged);
        emitSyncCompleted('audience');
      }

      // Décider du push :
      // - `dirty` signale qu'une édition locale (save/delete) vient d'avoir lieu
      // - sinon on pousse si le snapshot diffère du serveur
      const hasNewForServer = !serverFile
        || this.dirty
        || !keysEqual(merged, server)
        || Object.entries(merged).some(([k, v]) => server[k]?.modifiedAt !== v.modifiedAt);

      if (hasNewForServer) {
        const user = await getCurrentUserInfo();
        const payload: AudienceSyncFile = {
          ...buildMetadata(this.serverVersion, user),
          audienceResultats: merged,
        };
        const ok = await pushServer(payload);
        if (ok) {
          this.serverVersion = payload.version;
          this.dirty = false;
        }
      } else {
        this.dirty = false;
      }

      this.initialized = true;
    } catch (error) {
      console.error('❌ AudienceSync: sync échouée', error);
    }
  }

  schedulePush(): void {
    this.dirty = true;
    if (!isAudienceSyncAvailable()) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.sync().catch(err => console.error('AudienceSync.schedulePush', err));
    }, PUSH_DEBOUNCE_MS);
  }

  async flushPending(): Promise<void> {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
      await this.sync();
    } else if (this.inFlight) {
      await this.inFlight;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export const audienceSyncService = AudienceSyncService.getInstance();
