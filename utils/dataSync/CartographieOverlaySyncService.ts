// utils/dataSync/CartographieOverlaySyncService.ts
//
// Synchronisation dédiée des overlays cartographie : MEC ex nihilo, dossiers
// ex nihilo, liens renseignement, annotations de cluster, boosts de score
// MEC, et MEC épinglés au Top10. Permet à un collègue ouvrant le module
// cartographie de récupérer tous les ajouts manuels de l'équipe.
//
// Fichier serveur : P:\...\10_App METIER\cartographie-overlays.json
// Backups        : P:\...\10_App METIER\admin\backups\cartographie-overlays-*.json
//
// Stratégie de fusion :
//   - chaque entité (MEC, dossier, lien, annotation, boost) porte un
//     `updatedAt` → "le plus récent gagne par id" en cas de conflit
//   - tombstones par catégorie : un id supprimé sur un poste est conservé
//     dans la liste `deleted*` du fichier serveur jusqu'à expiration (TTL
//     30 jours). Au merge, l'entité est retirée des deux côtés. Évite
//     qu'un poste désynchronisé ressuscite un élément qu'un collègue
//     vient de supprimer.
//   - pinnedMecIds : union des deux ensembles, moins les ids présents dans
//     les tombstones `deletedPinnedMecIds`. Sans ce filtrage, désépingler en
//     local était silencieusement annulé au prochain pull (le serveur avait
//     encore l'épingle, l'union la ressuscitait).

import { CartographieOverlaySyncFile, CartographieTombstone } from '@/types/globalSyncTypes';
import {
  useCartographieOverlayStore,
  forceFlushCartographieOverlay,
  pruneCartographieTombstones,
  registerCartographieOverlayMutationListener,
  type CartographieTombstoneEntry,
  type ClusterAnnotation,
  type DossierExNihilo,
  type LienRenseignement,
  type MecExNihilo,
  type MecScoreBoost,
  type TagZoneAssignment,
} from '@/stores/useCartographieOverlayStore';
import {
  buildMetadata,
  emitSyncCompleted,
  getCurrentUserInfo,
} from './globalSyncCommon';

const PUSH_DEBOUNCE_MS = 1500;
const PERIODIC_SYNC_MS = 60_000;

interface WithIdAndUpdated { id: string; updatedAt?: number; createdAt?: number }

function isCartographieSyncAvailable(): boolean {
  return typeof window !== 'undefined'
    && !!window.electronAPI?.globalSync_pullCartographie
    && !!window.electronAPI?.globalSync_pushCartographie;
}

// ─── Helpers de merge ────────────────────────────────────────────────────────

/** Timestamp effectif pour comparer deux versions d'une entité. */
function tsOf(e: WithIdAndUpdated): number {
  return e.updatedAt || e.createdAt || 0;
}

/**
 * Merge deux listes d'entités identifiées par `id`, en prenant la version
 * la plus récente de chaque côté. Les tombstones (`deletedIds`) suppriment
 * définitivement les entrées correspondantes du résultat.
 */
function mergeWithTombstones<T extends WithIdAndUpdated>(
  local: T[],
  server: T[],
  tombstones: { id: string; deletedAt: number | string }[],
): T[] {
  // Convertir tombstones en map id → deletedAt (ms)
  const tombMap = new Map<string, number>();
  for (const t of tombstones) {
    const ts = typeof t.deletedAt === 'string' ? Date.parse(t.deletedAt) : t.deletedAt;
    if (!Number.isFinite(ts)) continue;
    const prev = tombMap.get(t.id) || 0;
    if (ts > prev) tombMap.set(t.id, ts);
  }

  // Build merged map by id.
  const merged = new Map<string, T>();
  for (const e of [...server, ...local]) {
    if (!e || !e.id) continue;
    const existing = merged.get(e.id);
    if (!existing) { merged.set(e.id, e); continue; }
    if (tsOf(e) > tsOf(existing)) merged.set(e.id, e);
  }

  // Filtrer par tombstone : si tombstone.deletedAt > entity.updatedAt → supprimé.
  const out: T[] = [];
  for (const [id, e] of merged) {
    const tombTs = tombMap.get(id);
    if (tombTs !== undefined && tombTs >= tsOf(e)) continue;
    out.push(e);
  }
  return out;
}

/** Merge l'union de deux listes de tombstones (par id, deletedAt le plus récent gagne). */
function mergeTombstones(
  local: CartographieTombstoneEntry[] | undefined,
  serverWire: CartographieTombstone[] | undefined,
): CartographieTombstoneEntry[] {
  const out = new Map<string, number>();
  for (const t of local || []) out.set(t.id, Math.max(out.get(t.id) || 0, t.deletedAt || 0));
  for (const t of serverWire || []) {
    const ts = Date.parse(t.deletedAt);
    if (!Number.isFinite(ts)) continue;
    out.set(t.id, Math.max(out.get(t.id) || 0, ts));
  }
  return Array.from(out, ([id, deletedAt]) => ({ id, deletedAt }));
}

/** Convertit une tombstone interne (deletedAt: number) au format wire (string ISO). */
function tombstonesToWire(list: CartographieTombstoneEntry[] | undefined): CartographieTombstone[] {
  if (!list) return [];
  return list.map(t => ({ id: t.id, deletedAt: new Date(t.deletedAt).toISOString() }));
}

/** Convertit un format wire (deletedAt: string ISO) en tombstones internes. */
function tombstonesFromWire(list: CartographieTombstone[] | undefined): CartographieTombstoneEntry[] {
  if (!list) return [];
  return list
    .map(t => ({ id: t.id, deletedAt: Date.parse(t.deletedAt) }))
    .filter(t => Number.isFinite(t.deletedAt));
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class CartographieOverlaySyncService {
  private static instance: CartographieOverlaySyncService;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private serverVersion = 0;
  private dirty = false;
  private initialized = false;

  static getInstance(): CartographieOverlaySyncService {
    if (!CartographieOverlaySyncService.instance) {
      CartographieOverlaySyncService.instance = new CartographieOverlaySyncService();
    }
    return CartographieOverlaySyncService.instance;
  }

  /**
   * À appeler une fois (dans le composant racine du module Cartographie) :
   * branche le listener du store pour déclencher des pushs après chaque
   * mutation, et lance la première sync.
   */
  start(): void {
    registerCartographieOverlayMutationListener(() => this.schedulePush());
    this.startPeriodic();
    this.sync().catch(err => console.error('CartographieSync.initial', err));
  }

  stop(): void {
    registerCartographieOverlayMutationListener(null);
    this.stopPeriodic();
  }

  startPeriodic(): void {
    if (this.periodicTimer) return;
    this.periodicTimer = setInterval(() => {
      this.sync().catch(err => console.error('CartographieSync.periodic', err));
    }, PERIODIC_SYNC_MS);
  }

  stopPeriodic(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  schedulePush(): void {
    this.dirty = true;
    if (!isCartographieSyncAvailable()) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.sync().catch(err => console.error('CartographieSync.schedulePush', err));
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

  async sync(): Promise<void> {
    if (!isCartographieSyncAvailable()) return;
    if (this.inFlight) {
      await this.inFlight;
      return;
    }
    this.inFlight = this.performSync().finally(() => {
      this.inFlight = null;
    });
    await this.inFlight;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // ─── Implémentation ────────────────────────────────────────────────────────

  private async performSync(): Promise<void> {
    try {
      // 1. Pruner les tombstones expirés avant de pousser, pour éviter de
      //    faire grossir le fichier serveur indéfiniment.
      pruneCartographieTombstones();

      // 2. Pull serveur en parallèle de la lecture du store local.
      const [serverFile, local] = await Promise.all([
        this.pullServer(),
        Promise.resolve(this.snapshotLocal()),
      ]);

      this.serverVersion = serverFile?.version ?? 0;

      // 3. Merge intelligent côté entités + tombstones.
      const merged = this.merge(local, serverFile);

      // 4. Si le merge change l'état local, on l'applique au store et on
      //    persiste *immédiatement* sur disque (force flush) : applyServerSnapshot
      //    ne marque PAS dirty (sinon l'utilisateur verrait "Enregistrer*"
      //    juste après l'ouverture du module sans avoir rien modifié).
      const localChanged = !this.snapshotsEqual(local, merged);
      if (localChanged) {
        useCartographieOverlayStore.getState().applyServerSnapshot(merged);
        try {
          await forceFlushCartographieOverlay();
        } catch (err) {
          console.error('CartographieSync: forceFlush after merge failed', err);
        }
        emitSyncCompleted('audience'); // pas de scope dédié pour l'instant — réutilise le scope existant
      }

      // 5. Décider du push : `dirty` (mutation locale) OU le merge a
      //    introduit du nouveau côté serveur depuis le snapshot serveur.
      const needsPush = !serverFile
        || this.dirty
        || !this.snapshotsEqual(merged, this.serverFileToSnapshot(serverFile));

      if (needsPush) {
        const user = await getCurrentUserInfo();
        const payload: CartographieOverlaySyncFile = {
          ...buildMetadata(this.serverVersion, user),
          pinnedMecIds: merged.pinnedMecIds,
          mecsExNihilo: merged.mecsExNihilo,
          dossiersExNihilo: merged.dossiersExNihilo,
          liensRenseignement: merged.liensRenseignement,
          clusterAnnotations: merged.clusterAnnotations,
          mecScoreBoosts: merged.mecScoreBoosts,
          tagZones: merged.tagZones,
          deletedMecExNihiloIds: tombstonesToWire(merged.deletedMecExNihiloIds),
          deletedDossierExNihiloIds: tombstonesToWire(merged.deletedDossierExNihiloIds),
          deletedLienIds: tombstonesToWire(merged.deletedLienIds),
          deletedClusterAnnotationIds: tombstonesToWire(merged.deletedClusterAnnotationIds),
          deletedMecScoreBoostIds: tombstonesToWire(merged.deletedMecScoreBoostIds),
          deletedTagZones: tombstonesToWire(merged.deletedTagZones),
          deletedPinnedMecIds: tombstonesToWire(merged.deletedPinnedMecIds),
        };
        const ok = await this.pushServer(payload);
        if (ok) {
          this.serverVersion = payload.version;
          this.dirty = false;
        }
      } else {
        this.dirty = false;
      }

      this.initialized = true;
    } catch (error) {
      console.error('❌ CartographieSync: sync échouée', error);
    }
  }

  private snapshotLocal(): LocalSnapshot {
    const s = useCartographieOverlayStore.getState();
    return {
      pinnedMecIds: s.pinnedMecIds,
      mecsExNihilo: s.mecsExNihilo,
      dossiersExNihilo: s.dossiersExNihilo,
      liensRenseignement: s.liensRenseignement,
      clusterAnnotations: s.clusterAnnotations,
      mecScoreBoosts: s.mecScoreBoosts.map(b => ({ ...b, id: b.mecId })),
      tagZones: s.tagZones || [],
      deletedMecExNihiloIds: s.deletedMecExNihiloIds || [],
      deletedDossierExNihiloIds: s.deletedDossierExNihiloIds || [],
      deletedLienIds: s.deletedLienIds || [],
      deletedClusterAnnotationIds: s.deletedClusterAnnotationIds || [],
      deletedMecScoreBoostIds: s.deletedMecScoreBoostIds || [],
      deletedTagZones: s.deletedTagZones || [],
      deletedPinnedMecIds: s.deletedPinnedMecIds || [],
    };
  }

  private serverFileToSnapshot(file: CartographieOverlaySyncFile): LocalSnapshot {
    return {
      pinnedMecIds: file.pinnedMecIds || [],
      mecsExNihilo: (file.mecsExNihilo || []) as MecExNihilo[],
      dossiersExNihilo: (file.dossiersExNihilo || []) as DossierExNihilo[],
      liensRenseignement: (file.liensRenseignement || []) as LienRenseignement[],
      clusterAnnotations: (file.clusterAnnotations || []) as ClusterAnnotation[],
      mecScoreBoosts: ((file.mecScoreBoosts || []) as MecScoreBoost[])
        .map(b => ({ ...b, id: b.mecId })),
      tagZones: (file.tagZones || []) as TagZoneAssignment[],
      deletedMecExNihiloIds: tombstonesFromWire(file.deletedMecExNihiloIds),
      deletedDossierExNihiloIds: tombstonesFromWire(file.deletedDossierExNihiloIds),
      deletedLienIds: tombstonesFromWire(file.deletedLienIds),
      deletedClusterAnnotationIds: tombstonesFromWire(file.deletedClusterAnnotationIds),
      deletedMecScoreBoostIds: tombstonesFromWire(file.deletedMecScoreBoostIds),
      deletedTagZones: tombstonesFromWire(file.deletedTagZones),
      deletedPinnedMecIds: tombstonesFromWire(file.deletedPinnedMecIds),
    };
  }

  private merge(local: LocalSnapshot, serverFile: CartographieOverlaySyncFile | null): MergedSnapshot {
    const server = serverFile ? this.serverFileToSnapshot(serverFile) : emptySnapshot();

    // Tombstones d'abord : leur union est la base pour filtrer les entités.
    const deletedMec = mergeTombstones(local.deletedMecExNihiloIds, serverFile?.deletedMecExNihiloIds);
    const deletedDossier = mergeTombstones(local.deletedDossierExNihiloIds, serverFile?.deletedDossierExNihiloIds);
    const deletedLien = mergeTombstones(local.deletedLienIds, serverFile?.deletedLienIds);
    const deletedCluster = mergeTombstones(local.deletedClusterAnnotationIds, serverFile?.deletedClusterAnnotationIds);
    const deletedBoost = mergeTombstones(local.deletedMecScoreBoostIds, serverFile?.deletedMecScoreBoostIds);
    const deletedTagZone = mergeTombstones(local.deletedTagZones, serverFile?.deletedTagZones);
    const deletedPinned = mergeTombstones(local.deletedPinnedMecIds, serverFile?.deletedPinnedMecIds);

    // Pinned : union des deux ensembles, moins les ids présents dans les
    // tombstones. Le re-pinnage côté store retire l'id des tombstones, donc
    // une nouvelle épingle survit au merge.
    const pinnedTombSet = new Set(deletedPinned.map(t => t.id));
    const pinnedUnion = Array.from(new Set([...(local.pinnedMecIds || []), ...(server.pinnedMecIds || [])]));
    const mergedPinned = pinnedUnion.filter(id => !pinnedTombSet.has(id));

    return {
      pinnedMecIds: mergedPinned,
      mecsExNihilo: mergeWithTombstones(local.mecsExNihilo, server.mecsExNihilo, deletedMec),
      dossiersExNihilo: mergeWithTombstones(local.dossiersExNihilo, server.dossiersExNihilo, deletedDossier),
      liensRenseignement: mergeWithTombstones(local.liensRenseignement, server.liensRenseignement, deletedLien),
      clusterAnnotations: mergeWithTombstones(local.clusterAnnotations, server.clusterAnnotations, deletedCluster),
      // mecScoreBoosts : key = mecId. On a synthétisé `id = mecId` plus haut
      // pour réutiliser le même algo de merge.
      mecScoreBoosts: mergeWithTombstones(local.mecScoreBoosts, server.mecScoreBoosts, deletedBoost)
        .map((b: MecScoreBoost & { id: string }) => {
          const { id: _id, ...rest } = b;
          void _id;
          return rest as MecScoreBoost;
        }),
      // tagZones : key = tag, last-write-wins via updatedAt + tombstones par
      // tag pour que la suppression d'une assignation se propage entre postes.
      tagZones: mergeTagZones(local.tagZones, server.tagZones, deletedTagZone),
      deletedMecExNihiloIds: deletedMec,
      deletedDossierExNihiloIds: deletedDossier,
      deletedLienIds: deletedLien,
      deletedClusterAnnotationIds: deletedCluster,
      deletedMecScoreBoostIds: deletedBoost,
      deletedTagZones: deletedTagZone,
      deletedPinnedMecIds: deletedPinned,
    };
  }

  private snapshotsEqual(
    a: LocalSnapshot | MergedSnapshot,
    b: LocalSnapshot | MergedSnapshot,
  ): boolean {
    return canonicalSnapshot(a) === canonicalSnapshot(b);
  }

  private async pullServer(): Promise<CartographieOverlaySyncFile | null> {
    if (!window.electronAPI?.globalSync_pullCartographie) return null;
    return (await window.electronAPI.globalSync_pullCartographie()) || null;
  }

  private async pushServer(payload: CartographieOverlaySyncFile): Promise<boolean> {
    if (!window.electronAPI?.globalSync_pushCartographie) return false;
    return await window.electronAPI.globalSync_pushCartographie(payload);
  }
}

// ─── Types internes ──────────────────────────────────────────────────────────

interface LocalSnapshot {
  pinnedMecIds: string[];
  mecsExNihilo: MecExNihilo[];
  dossiersExNihilo: DossierExNihilo[];
  liensRenseignement: LienRenseignement[];
  clusterAnnotations: ClusterAnnotation[];
  // On ajoute virtuellement un `id` (= mecId) pour que les boosts passent
  // par le même algo de merge que les autres entités.
  mecScoreBoosts: (MecScoreBoost & { id: string })[];
  tagZones: TagZoneAssignment[];
  deletedMecExNihiloIds: CartographieTombstoneEntry[];
  deletedDossierExNihiloIds: CartographieTombstoneEntry[];
  deletedLienIds: CartographieTombstoneEntry[];
  deletedClusterAnnotationIds: CartographieTombstoneEntry[];
  deletedMecScoreBoostIds: CartographieTombstoneEntry[];
  deletedTagZones: CartographieTombstoneEntry[];
  deletedPinnedMecIds: CartographieTombstoneEntry[];
}

type MergedSnapshot = Omit<LocalSnapshot, 'mecScoreBoosts'> & {
  mecScoreBoosts: MecScoreBoost[];
};

function emptySnapshot(): LocalSnapshot {
  return {
    pinnedMecIds: [],
    mecsExNihilo: [],
    dossiersExNihilo: [],
    liensRenseignement: [],
    clusterAnnotations: [],
    mecScoreBoosts: [],
    tagZones: [],
    deletedMecExNihiloIds: [],
    deletedDossierExNihiloIds: [],
    deletedLienIds: [],
    deletedClusterAnnotationIds: [],
    deletedMecScoreBoostIds: [],
    deletedTagZones: [],
    deletedPinnedMecIds: [],
  };
}

/**
 * Sérialise un snapshot de manière déterministe pour comparaison d'égalité.
 *
 * Les comparaisons naïves via JSON.stringify produisent des faux positifs
 * "localChanged" pour deux raisons subtiles :
 *   1. `mecScoreBoosts` a un champ `id` synthétique côté LocalSnapshot
 *      (= mecId), strippé côté MergedSnapshot — donc les deux ne stringify
 *      jamais à la même chose même quand les données sont identiques.
 *   2. L'ordre des entrées dans les listes peut varier entre local et serveur
 *      (deux postes peuvent stocker les mêmes entités dans un ordre différent).
 *
 * On normalise donc en triant chaque liste par son identifiant naturel et
 * en strippant les champs synthétiques, avant le stringify final.
 */
function canonicalSnapshot(s: LocalSnapshot | MergedSnapshot): string {
  const stripId = <T extends { id?: unknown }>(arr: T[] | undefined): Omit<T, 'id'>[] =>
    (arr || []).map(e => {
      const { id: _id, ...rest } = e;
      void _id;
      return rest;
    });
  const sortBy = <T>(arr: T[] | undefined, key: (e: T) => string): T[] =>
    [...(arr || [])].sort((a, b) => key(a).localeCompare(key(b)));

  const norm = {
    pinnedMecIds: [...(s.pinnedMecIds || [])].sort(),
    mecsExNihilo: sortBy(s.mecsExNihilo, e => e.id),
    dossiersExNihilo: sortBy(s.dossiersExNihilo, e => e.id),
    liensRenseignement: sortBy(s.liensRenseignement, e => e.id),
    clusterAnnotations: sortBy(s.clusterAnnotations, e => e.id),
    // strippe `id` synthétique avant tri (clé = mecId).
    mecScoreBoosts: sortBy(stripId(s.mecScoreBoosts as { id?: string; mecId: string }[]), e => e.mecId),
    tagZones: sortBy(s.tagZones, e => e.tag),
    deletedMecExNihiloIds: sortBy(s.deletedMecExNihiloIds, e => e.id),
    deletedDossierExNihiloIds: sortBy(s.deletedDossierExNihiloIds, e => e.id),
    deletedLienIds: sortBy(s.deletedLienIds, e => e.id),
    deletedClusterAnnotationIds: sortBy(s.deletedClusterAnnotationIds, e => e.id),
    deletedMecScoreBoostIds: sortBy(s.deletedMecScoreBoostIds, e => e.id),
    deletedTagZones: sortBy(s.deletedTagZones, e => e.id),
    deletedPinnedMecIds: sortBy(s.deletedPinnedMecIds, e => e.id),
  };
  return JSON.stringify(norm);
}

/**
 * Merge tagZones par `tag` avec last-write-wins via `updatedAt`, en filtrant
 * les tags présents dans les tombstones (clé tombstone.id = tag). Sans
 * tombstones, supprimer une assignation localement était silencieusement
 * annulé au prochain pull car le serveur conservait l'entrée.
 */
function mergeTagZones(
  local: TagZoneAssignment[],
  server: TagZoneAssignment[],
  tombstones: CartographieTombstoneEntry[],
): TagZoneAssignment[] {
  const tombMap = new Map<string, number>();
  for (const t of tombstones) {
    const prev = tombMap.get(t.id) || 0;
    if (t.deletedAt > prev) tombMap.set(t.id, t.deletedAt);
  }
  const byTag = new Map<string, TagZoneAssignment>();
  for (const entry of [...server, ...local]) {
    const cur = byTag.get(entry.tag);
    const curTs = cur?.updatedAt || 0;
    const newTs = entry.updatedAt || 0;
    if (!cur || newTs >= curTs) byTag.set(entry.tag, entry);
  }
  // Filtrer les entrées dont le tombstone est plus récent que l'updatedAt.
  const out: TagZoneAssignment[] = [];
  for (const [tag, entry] of byTag) {
    const tombTs = tombMap.get(tag);
    if (tombTs !== undefined && tombTs >= (entry.updatedAt || 0)) continue;
    out.push(entry);
  }
  return out;
}

export const cartographieOverlaySyncService = CartographieOverlaySyncService.getInstance();
