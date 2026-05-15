// stores/useCartographieOverlayStore.ts
// Store Zustand pour les données utilisateur surimposées au graphe de
// cartographie : MEC ex nihilo, dossiers ex nihilo, liens "renseignement"
// manuels, et MEC épinglés au Top 10.
//
// Persistance locale via ElectronBridge (clé `cartographie_overlays`).
// Persistance partagée via CartographieOverlaySyncService (fichier
// cartographie-overlays.json sur le serveur commun) : les ajouts sont
// fusionnés entre collègues par timestamp `updatedAt`, les suppressions
// sont préservées via tombstones (sinon un poste désynchronisé pourrait
// ressusciter une entrée qu'un collègue vient de supprimer).
//
// Mode offline : on charge à l'ouverture du module et on flush à la fermeture
// (les écritures intermédiaires sont juste marquées dirty en mémoire) —
// la cartographie est trop lourde pour supporter une écriture par modification.

import { create } from '@/lib/zustand';
import { ElectronBridge } from '@/utils/electronBridge';
import { normalizeMecName } from '@/utils/mindmapGraph';

const STORAGE_KEY = 'cartographie_overlays';

export type MecExNihiloStatut = 'actif' | 'dormant' | 'decede' | 'libere';

export interface MecExNihilo {
  /** Identifiant canonique (nom normalisé) — fusionnable avec un MEC réel */
  id: string;
  displayName: string;
  alias: string[];
  statut?: MecExNihiloStatut;
  notes?: string;
  createdAt: number;
  /** Mis à jour à chaque modification — sert au merge inter-postes. */
  updatedAt?: number;
}

export interface DossierExNihilo {
  /** Identifiant interne unique (préfixé pour ne pas collisionner avec les vrais dossiers) */
  id: string;
  /** Libellé court (ex. "Réseau ZOUAOUI", "2018-1234 vieux jugement") */
  label: string;
  /** Date approximative au format ISO ou texte libre */
  dateApprox?: string;
  /** IDs canoniques des MEC liés (réels ou ex nihilo) */
  mecIds: string[];
  /** IDs des tags de type d'infraction associés (catégorie 'infractions').
   *  Utilisé uniquement par la cartographie pour pondérer le score top 10 —
   *  ces tags ne remontent PAS dans les stats globales. */
  typeInfractionTagIds?: string[];
  notes?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface LienRenseignement {
  id: string;
  /** ID du nœud source (MEC canonique ou dossierId) */
  source: string;
  target: string;
  label?: string;
  notes?: string;
  createdAt: number;
  updatedAt?: number;
}

/**
 * Annotation manuelle d'une aire d'influence ("réseau Marseille",
 * "groupe TAURUS"...). Ancrée à un ensemble d'IDs de nœuds : on considère
 * que l'annotation s'applique à un cluster détecté si le recouvrement
 * Jaccard est ≥ 0.5 (cf. matchAnnotation côté influenceHull). Cette
 * tolérance permet aux annotations de survivre à l'ajout/retrait de
 * quelques membres au cluster sans devoir être ré-attachées à la main.
 */
export interface ClusterAnnotation {
  id: string;
  label: string;
  notes?: string;
  /** Couleur custom optionnelle (sinon couleur héritée du contentieux dominant). */
  color?: string;
  /** Snapshot des IDs de nœuds composant le cluster au moment de l'annotation. */
  nodeIds: string[];
  createdAt: number;
  updatedAt?: number;
}

/**
 * Tombstone interne au store. Trace les ids supprimés localement pour que
 * la sync puisse les pousser au serveur, et permet au merge entrant de
 * supprimer un id qu'un autre poste viendrait à pousser à nouveau (sinon
 * la suppression locale serait silencieusement annulée par le re-push
 * d'un poste désynchronisé).
 */
export interface CartographieTombstoneEntry {
  id: string;
  deletedAt: number;
}

/**
 * Bonus de score appliqué manuellement à un MEC. L'utilisateur peut booster
 * (ou minorer) la pondération d'une personne qu'il sait plus importante que
 * ce que la formule automatique calcule. Additionné après la formule
 * (dossier × 2 + contentieux × 3 + ME × 1 + chefs × 0.3) × 1.2 si récent.
 */
export interface MecScoreBoost {
  /** ID canonique du MEC (cf. normalizeMecName). */
  mecId: string;
  /** Bonus en points bruts (typiquement -10 à +20). */
  bonus: number;
  /** Justification libre (visible dans le side panel). */
  reason?: string;
  updatedAt: number;
}

/**
 * Assignation d'un tag (typiquement un service d'enquête, mais peut être
 * n'importe quelle valeur de tag) à une zone géographique. Sert à structurer
 * la cartographie : tous les dossiers portant ce tag (et leurs MEC associés)
 * sont attirés vers le puits de gravité de la zone correspondante. Les
 * services eux-mêmes ne sont pas matérialisés comme des nœuds — seule la
 * direction d'attraction est visible.
 */
export interface TagZoneAssignment {
  /** Valeur exacte du tag (cf. Tag.value). Utilisé en clé. */
  tag: string;
  /** Zone parmi les 9 cardinales (cf. components/mindmap/zones.ts). */
  zone: 'centre' | 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
  updatedAt: number;
}

interface PersistedOverlay {
  pinnedMecIds: string[];
  mecsExNihilo: MecExNihilo[];
  dossiersExNihilo: DossierExNihilo[];
  liensRenseignement: LienRenseignement[];
  clusterAnnotations: ClusterAnnotation[];
  mecScoreBoosts: MecScoreBoost[];
  tagZones: TagZoneAssignment[];
  // Tombstones par catégorie (toutes optionnelles pour rétrocompat).
  deletedMecExNihiloIds?: CartographieTombstoneEntry[];
  deletedDossierExNihiloIds?: CartographieTombstoneEntry[];
  deletedLienIds?: CartographieTombstoneEntry[];
  deletedClusterAnnotationIds?: CartographieTombstoneEntry[];
  deletedMecScoreBoostIds?: CartographieTombstoneEntry[];
  // tag → zone : id = tag (cf. mergeTagZones côté sync service).
  deletedTagZones?: CartographieTombstoneEntry[];
  // Tombstones d'épinglage : trace les MEC désépinglés pour que le merge
  // de sync ne ressuscite pas l'épingle depuis un poste qui l'a encore.
  deletedPinnedMecIds?: CartographieTombstoneEntry[];
}

interface OverlayState extends PersistedOverlay {
  isLoaded: boolean;
  load: () => Promise<void>;
  /** Persiste immédiatement les modifications en attente sur disque. */
  flush: () => Promise<void>;
  /** True si des modifications locales attendent d'être persistées. */
  hasPendingChanges: () => boolean;
  /** Remplace l'état complet du store (utilisé par le sync service après merge). */
  applyServerSnapshot: (snapshot: Partial<PersistedOverlay>) => void;

  // épinglage
  pinMec: (mecId: string) => void;
  unpinMec: (mecId: string) => void;
  togglePinMec: (mecId: string) => void;
  isPinned: (mecId: string) => boolean;

  // MEC ex nihilo
  addMec: (input: { displayName: string; alias?: string[]; statut?: MecExNihiloStatut; notes?: string }) => string;
  updateMec: (id: string, patch: Partial<Omit<MecExNihilo, 'id' | 'createdAt'>>) => void;
  removeMec: (id: string) => void;

  // Dossier ex nihilo
  addDossier: (input: { label: string; dateApprox?: string; mecIds?: string[]; typeInfractionTagIds?: string[]; notes?: string }) => string;
  updateDossier: (id: string, patch: Partial<Omit<DossierExNihilo, 'id' | 'createdAt'>>) => void;
  removeDossier: (id: string) => void;

  // Liens renseignement
  addLien: (input: { source: string; target: string; label?: string; notes?: string }) => string;
  updateLien: (id: string, patch: Partial<Omit<LienRenseignement, 'id' | 'createdAt'>>) => void;
  removeLien: (id: string) => void;

  // Annotations de cluster
  addClusterAnnotation: (input: { label: string; notes?: string; color?: string; nodeIds: string[] }) => string;
  updateClusterAnnotation: (id: string, patch: Partial<Omit<ClusterAnnotation, 'id' | 'createdAt'>>) => void;
  removeClusterAnnotation: (id: string) => void;

  // Boosts de score MEC
  setMecScoreBoost: (mecId: string, bonus: number, reason?: string) => void;
  removeMecScoreBoost: (mecId: string) => void;

  // Assignation tag → zone géographique
  setTagZone: (tag: string, zone: TagZoneAssignment['zone']) => void;
  removeTagZone: (tag: string) => void;
}

const EMPTY: PersistedOverlay = {
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

/**
 * TTL des tombstones de cartographie. Au-delà, on les efface pour ne pas
 * faire grossir le fichier indéfiniment. 30 jours = largement suffisant
 * pour que tous les postes aient eu le temps de pull au moins une fois.
 */
export const CARTO_TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function pruneTombstones(
  list: CartographieTombstoneEntry[] | undefined,
  now: number,
): CartographieTombstoneEntry[] {
  if (!list) return [];
  const cutoff = now - CARTO_TOMBSTONE_TTL_MS;
  return list.filter(t => t.deletedAt > cutoff);
}

function appendTombstone(
  list: CartographieTombstoneEntry[] | undefined,
  id: string,
): CartographieTombstoneEntry[] {
  const next = (list || []).filter(t => t.id !== id);
  next.push({ id, deletedAt: Date.now() });
  return next;
}

const DOSSIER_EXN_PREFIX = 'dexn_';
const LIEN_PREFIX = 'lien_';
const CLUSTER_PREFIX = 'cluster_';

function uniqueId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

let _isDirty = false;

// Listener optionnel branché par CartographieOverlaySyncService — on garde le
// store agnostique du service (pas d'import circulaire) et on laisse le
// service s'enregistrer après son instanciation.
let _onMutateListener: (() => void) | null = null;

export function registerCartographieOverlayMutationListener(cb: (() => void) | null): void {
  _onMutateListener = cb;
}

/**
 * Persiste l'état actuel du store sur disque sans dépendre du drapeau dirty.
 * Utilisé par le sync service après applyServerSnapshot pour qu'un merge
 * serveur soit immédiatement écrit en local, sans faire apparaître
 * "Enregistrer*" à l'utilisateur (qui n'a rien modifié).
 */
export function forceFlushCartographieOverlay(): Promise<void> {
  return _flush(true);
}

async function _flush(force = false): Promise<void> {
  if (!force && !_isDirty) return;
  try {
    const s = useCartographieOverlayStore.getState();
    const payload: PersistedOverlay = {
      pinnedMecIds: s.pinnedMecIds,
      mecsExNihilo: s.mecsExNihilo,
      dossiersExNihilo: s.dossiersExNihilo,
      liensRenseignement: s.liensRenseignement,
      clusterAnnotations: s.clusterAnnotations,
      mecScoreBoosts: s.mecScoreBoosts,
      tagZones: s.tagZones,
      deletedMecExNihiloIds: s.deletedMecExNihiloIds,
      deletedDossierExNihiloIds: s.deletedDossierExNihiloIds,
      deletedLienIds: s.deletedLienIds,
      deletedClusterAnnotationIds: s.deletedClusterAnnotationIds,
      deletedMecScoreBoostIds: s.deletedMecScoreBoostIds,
      deletedTagZones: s.deletedTagZones,
      deletedPinnedMecIds: s.deletedPinnedMecIds,
    };
    await ElectronBridge.setData(STORAGE_KEY, payload);
    _isDirty = false;
  } catch (error) {
    console.error('❌ CartographieOverlayStore: erreur sauvegarde', error);
  }
}

function markDirty(): void {
  _isDirty = true;
  if (_onMutateListener) {
    try { _onMutateListener(); } catch { /* listener non bloquant */ }
  }
}

export const useCartographieOverlayStore = create<OverlayState>((set, get) => ({
  ...EMPTY,
  isLoaded: false,

  load: async () => {
    if (get().isLoaded) return;
    try {
      const data = await ElectronBridge.getData<PersistedOverlay>(STORAGE_KEY, EMPTY);
      set({
        pinnedMecIds: data.pinnedMecIds || [],
        mecsExNihilo: data.mecsExNihilo || [],
        dossiersExNihilo: data.dossiersExNihilo || [],
        liensRenseignement: data.liensRenseignement || [],
        clusterAnnotations: data.clusterAnnotations || [],
        mecScoreBoosts: data.mecScoreBoosts || [],
        tagZones: data.tagZones || [],
        deletedMecExNihiloIds: data.deletedMecExNihiloIds || [],
        deletedDossierExNihiloIds: data.deletedDossierExNihiloIds || [],
        deletedLienIds: data.deletedLienIds || [],
        deletedClusterAnnotationIds: data.deletedClusterAnnotationIds || [],
        deletedMecScoreBoostIds: data.deletedMecScoreBoostIds || [],
        deletedTagZones: data.deletedTagZones || [],
        deletedPinnedMecIds: data.deletedPinnedMecIds || [],
        isLoaded: true,
      });
    } catch (error) {
      console.error('❌ CartographieOverlayStore: erreur chargement', error);
      set({ isLoaded: true });
    }
  },

  flush: () => _flush(),

  hasPendingChanges: () => _isDirty,

  // Hydratation depuis un snapshot serveur déjà mergé. NE marque PAS dirty :
  // l'utilisateur n'a rien modifié, c'est le serveur qui s'est mis à jour.
  // C'est au sync service d'appeler ensuite forceFlush() pour persister
  // l'état mergé sur le disque local sans faire clignoter "Enregistrer*".
  applyServerSnapshot: (snapshot) => {
    set({
      pinnedMecIds: snapshot.pinnedMecIds ?? get().pinnedMecIds,
      mecsExNihilo: snapshot.mecsExNihilo ?? get().mecsExNihilo,
      dossiersExNihilo: snapshot.dossiersExNihilo ?? get().dossiersExNihilo,
      liensRenseignement: snapshot.liensRenseignement ?? get().liensRenseignement,
      clusterAnnotations: snapshot.clusterAnnotations ?? get().clusterAnnotations,
      mecScoreBoosts: snapshot.mecScoreBoosts ?? get().mecScoreBoosts,
      tagZones: snapshot.tagZones ?? get().tagZones,
      deletedMecExNihiloIds: snapshot.deletedMecExNihiloIds ?? get().deletedMecExNihiloIds,
      deletedDossierExNihiloIds: snapshot.deletedDossierExNihiloIds ?? get().deletedDossierExNihiloIds,
      deletedLienIds: snapshot.deletedLienIds ?? get().deletedLienIds,
      deletedClusterAnnotationIds: snapshot.deletedClusterAnnotationIds ?? get().deletedClusterAnnotationIds,
      deletedMecScoreBoostIds: snapshot.deletedMecScoreBoostIds ?? get().deletedMecScoreBoostIds,
      deletedTagZones: snapshot.deletedTagZones ?? get().deletedTagZones,
      deletedPinnedMecIds: snapshot.deletedPinnedMecIds ?? get().deletedPinnedMecIds,
    });
  },

  // ── Épinglage ────────────────────────────────

  pinMec: (mecId) => {
    const id = normalizeMecName(mecId) || mecId;
    const current = get().pinnedMecIds;
    if (current.includes(id)) return;
    // Re-pin après désépinglage : retirer le tombstone pour qu'il ne ré-évince
    // pas l'épingle au prochain merge serveur.
    const tombs = get().deletedPinnedMecIds || [];
    const nextTombs = tombs.some(t => t.id === id) ? tombs.filter(t => t.id !== id) : tombs;
    set({ pinnedMecIds: [...current, id], deletedPinnedMecIds: nextTombs });
    markDirty();
  },

  unpinMec: (mecId) => {
    const id = normalizeMecName(mecId) || mecId;
    const current = get().pinnedMecIds;
    if (!current.includes(id)) return;
    set({
      pinnedMecIds: current.filter(p => p !== id),
      deletedPinnedMecIds: appendTombstone(get().deletedPinnedMecIds, id),
    });
    markDirty();
  },

  togglePinMec: (mecId) => {
    const id = normalizeMecName(mecId) || mecId;
    const { pinnedMecIds } = get();
    if (pinnedMecIds.includes(id)) {
      set({
        pinnedMecIds: pinnedMecIds.filter(p => p !== id),
        deletedPinnedMecIds: appendTombstone(get().deletedPinnedMecIds, id),
      });
    } else {
      const tombs = get().deletedPinnedMecIds || [];
      const nextTombs = tombs.some(t => t.id === id) ? tombs.filter(t => t.id !== id) : tombs;
      set({ pinnedMecIds: [...pinnedMecIds, id], deletedPinnedMecIds: nextTombs });
    }
    markDirty();
  },

  isPinned: (mecId) => {
    const id = normalizeMecName(mecId) || mecId;
    return get().pinnedMecIds.includes(id);
  },

  // ── MEC ex nihilo ────────────────────────────

  addMec: (input) => {
    const canonical = normalizeMecName(input.displayName);
    if (!canonical) return '';
    const now = Date.now();
    const existing = get().mecsExNihilo.find(m => m.id === canonical);
    if (existing) {
      // Idempotent : merge alias/notes/statut sans écraser les valeurs non vides
      const merged: MecExNihilo = {
        ...existing,
        displayName: input.displayName || existing.displayName,
        alias: Array.from(new Set([...(existing.alias || []), ...(input.alias || [])])),
        statut: input.statut ?? existing.statut,
        notes: input.notes || existing.notes,
        updatedAt: now,
      };
      set({ mecsExNihilo: get().mecsExNihilo.map(m => m.id === canonical ? merged : m) });
      markDirty();
      return canonical;
    }
    const created: MecExNihilo = {
      id: canonical,
      displayName: input.displayName,
      alias: input.alias || [],
      statut: input.statut,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    };
    set({ mecsExNihilo: [...get().mecsExNihilo, created] });
    markDirty();
    return canonical;
  },

  updateMec: (id, patch) => {
    const list = get().mecsExNihilo;
    const idx = list.findIndex(m => m.id === id);
    if (idx < 0) return;
    const next = [...list];
    next[idx] = { ...next[idx], ...patch, updatedAt: Date.now() };
    set({ mecsExNihilo: next });
    markDirty();
  },

  removeMec: (id) => {
    const list = get().mecsExNihilo;
    if (!list.some(m => m.id === id)) return;
    // Cascade : retirer cet id des dossiers ex nihilo et des liens.
    // Les ids cascadés héritent eux aussi d'un updatedAt frais pour
    // que le merge propage la modification.
    const now = Date.now();
    const dossiers = get().dossiersExNihilo.map(d => {
      if (!d.mecIds.includes(id)) return d;
      return {
        ...d,
        mecIds: d.mecIds.filter(mid => mid !== id),
        updatedAt: now,
      };
    });
    const liens = get().liensRenseignement.filter(l => l.source !== id && l.target !== id);
    const removedLienIds = get().liensRenseignement.filter(l => l.source === id || l.target === id).map(l => l.id);
    const pinned = get().pinnedMecIds.filter(p => p !== id);
    set({
      mecsExNihilo: list.filter(m => m.id !== id),
      dossiersExNihilo: dossiers,
      liensRenseignement: liens,
      pinnedMecIds: pinned,
      deletedMecExNihiloIds: appendTombstone(get().deletedMecExNihiloIds, id),
      deletedLienIds: removedLienIds.reduce(
        (acc, lid) => appendTombstone(acc, lid),
        get().deletedLienIds || [],
      ),
    });
    markDirty();
  },

  // ── Dossier ex nihilo ────────────────────────

  addDossier: (input) => {
    const id = uniqueId(DOSSIER_EXN_PREFIX);
    const now = Date.now();
    const created: DossierExNihilo = {
      id,
      label: input.label,
      dateApprox: input.dateApprox,
      mecIds: (input.mecIds || []).map(m => normalizeMecName(m) || m).filter(Boolean),
      typeInfractionTagIds: input.typeInfractionTagIds && input.typeInfractionTagIds.length > 0
        ? [...input.typeInfractionTagIds]
        : undefined,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    };
    set({ dossiersExNihilo: [...get().dossiersExNihilo, created] });
    markDirty();
    return id;
  },

  updateDossier: (id, patch) => {
    const list = get().dossiersExNihilo;
    const idx = list.findIndex(d => d.id === id);
    if (idx < 0) return;
    const next = [...list];
    const cleanedMecIds = patch.mecIds
      ? patch.mecIds.map(m => normalizeMecName(m) || m).filter(Boolean)
      : next[idx].mecIds;
    next[idx] = { ...next[idx], ...patch, mecIds: cleanedMecIds, updatedAt: Date.now() };
    set({ dossiersExNihilo: next });
    markDirty();
  },

  removeDossier: (id) => {
    const list = get().dossiersExNihilo;
    if (!list.some(d => d.id === id)) return;
    // Cascade : retirer les liens qui pointent dessus → tombstones associés.
    const removedLienIds = get().liensRenseignement.filter(l => l.source === id || l.target === id).map(l => l.id);
    const liens = get().liensRenseignement.filter(l => l.source !== id && l.target !== id);
    set({
      dossiersExNihilo: list.filter(d => d.id !== id),
      liensRenseignement: liens,
      deletedDossierExNihiloIds: appendTombstone(get().deletedDossierExNihiloIds, id),
      deletedLienIds: removedLienIds.reduce(
        (acc, lid) => appendTombstone(acc, lid),
        get().deletedLienIds || [],
      ),
    });
    markDirty();
  },

  // ── Liens renseignement ──────────────────────

  addLien: (input) => {
    if (!input.source || !input.target || input.source === input.target) return '';
    // Évite les doublons exacts (mêmes endpoints, même label)
    const existing = get().liensRenseignement.find(
      l => ((l.source === input.source && l.target === input.target) ||
            (l.source === input.target && l.target === input.source)) &&
           (l.label || '') === (input.label || ''),
    );
    if (existing) return existing.id;
    const id = uniqueId(LIEN_PREFIX);
    const now = Date.now();
    const created: LienRenseignement = {
      id,
      source: input.source,
      target: input.target,
      label: input.label,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    };
    set({ liensRenseignement: [...get().liensRenseignement, created] });
    markDirty();
    return id;
  },

  updateLien: (id, patch) => {
    const list = get().liensRenseignement;
    const idx = list.findIndex(l => l.id === id);
    if (idx < 0) return;
    const next = [...list];
    next[idx] = { ...next[idx], ...patch, updatedAt: Date.now() };
    set({ liensRenseignement: next });
    markDirty();
  },

  removeLien: (id) => {
    const list = get().liensRenseignement;
    if (!list.some(l => l.id === id)) return;
    set({
      liensRenseignement: list.filter(l => l.id !== id),
      deletedLienIds: appendTombstone(get().deletedLienIds, id),
    });
    markDirty();
  },

  // ── Annotations de cluster ───────────────────

  addClusterAnnotation: (input) => {
    const label = (input.label || '').trim();
    if (!label || input.nodeIds.length === 0) return '';
    const id = uniqueId(CLUSTER_PREFIX);
    const now = Date.now();
    const created: ClusterAnnotation = {
      id,
      label,
      notes: input.notes,
      color: input.color,
      nodeIds: [...input.nodeIds],
      createdAt: now,
      updatedAt: now,
    };
    set({ clusterAnnotations: [...get().clusterAnnotations, created] });
    markDirty();
    return id;
  },

  updateClusterAnnotation: (id, patch) => {
    const list = get().clusterAnnotations;
    const idx = list.findIndex(c => c.id === id);
    if (idx < 0) return;
    const next = [...list];
    next[idx] = { ...next[idx], ...patch, updatedAt: Date.now() };
    set({ clusterAnnotations: next });
    markDirty();
  },

  removeClusterAnnotation: (id) => {
    const list = get().clusterAnnotations;
    if (!list.some(c => c.id === id)) return;
    set({
      clusterAnnotations: list.filter(c => c.id !== id),
      deletedClusterAnnotationIds: appendTombstone(get().deletedClusterAnnotationIds, id),
    });
    markDirty();
  },

  // ── Boosts de score MEC ──────────────────────

  setMecScoreBoost: (mecId, bonus, reason) => {
    const id = normalizeMecName(mecId) || mecId;
    if (!id) return;
    const list = get().mecScoreBoosts;
    const idx = list.findIndex(b => b.mecId === id);
    // Bonus = 0 (et pas de raison) → on retire l'entrée pour rester clean.
    if (bonus === 0 && !reason) {
      if (idx < 0) return;
      set({ mecScoreBoosts: list.filter(b => b.mecId !== id) });
      markDirty();
      return;
    }
    const next: MecScoreBoost = { mecId: id, bonus, reason, updatedAt: Date.now() };
    if (idx < 0) {
      set({ mecScoreBoosts: [...list, next] });
    } else {
      const updated = [...list];
      updated[idx] = next;
      set({ mecScoreBoosts: updated });
    }
    markDirty();
  },

  removeMecScoreBoost: (mecId) => {
    const id = normalizeMecName(mecId) || mecId;
    const list = get().mecScoreBoosts;
    if (!list.some(b => b.mecId === id)) return;
    set({
      mecScoreBoosts: list.filter(b => b.mecId !== id),
      deletedMecScoreBoostIds: appendTombstone(get().deletedMecScoreBoostIds, id),
    });
    markDirty();
  },

  // ── Assignation tag → zone géographique ─────

  setTagZone: (tag, zone) => {
    const t = (tag || '').trim();
    if (!t) return;
    const list = get().tagZones;
    const idx = list.findIndex(a => a.tag === t);
    const next: TagZoneAssignment = { tag: t, zone, updatedAt: Date.now() };
    if (idx < 0) {
      set({ tagZones: [...list, next] });
    } else {
      const updated = [...list];
      updated[idx] = next;
      set({ tagZones: updated });
    }
    // Réassignation après suppression : retirer un éventuel tombstone pour
    // que la nouvelle valeur ne soit pas re-supprimée par le merge.
    const tombs = get().deletedTagZones || [];
    if (tombs.some(x => x.id === t)) {
      set({ deletedTagZones: tombs.filter(x => x.id !== t) });
    }
    markDirty();
  },

  removeTagZone: (tag) => {
    const list = get().tagZones;
    if (!list.some(a => a.tag === tag)) return;
    // Tombstone obligatoire : sans ça, le sync inter-postes ressuscitait
    // l'assignation au prochain pull (le serveur avait encore l'entrée).
    set({
      tagZones: list.filter(a => a.tag !== tag),
      deletedTagZones: appendTombstone(get().deletedTagZones, tag),
    });
    markDirty();
  },
}));

// Helper exporté pour pruner les tombstones expirés. Appelé par le sync
// service avant chaque push pour ne pas faire grossir le fichier serveur
// indéfiniment.
export function pruneCartographieTombstones(): void {
  const s = useCartographieOverlayStore.getState();
  const now = Date.now();
  useCartographieOverlayStore.setState({
    deletedMecExNihiloIds: pruneTombstones(s.deletedMecExNihiloIds, now),
    deletedDossierExNihiloIds: pruneTombstones(s.deletedDossierExNihiloIds, now),
    deletedLienIds: pruneTombstones(s.deletedLienIds, now),
    deletedClusterAnnotationIds: pruneTombstones(s.deletedClusterAnnotationIds, now),
    deletedMecScoreBoostIds: pruneTombstones(s.deletedMecScoreBoostIds, now),
    deletedTagZones: pruneTombstones(s.deletedTagZones, now),
    deletedPinnedMecIds: pruneTombstones(s.deletedPinnedMecIds, now),
  });
}

