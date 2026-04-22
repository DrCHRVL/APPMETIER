// utils/dataSync/DeletedIdsSyncService.ts
//
// Synchronisation dédiée des tombstones de suppression.
// Fichier serveur : P:\...\10_App METIER\deleted-ids.json
// Backups        : P:\...\10_App METIER\admin\backups\deleted-ids-*.json
//
// Rôle : empêcher la résurrection d'une enquête / acte / CR / mis en cause
// supprimés quand un autre poste encore désynchronisé pousserait son état
// vers le serveur. Sans ces tombstones partagés, l'élément reparaît au
// prochain merge (bug historique du MultiSyncManager).

import { ElectronBridge } from '@/utils/electronBridge';
import { DeletedIdsSyncFile, DeletedTombstone } from '@/types/globalSyncTypes';
import { getCurrentUserInfo, buildMetadata, emitSyncCompleted } from './globalSyncCommon';

const DELETED_ENQUETE_IDS_KEY = 'deleted_ids';
const DELETED_ACTE_IDS_KEY    = 'deleted_acte_ids';
const DELETED_CR_IDS_KEY      = 'deleted_cr_ids';
const DELETED_MEC_IDS_KEY     = 'deleted_mec_ids';

const PUSH_DEBOUNCE_MS = 800;
const PERIODIC_SYNC_MS = 30_000;

function isDeletedIdsSyncAvailable(): boolean {
  return typeof window !== 'undefined'
    && !!window.electronAPI?.globalSync_pullDeletedIds
    && !!window.electronAPI?.globalSync_pushDeletedIds;
}

// ─── Fusion : union par ID, on garde la date la plus récente ─────────────────
function mergeTombstones(a: DeletedTombstone[], b: DeletedTombstone[]): DeletedTombstone[] {
  const map = new Map<number, DeletedTombstone>();
  for (const t of [...a, ...b]) {
    if (!t || typeof t.id !== 'number') continue;
    const prev = map.get(t.id);
    if (!prev || (t.deletedAt || '') >= (prev.deletedAt || '')) {
      map.set(t.id, t);
    }
  }
  return Array.from(map.values());
}

async function readLocal(key: string): Promise<DeletedTombstone[]> {
  const raw = await ElectronBridge.getData<DeletedTombstone[]>(key, []);
  return Array.isArray(raw) ? raw : [];
}

async function writeLocal(key: string, data: DeletedTombstone[]): Promise<void> {
  await ElectronBridge.setData(key, data);
}

async function pullServer(): Promise<DeletedIdsSyncFile | null> {
  if (!window.electronAPI?.globalSync_pullDeletedIds) return null;
  return (await window.electronAPI.globalSync_pullDeletedIds()) || null;
}

async function pushServer(payload: DeletedIdsSyncFile): Promise<boolean> {
  if (!window.electronAPI?.globalSync_pushDeletedIds) return false;
  return await window.electronAPI.globalSync_pushDeletedIds(payload);
}

/** Migration one-shot : récupère les tombstones de l'ancien app-data.json
 *  racine s'il en contient encore (format deletedIds / deletedActeIds / …
 *  listes de numbers). */
async function pullLegacyTombstones(): Promise<{
  enqueteIds: DeletedTombstone[];
  acteIds: DeletedTombstone[];
  crIds: DeletedTombstone[];
  mecIds: DeletedTombstone[];
}> {
  const empty = { enqueteIds: [], acteIds: [], crIds: [], mecIds: [] };
  try {
    if (!window.electronAPI?.globalSync_readLegacyAppData) return empty;
    const legacy = await window.electronAPI.globalSync_readLegacyAppData();
    if (!legacy) return empty;
    const toTombstones = (arr: unknown): DeletedTombstone[] => {
      if (!Array.isArray(arr)) return [];
      const now = new Date().toISOString();
      return arr
        .map((v: unknown) => {
          if (typeof v === 'number') return { id: v, deletedAt: now };
          if (v && typeof v === 'object' && typeof (v as any).id === 'number') {
            return { id: (v as any).id, deletedAt: (v as any).deletedAt || now };
          }
          return null;
        })
        .filter((t): t is DeletedTombstone => !!t);
    };
    return {
      enqueteIds: toTombstones(legacy.deletedIds),
      acteIds:    toTombstones(legacy.deletedActeIds),
      crIds:      toTombstones(legacy.deletedCRIds),
      mecIds:     toTombstones(legacy.deletedMECIds),
    };
  } catch {
    return empty;
  }
}

function listsDiffer(a: DeletedTombstone[], b: DeletedTombstone[]): boolean {
  if (a.length !== b.length) return true;
  const setB = new Set(b.map(t => t.id));
  return a.some(t => !setB.has(t.id));
}

export class DeletedIdsSyncService {
  private static instance: DeletedIdsSyncService;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private serverVersion = 0;
  private initialized = false;
  private inFlight: Promise<void> | null = null;
  private dirty = false;

  static getInstance(): DeletedIdsSyncService {
    if (!DeletedIdsSyncService.instance) {
      DeletedIdsSyncService.instance = new DeletedIdsSyncService();
    }
    return DeletedIdsSyncService.instance;
  }

  startPeriodic(): void {
    if (this.periodicTimer) return;
    this.periodicTimer = setInterval(() => {
      this.sync().catch(err => console.error('DeletedIdsSync.periodic', err));
    }, PERIODIC_SYNC_MS);
  }

  stopPeriodic(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  async sync(): Promise<void> {
    if (!isDeletedIdsSyncAvailable()) return;
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
      const [serverFile, localEnq, localActe, localCR, localMEC, legacy] = await Promise.all([
        pullServer(),
        readLocal(DELETED_ENQUETE_IDS_KEY),
        readLocal(DELETED_ACTE_IDS_KEY),
        readLocal(DELETED_CR_IDS_KEY),
        readLocal(DELETED_MEC_IDS_KEY),
        pullLegacyTombstones(),
      ]);

      const serverEnq  = serverFile?.enqueteIds ?? [];
      const serverActe = serverFile?.acteIds    ?? [];
      const serverCR   = serverFile?.crIds      ?? [];
      const serverMEC  = serverFile?.mecIds     ?? [];
      this.serverVersion = serverFile?.version ?? 0;

      // Migration one-shot : s'il n'y a pas encore de deleted-ids.json, on
      // intègre également les tombstones de l'ancien app-data.json racine.
      const base = serverFile
        ? { enq: serverEnq, acte: serverActe, cr: serverCR, mec: serverMEC }
        : {
            enq:  mergeTombstones(legacy.enqueteIds, serverEnq),
            acte: mergeTombstones(legacy.acteIds,    serverActe),
            cr:   mergeTombstones(legacy.crIds,      serverCR),
            mec:  mergeTombstones(legacy.mecIds,     serverMEC),
          };

      const mergedEnq  = mergeTombstones(localEnq,  base.enq);
      const mergedActe = mergeTombstones(localActe, base.acte);
      const mergedCR   = mergeTombstones(localCR,   base.cr);
      const mergedMEC  = mergeTombstones(localMEC,  base.mec);

      const localChanged =
        listsDiffer(mergedEnq, localEnq) ||
        listsDiffer(mergedActe, localActe) ||
        listsDiffer(mergedCR, localCR) ||
        listsDiffer(mergedMEC, localMEC);

      if (localChanged) {
        await writeLocal(DELETED_ENQUETE_IDS_KEY, mergedEnq);
        await writeLocal(DELETED_ACTE_IDS_KEY, mergedActe);
        await writeLocal(DELETED_CR_IDS_KEY, mergedCR);
        await writeLocal(DELETED_MEC_IDS_KEY, mergedMEC);
        emitSyncCompleted('deletedIds');
      }

      const hasNewForServer =
        !serverFile ||
        this.dirty ||
        listsDiffer(mergedEnq, serverEnq) ||
        listsDiffer(mergedActe, serverActe) ||
        listsDiffer(mergedCR, serverCR) ||
        listsDiffer(mergedMEC, serverMEC);

      if (hasNewForServer) {
        const user = await getCurrentUserInfo();
        const payload: DeletedIdsSyncFile = {
          ...buildMetadata(this.serverVersion, user),
          enqueteIds: mergedEnq,
          acteIds:    mergedActe,
          crIds:      mergedCR,
          mecIds:     mergedMEC,
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
      console.error('❌ DeletedIdsSync: sync échouée', error);
    }
  }

  schedulePush(): void {
    this.dirty = true;
    if (!isDeletedIdsSyncAvailable()) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.sync().catch(err => console.error('DeletedIdsSync.schedulePush', err));
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

export const deletedIdsSyncService = DeletedIdsSyncService.getInstance();
