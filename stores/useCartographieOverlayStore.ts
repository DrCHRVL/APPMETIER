// stores/useCartographieOverlayStore.ts
// Store Zustand pour les données utilisateur surimposées au graphe de
// cartographie : MEC ex nihilo, dossiers ex nihilo, liens "renseignement"
// manuels, et MEC épinglés au Top 10.
//
// Persistance via ElectronBridge (clé `cartographie_overlays`), écriture
// throttlée à 2.5 s — calque le pattern de useEnquetesStore.
//
// Pour l'instant, seul `pinnedMecIds` est exposé. Les autres collections
// (mecs ex nihilo, dossiers ex nihilo, liens) viendront dans des commits
// dédiés mais la structure du store est déjà prévue pour les accueillir.

import { create } from '@/lib/zustand';
import throttle from 'lodash/throttle';
import { ElectronBridge } from '@/utils/electronBridge';
import { normalizeMecName } from '@/utils/mindmapGraph';

const STORAGE_KEY = 'cartographie_overlays';
const SAVE_THROTTLE = 2500;

export interface MecExNihilo {
  /** Identifiant canonique (nom normalisé) — fusionnable avec un MEC réel */
  id: string;
  displayName: string;
  alias: string[];
  statut?: 'actif' | 'dormant' | 'decede' | 'libere';
  notes?: string;
  createdAt: number;
}

export interface DossierExNihilo {
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
  pinMec: (mecId: string) => void;
  unpinMec: (mecId: string) => void;
  togglePinMec: (mecId: string) => void;
  isPinned: (mecId: string) => boolean;
}

const EMPTY: PersistedOverlay = {
  pinnedMecIds: [],
  mecsExNihilo: [],
  dossiersExNihilo: [],
  liensRenseignement: [],
};

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
}));
