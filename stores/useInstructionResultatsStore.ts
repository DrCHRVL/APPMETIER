/**
 * Store dédié aux résultats d'audience des dossiers d'instruction.
 *
 * Stockage : `instruction_resultats__<windowsUsername>` (JSON séparé du
 * store des enquêtes audience_resultats), pour éviter toute corruption
 * croisée et **isoler les résultats par utilisateur** (chaque magistrat
 * a sa propre liste).
 *
 * Mêmes shape de données que `ResultatAudience` (réutilisation du type
 * pour bénéficier des modales et statistiques existantes), mais le champ
 * `enqueteId` y stocke l'identifiant du `DossierInstruction`.
 */

import { create } from '@/lib/zustand';
import type { ResultatAudience } from '@/types/audienceTypes';
import { electronStorage } from '@/services/storage/electronStorage';
import { APP_CONFIG } from '@/config/constants';

const STORAGE_PREFIX = APP_CONFIG.STORAGE_KEYS.INSTRUCTION_RESULTATS;

/**
 * Construit la clé de stockage user-scoped. `null` si pas d'utilisateur.
 */
const buildStorageKey = (username: string | null): string | null =>
  username ? `${STORAGE_PREFIX}__${username}` : null;

/**
 * Construit la clé composite stockée dans le dictionnaire des résultats.
 * Format : `${contentieuxId}__${dossierId}`.
 */
export const buildInstructionResultatKey = (
  contentieuxId: string,
  dossierId: number,
): string => `${contentieuxId}__${dossierId}`;

const FALLBACK_CONTENTIEUX = 'instructions';

const readFreshFromStorage = async (
  storageKey: string,
): Promise<Record<string, ResultatAudience>> => {
  try {
    const data = await electronStorage.read<Record<string, ResultatAudience>>(storageKey);
    return data || {};
  } catch {
    return {};
  }
};

interface InstructionResultatsState {
  resultats: Record<string, ResultatAudience>;
  isLoading: boolean;
  /** Username courant ; toutes les opérations utilisent la clé dérivée. */
  currentUsername: string | null;

  /**
   * Initialise le store pour un utilisateur donné. Idempotent : si déjà
   * initialisé pour le même username, ne fait rien. Si l'username change,
   * recharge depuis la nouvelle clé.
   */
  setUser: (username: string | null) => Promise<void>;

  saveResultat: (resultat: ResultatAudience) => Promise<boolean>;
  deleteResultat: (contentieuxId: string, dossierId: number) => Promise<boolean>;
  getResultat: (contentieuxId: string, dossierId: number) => ResultatAudience | null;
  hasResultat: (contentieuxId: string, dossierId: number) => boolean;
}

export const useInstructionResultatsStore = create<InstructionResultatsState>((set, get) => ({
  resultats: {},
  isLoading: true,
  currentUsername: null,

  setUser: async (username: string | null) => {
    const previous = get().currentUsername;
    if (previous === username) return;

    set({ currentUsername: username, isLoading: true, resultats: {} });
    const key = buildStorageKey(username);
    if (!key) {
      set({ isLoading: false });
      return;
    }
    try {
      const data = await readFreshFromStorage(key);
      set({ resultats: data });
    } catch (e) {
      console.error('InstructionResultatsStore: erreur chargement', e);
      set({ resultats: {} });
    } finally {
      set({ isLoading: false });
    }
  },

  saveResultat: async (resultat: ResultatAudience): Promise<boolean> => {
    const username = get().currentUsername;
    const storageKey = buildStorageKey(username);
    if (!storageKey) {
      throw new Error('Aucun utilisateur connecté — impossible d\'enregistrer le résultat');
    }
    const ctxId = resultat.contentieuxId || FALLBACK_CONTENTIEUX;
    const key = buildInstructionResultatKey(ctxId, resultat.enqueteId);
    const fresh = await readFreshFromStorage(storageKey);
    const next = {
      ...fresh,
      [key]: { ...resultat, contentieuxId: ctxId, modifiedAt: new Date().toISOString() },
    };
    const ok = await electronStorage.createOrUpdate(storageKey, next);
    if (ok) {
      set({ resultats: next });
      return true;
    }
    throw new Error('Échec de la sauvegarde du résultat d\'instruction');
  },

  deleteResultat: async (contentieuxId: string, dossierId: number): Promise<boolean> => {
    const username = get().currentUsername;
    const storageKey = buildStorageKey(username);
    if (!storageKey) {
      throw new Error('Aucun utilisateur connecté — impossible de supprimer');
    }
    const key = buildInstructionResultatKey(contentieuxId, dossierId);
    const fresh = await readFreshFromStorage(storageKey);
    const next = { ...fresh };
    delete next[key];
    const ok = await electronStorage.createOrUpdate(storageKey, next);
    if (ok) {
      set({ resultats: next });
      return true;
    }
    throw new Error('Échec de la suppression du résultat d\'instruction');
  },

  getResultat: (contentieuxId: string, dossierId: number): ResultatAudience | null => {
    return get().resultats[buildInstructionResultatKey(contentieuxId, dossierId)] || null;
  },

  hasResultat: (contentieuxId: string, dossierId: number): boolean => {
    const r = get().resultats[buildInstructionResultatKey(contentieuxId, dossierId)];
    if (!r) return false;
    if (r.isPreArchiveSaisies) return false;
    return true;
  },
}));
