"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Menu, FolderSearch, SearchX } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { MultiSideBar } from '@/components/MultiSideBar';
import { Header } from '@/components/Header';
import { FilterBar } from '@/components/FilterBar';
import { EnquetePreview } from '@/components/EnquetePreview';
import { LazyGrid } from '@/components/ui/LazyGrid';
import { NewEnqueteModal } from '@/components/modals/NewEnqueteModal';
import { EnqueteDetailModal } from '@/components/modals/EnqueteDetailModal';
import { TagManagementPage } from '@/components/pages/TagManagementPage';
import { AlertsPage } from '@/components/pages/AlertsPage';
import { AlertsModal } from '@/components/modals/AlertsModal';
import { SavePage } from '@/components/pages/SavePage';
const StatsPage = dynamic(() => import('@/components/pages/StatsPage').then(m => ({ default: m.StatsPage })), { ssr: false });
const DashboardPage = dynamic(() => import('@/components/pages/DashboardPage').then(m => ({ default: m.DashboardPage })), { ssr: false });
import { useContentieuxEnquetesStore as useContentieuxEnquetes } from '@/hooks/useContentieuxEnquetesStore';
import { useFilterSort } from '@/hooks/useFilterSort';
import { useInfractionFilter } from '@/hooks/useInfractionFilter';
import { useDocumentSearch } from '@/hooks/useDocumentSearch';
import { Enquete, NewEnqueteData, Tag, ToDoItem } from '@/types/interfaces';
import { StorageManager } from '@/utils/storage';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { ToastProvider, useToast } from '@/contexts/ToastContext';
import { AudienceProvider, useAudience } from '@/contexts/AudienceContext';
import { buildResultatKey } from '@/stores/useAudienceStore';
import { InstructionResultatsProvider } from '@/contexts/InstructionResultatsContext';
import type { EnquetePreliminaireOption } from '@/components/instruction/LierEnquetePreliminaireModal';
import { UserProvider, useUser } from '@/contexts/UserContext';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { ProlongationModal } from '@/components/modals/ProlongationModal';
import { PoseActeModal } from '@/components/modals/PoseActeModal';
import { ProlongationValidationModal } from '@/components/modals/ProlongationValidationModal';
import { DateUtils } from '@/utils/dateUtils';
import { ActeUtils } from '@/utils/acteUtils';
import { PermanencePage } from '@/components/pages/PermanencePage';
import { ArchivePage } from '@/components/pages/ArchivePage';
import type { EnqueteWithContext } from '@/utils/mindmapGraph';
import { sameMecPerson } from '@/utils/mindmapGraph';
import { useTags } from '@/hooks/useTags';
import { useSections } from '@/hooks/useSections';
import { useUserServiceOrganization } from '@/hooks/useUserServiceOrganization';
import dynamic from 'next/dynamic';

const AIRPage = dynamic(
  () => import('@/components/pages/AIRPage').then(m => ({ default: m.AIRPage })),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center h-full gap-5 text-white/50">
        <div className="w-9 h-9 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
        <p className="text-sm tracking-wide">Chargement du suivi AIR…</p>
        <div className="w-56 h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full w-2/3 bg-blue-400/70 rounded-full animate-pulse" />
        </div>
      </div>
    ),
  }
);

// Imports pour les instructions judiciaires (refonte PR1)
const InstructionsPage = dynamic(
  () => import('@/components/pages/InstructionsPage').then(m => ({ default: m.InstructionsPage })),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center h-full gap-5 text-white/50">
        <div className="w-9 h-9 rounded-full border-2 border-indigo-400/30 border-t-indigo-400 animate-spin" />
        <p className="text-sm tracking-wide">Chargement des instructions…</p>
        <div className="w-56 h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full w-2/3 bg-indigo-400/70 rounded-full animate-pulse" />
        </div>
      </div>
    ),
  }
);
const NewInstructionModal = dynamic(
  () => import('@/components/modals/NewInstructionModal').then(m => ({ default: m.NewInstructionModal })),
  { ssr: false }
);
const InstructionArchivesPage = dynamic(
  () => import('@/components/pages/InstructionArchivesPage').then(m => ({ default: m.InstructionArchivesPage })),
  { ssr: false }
);
const MindmapPage = dynamic(
  () => import('@/components/pages/MindmapPage').then(m => ({ default: m.MindmapPage })),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center h-full gap-5 text-white/50">
        <div className="w-9 h-9 rounded-full border-2 border-violet-400/30 border-t-violet-400 animate-spin" />
        <p className="text-sm tracking-wide">Chargement de la cartographie…</p>
        <div className="w-56 h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full w-2/3 bg-violet-400/70 rounded-full animate-pulse" />
        </div>
      </div>
    ),
  }
);
const InstructionDetailModal = dynamic(() => import('@/components/modals/InstructionDetailModal').then(m => ({ default: m.InstructionDetailModal })), { ssr: false });
import { useInstructions } from '@/hooks/useInstructions';
import { useInstructionAlerts } from '@/hooks/useInstructionAlerts';
import type { DossierInstruction } from '@/types/instructionTypes';

import { useAIR } from '@/hooks/useAIR';
import { useCombinedAlerts } from '@/hooks/useCombinedAlerts';
import { useVisualAlerts } from '@/hooks/useVisualAlerts';
import { contentieuxAlertsSyncService } from '@/utils/dataSync/ContentieuxAlertsSyncService';
import { backupManager } from '@/utils/backupManager';
const WeeklyRecapPopup = dynamic(() => import('@/components/modals/WeeklyRecapPopup').then(m => ({ default: m.WeeklyRecapPopup })), { ssr: false });
import { WeeklyPopupConfig } from '@/types/interfaces';
import { ElectronBridge } from '@/utils/electronBridge';
import { OPTimeline } from '@/components/OPTimeline';
import { TodoReminderBar } from '@/components/TodoReminderBar';
import { PendingActsJLD } from '@/components/PendingActsJLD';
import { PendingPose } from '@/components/PendingPose';

// 🆕 Imports pour la synchronisation des données
import { DataSyncConflictModal } from '@/components/modals/DataSyncConflictModal';
import { ConflictAction, SyncConflict, SyncData } from '@/types/dataSyncTypes';
import { useMultiSyncStatus } from '@/hooks/useMultiSyncStatus';
import { DataSyncManager } from '@/utils/dataSync/DataSyncManager';
import { MultiSyncManager } from '@/utils/dataSync/MultiSyncManager';
import { instructionSyncService } from '@/utils/dataSync/InstructionSyncService';
import { airSyncService } from '@/utils/dataSync/AIRSyncService';
import { UpdateChangelogModal } from '@/components/modals/UpdateChangelogModal';

// 🆕 Multi-contentieux
const SettingsModal = dynamic(() => import('@/components/modals/SettingsModal').then(m => ({ default: m.SettingsModal })), { ssr: false });
const ShareInvitationModal = dynamic(() => import('@/components/modals/ShareInvitationModal').then(m => ({ default: m.ShareInvitationModal })), { ssr: false });
const OverboardPage = dynamic(() => import('@/components/pages/OverboardPage').then(m => ({ default: m.OverboardPage })), { ssr: false });
const GlobalStatsPage = dynamic(() => import('@/components/pages/GlobalStatsPage').then(m => ({ default: m.GlobalStatsPage })), { ssr: false });
import { ContentieuxId } from '@/types/userTypes';
import { useCrossSearch } from '@/hooks/useCrossSearch';
const AdminUsersPanel = dynamic(() => import('@/components/AdminUsersPanel').then(m => ({ default: m.AdminUsersPanel })), { ssr: false });
import { UserManager } from '@/utils/userManager';
const AdminContentieuxPanel = dynamic(() => import('@/components/admin/AdminContentieuxPanel').then(m => ({ default: m.AdminContentieuxPanel })), { ssr: false });
const AdminInstructionPanel = dynamic(() => import('@/components/admin/AdminInstructionPanel').then(m => ({ default: m.AdminInstructionPanel })), { ssr: false });
const AdminAIRPanel = dynamic(() => import('@/components/admin/AdminAIRPanel').then(m => ({ default: m.AdminAIRPanel })), { ssr: false });
const AdminCartographyPanel = dynamic(() => import('@/components/admin/AdminCartographyPanel').then(m => ({ default: m.AdminCartographyPanel })), { ssr: false });
const AdminPathsPanel = dynamic(() => import('@/components/admin/AdminPathsPanel').then(m => ({ default: m.AdminPathsPanel })), { ssr: false });
const AdminDashboardPanel = dynamic(() => import('@/components/admin/AdminDashboardPanel').then(m => ({ default: m.AdminDashboardPanel })), { ssr: false });
const AdminTagHistoryPanel = dynamic(() => import('@/components/admin/AdminTagHistoryPanel').then(m => ({ default: m.AdminTagHistoryPanel })), { ssr: false });
const AdminNatinfPanel = dynamic(() => import('@/components/admin/AdminNatinfPanel').then(m => ({ default: m.AdminNatinfPanel })), { ssr: false });
const AdminUpdatePanel = dynamic(() => import('@/components/admin/AdminUpdatePanel').then(m => ({ default: m.AdminUpdatePanel })), { ssr: false });
const AboutContent = dynamic(() => import('@/components/AboutContent').then(m => ({ default: m.AboutContent })), { ssr: false });
const AgendaPanel = dynamic(() => import('@/components/AgendaPanel').then(m => ({ default: m.AgendaPanel })), { ssr: false });
const MyProfileContent = dynamic(() => import('@/components/MyProfileContent').then(m => ({ default: m.MyProfileContent })), { ssr: false });
import { useOverboardData } from '@/hooks/useOverboardData';
import { HeartbeatManager } from '@/utils/heartbeatManager';
import { SharedEventManager } from '@/utils/sharedEventManager';
import { NetworkStatusManager } from '@/utils/networkStatusManager';
import { AuditLogger } from '@/utils/auditLogger';

const CHEMIN_BASE = "P:\\TGI\\Parquet\\P17 - STUP - CRIM ORG\\PRELIM EN COURS\\";


function AppContent() {
  const [isClient, setIsClient] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false); // tiroir de navigation (petits écrans)
  const [currentView, setCurrentView] = useState('dashboard');
  const [searchTerm, setSearchTerm] = useState('');
  // Debounce de la recherche : l'input reste réactif, les hooks coûteux attendent 300ms
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setDebouncedSearchTerm(value), 300);
  }, []);

  // 🆕 Multi-contentieux
  const [activeContentieux, setActiveContentieux] = useState<ContentieuxId | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsContentieuxId, setSettingsContentieuxId] = useState<ContentieuxId | null>(null);
  const [pendingUsersCount, setPendingUsersCount] = useState(0);
  const { isAuthenticated, isLoading: userLoading, error: userError, accessibleContentieux, canDo, isAdmin, hasOverboard, hasModule, user, contentieux: contentieuxDefs } = useUser();
  // Profil JLD : accès restreint au seul tableau de bord (aperçu d'acte dédié,
  // aucune autre vue, aucune alerte, aucun paramètre).
  const isJLDUser = user?.globalRole === 'jld';

  // Initialiser le contentieux actif au premier accessible.
  // La vue par défaut reste le Tableau de bord (on ne force pas les enquêtes).
  useEffect(() => {
    if (!activeContentieux && accessibleContentieux.length > 0) {
      setActiveContentieux(accessibleContentieux[0].id);
    }
  }, [accessibleContentieux, activeContentieux]);

  // Réinitialise la recherche à chaque changement de vue
  const handleViewChange = async (view: string, contentieuxId?: ContentieuxId) => {
    // Le JLD est verrouillé sur le tableau de bord : toute autre vue est ignorée.
    if (isJLDUser && view !== 'dashboard') return;
    // Vérifier que l'utilisateur a accès au contentieux demandé
    if (contentieuxId && !accessibleContentieux.some(c => c.id === contentieuxId)) {
      return;
    }
    // Flush les données en attente avant de changer de contentieux
    if (contentieuxId && contentieuxId !== activeContentieux) {
      await flushPendingSave();
    }
    setSearchTerm('');
    setDebouncedSearchTerm('');
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setSelectedTags([]);
    setSortOrder('date-desc');
    setCurrentView(view);
    if (contentieuxId) {
      setActiveContentieux(contentieuxId);
    }
    // Rafraîchir l'overboard quand on y navigue (données potentiellement modifiées)
    if (view === 'overboard' || view === 'global_stats' || view === 'dashboard') {
      refreshOverboard();
    }
  };

  // Extraire le type de vue et le contentieux depuis les vues composites (ex: "enquetes_crimorg")
  const parseView = (view: string): { baseView: string; viewContentieux: ContentieuxId | null } => {
    const parts = view.split('_');
    if (parts.length >= 2) {
      const baseView = parts[0];
      const cId = parts.slice(1).join('_');
      // Vérifier que c'est bien un contentieux valide
      if (contentieuxDefs.some(c => c.id === cId)) {
        return { baseView, viewContentieux: cId };
      }
    }
    return { baseView: view, viewContentieux: null };
  };

  const { baseView, viewContentieux } = parseView(currentView);
  const effectiveContentieux = viewContentieux || activeContentieux;
  const [showNewEnqueteModal, setShowNewEnqueteModal] = useState(false);
  const [showNewInstructionModal, setShowNewInstructionModal] = useState(false);
  const [showAlertsModal, setShowAlertsModal] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [sortOrder, setSortOrder] = useState('date-desc');
  const [isSaving, setIsSaving] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<() => void>(() => {});
  const [globalTodos, setGlobalTodos] = useState<ToDoItem[]>([]);
  const { showToast } = useToast();

  // Popup de récapitulatif hebdomadaire
  const [showWeeklyPopup, setShowWeeklyPopup] = useState(false);
  const [weeklyBuckets, setWeeklyBuckets] = useState<Array<{
    contentieuxId: string;
    contentieuxLabel: string;
    contentieuxColor?: string;
    enquetes: any[];
  }>>([]);
  const { subscribedContentieux: weeklySubscribedIds, crDelayHighlight, instructionWeeklyRecapSubscribed, instructionNetworkPath } = useUserPreferences();

  // Construit les buckets pour le récap hebdo : intersection des contentieux
  // abonnés et des contentieux actuellement accessibles à l'utilisateur, en
  // lisant directement ctx_{id}_enquetes pour chaque (pas besoin d'activer le
  // contentieux dans le store).
  const buildWeeklyBuckets = useCallback(async () => {
    const allowedIds = new Set(accessibleContentieux.map(c => c.id));
    const effective = weeklySubscribedIds.filter(id => allowedIds.has(id));
    const results = await Promise.all(effective.map(async (id) => {
      const def = accessibleContentieux.find(c => c.id === id);
      const enq = await ElectronBridge.getData<any[]>(`ctx_${id}_enquetes`, []);
      return {
        contentieuxId: id,
        contentieuxLabel: def?.label || id,
        contentieuxColor: def?.color,
        enquetes: Array.isArray(enq) ? enq : [],
      };
    }));
    setWeeklyBuckets(results);
    return results;
  }, [accessibleContentieux, weeklySubscribedIds]);

  const openWeeklyPopup = useCallback(async () => {
    await buildWeeklyBuckets();
    setShowWeeklyPopup(true);
  }, [buildWeeklyBuckets]);

  // Ancien moteur de sync racine (DataSyncManager / useDataSync) : DÉSACTIVÉ.
  // Il synchronisait contre le fichier serveur racine `app-data.json`, qui
  // n'est plus alimenté, et écrasait/supprimait la clé locale héritée
  // `enquetes` (perte de données observée). La synchronisation est désormais
  // gérée intégralement par MultiSyncManager (clés `ctx_<contentieux>_enquetes`).
  // Ne pas remonter ce hook sans avoir d'abord retiré ses écritures destructrices.

  // 🆕 Statut consolidé de la synchronisation multi-contentieux (bandeau + page Sauvegardes)
  const { syncStatus, isSyncing } = useMultiSyncStatus();

  // 🆕 État pour le modal de conflits (multi-contentieux)
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [multiConflict, setMultiConflict] = useState<{
    contentieuxId: ContentieuxId;
    conflicts: SyncConflict[];
    localData: SyncData;
    serverData: SyncData;
  } | null>(null);

  // Auto-fermer le modal de conflits si les conditions deviennent invalides
  useEffect(() => {
    if (showConflictModal && !multiConflict) {
      setShowConflictModal(false);
    }
  }, [showConflictModal, multiConflict]);

  // Mise à jour de l'application
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateCommits, setUpdateCommits] = useState(0);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateLocalSha, setUpdateLocalSha] = useState<string | null>(null);
  const [updateRemoteSha, setUpdateRemoteSha] = useState<string | null>(null);
  const [updateApprovedSha, setUpdateApprovedSha] = useState<string | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  // Hook pour les enquêtes — scopé au contentieux actif (défaut : crimorg)
  const currentContentieuxId = effectiveContentieux || 'crimorg';
  const {
    enquetes,
    isLoading: enquetesLoading,
    selectedEnquete,
    isEditing,
    editingCR,
    setSelectedEnquete,
    setIsEditing,
    setEditingCR,
    handleAjoutCR,
    handleUpdateCR,
    handleDeleteCR,
    handleUpdateEnquete,
    handleAddEnquete,
    handleArchiveEnquete,
    handleDeleteEnquete,
    handleUnarchiveEnquete,
    handleStartEnquete,
    flushPendingSave,
    refreshData: refreshEnquetes,
    isSharedEnquete,
    handleShareEnquete,
    handleUnshareEnquete,
    handleTransferEnquete,
  } = useContentieuxEnquetes(currentContentieuxId);

  // Ref pour les callbacks stables qui lisent les enquêtes courantes.
  // Mise à jour via useEffect plutôt que pendant le render (plus sûr en concurrent mode).
  const enquetesLookupRef = useRef(enquetes);
  useEffect(() => {
    enquetesLookupRef.current = enquetes;
  });

  // Hook Overboard — données transversales (tous contentieux)
  const { enquetesByContentieux: overboardData, refresh: refreshOverboard, applyEnqueteUpdate: applyOverboardUpdate } = useOverboardData(contentieuxDefs);

  // Résultats d'audience (dont le marqueur OI) — sert à proposer, dans le module
  // instruction, les seules enquêtes préliminaires éligibles au rattachement.
  const { audienceState } = useAudience();

  // Wrapper qui met à jour l'enquête dans le store scopé ET dans le snapshot
  // Overboard, pour que le tableau de bord (qui lit le snapshot) reflète
  // immédiatement le changement — ex. cocher une tâche « à faire » — sans
  // attendre un rechargement de la page.
  const handleUpdateEnqueteSynced = useCallback((id: number, updates: Partial<Enquete>) => {
    handleUpdateEnquete(id, updates);
    applyOverboardUpdate(id, updates);
  }, [handleUpdateEnquete, applyOverboardUpdate]);

  // Hook pour les instructions judiciaires (refonte PR1 — modèle DossierInstruction)
  const {
    dossiers: instructions,
    addDossier: handleAddInstruction,
    updateDossier: handleUpdateInstruction,
    deleteDossier: handleDeleteInstruction,
    refresh: refreshInstructions,
  } = useInstructions();
  const [selectedInstruction, setSelectedInstruction] = useState<DossierInstruction | null>(null);
  const [isEditingInstruction, setIsEditingInstruction] = useState(false);
  // Stub d'alertes instruction (PR3 réimplémentera la génération automatique)
  const {
    instructionAlerts,
    handleValidateInstructionAlert,
    handleSnoozeInstructionAlert,
  } = useInstructionAlerts(instructions);

  // Hook pour les mesures AIR
  const {
    mesures: mesuresAIR,
    selectedMesure,
    isLoading: isLoadingAIR,
    isEditing: isEditingAIR,
    setSelectedMesure,
    setIsEditing: setIsEditingAIR,
    handleAddMesure,
    handleUpdateMesure,
    handleDeleteMesure,
    handleDeleteAllMesures,
    handleImportMesures
  } = useAIR();

  // Hook combiné pour les alertes
  const {
    alerts,
    enqueteAlerts,
    airAlerts,
    alertRules,
    isLoading: alertsLoading,
    updateAlerts,
    handleUpdateAlertRule,
    handleDuplicateRule,
    handleDeleteRule,
    handleSnoozeAlert,
    handleValidateAlert,
    unseenCount: unseenAlertsCount,
    markAllSeen: markAlertsSeen
  } = useCombinedAlerts(enquetes, mesuresAIR, currentContentieuxId);


  // Hook tags centralisé - simplifié
  const {
    tags,
    isLoading: tagsLoading,
    getTagsByCategory
  } = useTags();

  const { getSectionOrder, sections: sectionsList, reorderSection, addSection: addSectionFn } = useSections();
  const { getTagSection } = useUserServiceOrganization();

  // Hook alertes visuelles
  const {
    visualAlertRules,
    updateVisualAlertRule,
    deleteVisualAlertRule,
    reorderVisualAlertRules,
  } = useVisualAlerts();

  // Initialisation du système de sauvegarde
  useEffect(() => {
    backupManager.initialize();
    return () => {
      backupManager.stopAutomaticBackup();
    };
  }, []);

  // Sauvegarde réseau privée du module instruction : active uniquement si le
  // module est activé pour l'utilisateur ET qu'un dossier réseau est configuré.
  useEffect(() => {
    const enabled = hasModule('instructions');
    instructionSyncService.configure(
      enabled ? (user?.windowsUsername || null) : null,
      enabled ? instructionNetworkPath : null,
    );
  }, [hasModule, user?.windowsUsername, instructionNetworkPath]);

  // Sauvegarde réseau privée du module AIR (mesures AIR), avec partage
  // réciproque optionnel. En mode web, le coffre serveur chiffré `air-<user>`
  // sert de magasin — aucun dossier réseau à configurer.
  useEffect(() => {
    const enabled = hasModule('air');
    airSyncService.configure(
      enabled ? (user?.windowsUsername || null) : null,
      null,
    );
  }, [hasModule, user?.windowsUsername]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Rafraîchissement en arrière-plan quand l'app revient au premier plan (comme Slack)
  // Garde l'UI affichée (pas de page blanche), recharge les données silencieusement
  useEffect(() => {
    let lastHidden = 0;
    const STALE_THRESHOLD = 300_000; // 5min d'absence → rafraîchir (30s trop agressif en écran partagé)

    const handleVisibility = () => {
      if (document.hidden) {
        lastHidden = Date.now();
      } else if (lastHidden && Date.now() - lastHidden > STALE_THRESHOLD) {
        // L'app est revenue après 5min+ d'absence → refresh silencieux
        refreshEnquetes();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [refreshEnquetes]);

  // Enregistrer le flush de sauvegarde pour éviter la race condition sync/throttle
  useEffect(() => {
    DataSyncManager.registerPreSyncFlush(flushPendingSave);
  }, [flushPendingSave]);

  // Chargement des todos généraux au démarrage
  useEffect(() => {
    ElectronBridge.getData<ToDoItem[]>('global_todos', []).then(todos => {
      setGlobalTodos(todos || []);
    });
  }, []);

  // Compter les utilisateurs en attente d'approbation (admin uniquement)
  useEffect(() => {
    if (!isAdmin()) { setPendingUsersCount(0); return; }
    const count = UserManager.getInstance().getPendingUsersCount();
    setPendingUsersCount(count);
  }, [isAdmin, showSettingsModal]);

  // Démarrage des services temps réel (heartbeat, événements, audit)
  useEffect(() => {
    if (!user || !isAuthenticated) return;

    // Démarrer le moniteur réseau en premier : les autres services réagiront
    // à l'état initial via leurs propres timeouts (pas de coordination dure
    // pour l'instant, juste de la transparence côté UI).
    let cancelled = false;
    (async () => {
      const initial = await NetworkStatusManager.start();
      if (cancelled) return;

      // Sync prioritaire au lancement : récupérer les événements partagés
      // récents (24 h) avec un plafond de 8 s côté main process. Si le réseau
      // est injoignable, on toast et on bascule en mode dégradé.
      if (initial.state === 'unreachable') {
        showToast('Réseau injoignable — modifications enregistrées localement', 'warning');
      } else {
        try {
          const api = (window as any).electronAPI;
          const result = await api?.readRecentSharedEvents?.(24 * 60 * 60 * 1000);
          if (result?.events?.length) {
            // Rejouer les événements via SharedEventManager (déclenche les listeners
            // déjà branchés par les hooks métier).
            for (const ev of result.events) {
              SharedEventManager.dispatch(ev);
            }
          }
          if (result?.partial) {
            showToast('Synchronisation initiale partielle — réseau lent', 'info');
          }
        } catch {
          // Silencieux : le watcher prendra le relais
        }
      }
    })();

    // Heartbeat
    const hb = HeartbeatManager.getInstance();
    hb.start(user.windowsUsername, user.displayName);

    // Événements partagés
    const sem = SharedEventManager.getInstance();
    sem.start(user.windowsUsername);
    // Démarrer le file watcher côté main process
    (window as any).electronAPI?.startEventsWatcher?.();

    // Journal d'audit
    const audit = AuditLogger.getInstance();
    audit.initialize(user.windowsUsername, user.displayName);
    audit.log('user_login', `Connexion de ${user.displayName}`);

    // Nettoyage périodique des événements (toutes les 5 min)
    const cleanupInterval = setInterval(() => {
      SharedEventManager.cleanup();
    }, 5 * 60_000);

    return () => {
      cancelled = true;
      hb.stop();
      clearInterval(cleanupInterval);
    };
  }, [user, isAuthenticated, showToast]);

  // Mise à jour du contexte heartbeat quand la vue change
  useEffect(() => {
    if (!user) return;
    const hb = HeartbeatManager.getInstance();
    hb.updateContext(activeContentieux, baseView);
  }, [activeContentieux, baseView, user]);

  const handleGlobalTodosChange = useCallback((todos: ToDoItem[]) => {
    setGlobalTodos(todos);
    ElectronBridge.setData('global_todos', todos);
  }, []);

  // Popup récapitulatif hebdomadaire : vérifié au démarrage, une fois que
  // les contentieux accessibles et les abonnements utilisateur sont chargés.
  // N'ouvre pas le popup si aucun contentieux n'est coché : le user doit
  // s'abonner explicitement via Paramètres → Alertes.
  const weeklyCheckDoneRef = useRef(false);
  useEffect(() => {
    if (weeklyCheckDoneRef.current) return;
    if (accessibleContentieux.length === 0) return;

    const allowedIds = new Set(accessibleContentieux.map(c => c.id));
    const effectiveIds = weeklySubscribedIds.filter(id => allowedIds.has(id));
    if (effectiveIds.length === 0) return;

    const checkWeeklyPopup = async () => {
      try {
        const cfg = await ElectronBridge.getData<WeeklyPopupConfig>('weekly_popup_config', {
          enabled: false, dayOfWeek: 1, hour: 9
        });
        if (!cfg.enabled) return;

        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];

        if (cfg.lastShownDate === todayStr) return;

        const isRightDay = cfg.dayOfWeek === 7 || now.getDay() === cfg.dayOfWeek;
        if (isRightDay && now.getHours() >= cfg.hour) {
          await ElectronBridge.setData('weekly_popup_config', { ...cfg, lastShownDate: todayStr });
          await buildWeeklyBuckets();
          setShowWeeklyPopup(true);
          weeklyCheckDoneRef.current = true;
        }
      } catch {
        // Silencieux si stockage non disponible
      }
    };
    checkWeeklyPopup();
  }, [accessibleContentieux, weeklySubscribedIds, buildWeeklyBuckets]);

  // Vérification des mises à jour au démarrage (puis toutes les 30 min) — Electron uniquement.
  // Sur le serveur web, la vérification et l'application sont gérées dans AdminUpdatePanel (admin seulement).
  useEffect(() => {
    if ((window as { __SIRAL_WEB__?: boolean }).__SIRAL_WEB__ === true) return;
    const checkUpdate = async () => {
      try {
        const result = await window.electronAPI.checkAppUpdate?.();
        if (result) {
          setUpdateAvailable(result.hasUpdate || false);
          setUpdateCommits(result.commits || 0);
          setUpdateLocalSha(result.localSha || null);
          setUpdateRemoteSha(result.remoteSha || null);
          setUpdateApprovedSha(result.approvedSha || null);
        }
      } catch {
        // Silencieux si pas de connexion
      }
    };
    checkUpdate();
    const interval = setInterval(checkUpdate, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleApplyUpdate = async () => {
    // Sur le serveur web, la mise à jour est réservée aux administrateurs et
    // passe par AdminUpdatePanel → ne rien faire ici pour les non-admins.
    if ((window as { __SIRAL_WEB__?: boolean }).__SIRAL_WEB__ === true && !isAdmin()) return;
    setIsUpdating(true);
    try {
      const result = await window.electronAPI.applyAppUpdate?.();
      if (result && !result.success) {
        showToast(`Erreur de mise à jour : ${result.error}`, 'error');
        setIsUpdating(false);
      }
      // En Electron, l'app redémarre d'elle-même → pas besoin de reset l'état
    } catch {
      showToast('Impossible de mettre à jour l\'application', 'error');
      setIsUpdating(false);
    }
  };

  const handleResolveConflicts = async (selections: Map<number, ConflictAction>) => {
  if (!multiConflict) return;
  try {
    await MultiSyncManager.getInstance().resolveConflicts(
      multiConflict.contentieuxId,
      multiConflict.conflicts,
      selections,
      multiConflict.localData,
      multiConflict.serverData
    );
    setShowConflictModal(false);
    setMultiConflict(null);
    showToast('Conflits résolus avec succès', 'success');
    window.location.reload();
  } catch (error) {
    console.error('Erreur résolution conflits:', error);
    showToast('Erreur lors de la résolution des conflits', 'error');
  }
};

// États pour les modales d'actes 
  const [showProlongationModal, setShowProlongationModal] = useState(false);
  const [showPoseModal, setShowPoseModal] = useState(false);
  const [showProlongationValidationModal, setShowProlongationValidationModal] = useState(false);
  const [selectedActe, setSelectedActe] = useState<{id: number, type: 'acte' | 'ecoute' | 'geoloc', enqueteId?: number} | null>(null);

  // getSectionOrder est fourni par useSections()

  const handleManualSave = async () => {
    try {
      setIsSaving(true);
      await StorageManager.addManualSaveToHistory();
      
      const backupSuccess = await backupManager.createBackup(true);
      if (backupSuccess) {
        showToast('Sauvegarde et backup créés avec succès', 'success');
      } else {
        showToast('Sauvegarde créée mais échec du backup', 'warning');
      }
      
      setTimeout(() => setIsSaving(false), 1000);
    } catch (error) {
      console.error('Error saving data:', error);
      showToast('Erreur lors de la sauvegarde', 'error');
      setIsSaving(false);
    }
  };

  // 🆕 Gestionnaire de synchronisation manuelle
  const handleManualSync = async () => {
    try {
      showToast('Synchronisation en cours...', 'info');

      // Synchro multi-contentieux uniquement : met à jour <contentieux>/app-data.json.
      // L'ancien fichier racine app-data.json n'est plus écrit par ce bouton.
      const multiResults = await MultiSyncManager.getInstance().triggerSyncAll();

      // Premier contentieux en conflit → ouvrir la fenêtre de résolution
      const conflictEntry = Array.from(multiResults.entries()).find(
        ([, r]) => r.action === 'conflicts_detected'
      );
      if (conflictEntry) {
        const [contentieuxId, r] = conflictEntry;
        setMultiConflict({
          contentieuxId,
          conflicts: r.conflicts || [],
          localData: r.localData as SyncData,
          serverData: r.serverData as SyncData,
        });
        setShowConflictModal(true);
        showToast('Conflits détectés - veuillez choisir une résolution', 'error');
        return;
      }

      const firstError = Array.from(multiResults.values()).find(
        r => !r.success && r.action === 'error'
      );
      if (firstError) {
        showToast(`Erreur: ${firstError.error || 'Erreur inconnue'}`, 'error');
      } else {
        showToast('Synchronisation réussie', 'success');
        window.location.reload();
      }
    } catch (error) {
      console.error('Erreur sync:', error);
      showToast('Erreur lors de la synchronisation', 'error');
    }
  };

  const handleExportData = async () => {
    try {
      // Exporter les données du contentieux actif (clés préfixées)
      const ctxPrefix = `ctx_${currentContentieuxId}_`;
      const enquetesData = await StorageManager.get(`${ctxPrefix}enquetes`, []);
      const instructionsData = await StorageManager.get(`${ctxPrefix}instructions`, []);
      // Règles d'alertes : on lit la source actuelle (fichier serveur partagé)
      // via le service. La clé locale `ctx_X_alertRules` n'est plus à jour
      // depuis la migration vers contentieux-alerts/{id}.json.
      await contentieuxAlertsSyncService.sync(currentContentieuxId);
      const sharedAlertRules = await contentieuxAlertsSyncService.getRules(currentContentieuxId);
      const tagsData = await StorageManager.get(`${ctxPrefix}customTags`, []);
      const airKey = user?.windowsUsername ? `air_mesures__${user.windowsUsername}` : 'air_mesures';
      const airMesuresData = await StorageManager.get(airKey, []);

      const data = {
        contentieuxId: currentContentieuxId,
        enquetes: enquetesData,
        instructions: instructionsData,
        sharedAlertRules,
        tags: tagsData,
        airMesures: airMesuresData,
        exportDate: new Date().toISOString(),
        version: '4.0'
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sauvegarde_${currentContentieuxId}_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`Exportation réussie (${currentContentieuxId}): ${enquetesData.length} enquêtes, ${instructionsData.length} instructions`, 'success');
    } catch (error) {
      console.error('Erreur lors de l\'exportation des données:', error);
      showToast('Erreur lors de l\'exportation des données', 'error');
    }
  };

  const handleImportData = (mode: 'replace' | 'merge') => {
    setPendingAction(() => () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = async (e) => {
            try {
              await backupManager.createBackup();
              showToast('Sauvegarde de sécurité créée avant import', 'info');
              
              const importedData = JSON.parse(e.target?.result as string);
              
              if (!importedData || typeof importedData !== 'object') {
                throw new Error('Format de données invalide');
              }
              
              const hasEnquetes = 'enquetes' in importedData;
              const hasInstructions = 'instructions' in importedData;
              
              if (!hasEnquetes && !hasInstructions) {
                throw new Error('Le fichier ne contient pas de données d\'enquêtes ou d\'instructions');
              }

              // Déterminer le contentieux cible (depuis le fichier importé ou le contentieux actif)
              const targetCtx = importedData.contentieuxId || currentContentieuxId;
              const ctxPrefix = `ctx_${targetCtx}_`;

              if (hasEnquetes) {
                await StorageManager.set(`${ctxPrefix}enquetes`, importedData.enquetes);
              }
              if (hasInstructions) {
                await StorageManager.set(`${ctxPrefix}instructions`, importedData.instructions);
              }
              // v4.0+ : règles d'alertes partagées du contentieux. Push vers
              // le fichier serveur via le service. v3.0 (legacy) : champ
              // `alertRules` stocké dans la clé locale (plus utilisée).
              if (Array.isArray(importedData.sharedAlertRules)) {
                await contentieuxAlertsSyncService.saveRules(targetCtx, importedData.sharedAlertRules);
              } else if (importedData.alertRules) {
                await StorageManager.set(`${ctxPrefix}alertRules`, importedData.alertRules);
              }
              if (importedData.tags) {
                await StorageManager.set(`${ctxPrefix}customTags`, importedData.tags);
              }

              showToast(`Import réussi dans ${targetCtx}`, 'success');

              setTimeout(() => {
                window.location.reload();
              }, 1000);
              
            } catch (error) {
              console.error('Erreur lors de l\'import:', error);
              showToast(`Erreur lors de l'import: ${error instanceof Error ? error.message : 'Format invalide'}`, 'error');
            }
          };
          reader.readAsText(file);
        }
      };
      input.click();
    });
    setShowConfirmDialog(true);
  };

  const handleNewEnquete = () => {
    if (!effectiveContentieux) {
      showToast('Veuillez sélectionner un contentieux', 'error');
      return;
    }
    if (baseView === 'instructions') {
      setShowNewInstructionModal(true);
    } else {
      setShowNewEnqueteModal(true);
    }
  };

  // Toggle dissimulation JA
  const handleToggleHideFromJA = useCallback((enqueteId: number) => {
    const enquete = enquetesLookupRef.current.find(e => e.id === enqueteId);
    if (!enquete) return;
    const newValue = !enquete.hiddenFromJA;
    handleUpdateEnquete(enqueteId, { hiddenFromJA: newValue });
    showToast(
      newValue ? 'Enquête dissimulée aux JA' : 'Enquête visible par les JA',
      'success'
    );
  }, [handleUpdateEnquete, showToast]);

  // Toggle pin overboard pour une enquête
  const handleToggleOverboardPin = useCallback((enqueteId: number) => {
    if (!user) return;
    const enquete = enquetesLookupRef.current.find(e => e.id === enqueteId);
    if (!enquete) return;

    const pins = enquete.overboardPins || [];
    const existingPin = pins.find(p => p.pinnedBy === user.windowsUsername);

    let newPins;
    if (existingPin) {
      newPins = pins.filter(p => p.pinnedBy !== user.windowsUsername);
      showToast('Enquête retirée du suivi hiérarchique', 'success');
    } else {
      const globalRole = user.globalRole;
      if (!globalRole || !['admin', 'pra', 'vice_proc'].includes(globalRole)) return;
      newPins = [...pins, {
        pinnedBy: user.windowsUsername,
        pinnedAt: new Date().toISOString(),
        role: globalRole as 'admin' | 'pra' | 'vice_proc'
      }];
      showToast('Enquête épinglée au suivi hiérarchique', 'success');
    }
    handleUpdateEnquete(enqueteId, { overboardPins: newPins });
  }, [user, handleUpdateEnquete, showToast]);

  // Filtre d'infractions évolutif : chips = infractions réellement présentes
  // (thème NATINF pour les dossiers migrés, tag legacy sinon), et non plus tout
  // le référentiel de tags historique.
  const { infractionTags: infractionFilterTags, resolveInfractionKeys } = useInfractionFilter(enquetes);

  const filteredAndSortedEnquetes = useFilterSort(enquetes, debouncedSearchTerm, selectedTags, sortOrder, resolveInfractionKeys);

  // Liste dédupliquée de tous les noms de MEC connus (cross-dossiers)
  const allKnownMec = useMemo(
    () => [...new Set(enquetes.flatMap(e => e.misEnCause.map(m => m.nom)))].sort(),
    [enquetes]
  );

  // Sources pour le module Mindmap : toutes enquêtes accessibles + instructions
  // Les dossiers d'instruction (nouveau modèle) sont enveloppés dans une
  // pseudo-Enquete pour rester compatibles avec le builder de graphe.
  const mindmapSources = useMemo<EnqueteWithContext[]>(() => {
    const out: EnqueteWithContext[] = [];
    // Enquêtes préliminaires rattachées à un dossier d'instruction : on les
    // masque pour ne pas créer de doublon sur la cartographie (l'affaire OI est
    // déjà représentée par son dossier d'instruction). Clé = `${ctx}_${id}`,
    // alignée sur l'identifiant de nœud de buildMindmapGraph.
    const suppressedPrelimKeys = new Set<string>();
    for (const inst of instructions) {
      if (inst.enquetePreliminaireId == null) continue;
      const ctx = inst.enquetePreliminaireContentieuxId || inst.contentieuxId;
      if (!ctx) continue;
      suppressedPrelimKeys.add(`${ctx}_${inst.enquetePreliminaireId}`);
    }
    for (const [ctxId, list] of overboardData) {
      for (const e of list) {
        if (suppressedPrelimKeys.has(`${ctxId}_${e.id}`)) continue;
        out.push({ enquete: e, contentieuxId: ctxId });
      }
    }
    for (const inst of instructions) {
      // Un dossier d'instruction n'apparaît sur la cartographie que s'il est
      // rattaché à un contentieux explicite (crimorg / ecofi / enviro / ...).
      // Les fiches "non précisé" sont volontairement masquées de la mindmap.
      if (!inst.contentieuxId) continue;
      // Personnes projetées par le dossier d'instruction lui-même :
      // mis en examen + victimes « sur carto » + suspects. Dédupliquées entre
      // elles avec tolérance (ordre des mots, coquille, composés) : un suspect
      // resté dans la liste après sa mise en examen ne crée pas de second nœud.
      const personnes: Array<Record<string, unknown>> = [];
      const nomsPresents: string[] = [];
      const pushPersonne = (p: Record<string, unknown>, allowSubset = false) => {
        const nom = String(p.nom || '').trim();
        if (!nom) return;
        const matches = nomsPresents.filter(existant => sameMecPerson(existant, nom, { allowSubset }));
        // Nom partiel ambigu (plusieurs candidats) : on ne fusionne que si un
        // match strict existe, sinon on garde la personne distincte.
        if (matches.length === 1 || matches.some(existant => sameMecPerson(existant, nom))) return;
        nomsPresents.push(nom);
        personnes.push(p);
      };
      for (const m of inst.misEnExamen) {
        pushPersonne({ id: m.id, nom: m.nom, statut: m.mesureSurete.type });
      }
      // Victimes explicitement marquées « faire apparaître sur la cartographie » :
      // projetées comme des mis en cause mais étiquetées (Victime).
      for (const v of inst.victimes || []) {
        if (v.surCarto && v.nom?.trim()) {
          pushPersonne({ id: v.id, nom: v.nom, statut: 'victime', isVictime: true });
        }
      }
      // Suspects : projetés sur la cartographie avec un visuel distinct
      // (anneau orange, lien tireté orange vers le dossier).
      for (const s of inst.suspects || []) {
        if (s.nom?.trim()) {
          pushPersonne({ id: s.id, nom: s.nom, statut: 'suspect', isSuspect: true, suspectRole: s.role });
        }
      }

      // Fusion : si une enquête préliminaire est rattachée, son nœud est masqué
      // (anti-doublon). Pour ne perdre AUCUN protagoniste, on reverse ses mis en
      // cause sur le nœud d'instruction. La préliminaire et l'instruction ont
      // souvent été saisies avec des conventions différentes ("Prénom NOM" vs
      // "NOM Prénom", coquilles, composés) : la dédup tolère ces variantes, y
      // compris un nom partiel si un seul candidat correspond.
      if (inst.enquetePreliminaireId != null) {
        const prelimCtx = (inst.enquetePreliminaireContentieuxId || inst.contentieuxId) as ContentieuxId;
        const prelim = overboardData.get(prelimCtx)?.find(e => e.id === inst.enquetePreliminaireId);
        for (const mc of prelim?.misEnCause || []) {
          pushPersonne(
            { id: mc.id, nom: mc.nom, statut: mc.statut, isVictime: mc.isVictime },
            true,
          );
        }
      }

      const pseudoEnquete = {
        id: inst.id,
        numero: inst.numeroInstruction,
        statut: 'instruction' as const,
        dateCreation: inst.dateCreation,
        dateMiseAJour: inst.dateMiseAJour,
        dateDebut: inst.dateOuverture,
        services: [],
        actes: [],
        comptesRendus: [],
        documents: [],
        notes: '',
        tags: inst.tags || [],
        misEnCause: personnes,
      } as unknown as import('@/types/interfaces').Enquete;
      out.push({
        enquete: pseudoEnquete,
        contentieuxId: inst.contentieuxId,
        misEnExamen: inst.misEnExamen,
      });
    }
    return out;
  }, [overboardData, instructions]);

  // Les dossiers d'instruction sans contentieux ne sont pas projetés sur la
  // mindmap, donc on n'a plus besoin du pseudo-contentieux "instructions" :
  // seuls les vrais contentieux (crimorg / ecofi / enviro / ...) sont exposés.
  const mindmapContentieuxDefs = contentieuxDefs;

  // Enquêtes préliminaires éligibles au rattachement à un dossier d'instruction :
  // uniquement celles dont le résultat d'audience est une OI (ouverture
  // d'information). C'est le seul cas où l'instruction prolonge directement la
  // préliminaire, et donc où le doublon de cartographie doit être levé.
  const eligiblePrelimEnquetes = useMemo<EnquetePreliminaireOption[]>(() => {
    const out: EnquetePreliminaireOption[] = [];
    for (const [ctxId, list] of overboardData) {
      const def = contentieuxDefs.find(d => d.id === ctxId);
      for (const e of list) {
        const res = audienceState.resultats[buildResultatKey(ctxId, e.id)];
        if (!res?.isOI) continue;
        out.push({
          id: e.id,
          numero: e.numero,
          contentieuxId: ctxId,
          contentieuxLabel: def?.label || ctxId,
          dateArchivage: e.dateArchivage,
        });
      }
    }
    return out;
  }, [overboardData, audienceState.resultats, contentieuxDefs]);

  // Recherche dans le contenu des documents (async, avec cache)
  const { documentMatchIds, isSearchingDocs } = useDocumentSearch(enquetes, debouncedSearchTerm);

  // Recherche cross-contentieux (pastilles sidebar + bandeau)
  const { crossSearchResults, totalOtherResults } = useCrossSearch(debouncedSearchTerm, effectiveContentieux, contentieuxDefs);

  // Fusion des résultats métadonnées + contenu documents
  const mergedFilteredEnquetes = useMemo(() => {
    if (!documentMatchIds.size) return filteredAndSortedEnquetes;

    const metadataIds = new Set(filteredAndSortedEnquetes.map(e => e.id));
    const docOnlyMatches = enquetes.filter(
      e => documentMatchIds.has(e.id) && !metadataIds.has(e.id)
    );

    return [...filteredAndSortedEnquetes, ...docOnlyMatches];
  }, [filteredAndSortedEnquetes, documentMatchIds, enquetes]);

  // Déterminer si l'utilisateur est JA pour le contentieux actif
  const isJAForCurrentCtx = useMemo(() => {
    if (!user) return false;
    if (user.globalRole) return false; // Les rôles globaux ne sont pas JA
    return user.contentieux.some(c => c.contentieuxId === currentContentieuxId && c.role === 'ja');
  }, [user, currentContentieuxId]);

  const activeEnquetes = useMemo(() => {
    let result = mergedFilteredEnquetes.filter(e => e.statut !== 'archive');
    // Filtrer les enquêtes dissimulées aux JA
    if (isJAForCurrentCtx) {
      result = result.filter(e => !e.hiddenFromJA);
    }
    return result;
  }, [mergedFilteredEnquetes, isJAForCurrentCtx]);

  // Organisation des enquêtes par section, puis par service au sein de chaque section
  const enquetesByOrganization = useMemo(() => {
    // Structure : { [section]: { [serviceName]: enquete[] } }
    const organized: { [section: string]: { [serviceName: string]: any[] } } = {};
    const fallback: any[] = [];

    activeEnquetes.forEach(enquete => {
      const serviceTag = enquete.tags?.find((tag: any) => tag.category === 'services');

      if (serviceTag) {
        // Chercher le tag central correspondant pour récupérer l'id, puis
        // résoudre la section depuis l'organisation PERSONNELLE de
        // l'utilisateur courant (prefs) — plus d'`organization` globale.
        const centralTag = tags.find(t => t.value === serviceTag.value && t.category === 'services');
        const userSection = centralTag ? getTagSection(centralTag.id) : undefined;

        if (userSection) {
          const serviceName = serviceTag.value as string;
          if (!organized[userSection]) organized[userSection] = {};
          if (!organized[userSection][serviceName]) organized[userSection][serviceName] = [];
          organized[userSection][serviceName].push(enquete);
        } else {
          fallback.push(enquete);
        }
      } else {
        fallback.push(enquete);
      }
    });

    if (fallback.length > 0) {
      organized['AUTRES SERVICES'] = { '': fallback };
    }

    return organized;
  }, [activeEnquetes, tags, getTagSection]);

  const archivedEnquetes = useMemo(() => {
    return mergedFilteredEnquetes.filter(e => e.statut === 'archive');
  }, [mergedFilteredEnquetes]);

  // Nombre total d'alertes actives
  const activeAlertsCount = useMemo(() => {
    const enqueteAlertsCount = alerts.filter(alert => alert.status === 'active' && !alert.isAIRAlert).length;
    const instructionAlertsCount = instructionAlerts.length;
    const airAlertsCount = alerts.filter(alert => alert.status === 'active' && alert.isAIRAlert).length;
    
    return enqueteAlertsCount + instructionAlertsCount + airAlertsCount;
  }, [alerts, instructionAlerts]);

  // ── Mémorisation des tableaux et callbacks pour éviter de casser React.memo ──

  // Alertes filtrées (référence stable tant que alerts ne change pas)
  const enqueteAlertsList = useMemo(
    () => alerts.filter(alert => !alert.isAIRAlert),
    [alerts]
  );
  const headerAlertsList = useMemo(
    () => [...alerts.filter(alert => alert.status === 'active'), ...instructionAlerts],
    [alerts, instructionAlerts]
  );

  // Callbacks stables pour EnquetePreview — ne dépendent pas de l'enquête individuelle
  const handleViewEnquete = useCallback((enqueteOrId: Enquete | number) => {
    const enquete = typeof enqueteOrId === 'number'
      ? enquetesLookupRef.current.find(e => e.id === enqueteOrId)
      : enqueteOrId;
    if (!enquete) return;
    setSelectedEnquete(enquete);
    setIsEditing(false);
  }, []);
  const handleEditEnquete = useCallback((enqueteOrId: Enquete | number) => {
    const enquete = typeof enqueteOrId === 'number'
      ? enquetesLookupRef.current.find(e => e.id === enqueteOrId)
      : enqueteOrId;
    if (!enquete) return;
    setSelectedEnquete(enquete);
    setIsEditing(true);
  }, []);
  const handleToggleSuivi = useCallback((enqueteId: number, type: 'JIRS' | 'PG') => {
    const enquete = enquetesLookupRef.current.find(e => e.id === enqueteId);
    if (!enquete) return;
    const tagId = type === 'JIRS' ? 'suivi_jirs' : 'suivi_pg';
    const etags = enquete.tags || [];
    const hasSuiviTag = etags.some((tag: any) => tag.category === 'suivi' && tag.value === type);
    const newTags = hasSuiviTag
      ? etags.filter((tag: any) => !(tag.category === 'suivi' && tag.value === type))
      : [...etags, { id: tagId, value: type, category: 'suivi' as const }];
    handleUpdateEnquete(enqueteId, { tags: newTags });
  }, [handleUpdateEnquete]);
  const handleActeRequest = useCallback((acteId: number, type: 'acte' | 'ecoute' | 'geoloc', enqueteId: number, modal: 'prolongation' | 'pose' | 'validation') => {
    setSelectedActe({ id: acteId, type, enqueteId });
    if (modal === 'prolongation') setShowProlongationModal(true);
    else if (modal === 'pose') setShowPoseModal(true);
    else setShowProlongationValidationModal(true);
  }, []);
  // Wrappers stables pour EnquetePreview (évitent les arrow functions inline dans le .map())
  const handleProlongationRequest = useCallback((enqueteId: number, acteId: number, type: 'acte' | 'ecoute' | 'geoloc') => {
    handleActeRequest(acteId, type, enqueteId, 'prolongation');
  }, [handleActeRequest]);
  const handlePoseRequest = useCallback((enqueteId: number, acteId: number, type: 'acte' | 'ecoute' | 'geoloc') => {
    handleActeRequest(acteId, type, enqueteId, 'pose');
  }, [handleActeRequest]);
  const handleValidateProlongationRequest = useCallback((enqueteId: number, acteId: number, type: 'acte' | 'ecoute' | 'geoloc') => {
    handleActeRequest(acteId, type, enqueteId, 'validation');
  }, [handleActeRequest]);
  const handleValidateAutorisation = useCallback((enqueteId: number, acteId: number, type: 'acte' | 'ecoute' | 'geoloc') => {
    const enquete = enquetesLookupRef.current.find(e => e.id === enqueteId);
    if (!enquete) return;
    const key = type === 'acte' ? 'actes' : type === 'ecoute' ? 'ecoutes' : 'geolocalisations';
    handleUpdateEnquete(enqueteId, {
      [key]: enquete[key]?.map((a: any) => a.id === acteId ? { ...a, statut: 'en_cours' } : a)
    });
    showToast('Autorisation validée', 'success');
  }, [handleUpdateEnquete, showToast]);
  const handleCreateGlobalTodo = useCallback((todo: ToDoItem) => {
    setGlobalTodos(prev => {
      const updated = [...prev, todo];
      ElectronBridge.setData('global_todos', updated);
      return updated;
    });
  }, []);

  // Flags conditionnels stables
  const showOverboardPin = hasOverboard();
  const showHideFromJA = canDo(currentContentieuxId, 'delete');

  // Sections actives mémorisées pour FilterBar
  const activeSections = useMemo(
    () => Object.keys(enquetesByOrganization),
    [enquetesByOrganization]
  );

  // Callbacks FilterBar stables
  const handleTagSelect = useCallback((tag: Tag) => {
    setSelectedTags(prev => [...prev, tag]);
  }, []);
  const handleTagRemove = useCallback((tagId: string) => {
    setSelectedTags(prev => prev.filter(t => t.id !== tagId));
  }, []);

  // Compteurs sidebar : enquêtes en cours par contentieux + instructions en cours
  const sidebarEnqueteCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [ctxId, list] of overboardData) {
      counts[ctxId] = list.filter(e => e.statut !== 'archive').length;
    }
    return counts;
  }, [overboardData]);
  const sidebarInstructionCount = useMemo(
    () => instructions.filter(d => !d.archived).length,
    [instructions]
  );

  if (!isClient || tagsLoading || userLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-lg">Chargement...</div>
      </div>
    );
  }

  // Afficher une erreur si l'utilisateur n'est pas reconnu
  if (userError && !isAuthenticated) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center space-y-4 max-w-md">
          <div className="text-6xl">🔒</div>
          <h1 className="text-xl font-bold text-gray-800">Accès non autorisé</h1>
          <p className="text-gray-600">{userError}</p>
          <p className="text-sm text-gray-400">
            Vérifiez que vous êtes bien connecté à votre session Windows
            et que le serveur partagé est accessible.
          </p>
        </div>
      </div>
    );
  }

  // Utilisateur non approuvé par l'administrateur
  if (isAuthenticated && user && user.approved !== true && user.globalRole !== 'admin') {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-5 max-w-lg p-8 bg-white rounded-2xl shadow-lg border border-gray-200">
          <div className="mx-auto w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m0 0v2m0-2h2m-2 0H10m2-6V4m0 0a2 2 0 00-2 2v2a2 2 0 002 2 2 2 0 002-2V6a2 2 0 00-2-2z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-800">
            Demande d'accès en attente
          </h1>
          <p className="text-gray-600">
            Bonjour <span className="font-semibold">{user.displayName || user.windowsUsername}</span>, votre demande d'utilisation a bien été enregistrée.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-sm text-amber-800 font-medium">
              L'administrateur doit valider votre accès avant que vous puissiez utiliser l'application.
            </p>
          </div>
          <p className="text-xs text-gray-400">
            Relancez l'application une fois votre accès validé par l'administrateur.
          </p>
        </div>
      </div>
    );
  }

  // Utilisateur approuvé mais sans contentieux attribué
  if (isAuthenticated && accessibleContentieux.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-5 max-w-lg p-8 bg-white rounded-2xl shadow-lg border border-gray-200">
          <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-800">Bienvenue, {user?.displayName || user?.windowsUsername}</h1>
          <p className="text-gray-600">
            Votre accès a été validé, mais aucun contentieux ne vous a encore été attribué.
          </p>
          <p className="text-gray-600">
            L'administrateur doit vous affecter à un ou plusieurs contentieux pour que vous puissiez accéder aux données.
          </p>
          <p className="text-xs text-gray-400">
            Relancez l'application une fois vos contentieux configurés.
          </p>
        </div>
      </div>
    );
  }

return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar : fixe sur grand écran, tiroir sur mobile */}
      <div className="no-print hidden lg:block">
        <MultiSideBar
          isOpen={sidebarOpen}
          currentView={currentView}
          currentContentieux={effectiveContentieux}
          onViewChange={handleViewChange}
          onNewEnquete={handleNewEnquete}
          onNewInstruction={() => setShowNewInstructionModal(true)}
          onOpenSettings={() => setShowSettingsModal(true)}
          alertCount={activeAlertsCount}
          instructionAlertCount={instructionAlerts.length}
          enqueteCounts={sidebarEnqueteCounts}
          instructionCount={sidebarInstructionCount}
          crossSearchResults={crossSearchResults}
          pendingUsersCount={pendingUsersCount}
        />
      </div>
      {mobileNavOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 shadow-2xl" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            <MultiSideBar
              isOpen={true}
              currentView={currentView}
              currentContentieux={effectiveContentieux}
              onViewChange={(view, ctx) => { setMobileNavOpen(false); handleViewChange(view, ctx); }}
              onNewEnquete={() => { setMobileNavOpen(false); handleNewEnquete(); }}
              onNewInstruction={() => { setMobileNavOpen(false); setShowNewInstructionModal(true); }}
              onOpenSettings={() => { setMobileNavOpen(false); setShowSettingsModal(true); }}
              alertCount={activeAlertsCount}
              instructionAlertCount={instructionAlerts.length}
              enqueteCounts={sidebarEnqueteCounts}
              instructionCount={sidebarInstructionCount}
              crossSearchResults={crossSearchResults}
              pendingUsersCount={pendingUsersCount}
            />
          </div>
        </div>
      )}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="no-print flex items-stretch" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <button
            className="lg:hidden flex items-center justify-center w-12 bg-white border-r border-gray-100"
            style={{ borderBottom: '1px solid hsl(214 25% 88%)' }}
            onClick={() => setMobileNavOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-5 w-5 text-gray-600" />
          </button>
          <div className="flex-1 min-w-0">
          <Header
            searchTerm={searchTerm}
            onSearch={handleSearchChange}
            alerts={headerAlertsList}
            unseenAlertCount={unseenAlertsCount}
            onShowAlerts={() => { setShowAlertsModal(true); markAlertsSeen(); }}
            onSave={handleManualSave}
            isSaving={isSaving}
            lastSaveDate={StorageManager.getLastSave() ?? undefined}
            syncStatus={syncStatus}
            onSync={handleManualSync}
            isSyncing={isSyncing}
            isSearchingDocs={isSearchingDocs}
            isAdmin={isAdmin()}
            updateAvailable={updateAvailable}
            updateCommits={updateCommits}
            onShowUpdate={() => setShowUpdateModal(true)}
            isUpdating={isUpdating}
            remoteSha={updateRemoteSha}
            approvedSha={updateApprovedSha}
            minimal={isJLDUser}
          />
          </div>
        </div>

        {/* Bandeau lecture seule */}
        {effectiveContentieux && !canDo(effectiveContentieux, 'edit') && (baseView === 'enquetes' || baseView === 'archives') && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-xs text-amber-700 font-medium flex items-center gap-2">
            <span>👁</span> Mode consultation — {contentieuxDefs.find(c => c.id === effectiveContentieux)?.label || effectiveContentieux}
          </div>
        )}

        {/* Bandeau résultats cross-contentieux */}
        {totalOtherResults > 0 && baseView === 'enquetes' && (
          <div className="bg-purple-50 border-b border-purple-200 px-4 py-1.5 text-xs text-purple-700 font-medium flex items-center gap-2">
            <span className="shrink-0">Aussi trouvé :</span>
            {crossSearchResults.map(r => {
              const def = contentieuxDefs.find(d => d.id === r.contentieuxId);
              return (
                <button
                  key={r.contentieuxId}
                  onClick={() => handleViewChange(`enquetes_${r.contentieuxId}`, r.contentieuxId)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full hover:bg-purple-100 transition-colors"
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: def?.color || '#888' }}
                  />
                  <span className="font-semibold">{def?.label || r.contentieuxId}</span>
                  <span className="bg-purple-200 text-purple-800 px-1 rounded-full text-[10px] font-bold">
                    {r.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {(baseView === 'enquetes' || baseView === 'instructions') && (
          <FilterBar
            selectedTags={selectedTags}
            onTagSelect={handleTagSelect}
            onTagRemove={handleTagRemove}
            sortOrder={sortOrder}
            onSortChange={setSortOrder}
            activeSections={activeSections}
            sections={sectionsList}
            onReorder={reorderSection}
            onAddSection={addSectionFn}
            infractionTags={infractionFilterTags}
          />
        )}

        <main key={baseView} className="flex-1 overflow-auto p-3 sm:p-6 view-fade">
          {baseView === 'dashboard' && (
            <DashboardPage
              enquetesByContentieux={overboardData}
              contentieuxDefs={contentieuxDefs}
              activeContentieux={effectiveContentieux}
              instructions={instructions}
              globalTodos={globalTodos}
              onUpdateEnquete={handleUpdateEnqueteSynced}
              onGlobalTodosChange={handleGlobalTodosChange}
              onOpenEnquete={handleViewEnquete}
              onOpenInstruction={(d) => { setSelectedInstruction(d); setIsEditingInstruction(false); }}
              isJLD={isJLDUser}
            />
          )}

          {baseView === 'enquetes' && (
            <div className="space-y-6">
              {/* Chargement : spinner discret plutôt que le flash « Aucune enquête »
                  (anxiogène sur des données métier) tant que le store hydrate. */}
              {enquetesLoading && enquetes.length === 0 && (
                <div className="flex items-center justify-center py-16 text-gray-400 gap-3">
                  <div className="w-6 h-6 rounded-full border-2 border-gray-200 border-t-emerald-500 animate-spin" />
                  <span className="text-sm">Chargement des enquêtes…</span>
                </div>
              )}
              {/* États vides illustrés : service qui démarre vs recherche sans résultat */}
              {!enquetesLoading && activeEnquetes.length === 0 && (
                <EmptyState
                  icon={<FolderSearch />}
                  title="Aucune enquête en cours"
                  hint="Ce contentieux n'a pas encore d'enquête ouverte. Créez la première pour démarrer le suivi."
                  actionLabel={effectiveContentieux && canDo(effectiveContentieux, 'create') ? 'Nouvelle enquête' : undefined}
                  onAction={handleNewEnquete}
                />
              )}
              {activeEnquetes.length > 0 && mergedFilteredEnquetes.length === 0 && (
                <EmptyState
                  icon={<SearchX />}
                  title="Aucun résultat"
                  hint="Aucune enquête ne correspond à la recherche ou aux filtres en cours."
                  tone={{ circle: 'bg-gray-100', icon: 'text-gray-400' }}
                />
              )}
              {Object.entries(enquetesByOrganization)
                .sort(([a], [b]) => getSectionOrder(a) - getSectionOrder(b))
                .map(([section, serviceGroups]) => {
                  const serviceEntries = Object.entries(serviceGroups);
                  const allEnquetes = serviceEntries.flatMap(([, enqs]) => enqs);
                  const totalCount = allEnquetes.length;
                  // Subdivision si plusieurs services nommés dans la même section
                  const namedServiceEntries = serviceEntries.filter(([name]) => name !== '');
                  const hasMultipleServices = namedServiceEntries.length > 1;

                  const renderEnqueteCard = (enquete: any) => (
                    <EnquetePreview
                      key={enquete.id}
                      enquete={enquete}
                      contentieuxId={enquete.contentieuxOrigine || currentContentieuxId}
                      onView={handleViewEnquete}
                      onEdit={handleEditEnquete}
                      onArchive={handleArchiveEnquete}
                      onToggleSuivi={handleToggleSuivi}
                      onStartEnquete={handleStartEnquete}
                      onToggleOverboardPin={showOverboardPin ? handleToggleOverboardPin : undefined}
                      onToggleHideFromJA={showHideFromJA ? handleToggleHideFromJA : undefined}
                      alerts={enqueteAlertsList}
                      onValidateAlert={handleValidateAlert}
                      onSnoozeAlert={handleSnoozeAlert}
                      onProlongationRequest={handleProlongationRequest}
                      onPoseRequest={handlePoseRequest}
                      onValidateProlongationRequest={handleValidateProlongationRequest}
                      onValidateAutorisationRequest={handleValidateAutorisation}
                      visualAlertRules={visualAlertRules}
                      crDelayHighlight={crDelayHighlight}
                      onCreateGlobalTodo={handleCreateGlobalTodo}
                    />
                  );

                  return (
                    <div key={section} className="space-y-4">
                      <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
                        <div className="w-0.5 h-4 rounded-full bg-green-700/50 flex-shrink-0" />
                        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          {section}
                        </h2>
                        <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-bold leading-none">
                          {totalCount}
                        </span>
                      </div>

                      {hasMultipleServices ? (
                        <div className="space-y-3">
                          {namedServiceEntries.map(([serviceName, serviceEnquetes]) => (
                            <div key={serviceName} className="bg-gray-50/80 rounded-lg border border-gray-200/70 px-3 pt-2 pb-3 space-y-3">
                              <div className="flex items-center gap-2">
                                <div className="w-0.5 h-3 rounded-full bg-gray-400/70 flex-shrink-0" />
                                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                                  {serviceName}
                                </span>
                                <span className="text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full font-bold leading-none">
                                  {serviceEnquetes.length}
                                </span>
                              </div>
                              <LazyGrid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 justify-items-center">
                                {serviceEnquetes.map(renderEnqueteCard)}
                              </LazyGrid>
                            </div>
                          ))}
                          {/* Enquêtes sans service nommé dans cette section */}
                          {serviceGroups[''] && serviceGroups[''].length > 0 && (
                            <LazyGrid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 justify-items-center">
                              {serviceGroups[''].map(renderEnqueteCard)}
                            </LazyGrid>
                          )}
                        </div>
                      ) : (
                        <LazyGrid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 justify-items-center">
                          {allEnquetes.map(renderEnqueteCard)}
                        </LazyGrid>
                      )}
                    </div>
                  );
                })
              }
            </div>
          )}

          {baseView === 'instructions' && (
            <InstructionsPage
              dossiers={instructions}
              searchTerm={searchTerm}
              onSearchChange={handleSearchChange}
              onOpenDossier={(d) => {
                setSelectedInstruction(d);
                setIsEditingInstruction(false);
              }}
              onCreateDossier={() => setShowNewInstructionModal(true)}
              onUpdateDossier={handleUpdateInstruction}
              onDeleteDossier={handleDeleteInstruction}
            />
          )}

          {baseView === 'instructions_archives' && (
            <InstructionArchivesPage
              dossiers={instructions}
              searchTerm={searchTerm}
              onSearchChange={handleSearchChange}
              onUpdateDossier={handleUpdateInstruction}
              onDeleteDossier={handleDeleteInstruction}
            />
          )}

          {baseView === 'archives' && (
            <ArchivePage
              enquetes={enquetes}
              searchTerm={searchTerm}
              contentieuxId={currentContentieuxId}
              onUpdateEnquete={handleUpdateEnquete}
              onDeleteEnquete={handleDeleteEnquete}
              onUnarchiveEnquete={handleUnarchiveEnquete}
              onAjoutCR={handleAjoutCR}
              onUpdateCR={handleUpdateCR}
              onDeleteCR={handleDeleteCR}
            />
          )}

          {baseView === 'permanence' && (
            <PermanencePage />
          )}

          {baseView === 'air' && (
            <AIRPage
              mesures={mesuresAIR}
              searchTerm={debouncedSearchTerm}
              isLoading={isLoadingAIR}
              onUpdateMesure={handleUpdateMesure}
              onDeleteMesure={handleDeleteMesure} 
              onDeleteAllMesures={handleDeleteAllMesures}
              onAddMesure={handleAddMesure}
              onImportMesures={handleImportMesures}
            />
          )}

          {baseView === 'stats' && (
            <StatsPage
              enquetes={enquetes}
              contentieuxId={currentContentieuxId}
              instructions={instructions.filter(d => (d.contentieuxId || '') === currentContentieuxId)}
            />
          )}

          {/* 🗺️ Mindmap (cartographie MEC ↔ dossiers, transversal) */}
          {baseView === 'mindmap' && (
            <MindmapPage
              sources={mindmapSources}
              searchTerm={debouncedSearchTerm}
              onSearchChange={handleSearchChange}
              onRefresh={() => {
                void refreshOverboard();
                void refreshInstructions();
              }}
              contentieuxDefs={mindmapContentieuxDefs}
              onOpenEnquete={(enquete, contentieuxId) => {
                // Les dossiers d'instruction projetés sur la mindmap portent
                // statut='instruction' : on retombe sur la fiche dossier
                // d'instruction quel que soit le contentieux choisi.
                if ((enquete as any)?.statut === 'instruction') {
                  const dossier = instructions.find(d => d.id === enquete.id);
                  if (dossier) setSelectedInstruction(dossier);
                  return;
                }
                if (contentieuxId && contentieuxId !== activeContentieux) {
                  setActiveContentieux(contentieuxId);
                  setCurrentView(`enquetes_${contentieuxId}`);
                }
                setSelectedEnquete(enquete);
                setIsEditing(false);
              }}
            />
          )}

          {/* 🆕 Overboard (vue transversale) */}
          {baseView === 'overboard' && (
            <OverboardPage
              enquetesByContentieux={overboardData}
              contentieuxDefs={contentieuxDefs}
              onEnqueteClick={(enquete, contentieuxId) => {
                // Switcher vers le bon contentieux avant d'ouvrir le modal
                if (contentieuxId && contentieuxId !== activeContentieux) {
                  setActiveContentieux(contentieuxId);
                  setCurrentView(`enquetes_${contentieuxId}`);
                }
                setSelectedEnquete(enquete);
                setIsEditing(false);
              }}
            />
          )}

          {/* Statistiques globales (tous contentieux) */}
          {currentView === 'global_stats' && (
            <GlobalStatsPage
              enquetesByContentieux={overboardData}
              contentieuxDefs={contentieuxDefs}
            />
          )}
        </main>
      </div>

      {/* Modales pour enquêtes préliminaires */}
      <NewEnqueteModal
        isOpen={showNewEnqueteModal}
        onClose={() => setShowNewEnqueteModal(false)}
        onSubmit={handleAddEnquete}
        cheminBase={CHEMIN_BASE}
        allKnownMec={allKnownMec}
      />

      {selectedEnquete && (
        <EnqueteDetailModal
          enquete={selectedEnquete}
          isEditing={isEditing}
          editingCR={editingCR}
          onClose={() => setSelectedEnquete(null)}
          onEdit={() => setIsEditing(!isEditing)}
          onUpdate={handleUpdateEnqueteSynced}
          onAddCR={(cr) => handleAjoutCR(selectedEnquete.id, cr)}
          onUpdateCR={(crId, updates) => handleUpdateCR(selectedEnquete.id, crId, updates)}
          onDeleteCR={(crId) => handleDeleteCR(selectedEnquete.id, crId)}
          setEditingCR={setEditingCR}
          onDelete={handleDeleteEnquete}
          allKnownMec={allKnownMec}
          onCreateGlobalTodo={(todo) => handleGlobalTodosChange([...globalTodos, todo])}
          readOnly={effectiveContentieux ? !canDo(effectiveContentieux, 'edit') : true}
          contentieuxId={currentContentieuxId}
          onShareEnquete={handleShareEnquete}
          onUnshareEnquete={handleUnshareEnquete}
          onTransferEnquete={handleTransferEnquete}
          isSharedEnquete={isSharedEnquete(selectedEnquete.id)}
        />
      )}

      {/* Modales pour instructions judiciaires */}
      <NewInstructionModal
        isOpen={showNewInstructionModal}
        onClose={() => setShowNewInstructionModal(false)}
        onSubmit={handleAddInstruction}
        contentieuxDefs={contentieuxDefs}
        defaultContentieuxId={effectiveContentieux || undefined}
      />

      {selectedInstruction && (
        <InstructionDetailModal
          dossier={selectedInstruction}
          isEditing={isEditingInstruction}
          onClose={() => setSelectedInstruction(null)}
          onEdit={() => setIsEditingInstruction(v => !v)}
          onUpdate={(id, updates) => {
            handleUpdateInstruction(id, updates);
            setSelectedInstruction(prev => (prev && prev.id === id ? { ...prev, ...updates } : prev));
          }}
          onDelete={handleDeleteInstruction}
          contentieuxDefs={contentieuxDefs}
          allKnownNames={Array.from(new Set(
            instructions.flatMap(inst => [
              ...inst.misEnExamen.map(m => m.nom),
              ...(inst.suspects || []).map(s => s.nom),
            ]).filter(Boolean)
          ))}
          enquetePreliminaireOptions={eligiblePrelimEnquetes}
          onOpenEnquetePreliminaire={(enqueteId, ctxId) => {
            const scoped = ctxId ? overboardData.get(ctxId as ContentieuxId) : undefined;
            const found = scoped?.find(e => e.id === enqueteId)
              ?? Array.from(overboardData.values()).flat().find(e => e.id === enqueteId);
            if (found) {
              setSelectedInstruction(null);
              handleViewEnquete(found);
            } else {
              showToast('Enquête préliminaire introuvable (contentieux non chargé ?)', 'error');
            }
          }}
        />
      )}

      {/* Modales communes */}
      <AlertsModal
        isOpen={showAlertsModal}
        onClose={() => setShowAlertsModal(false)}
        alerts={[...alerts.filter(alert => alert.status === 'active'), ...instructionAlerts]}
        onValidateAlert={(alertId: number | number[]) => {
          const ids = Array.isArray(alertId) ? alertId : [alertId];
          const instructionIds = ids.filter(id => instructionAlerts.some(alert => alert.id === id));
          const regularIds = ids.filter(id => !instructionAlerts.some(alert => alert.id === id));
          if (instructionIds.length > 0) {
            handleValidateInstructionAlert(instructionIds.length === 1 ? instructionIds[0] : instructionIds);
          }
          if (regularIds.length > 0) {
            handleValidateAlert(regularIds.length === 1 ? regularIds[0] : regularIds);
          }
        }}
        onSnoozeAlert={(alertId: number, daysOrDate: number | string) => {
          const isInstructionAlert = instructionAlerts.some(alert => alert.id === alertId);
          if (isInstructionAlert) {
            handleSnoozeInstructionAlert(alertId);
          } else {
            handleSnoozeAlert(alertId, daysOrDate);
          }
        }}
        onOpenEnquete={(enqueteId: number) => handleViewEnquete(enqueteId)}
      />

      <ConfirmationDialog
        isOpen={showConfirmDialog}
        onClose={() => setShowConfirmDialog(false)}
        onConfirm={() => {
          pendingAction();
          setShowConfirmDialog(false);
        }}
        title="Confirmation"
        message="Êtes-vous sûr de vouloir effectuer cette action ?"
        confirmLabel="Confirmer"
        cancelLabel="Annuler"
      />

      {/* Modales pour actes */}
      {selectedActe && (
        <>
          <ProlongationModal 
            isOpen={showProlongationModal}
            onClose={() => {
              setShowProlongationModal(false);
              setSelectedActe(null);
            }}
            onConfirm={() => {
              if (selectedActe && selectedActe.enqueteId) {
                const enquete = enquetes.find(e => e.id === selectedActe.enqueteId);
                if (enquete) {
                  let acte;
                  switch (selectedActe.type) {
                    case 'acte':
                      acte = enquete.actes?.find(a => a.id === selectedActe.id);
                      break;
                    case 'ecoute':
                      acte = enquete.ecoutes?.find(e => e.id === selectedActe.id);
                      break;
                    case 'geoloc':
                      acte = enquete.geolocalisations?.find(g => g.id === selectedActe.id);
                      break;
                  }
                  if (acte) {
                    handleUpdateEnquete(enquete.id, {
                      [selectedActe.type === 'acte' ? 'actes' : 
                       selectedActe.type === 'ecoute' ? 'ecoutes' : 
                       'geolocalisations']: enquete[selectedActe.type === 'acte' ? 'actes' : 
                                                    selectedActe.type === 'ecoute' ? 'ecoutes' : 
                                                    'geolocalisations']?.map(a => 
                        a.id === selectedActe.id ? { ...a, statut: 'prolongation_pending', prolongationRequestedAt: new Date().toISOString() } : a
                      )
                    });
                  }
                }
              }
              setShowProlongationModal(false);
              setSelectedActe(null);
            }}
            originalStartDate={
              (selectedActe && selectedActe.enqueteId && enquetes.find(e => e.id === selectedActe.enqueteId)?.[
                selectedActe.type === 'acte' ? 'actes' :
                selectedActe.type === 'ecoute' ? 'ecoutes' :
                'geolocalisations'
              ]?.find(a => a.id === selectedActe.id)?.dateDebut) || undefined
            }
            originalDuration={
              (selectedActe && selectedActe.enqueteId && (() => {
                const duree = enquetes.find(e => e.id === selectedActe.enqueteId)?.[
                  selectedActe.type === 'acte' ? 'actes' :
                  selectedActe.type === 'ecoute' ? 'ecoutes' :
                  'geolocalisations'
                ]?.find(a => a.id === selectedActe.id)?.duree;
                return duree != null ? String(duree) : undefined;
              })()) || undefined
            }
          />

          <PoseActeModal
            isOpen={showPoseModal}
            onClose={() => {
              setShowPoseModal(false);
              setSelectedActe(null);
            }}
            onConfirm={(date) => {
              if (selectedActe && selectedActe.enqueteId) {
                const enquete = enquetes.find(e => e.id === selectedActe.enqueteId);
                if (enquete) {
                  handleUpdateEnquete(enquete.id, {
                    [selectedActe.type === 'acte' ? 'actes' : 
                     selectedActe.type === 'ecoute' ? 'ecoutes' : 
                     'geolocalisations']: enquete[selectedActe.type === 'acte' ? 'actes' : 
                                                  selectedActe.type === 'ecoute' ? 'ecoutes' : 
                                                  'geolocalisations']?.map(a => 
                      a.id === selectedActe.id ? { ...a, ...ActeUtils.setPose(a, date) } : a
                    )
                  });
                }
              }
              setShowPoseModal(false);
              setSelectedActe(null);
            }}
            dateDebut={
              selectedActe && selectedActe.enqueteId && enquetes.find(e => e.id === selectedActe.enqueteId)?.[
                selectedActe.type === 'acte' ? 'actes' : 
                selectedActe.type === 'ecoute' ? 'ecoutes' : 
                'geolocalisations'
              ]?.find(a => a.id === selectedActe.id)?.dateDebut || ''
            }
            duree={
              selectedActe && selectedActe.enqueteId && enquetes.find(e => e.id === selectedActe.enqueteId)?.[
                selectedActe.type === 'acte' ? 'actes' : 
                selectedActe.type === 'ecoute' ? 'ecoutes' : 
                'geolocalisations'
              ]?.find(a => a.id === selectedActe.id)?.duree || ''
            }
          />

          <ProlongationValidationModal
            isOpen={showProlongationValidationModal}
            onClose={() => {
              setShowProlongationValidationModal(false);
              setSelectedActe(null);
            }}
            onValidate={(date, duration) => {
              try {
                if (selectedActe && selectedActe.enqueteId) {
                  const enquete = enquetes.find(e => e.id === selectedActe.enqueteId);
                  if (enquete) {
                    const acteArray = enquete[selectedActe.type === 'acte' ? 'actes' : 
                                           selectedActe.type === 'ecoute' ? 'ecoutes' : 
                                           'geolocalisations'];
                    
                    const acte = acteArray?.find(a => a.id === selectedActe.id);
                    if (!acte) {
                      throw new Error('Acte non trouvé');
                    }

                    const nouvelleDuree = (parseInt(acte.duree) + parseInt(duration)).toString();
                    // Utiliser dateFin actuelle comme base (intègre les prolongations précédentes)
                    const currentEndDate = acte.dateFin || DateUtils.calculateActeEndDate(acte.datePose || acte.dateDebut, acte.duree);
                    const dateFinCalculee = DateUtils.addCalendarMonths(currentEndDate, parseInt(duration));

                    handleUpdateEnquete(enquete.id, {
                      [selectedActe.type === 'acte' ? 'actes' : 
                       selectedActe.type === 'ecoute' ? 'ecoutes' : 
                       'geolocalisations']: acteArray?.map(a => 
                        a.id === selectedActe.id ? { 
                          ...a, 
                          statut: 'en_cours',
                          prolongationDate: date,
                          dateValidationProlongation: date,
                          dureeProlongation: duration,
                          dureeInitiale: a.duree,
                          duree: nouvelleDuree,
                          dateFin: dateFinCalculee
                        } : a
                      )
                    });
                  }
                }
                setShowProlongationValidationModal(false);
                setSelectedActe(null);
              } catch (error) {
                console.error('Erreur lors de la validation de la prolongation:', error);
              }
            }}
            originalStartDate={
              (selectedActe && selectedActe.enqueteId && enquetes.find(e => e.id === selectedActe.enqueteId)?.[
                selectedActe.type === 'acte' ? 'actes' :
                selectedActe.type === 'ecoute' ? 'ecoutes' :
                'geolocalisations'
              ]?.find(a => a.id === selectedActe.id)?.dateDebut) || undefined
            }
            originalDuration={
              (selectedActe && selectedActe.enqueteId && (() => {
                const duree = enquetes.find(e => e.id === selectedActe.enqueteId)?.[
                  selectedActe.type === 'acte' ? 'actes' :
                  selectedActe.type === 'ecoute' ? 'ecoutes' :
                  'geolocalisations'
                ]?.find(a => a.id === selectedActe.id)?.duree;
                return duree != null ? String(duree) : undefined;
              })()) || undefined
            }
            poseDate={
              (selectedActe && selectedActe.enqueteId && enquetes.find(e => e.id === selectedActe.enqueteId)?.[
                selectedActe.type === 'acte' ? 'actes' :
                selectedActe.type === 'ecoute' ? 'ecoutes' :
                'geolocalisations'
              ]?.find(a => a.id === selectedActe.id)?.datePose) || undefined
            }
            currentDateFin={
              (selectedActe && selectedActe.enqueteId && enquetes.find(e => e.id === selectedActe.enqueteId)?.[
                selectedActe.type === 'acte' ? 'actes' :
                selectedActe.type === 'ecoute' ? 'ecoutes' :
                'geolocalisations'
              ]?.find(a => a.id === selectedActe.id)?.dateFin) || undefined
            }
          />
        </>
      )}

      {/* 🆕 Modal de gestion des conflits de synchronisation */}
{showConflictModal && multiConflict && (
  <DataSyncConflictModal
    isOpen={showConflictModal}
    onClose={() => { setShowConflictModal(false); setMultiConflict(null); }}
    conflicts={multiConflict.conflicts}
    onResolve={handleResolveConflicts}
  />
)}

      {/* Modal changelog mise à jour */}
      <UpdateChangelogModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        localSha={updateLocalSha}
        remoteSha={updateRemoteSha}
        commitsCount={updateCommits}
        onApply={handleApplyUpdate}
        isApplying={isUpdating}
      />

      {/* Popup récapitulatif hebdomadaire */}
      <WeeklyRecapPopup
        isOpen={showWeeklyPopup}
        onClose={() => setShowWeeklyPopup(false)}
        buckets={weeklyBuckets}
        alertRules={alertRules}
        instructionDossiers={instructionWeeklyRecapSubscribed ? instructions : undefined}
      />

      {/* Invitations de partage entrantes (AIR / instruction) — pop-up un clic */}
      <ShareInvitationModal />

      {/* 🆕 Modal Paramètres multi-onglets */}
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => {
          setShowSettingsModal(false);
          setSettingsContentieuxId(null);
        }}
        activeContentieuxId={settingsContentieuxId || currentContentieuxId}
        onContentieuxChange={async (cId) => {
          // Flush les données en attente avant de changer de contentieux
          await flushPendingSave();
          setSettingsContentieuxId(cId);
          setActiveContentieux(cId);
          setCurrentView(`enquetes_${cId}`);
        }}
        alertesContent={
          <AlertsPage
            onShowWeeklyPopup={() => { openWeeklyPopup(); }}
            visualAlertRules={visualAlertRules}
            onUpdateVisualAlertRule={updateVisualAlertRule}
            onDeleteVisualAlertRule={deleteVisualAlertRule}
            onReorderVisualAlertRules={reorderVisualAlertRules}
          />
        }
        tagsContent={<TagManagementPage />}
        sauvegardesContent={
          <SavePage
            lastSaveDate={StorageManager.getLastSave() ?? undefined}
            contentieuxLabel={currentContentieuxId}
            onRepairServer={() => MultiSyncManager.getInstance().repairWithLocalData(currentContentieuxId)}
            onRestoreFromServerBackup={(filename) => MultiSyncManager.getInstance().restoreFromBackup(currentContentieuxId, filename)}
            onListServerBackups={() => MultiSyncManager.getInstance().listBackups(currentContentieuxId)}
            isSyncing={isSyncing}
            syncStatus={syncStatus}
          />
        }
        adminUsersContent={<AdminUsersPanel />}
        adminContentieuxContent={<AdminContentieuxPanel />}
        moduleInstructionContent={hasModule('instructions') ? <AdminInstructionPanel /> : null}
        moduleAIRContent={hasModule('air') ? <AdminAIRPanel /> : null}
        moduleCartographieContent={hasModule('mindmap') ? <AdminCartographyPanel /> : null}
        adminPathsContent={<AdminPathsPanel />}
        agendaContent={<AgendaPanel />}
        adminDashboardContent={<AdminDashboardPanel />}
        adminTagHistoryContent={<AdminTagHistoryPanel />}
        adminNatinfContent={<AdminNatinfPanel />}
        adminUpdateContent={<AdminUpdatePanel onGithubUpdateChange={(hasUpdate, commits) => {
          setUpdateAvailable(hasUpdate);
          setUpdateCommits(commits);
        }} />}
        aProposContent={<AboutContent />}
        monProfilContent={<MyProfileContent />}
        pendingUsersCount={pendingUsersCount}
      />
    </div>
  );
}

// ──────────────────────────────────────────────
// ÉCRAN DE CONFIGURATION INITIALE (premier lancement)
// ──────────────────────────────────────────────

function InitialSetupScreen({ onSetupComplete }: { onSetupComplete: () => void }) {
  const [serverPath, setServerPath] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [isValid, setIsValid] = useState<boolean | null>(null);

  const handleBrowse = async () => {
    const selected = await (window as any).electronAPI?.selectFolder?.();
    if (selected) {
      setServerPath(selected);
      setError('');
      setIsValid(null);
      // Valider automatiquement
      setValidating(true);
      try {
        const result = await (window as any).electronAPI?.validatePath?.(selected);
        setIsValid(!!result);
      } catch { setIsValid(false); }
      setValidating(false);
    }
  };

  const handleSetup = async () => {
    if (!serverPath.trim()) {
      setError('Veuillez indiquer un chemin.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await (window as any).electronAPI?.serverConfig_setup?.(serverPath.trim());
      if (result?.success) {
        onSetupComplete();
      } else {
        setError(result?.error || 'Erreur inconnue');
      }
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  };

  return (
    <div className="h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-xl w-full mx-4 p-8 bg-white rounded-2xl shadow-xl border border-gray-200 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Configuration initiale</h1>
          <p className="text-gray-500 text-sm">
            Bienvenue ! Configurez le dossier réseau partagé pour démarrer.
          </p>
        </div>

        {/* Explication */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">
            Indiquez le chemin du <strong>dossier réseau partagé</strong> qui servira de point central
            pour la synchronisation des données, les utilisateurs et les mises à jour.
          </p>
          <p className="text-xs text-blue-600 mt-2">
            Ce dossier doit être accessible par tous les postes qui utiliseront l'application.
            Vous serez l'administrateur de cette instance.
          </p>
        </div>

        {/* Champ chemin */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Chemin du dossier réseau partagé
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={serverPath}
              onChange={(e) => { setServerPath(e.target.value); setError(''); setIsValid(null); }}
              placeholder="Ex: P:\MonService\AppMetier"
              className="flex-1 px-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
            <button
              onClick={handleBrowse}
              className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors text-sm font-medium text-gray-700"
            >
              Parcourir
            </button>
          </div>
          {validating && (
            <p className="text-xs text-gray-400">Vérification du chemin...</p>
          )}
          {isValid === true && (
            <p className="text-xs text-emerald-600">Chemin accessible et inscriptible</p>
          )}
          {isValid === false && (
            <p className="text-xs text-red-500">Chemin inaccessible ou non inscriptible</p>
          )}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>
          )}
        </div>

        {/* Bouton */}
        <button
          onClick={handleSetup}
          disabled={saving || !serverPath.trim()}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Configuration en cours...' : 'Initialiser l\'application'}
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// APP — Point d'entrée avec guard de setup
// ──────────────────────────────────────────────

export default function App() {
  const [setupChecked, setSetupChecked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const config = await (window as any).electronAPI?.serverConfig_get?.();
        if (config?.isConfigured) {
          // Déjà configuré
          setNeedsSetup(false);
        } else {
          // Pas configuré — vérifier si le chemin legacy est accessible (installation existante)
          const legacyAccessible = await (window as any).electronAPI?.validatePath?.(config?.serverRootPath);
          if (legacyAccessible) {
            // Le chemin legacy marche → sauvegarder en tant que config officielle et continuer
            await (window as any).electronAPI?.serverConfig_setup?.(config?.serverRootPath);
            setNeedsSetup(false);
          } else {
            // Aucun chemin accessible → afficher l'écran de setup
            setNeedsSetup(true);
          }
        }
      } catch {
        // Si electronAPI n'est pas dispo (mode dev Next.js pur), skip
        setNeedsSetup(false);
      }
      setSetupChecked(true);
    };
    checkSetup();
  }, []);

  if (!setupChecked) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-lg text-gray-500">Chargement...</div>
      </div>
    );
  }

  if (needsSetup) {
    return <InitialSetupScreen onSetupComplete={() => { setNeedsSetup(false); window.location.reload(); }} />;
  }

  return (
    <UserProvider>
      <ToastProvider>
        <AudienceProvider>
          <InstructionResultatsProvider>
            <AppContent />
          </InstructionResultatsProvider>
        </AudienceProvider>
      </ToastProvider>
    </UserProvider>
  );
}