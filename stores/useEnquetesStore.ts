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
import { Enquete, CompteRendu, NewEnqueteData, ActeMeta } from '@/types/interfaces';
import { buildProductionActe } from '@/utils/productionActe';
import { findEnqueteParNumero } from '@/utils/numeroDossier';
import { ElectronBridge } from '@/utils/electronBridge';
import { ContentieuxId } from '@/types/userTypes';
import { MultiSyncManager } from '@/utils/dataSync/MultiSyncManager';
import { ContentieuxManager } from '@/utils/contentieuxManager';
import { trackDeletedEnqueteId, trackDeletedCRId, normalizeExpiredActeStatuses } from '@/utils/acteUtils';
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

const SAVE_THROTTLE = 8000;

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

// Fermeture d'onglet / veille iPhone : sans flush, tout ce qui est dans la
// fenêtre de throttle (8 s) serait définitivement perdu. `pagehide` couvre
// iOS (où beforeunload ne se déclenche pas), `visibilitychange` couvre la
// mise en veille et le changement d'app.
if (typeof window !== 'undefined') {
  const flushNow = () => { if (_isDirty) _saveThrottled.flush(); };
  window.addEventListener('pagehide', flushNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushNow(); });
}

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
  /**
   * Tire immédiatement le coffre serveur (sans attendre le cycle de sync de
   * 2 min) puis rafraîchit la grille ET le dossier ouvert. Utilisé après une
   * écriture de l'attaché IA (acte, CR, MEC, description) pour la rendre
   * visible tout de suite.
   */
  syncAndRefresh: () => Promise<void>;

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

  /**
   * Répercute la validation (ou la réouverture) d'un acte rédigé par l'attaché
   * de justice sur les actes de l'enquête, retrouvée par son `numero`.
   *  - `validated = true` : crée un acte IDENTIQUE à une saisie manuelle
   *    (rubrique écoute / géoloc / autre + catégorie légale + statut dérivé),
   *    à partir des métadonnées `prod.meta` de la production, lié par `prodId`.
   *    Idempotent : ne recrée rien si l'acte existe déjà. Certaines productions
   *    (note, livrable) ne créent aucun acte.
   *  - `validated = false` : retire l'acte auto-créé s'il est resté à son état
   *    initial (le magistrat ne l'a pas repris en main : pas de pose, pas de
   *    prolongation). Sinon on le préserve.
   * No-op si aucune enquête propre ne porte ce `numero`.
   */
  syncProductionActe: (
    numero: string,
    prod: { id: string; type: string; titre: string; meta?: ActeMeta; objet?: string },
    validated: boolean,
  ) => void;

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
      // Normalise au passage le statut des actes expirés (en_cours → termine) :
      // si au moins une enquête est corrigée, on persiste pour figer la donnée.
      let actesNormalized = false;
      const validData = Array.isArray(data)
        ? data
            .filter(item => item.statut !== 'instruction')
            .map(item => {
              const migrated = migrateEnqueteDocuments(item);
              const { enquete, changed } = normalizeExpiredActeStatuses(migrated);
              if (changed) actesNormalized = true;
              return enquete;
            })
        : [];
      _enquetesRef = validData;
      _contentieuxRef = contentieuxId;
      if (actesNormalized) {
        _isDirty = true;
        _saveThrottled();
      }
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

  syncAndRefresh: async () => {
    const { contentieuxId } = get();
    // 1) Tirer le coffre serveur maintenant (l'attaché IA écrit côté serveur ;
    //    le cache local n'est mis à jour que par la sync). En cas de conflit /
    //    hors-ligne, triggerSync n'écrit rien : on recharge quand même, sans
    //    casser l'affichage — le cycle périodique reprendra la main.
    try {
      await MultiSyncManager.getInstance().triggerSync(contentieuxId);
    } catch (error) {
      console.warn('EnquetesStore.syncAndRefresh: sync ignorée', error);
    }
    // 2) Recharger la grille depuis le cache local fraîchement mis à jour.
    await get().loadEnquetes();
    await get().loadSharedEnquetes();
    // 3) Rafraîchir le dossier ouvert (sauf pendant une édition manuelle, pour
    //    ne pas écraser une saisie en cours), en reprenant la version fraîche.
    const { selectedEnquete, isEditing, enquetes } = get();
    if (selectedEnquete && !isEditing) {
      const fresh = enquetes.find((e) => e.id === selectedEnquete.id);
      if (fresh && fresh !== selectedEnquete) set({ selectedEnquete: fresh });
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

  syncProductionActe: (numero, prod, validated) => {
    // Rapprochement TOLÉRANT : l'acte rédigé peut porter une écriture courte
    // du numéro (« 85103/843/2026 ») quand l'enquête s'appelle
    // « 85103/843/2026 - GRIVESNES 2 » — même règle que l'ouverture d'un
    // dossier depuis le journal de l'attaché.
    const enquete = findEnqueteParNumero(get().ownEnquetes, numero);
    if (!enquete) {
      // Enquête PARTAGÉE (co-saisine) : l'acte doit naître dans le contentieux
      // d'ORIGINE — même mécanique qu'ajoutCR. Sans cela, la validation
      // marquait l'acte « traité » sans jamais créer l'acte de suivi.
      const shared = findEnqueteParNumero(get().sharedEnquetes, numero);
      if (!shared?.contentieuxOrigine) return; // introuvable partout : on ne fait rien.
      const built = validated
        ? buildProductionActe({ prodId: prod.id, type: prod.type, titre: prod.titre, meta: prod.meta, objet: prod.objet })
        : null;
      const manager = ContentieuxManager.getInstance();
      const originEnquetes = manager.getEnquetes(shared.contentieuxOrigine);
      const sharedCollections = ['actes', 'geolocalisations', 'ecoutes'] as const;
      let changed = false;
      const updated = originEnquetes.map(e => {
        if (e.id !== shared.id) return e;
        if (validated) {
          if (!built) return e;
          if (sharedCollections.some(c => (e[c] || []).find(a => a.prodId === prod.id))) return e; // idempotent
          changed = true;
          const next: Enquete = { ...e, [built.collection]: [...(e[built.collection] || []), built.acte], dateMiseAJour: new Date().toISOString() };
          return appendModifications(next, [{ type: 'general_info_updated', label: `Acte créé depuis un acte rédigé validé : ${prod.titre}` }]);
        }
        // Réouverture : retirer l'acte resté à son état initial (même règle que ci-dessous).
        for (const c of sharedCollections) {
          const a = (e[c] || []).find(x => x.prodId === prod.id);
          if (!a) continue;
          const initialStatut = a.statut === 'autorisation_pending' || a.statut === 'pose_pending' || a.statut === 'en_cours';
          const untouched = initialStatut && !a.datePose && !(a.prolongationsHistory && a.prolongationsHistory.length);
          if (untouched) {
            changed = true;
            return { ...e, [c]: (e[c] || []).filter(x => x.id !== a.id), dateMiseAJour: new Date().toISOString() };
          }
        }
        return e;
      });
      if (changed) {
        manager.setEnquetes(shared.contentieuxOrigine, updated);
        persistOriginContentieux(shared.contentieuxOrigine, updated);
        get().loadSharedEnquetes();
      }
      return;
    }

    // Recherche de l'acte déjà lié à cette production, quelle que soit la rubrique.
    const collections = ['actes', 'geolocalisations', 'ecoutes'] as const;
    let hit: { collection: typeof collections[number]; acte: { id: number; prodId?: string; statut: string; datePose?: string; prolongationsHistory?: unknown[] } } | null = null;
    for (const c of collections) {
      const found = (enquete[c] || []).find(a => a.prodId === prod.id);
      if (found) { hit = { collection: c, acte: found }; break; }
    }

    if (validated) {
      if (hit) return; // déjà créé : idempotent.
      const built = buildProductionActe({ prodId: prod.id, type: prod.type, titre: prod.titre, meta: prod.meta, objet: prod.objet });
      if (!built) return; // production sans acte associé (note, livrable).
      const current = enquete[built.collection] || [];
      get().updateEnquete(enquete.id, { [built.collection]: [...current, built.acte] });
    } else {
      // Réouverture : ne retirer l'acte que s'il est resté à son état initial
      // (le magistrat ne l'a pas repris en main : pas de pose, pas de
      // prolongation, statut de création). Sinon on préserve son travail.
      if (!hit) return;
      const a = hit.acte;
      const initialStatut = a.statut === 'autorisation_pending' || a.statut === 'pose_pending' || a.statut === 'en_cours';
      const untouched = initialStatut && !a.datePose && !(a.prolongationsHistory && a.prolongationsHistory.length);
      if (untouched) {
        const current = enquete[hit.collection] || [];
        get().updateEnquete(enquete.id, { [hit.collection]: current.filter(x => x.id !== a.id) });
      }
    }
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
          // Effacer dateArchivage : sinon la résolution de conflit de sync
          // (DataMergeService.mergeEnquete) ré-impose le statut « archive »
          // (localArchiveTs >= serverTs) et le désarchivage ne se propage jamais.
          const unarchived: Enquete = { ...e, statut: 'en_cours', dateArchivage: undefined, dateMiseAJour: now };
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
