// stores/useCartographieOverlayStore.ts
// Store Zustand pour les données utilisateur surimposées au graphe de
// cartographie : MEC ex nihilo, dossiers ex nihilo, liens "renseignement"
// manuels, et MEC épinglés au Top 10.
//
// Persistance via ElectronBridge (clé `cartographie_overlays`), écriture
// throttlée à 2.5 s — calque le pattern de useEnquetesStore.

import { create } from '@/lib/zustand';
import throttle from 'lodash/throttle';
import { ElectronBridge } from '@/utils/electronBridge';
import { normalizeMecName } from '@/utils/mindmapGraph';

const STORAGE_KEY = 'cartographie_overlays';
const SAVE_THROTTLE = 2500;

export type MecExNihiloStatut = 'actif' | 'dormant' | 'decede' | 'libere';

export interface MecExNihilo {
  /** Identifiant canonique (nom normalisé) — fusionnable avec un MEC réel */
  id: string;
  displayName: string;
  alias: string[];
  statut?: MecExNihiloStatut;
  notes?: string;
  createdAt: number;
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
  notes?: string;
  createdAt: number;
}

export interface LienRenseignement {
  id: string;
  /** ID du nœud source (MEC canonique ou dossierId) */
  source: string;
  target: string;
  label?: string;
  notes?: string;
  createdAt: number;
}

interface PersistedOverlay {
  pinnedMecIds: string[];
  mecsExNihilo: MecExNihilo[];
  dossiersExNihilo: DossierExNihilo[];
  liensRenseignement: LienRenseignement[];
}

interface OverlayState extends PersistedOverlay {
  isLoaded: boolean;
  load: () => Promise<void>;

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
  addDossier: (input: { label: string; dateApprox?: string; mecIds?: string[]; notes?: string }) => string;
  updateDossier: (id: string, patch: Partial<Omit<DossierExNihilo, 'id' | 'createdAt'>>) => void;
  removeDossier: (id: string) => void;

  // Liens renseignement
  addLien: (input: { source: string; target: string; label?: string; notes?: string }) => string;
  updateLien: (id: string, patch: Partial<Omit<LienRenseignement, 'id' | 'createdAt'>>) => void;
  removeLien: (id: string) => void;
}

const EMPTY: PersistedOverlay = {
  pinnedMecIds: [],
  mecsExNihilo: [],
  dossiersExNihilo: [],
  liensRenseignement: [],
};

const DOSSIER_EXN_PREFIX = 'dexn_';
const LIEN_PREFIX = 'lien_';

function uniqueId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

let _isDirty = false;

const _saveThrottled = throttle(async () => {
  if (!_isDirty) return;
  try {
    const s = useCartographieOverlayStore.getState();
    const payload: PersistedOverlay = {
      pinnedMecIds: s.pinnedMecIds,
      mecsExNihilo: s.mecsExNihilo,
      dossiersExNihilo: s.dossiersExNihilo,
      liensRenseignement: s.liensRenseignement,
    };
    await ElectronBridge.setData(STORAGE_KEY, payload);
    _isDirty = false;
  } catch (error) {
    console.error('❌ CartographieOverlayStore: erreur sauvegarde', error);
  }
}, SAVE_THROTTLE);

function markDirty(): void {
  _isDirty = true;
  _saveThrottled();
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
        isLoaded: true,
      });
    } catch (error) {
      console.error('❌ CartographieOverlayStore: erreur chargement', error);
      set({ isLoaded: true });
    }
  },

  // ── Épinglage ────────────────────────────────

  pinMec: (mecId) => {
    const id = normalizeMecName(mecId) || mecId;
    const current = get().pinnedMecIds;
    if (current.includes(id)) return;
    set({ pinnedMecIds: [...current, id] });
    markDirty();
  },

  unpinMec: (mecId) => {
    const id = normalizeMecName(mecId) || mecId;
    const current = get().pinnedMecIds;
    if (!current.includes(id)) return;
    set({ pinnedMecIds: current.filter(p => p !== id) });
    markDirty();
  },

  togglePinMec: (mecId) => {
    const id = normalizeMecName(mecId) || mecId;
    const { pinnedMecIds } = get();
    if (pinnedMecIds.includes(id)) {
      set({ pinnedMecIds: pinnedMecIds.filter(p => p !== id) });
    } else {
      set({ pinnedMecIds: [...pinnedMecIds, id] });
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
    const existing = get().mecsExNihilo.find(m => m.id === canonical);
    if (existing) {
      // Idempotent : merge alias/notes/statut sans écraser les valeurs non vides
      const merged: MecExNihilo = {
        ...existing,
        displayName: input.displayName || existing.displayName,
        alias: Array.from(new Set([...(existing.alias || []), ...(input.alias || [])])),
        statut: input.statut ?? existing.statut,
        notes: input.notes || existing.notes,
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
      createdAt: Date.now(),
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
    next[idx] = { ...next[idx], ...patch };
    set({ mecsExNihilo: next });
    markDirty();
  },

  removeMec: (id) => {
    const list = get().mecsExNihilo;
    if (!list.some(m => m.id === id)) return;
    // Cascade : retirer cet id des dossiers ex nihilo et des liens
    const dossiers = get().dossiersExNihilo.map(d => ({
      ...d,
      mecIds: d.mecIds.filter(mid => mid !== id),
    }));
    const liens = get().liensRenseignement.filter(l => l.source !== id && l.target !== id);
    const pinned = get().pinnedMecIds.filter(p => p !== id);
    set({
      mecsExNihilo: list.filter(m => m.id !== id),
      dossiersExNihilo: dossiers,
      liensRenseignement: liens,
      pinnedMecIds: pinned,
    });
    markDirty();
  },

  // ── Dossier ex nihilo ────────────────────────

  addDossier: (input) => {
    const id = uniqueId(DOSSIER_EXN_PREFIX);
    const created: DossierExNihilo = {
      id,
      label: input.label,
      dateApprox: input.dateApprox,
      mecIds: (input.mecIds || []).map(m => normalizeMecName(m) || m).filter(Boolean),
      notes: input.notes,
      createdAt: Date.now(),
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
    next[idx] = { ...next[idx], ...patch, mecIds: cleanedMecIds };
    set({ dossiersExNihilo: next });
    markDirty();
  },

  removeDossier: (id) => {
    const list = get().dossiersExNihilo;
    if (!list.some(d => d.id === id)) return;
    // Cascade : retirer les liens qui pointent dessus
    const liens = get().liensRenseignement.filter(l => l.source !== id && l.target !== id);
    set({
      dossiersExNihilo: list.filter(d => d.id !== id),
      liensRenseignement: liens,
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
    const created: LienRenseignement = {
      id,
      source: input.source,
      target: input.target,
      label: input.label,
      notes: input.notes,
      createdAt: Date.now(),
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
    next[idx] = { ...next[idx], ...patch };
    set({ liensRenseignement: next });
    markDirty();
  },

  removeLien: (id) => {
    const list = get().liensRenseignement;
    if (!list.some(l => l.id === id)) return;
    set({ liensRenseignement: list.filter(l => l.id !== id) });
    markDirty();
  },
}));

