// utils/dataSync/TagSyncService.ts
//
// Synchronisation dédiée des tags (customTags + tagRequests).
// Fichier serveur : P:\...\10_App METIER\tag-data.json
// Backups        : P:\...\10_App METIER\admin\backups\tag-data-*.json

import { ElectronBridge } from '@/utils/electronBridge';
import { APP_CONFIG } from '@/config/constants';
import { TagDefinition } from '@/config/tags';
import type { TagRequest } from '@/utils/tagRequestManager';
import { TagSyncFile, TagTombstone } from '@/types/globalSyncTypes';
import {
  getCurrentUserInfo,
  buildMetadata,
  isGlobalSyncAvailable,
  emitSyncCompleted,
} from './globalSyncCommon';

const TAG_REQUESTS_KEY = 'tag_requests';
export const DELETED_TAG_IDS_KEY = 'deleted_tag_ids';
export const DELETED_TAG_REQUEST_IDS_KEY = 'deleted_tag_request_ids';
const PUSH_DEBOUNCE_MS = 800;
const PERIODIC_SYNC_MS = 30_000;
const TAG_TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

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

// ─── Déduplication par (catégorie, valeur normalisée) ───────────────────────
// Les migrations historiques ont créé plusieurs TagDefinition avec des IDs
// différents mais la même valeur (ex. deux "BR ABBEVILLE" dont un seul porte
// l'organisation). On fusionne systématiquement lors du merge : un tag par
// paire (catégorie, valeur), en préservant l'organisation si un des doublons
// en avait une. Auto-réparant et idempotent.
function normalizeTagKey(tag: TagDefinition): string {
  const value = (tag.value || '').trim().toLowerCase();
  return `${tag.category}::${value}`;
}

function dedupTagsByValue(tags: TagDefinition[]): TagDefinition[] {
  const groups = new Map<string, TagDefinition[]>();
  const noKey: TagDefinition[] = [];
  for (const tag of tags) {
    if (!tag || !tag.value || !tag.category) {
      if (tag) noKey.push(tag);
      continue;
    }
    const key = normalizeTagKey(tag);
    const arr = groups.get(key);
    if (arr) arr.push(tag);
    else groups.set(key, [tag]);
  }

  const result: TagDefinition[] = [];
  groups.forEach(group => {
    if (group.length === 1) {
      result.push(group[0]);
      return;
    }
    // Choix déterministe du "gardé" :
    //   1) celui qui possède une organisation.section
    //   2) à défaut, plus petit ID (ordre lexicographique) pour stabilité
    const sorted = [...group].sort((a, b) => {
      const aOrg = a.organization?.section ? 1 : 0;
      const bOrg = b.organization?.section ? 1 : 0;
      if (aOrg !== bOrg) return bOrg - aOrg; // org en premier
      return (a.id || '').localeCompare(b.id || '');
    });
    const keeper = sorted[0];
    // Si le gardé n'a pas d'organisation mais un doublon en a une, on la
    // transfère. (Le tri fait que si keeper n'en a pas, aucun n'en a ; mais
    // on garde la sécurité si la structure change.)
    if (!keeper.organization?.section) {
      const donor = group.find(t => t.organization?.section);
      if (donor?.organization) {
        result.push({ ...keeper, organization: donor.organization });
        return;
      }
    }
    result.push(keeper);
  });

  return [...result, ...noKey];
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

async function readLocalTombstones(key: string): Promise<TagTombstone[]> {
  const raw = await ElectronBridge.getData<TagTombstone[]>(key, []);
  return Array.isArray(raw) ? raw : [];
}

async function writeLocalTombstones(key: string, data: TagTombstone[]): Promise<void> {
  await ElectronBridge.setData(key, data);
}

// ─── Fusion des tombstones : union par ID, deletedAt le plus récent gagne ───
function mergeTombstones(a: TagTombstone[], b: TagTombstone[]): TagTombstone[] {
  const map = new Map<string, TagTombstone>();
  for (const t of [...a, ...b]) {
    if (!t || typeof t.id !== 'string') continue;
    const prev = map.get(t.id);
    if (!prev || (t.deletedAt || '') >= (prev.deletedAt || '')) {
      map.set(t.id, t);
    }
  }
  return Array.from(map.values());
}

// ─── Expiration des tombstones après TAG_TOMBSTONE_TTL_MS ───────────────────
function pruneExpiredTombstones(tombstones: TagTombstone[]): TagTombstone[] {
  const cutoff = Date.now() - TAG_TOMBSTONE_TTL_MS;
  return tombstones.filter(t => {
    const ts = Date.parse(t.deletedAt || '');
    return !Number.isFinite(ts) || ts >= cutoff;
  });
}

function tombstonesDiffer(a: TagTombstone[], b: TagTombstone[]): boolean {
  if (a.length !== b.length) return true;
  const setB = new Set(b.map(t => t.id));
  return a.some(t => !setB.has(t.id));
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
      const [serverFile, localTags, localRequests, legacy, localTagTombs, localReqTombs] = await Promise.all([
        pullServer(),
        readLocalTags(),
        readLocalTagRequests(),
        pullLegacyTags(),
        readLocalTombstones(DELETED_TAG_IDS_KEY),
        readLocalTombstones(DELETED_TAG_REQUEST_IDS_KEY),
      ]);

      const serverTags = serverFile?.customTags ?? [];
      const serverRequests = serverFile?.tagRequests ?? [];
      const serverTagTombs = serverFile?.deletedTagIds ?? [];
      const serverReqTombs = serverFile?.deletedTagRequestIds ?? [];
      this.serverVersion = serverFile?.version ?? 0;

      // Fusion des tombstones (local + serveur), puis purge de ceux > 7j.
      // Les tombstones expirés sont nettoyés lors de chaque sync : ils ne
      // sont utiles que le temps que toutes les machines se resynchronisent.
      const mergedTagTombs = pruneExpiredTombstones(mergeTombstones(localTagTombs, serverTagTombs));
      const mergedReqTombs = pruneExpiredTombstones(mergeTombstones(localReqTombs, serverReqTombs));
      const deletedTagIds = new Set(mergedTagTombs.map(t => t.id));
      const deletedReqIds = new Set(mergedReqTombs.map(t => t.id));

      // Si le fichier serveur n'existait pas, on intègre aussi les tags
      // historiques du vieux app-data.json racine (migration one-shot).
      // `dedupTagsByValue` écrase les doublons hérités des migrations :
      // même (catégorie, valeur normalisée) ⇒ un seul tag conservé.
      // Les tombstones filtrent tout tag/demande explicitement supprimé
      // avant le merge ET après, pour neutraliser les entrées serveur
      // issues d'un poste encore désynchronisé.
      const filterOutTags = (arr: TagDefinition[]) => arr.filter(t => t && !deletedTagIds.has(t.id));
      const filterOutReqs = (arr: TagRequest[]) => arr.filter(r => r && !deletedReqIds.has(r.id));

      const mergedTags = dedupTagsByValue(
        filterOutTags(
          serverFile
            ? mergeById(filterOutTags(localTags), filterOutTags(serverTags))
            : mergeById(
                mergeById(filterOutTags(localTags), filterOutTags(legacy.tags)),
                filterOutTags(serverTags),
              ),
        ),
      );

      const mergedRequests = filterOutReqs(
        serverFile
          ? mergeById(filterOutReqs(localRequests), filterOutReqs(serverRequests), r => r.reviewedAt || r.requestedAt)
          : mergeById(
              mergeById(filterOutReqs(localRequests), filterOutReqs(legacy.tagRequests), r => r.reviewedAt || r.requestedAt),
              filterOutReqs(serverRequests),
              r => r.reviewedAt || r.requestedAt,
            ),
      );

      // Écrire le local si différent (évite les notifications inutiles)
      const localChanged =
        mergedTags.length !== localTags.length ||
        mergedRequests.length !== localRequests.length ||
        mergedTags.some(t => !localTags.find(l => l.id === t.id)) ||
        tombstonesDiffer(mergedTagTombs, localTagTombs) ||
        tombstonesDiffer(mergedReqTombs, localReqTombs);

      if (localChanged) {
        await writeLocalTags(mergedTags);
        await writeLocalTagRequests(mergedRequests);
        await writeLocalTombstones(DELETED_TAG_IDS_KEY, mergedTagTombs);
        await writeLocalTombstones(DELETED_TAG_REQUEST_IDS_KEY, mergedReqTombs);
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
        mergedRequests.some(r => !serverRequests.find(s => s.id === r.id)) ||
        tombstonesDiffer(mergedTagTombs, serverTagTombs) ||
        tombstonesDiffer(mergedReqTombs, serverReqTombs);

      if (mergedHasNewForServer) {
        const user = await getCurrentUserInfo();
        const payload: TagSyncFile = {
          ...buildMetadata(this.serverVersion, user),
          customTags: mergedTags,
          tagRequests: mergedRequests,
          deletedTagIds: mergedTagTombs,
          deletedTagRequestIds: mergedReqTombs,
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
