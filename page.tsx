"use client"

import { useState, useEffect, useMemo } from 'react';
import { MultiSideBar } from './components/MultiSideBar';
import { Header } from './components/Header';
import { FilterBar } from './components/FilterBar';
import { EnquetePreview } from './components/EnquetePreview';
import { NewEnqueteModal } from './components/modals/NewEnqueteModal';
import { EnqueteDetailModal } from './components/modals/EnqueteDetailModal';
import { TagManagementPage } from './components/pages/TagManagementPage';
import { AlertsPage } from './components/pages/AlertsPage';
import { AlertsModal } from './components/modals/AlertsModal';
import { SavePage } from './components/pages/SavePage';
import { StatsPage } from './components/pages/StatsPage';
import { useContentieuxEnquetes } from './hooks/useContentieuxEnquetes';
import { useFilterSort } from './hooks/useFilterSort';
import { useDocumentSearch } from './hooks/useDocumentSearch';
import { NewEnqueteData, Tag, ToDoItem } from './types/interfaces';
import { StorageManager } from './utils/storage';
import { ConfirmationDialog } from './components/ui/confirmation-dialog';
import { ToastProvider, useToast } from './contexts/ToastContext';
import { AudienceProvider } from './contexts/AudienceContext';
import { UserProvider, useUser } from './contexts/UserContext';
import { ProlongationModal } from './components/modals/ProlongationModal';
import { PoseActeModal } from './components/modals/PoseActeModal';
import { ProlongationValidationModal } from './components/modals/ProlongationValidationModal';
import { DateUtils } from '@/utils/dateUtils';
import { ActeUtils } from '@/utils/acteUtils';
import { PermanencePage } from './components/pages/PermanencePage';
import { ArchivePage } from './components/pages/ArchivePage';
import { AIRPage } from './components/pages/AIRPage';
import { useTags } from './hooks/useTags';
import { useSections } from './hooks/useSections';

// Imports pour les instructions judiciaires
import { InstructionsPage } from './components/pages/InstructionsPage';
import { NewInstructionModal } from './components/modals/NewInstructionModal';
import { InstructionDetailModal } from './components/modals/InstructionDetailModal';
import { useInstructions } from './hooks/useInstructions';

import { useAIR } from './hooks/useAIR';
import { useCombinedAlerts } from './hooks/useCombinedAlerts';
import { useVisualAlerts } from './hooks/useVisualAlerts';
import { backupManager } from '@/utils/backupManager';
import { WeeklyRecapPopup } from './components/modals/WeeklyRecapPopup';
import { WeeklyPopupConfig } from './types/interfaces';
import { ElectronBridge } from './utils/electronBridge';
import { OPTimeline } from './components/OPTimeline';
import { TodoReminderBar } from './components/TodoReminderBar';
import { PendingActsJLD } from './components/PendingActsJLD';

// 🆕 Imports pour la synchronisation des données
import { useDataSync } from './hooks/useDataSync';
import { DataSyncConflictModal } from './components/modals/DataSyncConflictModal';
import { ConflictAction } from '@/types/dataSyncTypes';
import { DataSyncManager } from './utils/dataSync/DataSyncManager';

// 🆕 Multi-contentieux
import { SettingsModal } from './components/modals/SettingsModal';
import { OverboardPage } from './components/pages/OverboardPage';
import { GlobalStatsPage } from './components/pages/GlobalStatsPage';
import { ContentieuxId } from '@/types/userTypes';
import { AdminUsersPanel } from './components/AdminUsersPanel';
import { AdminPathsPanel } from './components/admin/AdminPathsPanel';
import { AdminDashboardPanel } from './components/admin/AdminDashboardPanel';
import { AdminTagHistoryPanel } from './components/admin/AdminTagHistoryPanel';
import { useOverboardData } from './hooks/useOverboardData';
import { TagRequestPopup } from './components/modals/TagRequestPopup';
import { tagRequestManager } from './utils/tagRequestManager';
import { HeartbeatManager } from './utils/heartbeatManager';
import { SharedEventManager } from './utils/sharedEventManager';
import { AuditLogger } from './utils/auditLogger';

const CHEMIN_BASE = "P:\\TGI\\Parquet\\P17 - STUP - CRIM ORG\\PRELIM EN COURS\\";


function AppContent() {
  const [isClient, setIsClient] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentView, setCurrentView] = useState('enquetes');
  const [searchTerm, setSearchTerm] = useState('');

  // 🆕 Multi-contentieux
  const [activeContentieux, setActiveContentieux] = useState<ContentieuxId | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsContentieuxId, setSettingsContentieuxId] = useState<ContentieuxId | null>(null);
  const [showTagRequestPopup, setShowTagRequestPopup] = useState(false);
  const { isAuthenticated, isLoading: userLoading, error: userError, accessibleContentieux, canDo, isAdmin, hasOverboard, hasModule, user, contentieux: contentieuxDefs } = useUser();

  // Initialiser le contentieux actif et la vue au premier contentieux accessible
  useEffect(() => {
    if (!activeContentieux && accessibleContentieux.length > 0) {
      const firstId = accessibleContentieux[0].id;
      setActiveContentieux(firstId);
      setCurrentView(`enquetes_${firstId}`);
    }
  }, [accessibleContentieux, activeContentieux]);

  // Réinitialise la recherche à chaque changement de vue
  const handleViewChange = async (view: string, contentieuxId?: ContentieuxId) => {
    // Vérifier que l'utilisateur a accès au contentieux demandé
    if (contentieuxId && !accessibleContentieux.some(c => c.id === contentieuxId)) {
      return;
    }
    // Flush les données en attente avant de changer de contentieux
    if (contentieuxId && contentieuxId !== activeContentieux) {
      await flushPendingSave();
    }
    setSearchTerm('');
    setSelectedTags([]);
    setSortOrder('date-desc');
    setCurrentView(view);
    if (contentieuxId) {
      setActiveContentieux(contentieuxId);
    }
    // Rafraîchir l'overboard quand on y navigue (données potentiellement modifiées)
    if (view === 'overboard' || view === 'global_stats') {
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

  // 🆕 Hook de synchronisation des données
  const {
    syncStatus,
    isSyncing,
    triggerSync,
    resolveConflicts,
    repairServer,
    restoreFromServerBackup,
    listServerBackups,
    lastSyncResult,
    hasConflicts,
    conflicts
  } = useDataSync();

  // 🆕 État pour le modal de conflits
  const [showConflictModal, setShowConflictModal] = useState(false);

  // Auto-fermer le modal de conflits si les conditions deviennent invalides
  useEffect(() => {
    if (showConflictModal && (!lastSyncResult || !hasConflicts)) {
      setShowConflictModal(false);
    }
  }, [showConflictModal, lastSyncResult, hasConflicts]);

  // Mise à jour de l'application
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateCommits, setUpdateCommits] = useState(0);
  const [isUpdating, setIsUpdating] = useState(false);

  // Hook pour les enquêtes — scopé au contentieux actif (défaut : crimorg)
  const currentContentieuxId = effectiveContentieux || 'crimorg';
  const {
    enquetes,
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
    flushPendingSave
  } = useContentieuxEnquetes(currentContentieuxId);

  // Hook Overboard — données transversales (tous contentieux)
  const { enquetesByContentieux: overboardData, refresh: refreshOverboard } = useOverboardData(contentieuxDefs);

  // Hook pour les instructions judiciaires
  const {
    instructions,
    selectedInstruction,
    isEditing: isEditingInstruction,
    editingCR: editingCRInstruction,
    instructionAlerts,
    setSelectedInstruction,
    setIsEditing: setIsEditingInstruction,
    setEditingCR: setEditingCRInstruction,
    handleAddInstruction,
    handleUpdateInstruction,
    handleDeleteInstruction,
    handleAjoutCR: handleAjoutCRInstruction,
    handleUpdateCR: handleUpdateCRInstruction,
    handleDeleteCR: handleDeleteCRInstruction,
    handleValidateInstructionAlert,
    handleSnoozeInstructionAlert
  } = useInstructions();

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
    handleValidateAlert
  } = useCombinedAlerts(enquetes, mesuresAIR, currentContentieuxId);


  // Hook tags centralisé - simplifié
  const {
    tags,
    isLoading: tagsLoading,
    getTagsByCategory
  } = useTags();

  const { getSectionOrder, sections: sectionsList, reorderSection, addSection: addSectionFn } = useSections();

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

  useEffect(() => {
    setIsClient(true);
  }, []);

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

  // Vérifier les demandes de tags en attente (admin uniquement)
  useEffect(() => {
    if (!isAdmin()) return;
    tagRequestManager.getPendingRequests().then(requests => {
      if (requests.length > 0) {
        setShowTagRequestPopup(true);
      }
    });
  }, [isAdmin]);

  // Démarrage des services temps réel (heartbeat, événements, audit)
  useEffect(() => {
    if (!user || !isAuthenticated) return;

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
      hb.stop();
      clearInterval(cleanupInterval);
    };
  }, [user, isAuthenticated]);

  // Mise à jour du contexte heartbeat quand la vue change
  useEffect(() => {
    if (!user) return;
    const hb = HeartbeatManager.getInstance();
    hb.updateContext(activeContentieux, baseView);
  }, [activeContentieux, baseView, user]);

  const handleGlobalTodosChange = (todos: ToDoItem[]) => {
    setGlobalTodos(todos);
    ElectronBridge.setData('global_todos', todos);
  };

  // Popup récapitulatif hebdomadaire : vérifié une fois au démarrage
  useEffect(() => {
    const checkWeeklyPopup = async () => {
      try {
        const cfg = await ElectronBridge.getData<WeeklyPopupConfig>('weekly_popup_config', {
          enabled: false, dayOfWeek: 1, hour: 9
        });
        if (!cfg.enabled) return;

        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];

        // Déjà montré aujourd'hui ?
        if (cfg.lastShownDate === todayStr) return;

        // Bon jour de la semaine et heure atteinte ? (7 = chaque jour)
        const isRightDay = cfg.dayOfWeek === 7 || now.getDay() === cfg.dayOfWeek;
        if (isRightDay && now.getHours() >= cfg.hour) {
          // Mettre à jour lastShownDate pour ne pas le réafficher cette journée
          await ElectronBridge.setData('weekly_popup_config', { ...cfg, lastShownDate: todayStr });
          setShowWeeklyPopup(true);
        }
      } catch {
        // Silencieux si stockage non disponible
      }
    };
    checkWeeklyPopup();
  }, []);

  // 🆕 Effet pour détecter les conflits et afficher le modal
  useEffect(() => {
    if (hasConflicts && lastSyncResult?.action === 'conflicts_detected') {
      setShowConflictModal(true);
    }
  }, [hasConflicts, lastSyncResult]);

  // Vérification des mises à jour au démarrage (puis toutes les 30 min)
  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const result = await window.electronAPI.checkAppUpdate?.();
        if (result && result.hasUpdate) {
          setUpdateAvailable(true);
          setUpdateCommits(result.commits);
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
    setIsUpdating(true);
    try {
      const result = await window.electronAPI.applyAppUpdate?.();
      if (result && !result.success) {
        showToast(`Erreur de mise à jour : ${result.error}`, 'error');
        setIsUpdating(false);
      }
      // Si succès, l'app redémarre → pas besoin de reset l'état
    } catch {
      showToast('Impossible de mettre à jour l\'application', 'error');
      setIsUpdating(false);
    }
  };

  const handleResolveConflicts = async (selections: Map<number, ConflictAction>) => {
  try {
    await resolveConflicts(selections);
    setShowConflictModal(false);
    showToast('Conflits résolus avec succès', 'success');
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
      const result = await triggerSync();
      
      if (result.action === 'conflicts_detected') {
        showToast('Conflits détectés - veuillez choisir une résolution', 'error');
      } else if (result.success) {
        showToast('Synchronisation réussie', 'success');
        window.location.reload();
      } else {
        showToast(`Erreur: ${result.error || 'Erreur inconnue'}`, 'error');
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
      const alertRulesData = await StorageManager.get(`${ctxPrefix}alertRules`, []);
      const tagsData = await StorageManager.get(`${ctxPrefix}customTags`, []);
      const airMesuresData = await StorageManager.get('air_mesures', []);

      const data = {
        contentieuxId: currentContentieuxId,
        enquetes: enquetesData,
        instructions: instructionsData,
        alertRules: alertRulesData,
        tags: tagsData,
        airMesures: airMesuresData,
        exportDate: new Date().toISOString(),
        version: '3.0'
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
              if (importedData.alertRules) {
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
  const handleToggleHideFromJA = (enqueteId: number) => {
    const enquete = enquetes.find(e => e.id === enqueteId);
    if (!enquete) return;
    const newValue = !enquete.hiddenFromJA;
    handleUpdateEnquete(enqueteId, { hiddenFromJA: newValue });
    showToast(
      newValue ? 'Enquête dissimulée aux JA' : 'Enquête visible par les JA',
      'success'
    );
  };

  // Toggle pin overboard pour une enquête
  const handleToggleOverboardPin = (enqueteId: number) => {
    if (!user) return;
    const enquete = enquetes.find(e => e.id === enqueteId);
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
  };

  const filteredAndSortedEnquetes = useFilterSort(enquetes, searchTerm, selectedTags, sortOrder);

  // Liste dédupliquée de tous les noms de MEC connus (cross-dossiers)
  const allKnownMec = useMemo(
    () => [...new Set(enquetes.flatMap(e => e.misEnCause.map(m => m.nom)))].sort(),
    [enquetes]
  );

  // Recherche dans le contenu des documents (async, avec cache)
  const { documentMatchIds, isSearchingDocs } = useDocumentSearch(enquetes, searchTerm);

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
        // Chercher le tag central correspondant pour récupérer l'organization
        const centralTag = tags.find(t => t.value === serviceTag.value && t.category === 'services');

        if (centralTag?.organization?.section) {
          const section = centralTag.organization.section;
          const serviceName = serviceTag.value as string;
          if (!organized[section]) organized[section] = {};
          if (!organized[section][serviceName]) organized[section][serviceName] = [];
          organized[section][serviceName].push(enquete);
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
  }, [activeEnquetes, tags]);

  const archivedEnquetes = useMemo(() =>
    mergedFilteredEnquetes.filter(e => e.statut === 'archive'),
    [mergedFilteredEnquetes]
  );

  // Nombre total d'alertes actives
  const activeAlertsCount = useMemo(() => {
    const enqueteAlertsCount = alerts.filter(alert => alert.status === 'active' && !alert.isAIRAlert).length;
    const instructionAlertsCount = instructionAlerts.length;
    const airAlertsCount = alerts.filter(alert => alert.status === 'active' && alert.isAIRAlert).length;
    
    return enqueteAlertsCount + instructionAlertsCount + airAlertsCount;
  }, [alerts, instructionAlerts]);

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

  // Utilisateur authentifié mais sans contentieux attribué (nouvel utilisateur auto-inscrit)
  if (isAuthenticated && accessibleContentieux.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center space-y-4 max-w-md">
          <div className="text-6xl">&#x23F3;</div>
          <h1 className="text-xl font-bold text-gray-800">Bienvenue, {user?.displayName || user?.windowsUsername}</h1>
          <p className="text-gray-600">
            Votre compte a été créé automatiquement.
          </p>
          <p className="text-gray-600">
            L'administrateur doit maintenant vous attribuer un ou plusieurs contentieux pour que vous puissiez accéder à l'application.
          </p>
          <p className="text-sm text-gray-400">
            Relancez l'application une fois vos accès configurés.
          </p>
        </div>
      </div>
    );
  }

return (
    <div className="flex h-screen bg-gray-100">
      <div className="no-print">
        <MultiSideBar
          isOpen={sidebarOpen}
          currentView={currentView}
          currentContentieux={effectiveContentieux}
          onViewChange={handleViewChange}
          onNewEnquete={handleNewEnquete}
          onOpenSettings={() => setShowSettingsModal(true)}
          alertCount={activeAlertsCount}
          instructionAlertCount={instructionAlerts.length}
        />
      </div>
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="no-print">
          <Header
            searchTerm={searchTerm}
            onSearch={setSearchTerm}
            alerts={[...alerts.filter(alert => alert.status === 'active'), ...instructionAlerts]}
            onShowAlerts={() => setShowAlertsModal(true)}
            onSave={handleManualSave}
            isSaving={isSaving}
            lastSaveDate={StorageManager.getLastSave()}
            syncStatus={syncStatus}
            onSync={handleManualSync}
            isSyncing={isSyncing}
            isSearchingDocs={isSearchingDocs}
            updateAvailable={updateAvailable}
            updateCommits={updateCommits}
            onApplyUpdate={handleApplyUpdate}
            isUpdating={isUpdating}
          />
        </div>

        {/* 🆕 Bandeau lecture seule */}
        {effectiveContentieux && !canDo(effectiveContentieux, 'edit') && (baseView === 'enquetes' || baseView === 'archives') && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-xs text-amber-700 font-medium flex items-center gap-2">
            <span>👁</span> Mode consultation — {contentieuxDefs.find(c => c.id === effectiveContentieux)?.label || effectiveContentieux}
          </div>
        )}

        {(baseView === 'enquetes' || baseView === 'instructions') && (
          <FilterBar
            selectedTags={selectedTags}
            onTagSelect={(tag) => setSelectedTags([...selectedTags, tag])}
            onTagRemove={(tagId) => setSelectedTags(selectedTags.filter(t => t.id !== tagId))}
            sortOrder={sortOrder}
            onSortChange={setSortOrder}
            activeSections={Object.keys(enquetesByOrganization)}
            sections={sectionsList}
            onReorder={reorderSection}
            onAddSection={addSectionFn}
          />
        )}

        <main className="flex-1 overflow-auto p-6">
          {baseView === 'enquetes' && (
            <div className="space-y-6">
              <OPTimeline enquetes={activeEnquetes} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <TodoReminderBar
                  enquetes={activeEnquetes}
                  globalTodos={globalTodos}
                  onUpdateEnquete={handleUpdateEnquete}
                  onGlobalTodosChange={handleGlobalTodosChange}
                  onOpenEnquete={(e) => { setSelectedEnquete(e); setIsEditing(false); }}
                />
                <PendingActsJLD
                  enquetes={activeEnquetes}
                  onOpenEnquete={(e) => { setSelectedEnquete(e); setIsEditing(false); }}
                />
              </div>
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
                      onView={() => {
                        setSelectedEnquete(enquete);
                        setIsEditing(false);
                      }}
                      onEdit={() => {
                        setSelectedEnquete(enquete);
                        setIsEditing(true);
                      }}
                      onArchive={handleArchiveEnquete}
                      onToggleSuivi={(type: 'JIRS' | 'PG') => {
                        const tagId = type === 'JIRS' ? 'suivi_jirs' : 'suivi_pg';
                        const tags = enquete.tags || [];
                        const hasSuiviTag = tags.some((tag: any) =>
                          tag.category === 'suivi' && tag.value === type
                        );
                        const newTags = hasSuiviTag
                          ? tags.filter((tag: any) => !(tag.category === 'suivi' && tag.value === type))
                          : [...tags, { id: tagId, value: type, category: 'suivi' }];
                        handleUpdateEnquete(enquete.id, { tags: newTags });
                      }}
                      onStartEnquete={handleStartEnquete}
                      onToggleOverboardPin={hasOverboard() ? handleToggleOverboardPin : undefined}
                      onToggleHideFromJA={canDo(currentContentieuxId, 'delete') ? handleToggleHideFromJA : undefined}
                      alerts={alerts.filter(alert => !alert.isAIRAlert)}
                      onValidateAlert={handleValidateAlert}
                      onSnoozeAlert={handleSnoozeAlert}
                      onProlongationRequest={(acteId, type) => {
                        setSelectedActe({ id: acteId, type, enqueteId: enquete.id });
                        setShowProlongationModal(true);
                      }}
                      onPoseRequest={(acteId, type) => {
                        setSelectedActe({ id: acteId, type, enqueteId: enquete.id });
                        setShowPoseModal(true);
                      }}
                      onValidateProlongationRequest={(acteId, type) => {
                        setSelectedActe({ id: acteId, type, enqueteId: enquete.id });
                        setShowProlongationValidationModal(true);
                      }}
                      onValidateAutorisationRequest={(acteId, type) => {
                        handleUpdateEnquete(enquete.id, {
                          [type === 'acte' ? 'actes' :
                           type === 'ecoute' ? 'ecoutes' :
                           'geolocalisations']: enquete[type === 'acte' ? 'actes' :
                                                        type === 'ecoute' ? 'ecoutes' :
                                                        'geolocalisations']?.map((a: any) =>
                            a.id === acteId ? { ...a, statut: 'en_cours' } : a
                          )
                        });
                        showToast('Autorisation validée', 'success');
                      }}
                      visualAlertRules={visualAlertRules}
                      onCreateGlobalTodo={(todo) => handleGlobalTodosChange([...globalTodos, todo])}
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
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 justify-items-center">
                                {serviceEnquetes.map(renderEnqueteCard)}
                              </div>
                            </div>
                          ))}
                          {/* Enquêtes sans service nommé dans cette section */}
                          {serviceGroups[''] && serviceGroups[''].length > 0 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 justify-items-center">
                              {serviceGroups[''].map(renderEnqueteCard)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 justify-items-center">
                          {allEnquetes.map(renderEnqueteCard)}
                        </div>
                      )}
                    </div>
                  );
                })
              }
            </div>
          )}

          {baseView === 'instructions' && (
            <InstructionsPage
              instructions={instructions}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              onUpdateInstruction={handleUpdateInstruction}
              onAddInstruction={handleAddInstruction}
              onDeleteInstruction={handleDeleteInstruction}
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
              isLoading={isLoadingAIR}
              onUpdateMesure={handleUpdateMesure}
              onDeleteMesure={handleDeleteMesure} 
              onDeleteAllMesures={handleDeleteAllMesures}
              onAddMesure={handleAddMesure}
              onImportMesures={handleImportMesures}
            />
          )}

          {baseView === 'stats' && (
            <StatsPage enquetes={enquetes} contentieuxId={currentContentieuxId} />
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
          onUpdate={handleUpdateEnquete}
          onAddCR={handleAjoutCR}
          onUpdateCR={handleUpdateCR}
          onDeleteCR={handleDeleteCR}
          setEditingCR={setEditingCR}
          onDelete={handleDeleteEnquete}
          allKnownMec={allKnownMec}
          onCreateGlobalTodo={(todo) => handleGlobalTodosChange([...globalTodos, todo])}
          readOnly={effectiveContentieux ? !canDo(effectiveContentieux, 'edit') : true}
        />
      )}

      {/* Modales pour instructions judiciaires */}
      <NewInstructionModal 
        isOpen={showNewInstructionModal}
        onClose={() => setShowNewInstructionModal(false)}
        onSubmit={handleAddInstruction}
      />

      {selectedInstruction && (
        <InstructionDetailModal 
          instruction={selectedInstruction}
          isEditing={isEditingInstruction}
          onClose={() => setSelectedInstruction(null)}
          onEdit={() => setIsEditingInstruction(!isEditingInstruction)}
          onUpdate={handleUpdateInstruction}
          onDelete={handleDeleteInstruction}
        />
      )}

      {/* Modales communes */}
      <AlertsModal
        isOpen={showAlertsModal}
        onClose={() => setShowAlertsModal(false)}
        alerts={[...alerts.filter(alert => alert.status === 'active'), ...instructionAlerts]}
        onValidateAlert={(alertId) => {
          const isInstructionAlert = instructionAlerts.some(alert => alert.id === alertId);
          if (isInstructionAlert) {
            handleValidateInstructionAlert(alertId);
          } else {
            handleValidateAlert(alertId);
          }
        }}
        onSnoozeAlert={(alertId) => {
          const isInstructionAlert = instructionAlerts.some(alert => alert.id === alertId);
          if (isInstructionAlert) {
            handleSnoozeInstructionAlert(alertId);
          } else {
            handleSnoozeAlert(alertId);
          }
        }}
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
                        a.id === selectedActe.id ? { ...a, statut: 'prolongation_pending' } : a
                      )
                    });
                  }
                }
              }
              setShowProlongationModal(false);
              setSelectedActe(null);
            }}
            originalStartDate={
              selectedActe && selectedActe.enqueteId && enquetes.find(e => e.id === selectedActe.enqueteId)?.[
                selectedActe.type === 'acte' ? 'actes' : 
                selectedActe.type === 'ecoute' ? 'ecoutes' : 
                'geolocalisations'
              ]?.find(a => a.id === selectedActe.id)?.dateDebut
            }
            originalDuration={
              selectedActe && selectedActe.enqueteId && enquetes.find(e => e.id === selectedActe.enqueteId)?.[
                selectedActe.type === 'acte' ? 'actes' : 
                selectedActe.type === 'ecoute' ? 'ecoutes' : 
                'geolocalisations'
              ]?.find(a => a.id === selectedActe.id)?.duree
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
              selectedActe && selectedActe.enqueteId && enquetes.find(e => e.id === selectedActe.enqueteId)?.[
                selectedActe.type === 'acte' ? 'actes' : 
                selectedActe.type === 'ecoute' ? 'ecoutes' : 
                'geolocalisations'
              ]?.find(a => a.id === selectedActe.id)?.dateDebut
            }
            originalDuration={
              selectedActe && selectedActe.enqueteId && enquetes.find(e => e.id === selectedActe.enqueteId)?.[
                selectedActe.type === 'acte' ? 'actes' : 
                selectedActe.type === 'ecoute' ? 'ecoutes' : 
                'geolocalisations'
              ]?.find(a => a.id === selectedActe.id)?.duree
            }
            poseDate={
              selectedActe && selectedActe.enqueteId && enquetes.find(e => e.id === selectedActe.enqueteId)?.[
                selectedActe.type === 'acte' ? 'actes' :
                selectedActe.type === 'ecoute' ? 'ecoutes' :
                'geolocalisations'
              ]?.find(a => a.id === selectedActe.id)?.datePose
            }
            currentDateFin={
              selectedActe && selectedActe.enqueteId && enquetes.find(e => e.id === selectedActe.enqueteId)?.[
                selectedActe.type === 'acte' ? 'actes' :
                selectedActe.type === 'ecoute' ? 'ecoutes' :
                'geolocalisations'
              ]?.find(a => a.id === selectedActe.id)?.dateFin
            }
          />
        </>
      )}

      {/* 🆕 Modal de gestion des conflits de synchronisation */}
{showConflictModal && lastSyncResult && hasConflicts && (
  <DataSyncConflictModal
    isOpen={showConflictModal}
    onClose={() => setShowConflictModal(false)}
    conflicts={conflicts || []}
    onResolve={handleResolveConflicts}
  />
)}

      {/* Popup récapitulatif hebdomadaire */}
      <WeeklyRecapPopup
        isOpen={showWeeklyPopup}
        onClose={() => setShowWeeklyPopup(false)}
        enquetes={enquetes}
        alertRules={alertRules}
      />

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
            rules={alertRules}
            onUpdateRule={handleUpdateAlertRule}
            onDuplicateRule={handleDuplicateRule}
            onDeleteRule={handleDeleteRule}
            onShowWeeklyPopup={() => setShowWeeklyPopup(true)}
            visualAlertRules={visualAlertRules}
            onUpdateVisualAlertRule={updateVisualAlertRule}
            onDeleteVisualAlertRule={deleteVisualAlertRule}
            onReorderVisualAlertRules={reorderVisualAlertRules}
          />
        }
        tagsContent={<TagManagementPage />}
        sauvegardesContent={
          <SavePage
            onExport={handleExportData}
            onImport={handleImportData}
            onManualSave={handleManualSave}
            lastSaveDate={StorageManager.getLastSave()}
            onRepairServer={repairServer}
            onRestoreFromServerBackup={restoreFromServerBackup}
            onListServerBackups={listServerBackups}
            isSyncing={isSyncing}
            syncStatus={syncStatus}
          />
        }
        adminUsersContent={<AdminUsersPanel />}
        adminPathsContent={<AdminPathsPanel />}
        adminDashboardContent={<AdminDashboardPanel />}
        adminTagHistoryContent={<AdminTagHistoryPanel />}
      />

      {/* Popup demandes de tags (admin) */}
      <TagRequestPopup
        isOpen={showTagRequestPopup}
        onClose={() => setShowTagRequestPopup(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <UserProvider>
      <ToastProvider>
        <AudienceProvider>
          <AppContent />
        </AudienceProvider>
      </ToastProvider>
    </UserProvider>
  );
}