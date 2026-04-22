// utils/dataSync/TagSyncService.ts
//
// Synchronisation dédiée des tags (customTags + tagRequests).
// Fichier serveur : P:\...\10_App METIER\tag-data.json
// Backups        : P:\...\10_App METIER\admin\backups\tag-data-*.json

import { ElectronBridge } from '@/utils/electronBridge';
import { APP_CONFIG } from '@/config/constants';
import { TagDefinition } from '@/config/tags';
import { TagRequest } from '@/utils/tagRequestManager';
import { TagSyncFile } from '@/types/globalSyncTypes';
import {
  getCurrentUserInfo,
  buildMetadata,
  isGlobalSyncAvailable,
  emitSyncCompleted,
} from './globalSyncCommon';

const TAG_REQUESTS_KEY = 'tag_requests';
const PUSH_DEBOUNCE_MS = 800;
const PERIODIC_SYNC_MS = 30_000;

// ─── Fusion : union par ID, le plus récent gagne quand disponible ────────────
function mergeById<T extends { id: string }>(
  local: T[],
  server: T[],
  getStamp?: (item: T) => string | undefined,
): T[] {
  const map = new Map<string, T>();
  for (const item of server) {
    if (item && item.id) map.set(item.id, item);
  }
  for (const item of local) {
    if (!item || !item.id) continue;
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
      continue;
    }
    if (getStamp) {
      const a = getStamp(item);
      const b = getStamp(existing);
      if (a && b) {
        map.set(item.id, a >= b ? item : existing);
        continue;
      }
    }
    // Par défaut : local gagne (l'utilisateur qui a modifié vient de toucher au tag)
    map.set(item.id, item);
  }
  return Array.from(map.values());
}

// ─── Migration one-shot depuis le vieux app-data.json racine ─────────────────
// Deux formats connus :
//   A) customTags = TagDefinition[]          (format attendu)
//   B) customTags = { services: [...], infractions: [...], ... }  (legacy)
// On aplatit B → A en recopiant la clé de catégorie.
function flattenLegacyCustomTags(legacy: unknown): TagDefinition[] {
  if (!legacy) return [];
  if (Array.isArray(legacy)) return legacy as TagDefinition[];
  if (typeof legacy === 'object') {
    const out: TagDefinition[] = [];
    for (const [cat, arr] of Object.entries(legacy as Record<string, unknown>)) {
      if (!Array.isArray(arr)) continue;
      for (const entry of arr as Array<Record<string, unknown>>) {
        if (!entry || !entry.id || !entry.value) continue;
        out.push({
          ...(entry as unknown as TagDefinition),
          category: (entry.category as string) || cat,
        } as TagDefinition);
      }
    }
    return out;
  }
  return [];
}

async function readLocalTags(): Promise<TagDefinition[]> {
  const raw = await ElectronBridge.getData<any>(APP_CONFIG.STORAGE_KEYS.CUSTOM_TAGS, []);
  if (Array.isArray(raw)) return raw;
  // Compat : si le local a encore le format legacy objet, on aplatit
  return flattenLegacyCustomTags(raw);
}

async function readLocalTagRequests(): Promise<TagRequest[]> {
  const raw = await ElectronBridge.getData<any>(TAG_REQUESTS_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

async function writeLocalTags(tags: TagDefinition[]): Promise<void> {
  await ElectronBridge.setData(APP_CONFIG.STORAGE_KEYS.CUSTOM_TAGS, tags);
}

async function writeLocalTagRequests(requests: TagRequest[]): Promise<void> {
  await ElectronBridge.setData(TAG_REQUESTS_KEY, requests);
}

async function pullServer(): Promise<TagSyncFile | null> {
  if (!window.electronAPI?.globalSync_pullTags) return null;
  return (await window.electronAPI.globalSync_pullTags()) || null;
}

async function pushServer(payload: TagSyncFile): Promise<boolean> {
  if (!window.electronAPI?.globalSync_pushTags) return false;
  return await window.electronAPI.globalSync_pushTags(payload);
}

/**
 * Lit le vieux app-data.json racine (s'il existe encore) pour extraire
 * les tags qui n'auraient jamais été promus vers tag-data.json.
 */
async function pullLegacyTags(): Promise<{ tags: TagDefinition[]; tagRequests: TagRequest[] }> {
  try {
    if (!window.electronAPI?.globalSync_readLegacyAppData) {
      return { tags: [], tagRequests: [] };
    }
    const legacy = await window.electronAPI.globalSync_readLegacyAppData();
    if (!legacy) return { tags: [], tagRequests: [] };
    return {
      tags: flattenLegacyCustomTags(legacy.customTags),
      tagRequests: Array.isArray(legacy.tagRequests) ? legacy.tagRequests : [],
    };
  } catch {
    return { tags: [], tagRequests: [] };
  }
}

export class TagSyncService {
  private static instance: TagSyncService;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private serverVersion = 0;
  private initialized = false;
  private inFlight: Promise<void> | null = null;
  // Signal positionné par schedulePush() après une édition locale.
  // Évite qu'un update par ID (mêmes IDs, contenu différent) soit ignoré.
  private dirty = false;

  static getInstance(): TagSyncService {
    if (!TagSyncService.instance) {
      TagSyncService.instance = new TagSyncService();
    }
    return TagSyncService.instance;
  }

  startPeriodic(): void {
    if (this.periodicTimer) return;
    this.periodicTimer = setInterval(() => {
      this.sync().catch(err => console.error('TagSync.periodic', err));
    }, PERIODIC_SYNC_MS);
  }

  stopPeriodic(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  /**
   * Sync complète : pull serveur → migrer legacy si besoin → fusionner avec local
   * → écrire local → pousser serveur si diff.
   * Idempotent : appelable à l'init et à intervalles réguliers.
   */
  async sync(): Promise<void> {
    if (!isGlobalSyncAvailable()) return;
    // Serialize les appels pour éviter les pull/push croisés
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
      const [serverFile, localTags, localRequests, legacy] = await Promise.all([
        pullServer(),
        readLocalTags(),
        readLocalTagRequests(),
        pullLegacyTags(),
      ]);

      const serverTags = serverFile?.customTags ?? [];
      const serverRequests = serverFile?.tagRequests ?? [];
      this.serverVersion = serverFile?.version ?? 0;

      // Si le fichier serveur n'existait pas, on intègre aussi les tags
      // historiques du vieux app-data.json racine (migration one-shot)
      const mergedTags = serverFile
        ? mergeById(localTags, serverTags)
        : mergeById(mergeById(localTags, legacy.tags), serverTags);

      const mergedRequests = serverFile
        ? mergeById(localRequests, serverRequests, r => r.reviewedAt || r.requestedAt)
        : mergeById(
            mergeById(localRequests, legacy.tagRequests, r => r.reviewedAt || r.requestedAt),
            serverRequests,
            r => r.reviewedAt || r.requestedAt,
          );

      // Écrire le local si différent (évite les notifications inutiles)
      const localChanged =
        mergedTags.length !== localTags.length ||
        mergedRequests.length !== localRequests.length ||
        mergedTags.some(t => !localTags.find(l => l.id === t.id));

      if (localChanged) {
        await writeLocalTags(mergedTags);
        await writeLocalTagRequests(mergedRequests);
        emitSyncCompleted('tags');
      }

      // Décider si on pousse :
      // - `dirty` signale qu'une édition locale vient d'avoir lieu (add/update/delete)
      // - sinon on ne pousse que si le merge a produit quelque chose d'absent du serveur
      const mergedHasNewForServer =
        !serverFile ||
        this.dirty ||
        mergedTags.length !== serverTags.length ||
        mergedRequests.length !== serverRequests.length ||
        mergedTags.some(t => !serverTags.find(s => s.id === t.id)) ||
        mergedRequests.some(r => !serverRequests.find(s => s.id === r.id));

      if (mergedHasNewForServer) {
        const user = await getCurrentUserInfo();
        const payload: TagSyncFile = {
          ...buildMetadata(this.serverVersion, user),
          customTags: mergedTags,
          tagRequests: mergedRequests,
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
      console.error('❌ TagSync: sync échouée', error);
    }
  }

  /**
   * Après une modification locale (addTag, updateTag, deleteTag,
   * addRequest, reviewRequest…), le caller appelle cette méthode.
   * Un push est programmé après `PUSH_DEBOUNCE_MS` pour agréger les
   * éditions successives (ex. tri/drag-and-drop qui émet plusieurs events).
   */
  schedulePush(): void {
    this.dirty = true;
    if (!isGlobalSyncAvailable()) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.sync().catch(err => console.error('TagSync.schedulePush', err));
    }, PUSH_DEBOUNCE_MS);
  }

  /**
   * Attendre qu'un push programmé se termine (utile avant de fermer l'appli
   * ou avant un pull forcé). No-op si aucun push n'est en attente.
   */
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

export const tagSyncService = TagSyncService.getInstance();
