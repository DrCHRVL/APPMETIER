import { create } from '@/lib/zustand';
import { ResultatAudience } from '@/types/audienceTypes';
import { cleanupAudienceResults } from '@/utils/audienceStats';
import { electronStorage } from '@/services/storage/electronStorage';
import { ElectronBridge } from '@/utils/electronBridge';
import { Enquete } from '@/types/interfaces';
import { audienceSyncService } from '@/utils/dataSync/AudienceSyncService';

const AUDIENCE_STORAGE_KEY = 'audience_resultats';
const CLEANUP_INTERVAL = 30000;

// Lecture fraîche depuis le storage (source de vérité)
const readFreshFromStorage = async (): Promise<Record<string, ResultatAudience>> => {
  try {
    const data = await electronStorage.read<Record<string, ResultatAudience>>(AUDIENCE_STORAGE_KEY);
    return data || {};
  } catch {
    return {};
  }
};

// Lecture des enquêtes pour le cleanup
const readEnquetesForCleanup = async (): Promise<Enquete[]> => {
  try {
    const contentieuxIds = ['crimorg', 'ecofi', 'enviro'];
    const all: Enquete[] = [];
    for (const cId of contentieuxIds) {
      const data = await ElectronBridge.getData<Enquete[]>(`ctx_${cId}_enquetes`, []);
      if (Array.isArray(data)) all.push(...data);
    }
    return all;
  } catch {
    return [];
  }
};

interface AudienceState {
  resultats: Record<string, ResultatAudience>;
  isLoading: boolean;
  _cleanupTimer: ReturnType<typeof setInterval> | null;
  _initialized: boolean;

  // Actions
  initialize: () => Promise<void>;
  saveResultat: (resultat: ResultatAudience) => Promise<boolean>;
  deleteResultat: (enqueteId: number) => Promise<boolean>;
  startCleanup: () => void;
  stopCleanup: () => void;

  // Helpers (stables, lisent via get())
  getResultat: (enqueteId: number) => ResultatAudience | null;
  hasResultat: (enqueteId: number) => boolean;
}

export const useAudienceStore = create<AudienceState>((set, get) => ({
  resultats: {},
  isLoading: true,
  _initialized: false,
  _cleanupTimer: null,

  initialize: async () => {
    // Guard : ne pas initialiser 2 fois (évite accumulation d'event listeners)
    if (get()._initialized) return;
    set({ _initialized: true, isLoading: true });

    try {
      // Tirer les résultats depuis le serveur commun (audience-data.json) avant
      // de lire le local, pour que les nouveaux postes voient tout de suite les
      // résultats OI/CSS/CRPC de leurs collègues.
      await audienceSyncService.sync();
      const savedResultats = await readFreshFromStorage();
      set({ resultats: savedResultats });
    } catch (error) {
      console.error('AudienceStore: erreur chargement', error);
      set({ resultats: {} });
    } finally {
      set({ isLoading: false });
    }

    // Écouter les événements de mise à jour externe :
    // - 'audience-stats-update'    : recalcul interne (utils/audienceStats)
    // - 'data-sync-completed'      : compat ancien pipeline
    // - 'global-sync-completed'    : nouveau pipeline dédié (audience-data.json)
    const handleExternalUpdate = (event?: Event) => {
      const custom = event as CustomEvent<{ scope?: string }> | undefined;
      if (custom?.detail?.scope && custom.detail.scope !== 'audience') return;
      readFreshFromStorage().then(freshData => {
        set({ resultats: freshData });
      });
    };
    window.addEventListener('audience-stats-update', handleExternalUpdate as EventListener);
    window.addEventListener('data-sync-completed', handleExternalUpdate as EventListener);
    window.addEventListener('global-sync-completed', handleExternalUpdate as EventListener);

    // Démarrer le cleanup périodique
    get().startCleanup();
  },

  saveResultat: async (resultat: ResultatAudience): Promise<boolean> => {
    const freshResultats = await readFreshFromStorage();
    const newResultats = {
      ...freshResultats,
      [resultat.enqueteId]: { ...resultat, modifiedAt: new Date().toISOString() },
    };

    const success = await electronStorage.createOrUpdate(AUDIENCE_STORAGE_KEY, newResultats);
    if (success) {
      set({ resultats: newResultats });
      audienceSyncService.schedulePush();
      return true;
    }
    throw new Error('Échec de la sauvegarde');
  },

  deleteResultat: async (enqueteId: number): Promise<boolean> => {
    const freshResultats = await readFreshFromStorage();
    const newResultats = { ...freshResultats };
    delete newResultats[enqueteId];

    const success = await electronStorage.createOrUpdate(AUDIENCE_STORAGE_KEY, newResultats);
    if (success) {
      set({ resultats: newResultats });
      audienceSyncService.schedulePush();
      return true;
    }
    throw new Error('Échec de la suppression');
  },

  startCleanup: () => {
    // Arrêter un éventuel timer existant avant d'en créer un nouveau
    get().stopCleanup();

    const runCleanup = async () => {
      const { isLoading } = get();
      if (isLoading) return;

      const freshResultats = await readFreshFromStorage();
      if (Object.keys(freshResultats).length === 0) return;

      const enquetes = await readEnquetesForCleanup();
      if (enquetes.length === 0) return;

      const cleanedResultats = cleanupAudienceResults(freshResultats, enquetes);
      set({ resultats: cleanedResultats });

      if (Object.keys(cleanedResultats).length !== Object.keys(freshResultats).length) {
        electronStorage.createOrUpdate(AUDIENCE_STORAGE_KEY, cleanedResultats);
      }
    };

    const timer = setInterval(runCleanup, CLEANUP_INTERVAL);
    set({ _cleanupTimer: timer });
  },

  stopCleanup: () => {
    const timer = get()._cleanupTimer;
    if (timer) clearInterval(timer);
    set({ _cleanupTimer: null });
  },

  // Helpers stables — n'entraînent jamais de re-render
  getResultat: (enqueteId: number): ResultatAudience | null => {
    return get().resultats[enqueteId] || null;
  },

  hasResultat: (enqueteId: number): boolean => {
    return !!get().resultats[enqueteId];
  },
}));
