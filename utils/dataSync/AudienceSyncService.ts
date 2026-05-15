// utils/dataSync/AudienceSyncService.ts
//
// Synchronisation dédiée des résultats d'audience (OI, CSS, CRPC, etc.).
// Fichier serveur : P:\...\10_App METIER\audience-data.json
// Backups        : P:\...\10_App METIER\admin\backups\audience-data-*.json

import { ElectronBridge } from '@/utils/electronBridge';
import { APP_CONFIG } from '@/config/constants';
import { ResultatAudience } from '@/types/audienceTypes';
import { AudienceSyncFile } from '@/types/globalSyncTypes';
import { migrateLegacyResultats } from '@/utils/audienceLegacy';
import {
  getCurrentUserInfo,
  buildMetadata,
  emitSyncCompleted,
} from './globalSyncCommon';

const PUSH_DEBOUNCE_MS = 800;
const PERIODIC_SYNC_MS = 30_000;
// Fenêtre pendant laquelle une clé fraîchement éditée localement a priorité
// absolue sur la version serveur lors du merge. Couvre largement les pires
// cas de skew d'horloge (NTP désynchronisé, fuseau, retry réseau).
const LOCAL_AUTHORITY_WINDOW_MS = 5 * 60_000;
// Flag persistant signalant que la migration one-shot depuis app-data.json a
// déjà eu lieu sur ce poste. Tant que ce flag est faux, on relit le legacy à
// chaque sync (utile pour rattraper un poste qui n'a jamais été initialisé).
// Une fois passé à true, on ne relit plus jamais le legacy : ça évite la
// re-injection des clés numériques nues qui ressuscitaient les pending.
const LEGACY_MIGRATION_DONE_KEY = 'audience_legacyMigrationDone';

function isAudienceSyncAvailable(): boolean {
  return typeof window !== 'undefined'
    && !!window.electronAPI?.globalSync_pullAudience
    && !!window.electronAPI?.globalSync_pushAudience;
}

// ─── Fusion par timestamp : le plus récent gagne par enqueteId ───────────────
// `localAuthorityKeys` : clés que l'utilisateur vient de modifier localement.
// Pour ces clés, le local gagne d'office — y compris une absence locale,
// gérée par l'appelant après merge (suppression locale récente).
function mergeByModifiedAt(
  local: Record<string, ResultatAudience>,
  server: Record<string, ResultatAudience>,
  localAuthorityKeys: Set<string>,
): Record<string, ResultatAudience> {
  const result: Record<string, ResultatAudience> = { ...server };
  for (const [key, localEntry] of Object.entries(local)) {
    const serverEntry = result[key];
    if (!serverEntry || localAuthorityKeys.has(key)) {
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

async function isLegacyMigrationDone(): Promise<boolean> {
  try {
    return await ElectronBridge.getData<boolean>(LEGACY_MIGRATION_DONE_KEY, false);
  } catch {
    return false;
  }
}

async function markLegacyMigrationDone(): Promise<void> {
  try {
    await ElectronBridge.setData(LEGACY_MIGRATION_DONE_KEY, true);
  } catch {
    // Sans ce flag, le poste relira app-data.json à chaque sync — gênant mais
    // pas bloquant : la déduplication via migrateLegacyResultats absorbe
    // toujours les doublons avant écriture.
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
  // Clés fraîchement éditées localement → expiration en ms-epoch.
  // Tant qu'une clé est dans cette table, le merge force la vue locale
  // (présence ou absence) sur la vue serveur.
  private localAuthorityUntil = new Map<string, number>();

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
      const localAuthorityKeys = this.getActiveLocalAuthorityKeys();

      // Le legacy n'est lu que si la migration one-shot n'a jamais été faite
      // sur ce poste. Sinon on évite de ré-injecter les clés numériques nues
      // (`"123"`) qui ressuscitaient les pending — y compris hors ligne.
      const legacyMigrationDone = await isLegacyMigrationDone();
      const [serverFile, local, legacy] = await Promise.all([
        pullServer(),
        readLocal(),
        legacyMigrationDone
          ? Promise.resolve<Record<string, ResultatAudience>>({})
          : pullLegacyAudience(),
      ]);

      const server = serverFile?.audienceResultats ?? {};
      this.serverVersion = serverFile?.version ?? 0;

      // Migration one-shot : si le serveur n'existait pas, on intègre aussi
      // l'historique du vieux app-data.json racine
      const mergedFromLegacy = serverFile
        ? server
        : mergeByModifiedAt(legacy, server, new Set());
      const rawMerged = mergeByModifiedAt(local, mergedFromLegacy, localAuthorityKeys);

      // Suppressions locales récentes : si une clé fait autorité locale et n'est
      // plus dans `local`, on l'efface du merged pour qu'elle ne ressuscite pas
      // depuis le serveur.
      for (const key of localAuthorityKeys) {
        if (!(key in local) && key in rawMerged) {
          delete rawMerged[key];
        }
      }

      // Dédoublonnage final : tout ce qui sort du merge passe par la même
      // normalisation que le store. Les clés nues `"123"` éventuellement
      // remontées par le legacy ou par un pair pas encore patché sont
      // collapsées en `crimorg__123` avec priorité à la version préfixée.
      // Effet de bord recherché : à chaque sync, le serveur et le local se
      // nettoient d'eux-mêmes des doublons historiques.
      const { migrated: merged } = migrateLegacyResultats(rawMerged);

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

      // Marquer la migration legacy comme faite dès qu'une sync complète a
      // abouti avec un serverFile valide — même si le legacy était vide.
      // Condition serverFile non-null : tant qu'on n'a jamais réussi à voir
      // le partage commun, on garde la possibilité de relire le legacy au
      // prochain démarrage en ligne.
      if (!legacyMigrationDone && serverFile) {
        await markLegacyMigrationDone();
      }

      this.initialized = true;
    } catch (error) {
      console.error('❌ AudienceSync: sync échouée', error);
    }
  }

  /**
   * @param touchedKey clé composite (`${ctxId}__${enqueteId}`) qui vient
   *   d'être créée, modifiée ou supprimée localement. Marquée "autorité locale"
   *   pendant `LOCAL_AUTHORITY_WINDOW_MS` : sa version locale gagnera tout
   *   merge avec le serveur dans cette fenêtre, même si le serveur prétend
   *   avoir un `modifiedAt` plus récent (skew d'horloge, push concurrent).
   */
  schedulePush(touchedKey?: string): void {
    if (touchedKey) {
      this.localAuthorityUntil.set(touchedKey, Date.now() + LOCAL_AUTHORITY_WINDOW_MS);
    }
    this.dirty = true;
    if (!isAudienceSyncAvailable()) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.sync().catch(err => console.error('AudienceSync.schedulePush', err));
    }, PUSH_DEBOUNCE_MS);
  }

  private getActiveLocalAuthorityKeys(): Set<string> {
    const now = Date.now();
    const active = new Set<string>();
    for (const [key, until] of this.localAuthorityUntil.entries()) {
      if (until > now) active.add(key);
      else this.localAuthorityUntil.delete(key);
    }
    return active;
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
