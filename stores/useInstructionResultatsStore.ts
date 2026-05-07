/**
 * Store dédié aux résultats d'audience des dossiers d'instruction.
 *
 * Stockage : `instruction_resultats` (JSON séparé du store des enquêtes
 * audience_resultats), pour éviter toute corruption croisée. Mêmes shape de
 * données que `ResultatAudience` (réutilisation du type pour bénéficier des
 * modales et statistiques existantes), mais le champ `enqueteId` y stocke
 * l'identifiant du `DossierInstruction`.
 *
 * Pas de service de sync serveur dédié pour l'instant (local uniquement).
 */

import { create } from '@/lib/zustand';
import type { ResultatAudience } from '@/types/audienceTypes';
import { electronStorage } from '@/services/storage/electronStorage';
import { APP_CONFIG } from '@/config/constants';

const STORAGE_KEY = APP_CONFIG.STORAGE_KEYS.INSTRUCTION_RESULTATS;

/**
 * Construit la clé composite stockée dans le dictionnaire des résultats.
 * Format : `${contentieuxId}__${dossierId}` (parallèle à buildResultatKey
 * côté audience, mais pour les instructions).
 */
export const buildInstructionResultatKey = (
  contentieuxId: string,
  dossierId: number,
): string => `${contentieuxId}__${dossierId}`;

const FALLBACK_CONTENTIEUX = 'instructions';

const readFreshFromStorage = async (): Promise<Record<string, ResultatAudience>> => {
  try {
    const data = await electronStorage.read<Record<string, ResultatAudience>>(STORAGE_KEY);
    return data || {};
  } catch {
    return {};
  }
};

interface InstructionResultatsState {
  resultats: Record<string, ResultatAudience>;
  isLoading: boolean;
  _initialized: boolean;

  initialize: () => Promise<void>;
  saveResultat: (resultat: ResultatAudience) => Promise<boolean>;
  deleteResultat: (contentieuxId: string, dossierId: number) => Promise<boolean>;
  getResultat: (contentieuxId: string, dossierId: number) => ResultatAudience | null;
  hasResultat: (contentieuxId: string, dossierId: number) => boolean;
}

export const useInstructionResultatsStore = create<InstructionResultatsState>((set, get) => ({
  resultats: {},
  isLoading: true,
  _initialized: false,

  initialize: async () => {
    if (get()._initialized) return;
    set({ _initialized: true, isLoading: true });
    try {
      const data = await readFreshFromStorage();
      set({ resultats: data });
    } catch (e) {
      console.error('InstructionResultatsStore: erreur chargement', e);
      set({ resultats: {} });
    } finally {
      set({ isLoading: false });
    }
  },

  saveResultat: async (resultat: ResultatAudience): Promise<boolean> => {
    const ctxId = resultat.contentieuxId || FALLBACK_CONTENTIEUX;
    const key = buildInstructionResultatKey(ctxId, resultat.enqueteId);
    const fresh = await readFreshFromStorage();
    const next = {
      ...fresh,
      [key]: { ...resultat, contentieuxId: ctxId, modifiedAt: new Date().toISOString() },
    };
    const ok = await electronStorage.createOrUpdate(STORAGE_KEY, next);
    if (ok) {
      set({ resultats: next });
      return true;
    }
    throw new Error('Échec de la sauvegarde du résultat d\'instruction');
  },

  deleteResultat: async (contentieuxId: string, dossierId: number): Promise<boolean> => {
    const key = buildInstructionResultatKey(contentieuxId, dossierId);
    const fresh = await readFreshFromStorage();
    const next = { ...fresh };
    delete next[key];
    const ok = await electronStorage.createOrUpdate(STORAGE_KEY, next);
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
