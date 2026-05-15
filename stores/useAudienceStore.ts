import { create } from '@/lib/zustand';
import { ResultatAudience } from '@/types/audienceTypes';
import { cleanupAudienceResults } from '@/utils/audienceStats';
import { electronStorage } from '@/services/storage/electronStorage';
import { ElectronBridge } from '@/utils/electronBridge';
import { Enquete } from '@/types/interfaces';
import { audienceSyncService } from '@/utils/dataSync/AudienceSyncService';

const AUDIENCE_STORAGE_KEY = 'audience_resultats';
const CLEANUP_INTERVAL = 30000;

// Contentieux par défaut affecté aux résultats legacy (clé numérique nue dans
// le stockage avant l'introduction du namespace par contentieux). Avant le
// refactor, seul crimorg utilisait correctement ce flux : tous les résultats
// existants en base sont donc rattachés à ce contentieux.
const LEGACY_CONTENTIEUX_ID = 'crimorg';

// Construit la clé composite stockée dans `audience_resultats`.
// Format : `${contentieuxId}__${enqueteId}` — double underscore pour éviter
// toute collision avec un id de contentieux contenant un underscore.
export const buildResultatKey = (contentieuxId: string, enqueteId: number): string =>
  `${contentieuxId}__${enqueteId}`;

// Migre un dictionnaire de résultats : ré-encode toutes les clés purement
// numériques (legacy) en clés composites `crimorg__N` et y écrit aussi le
// champ `contentieuxId` sur le résultat lui-même. Idempotent : les clés déjà
// composites sont laissées telles quelles.
const migrateLegacyResultats = (
  data: Record<string, ResultatAudience>
): { migrated: Record<string, ResultatAudience>; changed: boolean } => {
  let changed = false;
  const migrated: Record<string, ResultatAudience> = {};
  for (const [key, value] of Object.entries(data)) {
    if (/^\d+$/.test(key)) {
      const newKey = buildResultatKey(LEGACY_CONTENTIEUX_ID, value.enqueteId);
      migrated[newKey] = { ...value, contentieuxId: value.contentieuxId || LEGACY_CONTENTIEUX_ID };
      changed = true;
    } else if (!value.contentieuxId) {
      // Clé déjà composite mais champ contentieuxId manquant : on extrait
      // l'id du contentieux depuis la clé pour rester cohérent.
      const [ctxFromKey] = key.split('__');
      migrated[key] = { ...value, contentieuxId: ctxFromKey || LEGACY_CONTENTIEUX_ID };
      changed = true;
    } else {
      migrated[key] = value;
    }
  }
  return { migrated, changed };
};

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
