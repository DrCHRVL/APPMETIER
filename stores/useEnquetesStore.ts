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
import {
  ActeCollection,
  ProductionRef,
  libelleActe,
  planProductionActe,
} from '@/utils/productionActe';
import { findEnqueteParNumero } from '@/utils/numeroDossier';
import { SiralBridge } from '@/utils/siralBridge';
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
import { repairArchiveState } from '@/utils/archiveState';
import { buildResultatLookup } from '@/utils/archiveStateIO';
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
    await SiralBridge.setData(storageKey(_contentieuxRef), _enquetesRef);
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

  // Un pull de sync appliqué au CONTENTIEUX ACTIF (le listener ci-dessus
  // l'ignore à dessein) : depuis que la première sync ne bloque plus le
  // démarrage, le store peut être hydraté AVANT son arrivée — on recharge
  // alors en douceur, identités préservées si rien n'a changé.
  if (typeof window !== 'undefined') {
    window.addEventListener('siral-pull-applied', (event: Event) => {
      const detail = (event as CustomEvent<{ contentieuxId?: string }>).detail;
      const state = useEnquetesStore.getState();
      if (!detail?.contentieuxId || detail.contentieuxId !== state.contentieuxId) return;
      // Des modifications locales non sauvegardées : ne pas les écraser — le
      // prochain cycle de sync (post-save ou périodique) refera le point.
      if (_isDirty) return;
      const fraiches = ContentieuxManager.getInstance()
        .getEnquetes(state.contentieuxId)
        .filter(e => e.statut !== 'instruction')
        .map(migrateEnqueteDocuments);
      const identiques = fraiches.length === state.ownEnquetes.length
        && fraiches.every((e, i) => {
          const avant = state.ownEnquetes[i];
          return avant && avant.id === e.id && avant.dateMiseAJour === e.dateMiseAJour;
        });
      if (identiques) return;
      _enquetesRef = fraiches;
      useEnquetesStore.setState(s => ({
        ownEnquetes: fraiches,
        enquetes: [...fraiches, ...s.sharedEnquetes],
      }));
    });
  }
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
   * La DÉCISION (créer / prolonger / ne rien faire) est prise par
   * `planProductionActe` — voir utils/productionActe.ts pour les règles de
   * cohérence : une prolongation ne crée jamais d'acte, une mesure déjà suivie
   * n'est pas dupliquée, un écrit sans mesure ne crée rien.
   *  - `validated = true` : applique le plan (acte créé identique à une saisie
   *    manuelle et lié par `prodId` ; ou acte existant marqué « prolongation en
   *    attente JLD » et lié par `prolongationRequest`). Idempotent.
   *  - `validated = false` : défait ce qui a été fait, tant que le magistrat
   *    n'a pas repris l'acte en main (pas de pose, pas de prolongation validée).
   * Rend ce qui a été fait, pour que l'atelier « Actes rédigés » le DISE au
   * magistrat plutôt que d'annoncer une création qui n'a pas eu lieu.
   */
  syncProductionActe: (
    numero: string,
    prod: { id: string; type: string; titre: string; meta?: ActeMeta; objet?: string },
    validated: boolean,
  ) => ProductionActeResult;

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

/**
 * Ce que la validation (ou la réouverture) d'un acte rédigé a réellement fait
 * dans l'enquête — l'atelier « Actes rédigés » le rend au magistrat.
 */
export interface ProductionActeResult {
  action: 'cree' | 'prolonge' | 'existant' | 'retire' | 'prolongation_annulee' | 'rien';
  /** Acte concerné (« écoute 07 64 45 45 16 », « géolocalisation… »). */
  libelle?: string;
  raison?: 'deja_fait' | 'sans_mesure' | 'prolongation_orpheline' | 'enquete_introuvable';
}

/**
 * Ce qu'on DIT au magistrat après une validation / réouverture d'acte rédigé.
 * Toujours la vérité : une prolongation ne crée aucun acte, une mesure déjà
 * suivie n'en crée pas un second, et un acte prolongé introuvable se répare à
 * la main — mieux vaut le dire que fabriquer un acte de plus.
 */
export function messageProductionActe(r: ProductionActeResult): string {
  switch (r.action) {
    case 'cree':
      return `acte créé dans l'enquête${r.libelle ? ` (${r.libelle})` : ''}.`;
    case 'prolonge':
      return `prolongation demandée au JLD sur la ${r.libelle} — aucun nouvel acte créé.`;
    case 'existant':
      return `la ${r.libelle} est déjà suivie dans l'enquête — aucun doublon créé.`;
    case 'retire':
      return `l'acte créé à la validation a été retiré de l'enquête.`;
    case 'prolongation_annulee':
      return `la demande de prolongation a été annulée sur la ${r.libelle}.`;
    default:
      if (r.raison === 'prolongation_orpheline') {
        return `prolongation : l'acte prolongé n'a pas été retrouvé dans l'enquête — demandez la prolongation à la main sur l'acte concerné.`;
      }
      if (r.raison === 'enquete_introuvable') return `aucune enquête ne porte ce numéro — rien n'a été créé.`;
      if (r.raison === 'deja_fait') return `déjà répercuté dans l'enquête.`;
      return `aucun acte de suivi à créer.`;
  }
}

/** Un acte est-il resté à l'état où la validation l'a créé (magistrat pas intervenu) ? */
function acteIntact(a: { statut: string; datePose?: string; prolongationsHistory?: unknown[] }): boolean {
  const statutInitial = a.statut === 'autorisation_pending' || a.statut === 'pose_pending' || a.statut === 'en_cours';
  return statutInitial && !a.datePose && !(a.prolongationsHistory && a.prolongationsHistory.length);
}

/**
 * Applique dans UNE enquête ce que la validation (ou la réouverture) d'un acte
 * rédigé implique. Fonction pure : rend l'enquête à écrire (identique si rien
 * ne change) et le compte rendu de ce qui a été fait. Partagée par l'enquête
 * propre et l'enquête co-saisie — les deux chemins doivent se comporter pareil.
 * L'entrée « modifications » n'est PAS posée ici : sur l'enquête propre elle
 * naît du diff de `updateEnquete` (exactement comme une saisie manuelle) ;
 * l'enquête co-saisie, qui ne passe pas par là, la pose elle-même.
 */
function appliquerProductionActe(
  e: Enquete,
  prod: ProductionRef,
  validated: boolean,
): { enquete: Enquete; result: ProductionActeResult } {
  const now = new Date().toISOString();
  const collections: ActeCollection[] = ['ecoutes', 'geolocalisations', 'actes'];

  if (validated) {
    const plan = planProductionActe(prod, e);
    if (plan.action === 'creer') {
      const next: Enquete = {
        ...e,
        [plan.collection]: [...(e[plan.collection] || []), plan.acte],
        dateMiseAJour: now,
      };
      return { enquete: next, result: { action: 'cree', libelle: libelleActe(plan.collection, plan.acte) } };
    }
    if (plan.action === 'prolonger') {
      // Rien de créé : l'acte EXISTANT entre dans le chemin de prolongation
      // déjà en place (« Attente JLD » → colonne Prolongations), exactement
      // comme le bouton « Demander la prolongation » du détail d'enquête.
      const coll = (e[plan.collection] || []).map((a) => {
        if (a.id !== plan.acteId) return a;
        const prevStatut = a.statut === 'prolongation_pending'
          ? (a.prolongationRequest?.prevStatut ?? 'en_cours')
          : a.statut;
        return {
          ...a,
          statut: 'prolongation_pending' as const,
          prolongationRequestedAt: now,
          prolongationRequest: { prodId: prod.prodId, prevStatut },
        };
      });
      const next: Enquete = { ...e, [plan.collection]: coll, dateMiseAJour: now };
      return { enquete: next, result: { action: 'prolonge', libelle: plan.libelle } };
    }
    if (plan.action === 'existant') {
      // La mesure est DÉJÀ suivie (saisie manuelle, enregistrer_acte, ✓ d'une
      // proposition) : on ne la double pas — et on ne touche à rien.
      return { enquete: e, result: { action: 'existant', libelle: plan.libelle } };
    }
    return { enquete: e, result: { action: 'rien', raison: plan.raison } };
  }

  // ── Réouverture : défaire, tant que le magistrat n'a pas repris la main ──
  for (const c of collections) {
    const liste = e[c] || [];
    const cree = liste.find((a) => a.prodId === prod.prodId);
    if (cree) {
      if (!acteIntact(cree)) return { enquete: e, result: { action: 'rien' } };
      const next: Enquete = { ...e, [c]: liste.filter((a) => a.id !== cree.id), dateMiseAJour: now };
      return { enquete: next, result: { action: 'retire', libelle: libelleActe(c, cree) } };
    }
    const prolonge = liste.find((a) => a.prolongationRequest?.prodId === prod.prodId);
    if (prolonge) {
      // Le JLD a statué entre-temps (statut sorti de l'attente) : on ne défait rien.
      if (prolonge.statut !== 'prolongation_pending') return { enquete: e, result: { action: 'rien' } };
      const coll = liste.map((a) => {
        if (a.id !== prolonge.id) return a;
        const { prolongationRequest, prolongationRequestedAt, ...reste } = a;
        return { ...reste, statut: prolongationRequest!.prevStatut };
      });
      const next: Enquete = { ...e, [c]: coll, dateMiseAJour: now };
      return { enquete: next, result: { action: 'prolongation_annulee', libelle: libelleActe(c, prolonge) } };
    }
  }
  return { enquete: e, result: { action: 'rien' } };
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
    await SiralBridge.setData(storageKey(originId), enquetes);
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
        await SiralBridge.setData(storageKey(state.contentieuxId), _enquetesRef);
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
      const data = await SiralBridge.getData<Enquete[]>(key, []);
      // Normalise au passage les actes : statut des actes expirés (en_cours →
      // termine) et dateFin résiduelle des actes non posés (en attente de
      // pose/autorisation, le délai ne courant qu'à compter de la pose).
      // Si au moins une enquête est corrigée, on persiste pour figer la donnée.
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

      // Remise en cohérence de l'état d'archivage : une enquête archivée par un
      // collègue pouvait revenir « en cours » sur ce poste (fusion de sync
      // arbitrée sur dateMiseAJour, corrigée depuis) tout en gardant son
      // résultat d'audience — donc absente des enquêtes terminées. On la
      // rebascule à partir du journal des modifications, des marqueurs
      // d'archivage, et à défaut du résultat d'audience enregistré.
      const resultatOf = await buildResultatLookup(contentieuxId);
      const { enquetes: repairedData, repaired } = repairArchiveState(validData, resultatOf);
      if (repaired.length > 0) {
        console.warn(
          `🗄️ EnquetesStore[${contentieuxId}]: état d'archivage rétabli sur ${repaired.length} enquête(s)`,
          repaired.map(e => `${e.numero} → ${e.statut}`),
        );
      }

      _enquetesRef = repairedData;
      _contentieuxRef = contentieuxId;
      if (actesNormalized || repaired.length > 0) {
        _isDirty = true;
        _saveThrottled();
      }
      set(state => ({
        ownEnquetes: repairedData,
        enquetes: [...repairedData, ...state.sharedEnquetes],
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
      set(state => {
        // IDENTITÉ STABLE : ce rechargement suit CHAQUE cycle de sync, changement
        // ou pas. Reposer une liste reconstruite à l'identique donnait une
        // nouvelle identité à `enquetes` toutes les ~2 minutes — et tout ce qui
        // en dépend (index des personnes, veille de recoupements, recherche
        // globale) recalculait pour rien. Si rien n'a bougé, on ne touche rien.
        const inchangees = state.sharedEnquetes.length === shared.length
          && shared.every((e, i) => {
            const avant = state.sharedEnquetes[i];
            return avant
              && avant.id === e.id
              && avant.contentieuxOrigine === e.contentieuxOrigine
              && avant.dateMiseAJour === e.dateMiseAJour;
          });
        if (inchangees) return {};
        return {
          sharedEnquetes: shared,
          enquetes: [...state.ownEnquetes, ...shared],
        };
      });
    } catch (error) {
      console.error(`❌ EnquetesStore[${contentieuxId}]: erreur chargement co-saisines`, error);
      set(state => (state.sharedEnquetes.length === 0
        ? {} // déjà vide : on ne casse pas l'identité pour rien
        : { sharedEnquetes: [], enquetes: [...state.ownEnquetes] }));
    }
  },

  flushPendingSave: async () => {
    if (!_isDirty) return;
    try {
      await SiralBridge.setData(storageKey(_contentieuxRef), _enquetesRef);
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
    const ref: ProductionRef = {
      prodId: prod.id, type: prod.type, titre: prod.titre, meta: prod.meta, objet: prod.objet,
    };
    // Rapprochement TOLÉRANT : l'acte rédigé peut porter une écriture courte
    // du numéro (« 85103/843/2026 ») quand l'enquête s'appelle
    // « 85103/843/2026 - GRIVESNES 2 » — même règle que l'ouverture d'un
    // dossier depuis le journal de l'attaché.
    const enquete = findEnqueteParNumero(get().ownEnquetes, numero);
    if (enquete) {
      const { enquete: next, result } = appliquerProductionActe(enquete, ref, validated);
      if (next !== enquete) {
        // On repasse par updateEnquete pour la persistance et la synchro de
        // `selectedEnquete` : seules les collections d'actes ont pu changer.
        get().updateEnquete(enquete.id, {
          actes: next.actes,
          ecoutes: next.ecoutes,
          geolocalisations: next.geolocalisations,
        });
      }
      return result;
    }

    // Enquête PARTAGÉE (co-saisine) : l'acte doit naître dans le contentieux
    // d'ORIGINE — même mécanique qu'ajoutCR. Sans cela, la validation
    // marquait l'acte « traité » sans jamais créer l'acte de suivi.
    const shared = findEnqueteParNumero(get().sharedEnquetes, numero);
    if (!shared?.contentieuxOrigine) return { action: 'rien', raison: 'enquete_introuvable' };
    const manager = ContentieuxManager.getInstance();
    const originEnquetes = manager.getEnquetes(shared.contentieuxOrigine);
    let result: ProductionActeResult = { action: 'rien', raison: 'enquete_introuvable' };
    let changed = false;
    const updated = originEnquetes.map(e => {
      if (e.id !== shared.id) return e;
      const applied = appliquerProductionActe(e, ref, validated);
      result = applied.result;
      if (applied.enquete === e) return e;
      changed = true;
      const label = applied.result.action === 'prolonge'
        ? `Prolongation demandée au JLD depuis un acte rédigé validé : ${prod.titre}`
        : applied.result.action === 'cree'
          ? `Acte créé depuis un acte rédigé validé : ${prod.titre}`
          : `Acte rédigé rouvert : ${prod.titre}`;
      return appendModifications(applied.enquete, [{ type: 'general_info_updated', label }]);
    });
    if (changed) {
      manager.setEnquetes(shared.contentieuxOrigine, updated);
      persistOriginContentieux(shared.contentieuxOrigine, updated);
      get().loadSharedEnquetes();
    }
    return result;
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
          // `dateArchivage` et `dateDesarchivage` sont les deux marqueurs
          // monotones qui tranchent le statut lors des fusions de sync : on
          // pose le nouveau sans effacer l'ancien, c'est le plus récent des
          // deux qui fait foi (cf. utils/archiveState.ts).
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
          // On horodate le désarchivage au lieu d'effacer `dateArchivage` :
          // la fusion compare les deux marqueurs et le plus récent l'emporte,
          // donc le désarchivage se propage sans effacer la trace de
          // l'archivage (qui servait à réparer les statuts perdus).
          const unarchived: Enquete = { ...e, statut: 'en_cours', dateDesarchivage: now, dateMiseAJour: now };
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
