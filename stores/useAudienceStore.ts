import { create } from '@/lib/zustand';
import { ResultatAudience } from '@/types/audienceTypes';
import { cleanupAudienceResults } from '@/utils/audienceStats';
import { electronStorage } from '@/services/storage/electronStorage';
import { ElectronBridge } from '@/utils/electronBridge';
import { Enquete } from '@/types/interfaces';
import { audienceSyncService } from '@/utils/dataSync/AudienceSyncService';
import {
  LEGACY_CONTENTIEUX_ID,
  buildResultatKey,
  migrateLegacyResultats,
} from '@/utils/audienceLegacy';

// Re-exports pour préserver les imports existants (`@/stores/useAudienceStore`
// est l'API publique historique pour ces helpers).
export { buildResultatKey, migrateLegacyResultats };

const AUDIENCE_STORAGE_KEY = 'audience_resultats';
const CLEANUP_INTERVAL = 30000;

// Lecture fraîche depuis le storage (source de vérité) avec migration des
// clés legacy à la volée. La migration n'est PAS persistée ici — elle l'est
// au moment de `initialize` (un seul écrit suffit).
const readFreshFromStorage = async (): Promise<Record<string, ResultatAudience>> => {
  try {
    const data = await electronStorage.read<Record<string, ResultatAudience>>(AUDIENCE_STORAGE_KEY);
    if (!data) return {};
    return migrateLegacyResultats(data).migrated;
  } catch {
    return {};
  }
};

// Lecture des paires (contentieuxId, enqueteId) existantes pour le cleanup.
const readEnquetePairsForCleanup = async (): Promise<Set<string>> => {
  try {
    const contentieuxIds = ['crimorg', 'ecofi', 'enviro'];
    const pairs = new Set<string>();
    for (const cId of contentieuxIds) {
      const data = await ElectronBridge.getData<Enquete[]>(`ctx_${cId}_enquetes`, []);
      if (Array.isArray(data)) {
        for (const e of data) pairs.add(buildResultatKey(cId, e.id));
      }
    }
    return pairs;
  } catch {
    return new Set();
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
  deleteResultat: (contentieuxId: string, enqueteId: number) => Promise<boolean>;
  startCleanup: () => void;
  stopCleanup: () => void;

  // Helpers (stables, lisent via get())
  getResultat: (contentieuxId: string, enqueteId: number) => ResultatAudience | null;
  hasResultat: (contentieuxId: string, enqueteId: number) => boolean;
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
      const raw = await electronStorage.read<Record<string, ResultatAudience>>(AUDIENCE_STORAGE_KEY);
      const { migrated, changed } = migrateLegacyResultats(raw || {});
      // Persiste la migration une seule fois si nécessaire (clé legacy → composite).
      if (changed) {
        await electronStorage.createOrUpdate(AUDIENCE_STORAGE_KEY, migrated);
        audienceSyncService.schedulePush();
      }
      set({ resultats: migrated });
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
    const ctxId = resultat.contentieuxId || LEGACY_CONTENTIEUX_ID;
    const key = buildResultatKey(ctxId, resultat.enqueteId);
    const freshResultats = await readFreshFromStorage();
    const newResultats = {
      ...freshResultats,
      [key]: { ...resultat, contentieuxId: ctxId, modifiedAt: new Date().toISOString() },
    };
    // Ceinture+bretelles : si une entrée legacy nue traîne encore (cas où la
    // sync vient juste de la ré-injecter depuis app-data.json), on la purge
    // explicitement pour que `Object.values()` ne la voie plus comme pending.
    delete newResultats[String(resultat.enqueteId)];

    const success = await electronStorage.createOrUpdate(AUDIENCE_STORAGE_KEY, newResultats);
    if (success) {
      set({ resultats: newResultats });
      // Passer la clé touchée → priorité locale dans le prochain merge,
      // pour éviter qu'un push concurrent ou un skew d'horloge fasse
      // ressusciter l'ancienne entrée serveur (typiquement l'audience pending).
      audienceSyncService.schedulePush(key);
      return true;
    }
    throw new Error('Échec de la sauvegarde');
  },

  deleteResultat: async (contentieuxId: string, enqueteId: number): Promise<boolean> => {
    const key = buildResultatKey(contentieuxId, enqueteId);
    const freshResultats = await readFreshFromStorage();
    const newResultats = { ...freshResultats };
    delete newResultats[key];
    // Idem saveResultat : purger toute entrée legacy nue résiduelle, sinon le
    // résultat « supprimé » réapparaît 1 s plus tard via la sync.
    delete newResultats[String(enqueteId)];

    const success = await electronStorage.createOrUpdate(AUDIENCE_STORAGE_KEY, newResultats);
    if (success) {
      set({ resultats: newResultats });
      // Suppression : la clé reste marquée autorité locale → le merge
      // empêchera le serveur de la ressusciter dans la fenêtre.
      audienceSyncService.schedulePush(key);
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

      const enquetePairs = await readEnquetePairsForCleanup();
      if (enquetePairs.size === 0) return;

      const cleanedResultats = cleanupAudienceResults(freshResultats, enquetePairs);
      set({ resultats: cleanedResultats });

      if (Object.keys(cleanedResultats).length !== Object.keys(freshResultats).length) {
        electronStorage.createOrUpdate(AUDIENCE_STORAGE_KEY, cleanedResultats);
        // Propager le nettoyage (résultats orphelins) vers le serveur commun
        audienceSyncService.schedulePush();
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
  getResultat: (contentieuxId: string, enqueteId: number): ResultatAudience | null => {
    return get().resultats[buildResultatKey(contentieuxId, enqueteId)] || null;
  },

  hasResultat: (contentieuxId: string, enqueteId: number): boolean => {
    const r = get().resultats[buildResultatKey(contentieuxId, enqueteId)];
    if (!r) return false;
    // Un brouillon de saisies pré-archivage n'est pas un résultat d'audience :
    // il ne doit ni allumer le marteau, ni bloquer l'archivage.
    if (r.isPreArchiveSaisies) return false;
    return true;
  },
}));
