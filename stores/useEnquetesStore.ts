/**
 * Store Zustand pour les enquêtes — remplace useContentieuxEnquetes.
 *
 * Gains de performance :
 * - Pas de provider Context → pas de cascade de re-renders
 * - Selectors granulaires : chaque composant ne re-rend que sur sa tranche
 * - Actions stables : les fonctions CRUD ne changent jamais de référence
 * - Sauvegarde throttled préservée (2.5s)
 */

import { create } from '@/lib/zustand';
import { Enquete, CompteRendu, NewEnqueteData } from '@/types/interfaces';
import { ElectronBridge } from '@/utils/electronBridge';
import { ContentieuxId } from '@/types/userTypes';
import { MultiSyncManager } from '@/utils/dataSync/MultiSyncManager';
import { ContentieuxManager } from '@/utils/contentieuxManager';
import { trackDeletedEnqueteId, trackDeletedCRId } from '@/utils/acteUtils';
import {
  appendModifications,
  diffEnqueteUpdates,
  markEnqueteAsSeenForUser,
  makeCRAddedEntry,
  makeCRModifiedEntry,
  makeCRDeletedEntry,
} from '@/utils/modificationLogger';
import { useUserStore } from '@/stores/useUserStore';
import throttle from 'lodash/throttle';

const SAVE_THROTTLE = 2500;

function storageKey(contentieuxId: ContentieuxId): string {
  return `ctx_${contentieuxId}_enquetes`;
}

const migrateEnqueteDocuments = (enquete: any): Enquete => {
  if (!enquete.documents || !Array.isArray(enquete.documents)) {
    enquete.documents = [];
  }
  if (!enquete.toDos || !Array.isArray(enquete.toDos)) {
    enquete.toDos = [];
  }
  return enquete as Enquete;
};

// ── Sauvegarde throttled (module-level pour stabilité) ──
let _enquetesRef: Enquete[] = [];
let _contentieuxRef: ContentieuxId = 'crimorg';
let _isDirty = false;

const _saveThrottled = throttle(async () => {
  if (!_isDirty || useEnquetesStore.getState().isLoading) return;
  try {
    await ElectronBridge.setData(storageKey(_contentieuxRef), _enquetesRef);
    _isDirty = false;
    useEnquetesStore.setState({ _isDataDirty: false });
    MultiSyncManager.getInstance().triggerPostSaveSync(_contentieuxRef);
  } catch (error) {
    console.error(`❌ EnquetesStore[${_contentieuxRef}]: erreur sauvegarde`, error);
  }
}, SAVE_THROTTLE);

// ── Abonnement au ContentieuxManager pour la réactivité cross-contentieux ──
// Quand un autre contentieux (ou un pull de sync) met à jour ses enquêtes, on
// recharge nos sharedEnquetes pour que la grille et les stats reflètent les
// co-saisines entrantes/sortantes sans rechargement manuel.
let _managerUnsub: (() => void) | null = null;

function ensureManagerSubscription(): void {
  if (_managerUnsub) return;
  _managerUnsub = ContentieuxManager.getInstance().addListener((changedCtxId) => {
    const { contentieuxId } = useEnquetesStore.getState();
    // Nos propres écritures sont déjà synchronisées via updateOwn() ; ignorer.
    if (changedCtxId === contentieuxId) return;
    useEnquetesStore.getState().loadSharedEnquetes();
  });
}

// ── Interface du store ──

interface EnquetesState {
  contentieuxId: ContentieuxId;
  ownEnquetes: Enquete[];
  sharedEnquetes: Enquete[];
  enquetes: Enquete[]; // ownEnquetes + sharedEnquetes (toujours synchronisé)
  selectedEnquete: Enquete | null;
  isEditing: boolean;
  editingCR: CompteRendu | null;
  isLoading: boolean;
  _isDataDirty: boolean;

  // ── Lifecycle ──
  setContentieux: (id: ContentieuxId) => Promise<void>;
  loadEnquetes: () => Promise<void>;
  loadSharedEnquetes: () => Promise<void>;
  flushPendingSave: () => Promise<void>;

  // ── UI ──
  setSelectedEnquete: (enquete: Enquete | null) => void;
  setIsEditing: (editing: boolean) => void;
  setEditingCR: (cr: CompteRendu | null) => void;

  // ── CRUD Enquêtes ──
  addEnquete: (data: NewEnqueteData) => Enquete;
  updateEnquete: (id: number, updates: Partial<Enquete>) => void;
  deleteEnquete: (id: number) => void;
  archiveEnquete: (id: number) => void;
  unarchiveEnquete: (id: number) => void;
  startEnquete: (id: number, date: string) => void;

  // ── CRUD Comptes-Rendus ──
  ajoutCR: (enqueteId: number, cr: CompteRendu | Omit<CompteRendu, 'id'>) => void;
  updateCR: (enqueteId: number, crId: number, updates: Partial<CompteRendu>) => void;
  deleteCR: (enqueteId: number, crId: number) => void;

  // ── Suivi des modifications ──
  /** Marque l'enquête comme vue par l'utilisateur courant (sans ajouter d'entrée d'historique). */
  markEnqueteAsSeen: (enqueteId: number) => void;

  // ── Co-saisine ──
  isSharedEnquete: (enqueteId: number) => boolean;
  shareEnquete: (enqueteId: number, targetContentieuxIds: string[]) => Promise<void>;
  unshareEnquete: (enqueteId: number) => Promise<void>;

  // ── Transfert ──
  transferEnquete: (enqueteId: number, targetContentieuxId: ContentieuxId) => Promise<boolean>;
}

// ── Helper interne pour mettre à jour les enquêtes propres + synchroniser `enquetes` ──
function updateOwn(
  state: EnquetesState,
  updater: (prev: Enquete[]) => Enquete[]
): Partial<EnquetesState> {
  const newOwn = updater(state.ownEnquetes);
  _enquetesRef = newOwn;
  _isDirty = true;
  return {
    ownEnquetes: newOwn,
    enquetes: [...newOwn, ...state.sharedEnquetes],
    _isDataDirty: true,
  };
}

// ── Persistance d'un contentieux distant (co-saisine : CR écrit sur le contentieux d'origine) ──
// ContentieuxManager ne gère que le cache mémoire ; sans ce helper, les CR ajoutés sur une
// enquête co-saisie sont perdus au reboot.
async function persistOriginContentieux(
  originId: ContentieuxId,
  enquetes: Enquete[]
): Promise<void> {
  try {
    await ElectronBridge.setData(storageKey(originId), enquetes);
    MultiSyncManager.getInstance().triggerPostSaveSync(originId);
  } catch (error) {
    console.error(`❌ EnquetesStore[co-saisine→${originId}]: erreur persistance`, error);
  }
}

// ── Création du store ──

export const useEnquetesStore = create<EnquetesState>((set, get) => ({
  contentieuxId: 'crimorg',
  ownEnquetes: [],
  sharedEnquetes: [],
  enquetes: [],
  selectedEnquete: null,
  isEditing: false,
  editingCR: null,
  isLoading: true,
  _isDataDirty: false,

  // ────────────────────────────────────────────
  // LIFECYCLE
  // ────────────────────────────────────────────

  setContentieux: async (id: ContentieuxId) => {
    ensureManagerSubscription();
    const state = get();
    if (state.contentieuxId === id && state.ownEnquetes.length > 0) {
      // Déjà sur ce contentieux : rafraîchir seulement les co-saisines pour capturer
      // d'éventuels partages arrivés via MultiSyncManager depuis le dernier load.
      await get().loadSharedEnquetes();
      return;
    }

    // Annuler tout throttle en vol pour éviter qu'il écrive dans le NOUVEAU contentieux
    // avec les données de l'ANCIEN après le changement de _contentieuxRef.
    _saveThrottled.cancel();

    // Flush les données dirty du contentieux précédent (avant de muter _contentieuxRef)
    if (_isDirty) {
      try {
        await ElectronBridge.setData(storageKey(state.contentieuxId), _enquetesRef);
        _isDirty = false;
      } catch (err) {
        console.error('EnquetesStore: erreur flush avant switch', err);
      }
    }

    _contentieuxRef = id;
    set({
      contentieuxId: id,
      selectedEnquete: null,
      isEditing: false,
      editingCR: null,
      sharedEnquetes: [],
      _isDataDirty: false,
    });

    // Charger les données du nouveau contentieux
    await get().loadEnquetes();
    await get().loadSharedEnquetes();
  },

  loadEnquetes: async () => {
    const { contentieuxId } = get();
    set({ isLoading: true });
    try {
      const key = storageKey(contentieuxId);
      const data = await ElectronBridge.getData<Enquete[]>(key, []);
      const validData = Array.isArray(data)
        ? data.filter(item => item.statut !== 'instruction').map(migrateEnqueteDocuments)
        : [];
      _enquetesRef = validData;
      _contentieuxRef = contentieuxId;
      set(state => ({
        ownEnquetes: validData,
        enquetes: [...validData, ...state.sharedEnquetes],
      }));
    } catch (error) {
      console.error(`❌ EnquetesStore[${contentieuxId}]: erreur chargement`, error);
      _enquetesRef = [];
      set({ ownEnquetes: [], enquetes: [...get().sharedEnquetes] });
    } finally {
      set({ isLoading: false });
    }
  },

  loadSharedEnquetes: async () => {
    const { contentieuxId } = get();
    try {
      const manager = ContentieuxManager.getInstance();
      const allIds = manager.getLoadedContentieuxIds();
      const shared: Enquete[] = [];
      for (const otherId of allIds) {
        if (otherId === contentieuxId) continue;
        const otherEnquetes = manager.getEnquetes(otherId);
        for (const enquete of otherEnquetes) {
          if (enquete.sharedWith?.includes(contentieuxId)) {
            shared.push({
              ...enquete,
              contentieuxOrigine: enquete.contentieuxOrigine || otherId,
            });
          }
        }
      }
      set(state => ({
        sharedEnquetes: shared,
        enquetes: [...state.ownEnquetes, ...shared],
      }));
    } catch (error) {
      console.error(`❌ EnquetesStore[${contentieuxId}]: erreur chargement co-saisines`, error);
      set(state => ({
        sharedEnquetes: [],
        enquetes: [...state.ownEnquetes],
      }));
    }
  },

  flushPendingSave: async () => {
    if (!_isDirty) return;
    try {
      await ElectronBridge.setData(storageKey(_contentieuxRef), _enquetesRef);
      _isDirty = false;
      set({ _isDataDirty: false });
    } catch (error) {
      console.error(`❌ EnquetesStore: erreur flush`, error);
    }
  },

  // ────────────────────────────────────────────
  // UI STATE
  // ────────────────────────────────────────────

  setSelectedEnquete: (enquete: Enquete | null) => set({ selectedEnquete: enquete }),
  setIsEditing: (editing: boolean) => set({ isEditing: editing }),
  setEditingCR: (cr: CompteRendu | null) => set({ editingCR: cr }),

  // ────────────────────────────────────────────
  // CRUD ENQUÊTES
  // ────────────────────────────────────────────

  addEnquete: (data: NewEnqueteData): Enquete => {
    const maxId = _enquetesRef.reduce((max, e) => Math.max(max, e.id || 0), 0);
    const now = new Date().toISOString();
    const baseEnquete: Enquete = {
      ...data,
      id: maxId + 1,
      dateCreation: now,
      dateMiseAJour: now,
      statut: 'en_cours',
      documents: data.documents || [],
      toDos: [],
    };
    const newEnquete = appendModifications(baseEnquete, [
      { type: 'enquete_created', label: `Création de l'enquête ${baseEnquete.numero}` },
    ]);
    set(state => updateOwn(state, prev => [...prev, newEnquete]));
    _saveThrottled();
    return newEnquete;
  },

  updateEnquete: (id: number, updates: Partial<Enquete>) => {
    const now = new Date().toISOString();
    set(state => {
      const previous = state.ownEnquetes.find(e => e.id === id);
      // Si le patch ne contient que des champs techniques (pas de sens métier),
      // on n'enregistre pas d'entrée de modification.
      const techKeys = new Set(['lastViewedBy', 'modifications', 'dateMiseAJour']);
      const isTechOnly = Object.keys(updates).every(k => techKeys.has(k));
      const entries = previous && !isTechOnly ? diffEnqueteUpdates(previous, updates) : [];

      const changes = updateOwn(state, prev =>
        prev.map(e => {
          if (e.id !== id) return e;
          const next = { ...e, ...updates, dateMiseAJour: now };
          return entries.length > 0 ? appendModifications(next, entries) : next;
        })
      );
      // Synchroniser selectedEnquete si c'est celui qu'on édite
      const selected = state.selectedEnquete;
      if (selected && selected.id === id) {
        const updated = changes.ownEnquetes?.find(e => e.id === id);
        changes.selectedEnquete = updated || { ...selected, ...updates, dateMiseAJour: now };
      }
      return changes;
    });
    _saveThrottled();
  },

  deleteEnquete: (id: number) => {
    set(state => ({
      ...updateOwn(state, prev => prev.filter(e => e.id !== id)),
      selectedEnquete: null,
    }));
    // Pose un tombstone pour éviter que l'enquête ne revienne quand un
    // collègue avec un cache plus ancien re-pousse son état.
    trackDeletedEnqueteId(id).catch(() => {});
    _saveThrottled();
  },

  archiveEnquete: (id: number) => {
    const now = new Date().toISOString();
    set(state => ({
      ...updateOwn(state, prev =>
        prev.map(e => {
          if (e.id !== id) return e;
          const archived: Enquete = { ...e, statut: 'archive', dateArchivage: now, dateMiseAJour: now };
          return appendModifications(archived, [
            { type: 'enquete_archived', label: 'Enquête archivée' },
          ]);
        })
      ),
      selectedEnquete: null,
    }));
    _saveThrottled();
  },

  unarchiveEnquete: (id: number) => {
    const now = new Date().toISOString();
    set(state =>
      updateOwn(state, prev =>
        prev.map(e => {
          if (e.id !== id) return e;
          const unarchived: Enquete = { ...e, statut: 'en_cours', dateMiseAJour: now };
          return appendModifications(unarchived, [
            { type: 'enquete_unarchived', label: 'Enquête désarchivée' },
          ]);
        })
      )
    );
    _saveThrottled();
  },

  startEnquete: (id: number, date: string) => {
    set(state =>
      updateOwn(state, prev =>
        prev.map(e => {
          if (e.id === id) {
            const newTags = e.tags.filter(tag => tag.value !== 'enquête à venir');
            return { ...e, dateDebut: date, tags: newTags, dateMiseAJour: new Date().toISOString() };
          }
          return e;
        })
      )
    );
    _saveThrottled();
  },

  // ────────────────────────────────────────────
  // CRUD COMPTES-RENDUS
  // ────────────────────────────────────────────

  ajoutCR: (enqueteId: number, cr: CompteRendu | Omit<CompteRendu, 'id'>) => {
    const { contentieuxId, sharedEnquetes } = get();
    const newCR: CompteRendu = 'id' in cr
      ? { ...cr, contentieuxSource: contentieuxId }
      : { ...cr, id: Date.now(), contentieuxSource: contentieuxId };

    // Co-saisine : écrire dans le contentieux d'origine
    const shared = sharedEnquetes.find(e => e.id === enqueteId);
    if (shared?.contentieuxOrigine) {
      const manager = ContentieuxManager.getInstance();
      const originEnquetes = manager.getEnquetes(shared.contentieuxOrigine);
      const updated = originEnquetes.map(e => {
        if (e.id !== enqueteId) return e;
        const next: Enquete = { ...e, comptesRendus: [...e.comptesRendus, newCR], dateMiseAJour: new Date().toISOString() };
        return appendModifications(next, [makeCRAddedEntry(newCR)]);
      });
      manager.setEnquetes(shared.contentieuxOrigine, updated);
      persistOriginContentieux(shared.contentieuxOrigine, updated);
      get().loadSharedEnquetes();
      return;
    }

    const now = new Date().toISOString();
    set(state => {
      const changes = updateOwn(state, prev =>
        prev.map(e => {
          if (e.id !== enqueteId) return e;
          const next: Enquete = { ...e, comptesRendus: [...e.comptesRendus, newCR], dateMiseAJour: now };
          return appendModifications(next, [makeCRAddedEntry(newCR)]);
        })
      );
      if (state.selectedEnquete?.id === enqueteId) {
        const updatedSelected = changes.ownEnquetes?.find(e => e.id === enqueteId);
        if (updatedSelected) changes.selectedEnquete = updatedSelected;
      }
      return changes;
    });
    _saveThrottled();
  },

  updateCR: (enqueteId: number, crId: number, updates: Partial<CompteRendu>) => {
    const { sharedEnquetes } = get();
    const shared = sharedEnquetes.find(e => e.id === enqueteId);
    if (shared?.contentieuxOrigine) {
      const manager = ContentieuxManager.getInstance();
      const originEnquetes = manager.getEnquetes(shared.contentieuxOrigine);
      const updated = originEnquetes.map(e => {
        if (e.id !== enqueteId) return e;
        const updatedCRs = e.comptesRendus.map(cr => cr.id === crId ? { ...cr, ...updates } : cr);
        const targetCR = updatedCRs.find(cr => cr.id === crId);
        const next: Enquete = { ...e, comptesRendus: updatedCRs, dateMiseAJour: new Date().toISOString() };
        return targetCR ? appendModifications(next, [makeCRModifiedEntry(targetCR)]) : next;
      });
      manager.setEnquetes(shared.contentieuxOrigine, updated);
      persistOriginContentieux(shared.contentieuxOrigine, updated);
      get().loadSharedEnquetes();
      return;
    }

    const now = new Date().toISOString();
    set(state => {
      const changes = updateOwn(state, prev =>
        prev.map(e => {
          if (e.id !== enqueteId) return e;
          const updatedCRs = e.comptesRendus.map(cr => cr.id === crId ? { ...cr, ...updates } : cr);
          const targetCR = updatedCRs.find(cr => cr.id === crId);
          const next: Enquete = { ...e, comptesRendus: updatedCRs, dateMiseAJour: now };
          return targetCR ? appendModifications(next, [makeCRModifiedEntry(targetCR)]) : next;
        })
      );
      if (state.selectedEnquete?.id === enqueteId) {
        const updatedSelected = changes.ownEnquetes?.find(e => e.id === enqueteId);
        if (updatedSelected) changes.selectedEnquete = updatedSelected;
      }
      return changes;
    });
    _saveThrottled();
  },

  deleteCR: (enqueteId: number, crId: number) => {
    // Tombstone : le CR ne doit pas renaître via un merge ultérieur
    trackDeletedCRId(crId).catch(() => {});
    const { sharedEnquetes } = get();
    const shared = sharedEnquetes.find(e => e.id === enqueteId);
    if (shared?.contentieuxOrigine) {
      const manager = ContentieuxManager.getInstance();
      const originEnquetes = manager.getEnquetes(shared.contentieuxOrigine);
      const updated = originEnquetes.map(e => {
        if (e.id !== enqueteId) return e;
        const removedCR = e.comptesRendus.find(cr => cr.id === crId);
        const next: Enquete = {
          ...e,
          comptesRendus: e.comptesRendus.filter(cr => cr.id !== crId),
          dateMiseAJour: new Date().toISOString(),
        };
        return appendModifications(next, [makeCRDeletedEntry(removedCR, crId)]);
      });
      manager.setEnquetes(shared.contentieuxOrigine, updated);
      persistOriginContentieux(shared.contentieuxOrigine, updated);
      get().loadSharedEnquetes();
      return;
    }

    const now = new Date().toISOString();
    set(state => {
      const changes = updateOwn(state, prev =>
        prev.map(e => {
          if (e.id !== enqueteId) return e;
          const removedCR = e.comptesRendus.find(cr => cr.id === crId);
          const next: Enquete = {
            ...e,
            comptesRendus: e.comptesRendus.filter(cr => cr.id !== crId),
            dateMiseAJour: now,
          };
          return appendModifications(next, [makeCRDeletedEntry(removedCR, crId)]);
        })
      );
      if (state.selectedEnquete?.id === enqueteId) {
        const updatedSelected = changes.ownEnquetes?.find(e => e.id === enqueteId);
        if (updatedSelected) changes.selectedEnquete = updatedSelected;
      }
      return changes;
    });
    _saveThrottled();
  },

  // ────────────────────────────────────────────
  // CO-SAISINE
  // ────────────────────────────────────────────

  isSharedEnquete: (enqueteId: number): boolean => {
    return get().sharedEnquetes.some(e => e.id === enqueteId);
  },

  shareEnquete: async (enqueteId: number, targetContentieuxIds: string[]) => {
    const now = new Date().toISOString();
    const label = `Co-saisine partagée${targetContentieuxIds.length > 0 ? ` avec ${targetContentieuxIds.join(', ')}` : ''}`;
    set(state => {
      const changes = updateOwn(state, prev =>
        prev.map(e => {
          if (e.id !== enqueteId) return e;
          const next: Enquete = { ...e, sharedWith: targetContentieuxIds, dateMiseAJour: now };
          return appendModifications(next, [{ type: 'enquete_shared', label }]);
        })
      );
      if (state.selectedEnquete?.id === enqueteId) {
        const updated = changes.ownEnquetes?.find(e => e.id === enqueteId);
        if (updated) changes.selectedEnquete = updated;
      }
      return changes;
    });
    // Mettre à jour le cache ContentieuxManager pour que les autres contentieux voient le partage
    await ContentieuxManager.getInstance().setEnquetes(get().contentieuxId, get().ownEnquetes);
    _saveThrottled();
  },

  unshareEnquete: async (enqueteId: number) => {
    const now = new Date().toISOString();
    set(state => {
      const changes = updateOwn(state, prev =>
        prev.map(e => {
          if (e.id !== enqueteId) return e;
          const next: Enquete = { ...e, sharedWith: undefined, contentieuxOrigine: undefined, dateMiseAJour: now };
          return appendModifications(next, [{ type: 'enquete_unshared', label: 'Co-saisine retirée' }]);
        })
      );
      if (state.selectedEnquete?.id === enqueteId) {
        const updated = changes.ownEnquetes?.find(e => e.id === enqueteId);
        if (updated) changes.selectedEnquete = updated;
      }
      return changes;
    });
    // Mettre à jour le cache ContentieuxManager pour refléter la suppression du partage
    await ContentieuxManager.getInstance().setEnquetes(get().contentieuxId, get().ownEnquetes);
    _saveThrottled();
  },

  markEnqueteAsSeen: (enqueteId: number) => {
    const username = useUserStore.getState().user?.windowsUsername;
    if (!username) return;
    const { sharedEnquetes } = get();
    const sharedHit = sharedEnquetes.find(e => e.id === enqueteId);
    if (sharedHit?.contentieuxOrigine) {
      const manager = ContentieuxManager.getInstance();
      const originEnquetes = manager.getEnquetes(sharedHit.contentieuxOrigine);
      const updated = originEnquetes.map(e =>
        e.id === enqueteId ? markEnqueteAsSeenForUser(e, username) : e
      );
      manager.setEnquetes(sharedHit.contentieuxOrigine, updated);
      persistOriginContentieux(sharedHit.contentieuxOrigine, updated);
      get().loadSharedEnquetes();
      // Mettre à jour selectedEnquete localement si on regarde cette enquête
      const selected = get().selectedEnquete;
      if (selected && selected.id === enqueteId) {
        set({ selectedEnquete: markEnqueteAsSeenForUser(selected, username) });
      }
      return;
    }

    set(state => {
      const newOwn = state.ownEnquetes.map(e =>
        e.id === enqueteId ? markEnqueteAsSeenForUser(e, username) : e
      );
      _enquetesRef = newOwn;
      _isDirty = true;
      const next: Partial<EnquetesState> = {
        ownEnquetes: newOwn,
        enquetes: [...newOwn, ...state.sharedEnquetes],
        _isDataDirty: true,
      };
      if (state.selectedEnquete?.id === enqueteId) {
        next.selectedEnquete = markEnqueteAsSeenForUser(state.selectedEnquete, username);
      }
      return next;
    });
    _saveThrottled();
  },

  // ────────────────────────────────────────────
  // TRANSFERT
  // ────────────────────────────────────────────

  transferEnquete: async (enqueteId: number, targetContentieuxId: ContentieuxId): Promise<boolean> => {
    const { contentieuxId, ownEnquetes } = get();
    if (targetContentieuxId === contentieuxId) return false;

    const original = ownEnquetes.find(e => e.id === enqueteId);
    if (!original) return false; // UI restreint au propriétaire, garde-fou

    const manager = ContentieuxManager.getInstance();
    if (manager.getSyncMode(targetContentieuxId) !== 'read_write') return false;

    const targetEnquetes = manager.getEnquetes(targetContentieuxId);
    const newId = targetEnquetes.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1;

    const transferred: Enquete = {
      ...original,
      id: newId,
      contentieuxOrigine: targetContentieuxId,
      sharedWith: undefined, // Le partage ne suit pas le transfert ; l'utilisateur re-configure si besoin
      dateMiseAJour: new Date().toISOString(),
    };

    const ok = await manager.setEnquetes(targetContentieuxId, [...targetEnquetes, transferred]);
    if (!ok) return false;
    MultiSyncManager.getInstance().triggerPostSaveSync(targetContentieuxId);

    set(state => {
      const changes = updateOwn(state, prev => prev.filter(e => e.id !== enqueteId));
      if (state.selectedEnquete?.id === enqueteId) {
        changes.selectedEnquete = null;
        changes.isEditing = false;
        changes.editingCR = null;
      }
      return changes;
    });
    _saveThrottled();
    await manager.setEnquetes(contentieuxId, get().ownEnquetes);

    return true;
  },
}));
