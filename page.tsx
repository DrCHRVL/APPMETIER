"use client"

import { useState, useEffect, useMemo } from 'react';
import { SideBar } from './components/SideBar';
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
import { useEnquetes } from './hooks/useEnquetes';
import { useFilterSort } from './hooks/useFilterSort';
import { useDocumentSearch } from './hooks/useDocumentSearch';
import { NewEnqueteData, Tag, ToDoItem } from './types/interfaces';
import { StorageManager } from './utils/storage';
import { useAudience } from './hooks/useAudience';
import { ConfirmationDialog } from './components/ui/confirmation-dialog';
import { ToastProvider, useToast } from './contexts/ToastContext';
import { ProlongationModal } from './components/modals/ProlongationModal';
import { PoseActeModal } from './components/modals/PoseActeModal';
import { ProlongationValidationModal } from './components/modals/ProlongationValidationModal';
import { DateUtils } from '@/utils/dateUtils';
import { PermanencePage } from './components/pages/PermanencePage';
import { ArchivePage } from './components/pages/ArchivePage';
import { AIRPage } from './components/pages/AIRPage';
import { useTags } from './hooks/useTags';

// Imports pour les instructions judiciaires
import { InstructionsPage } from './components/pages/InstructionsPage';
import { NewInstructionModal } from './components/modals/NewInstructionModal';
import { InstructionDetailModal } from './components/modals/InstructionDetailModal';
import { useInstructions } from './hooks/useInstructions';

import { useAIR } from './hooks/useAIR';
import { useCombinedAlerts } from './hooks/useCombinedAlerts';
import { backupManager } from '@/utils/backupManager';
import { WeeklyRecapPopup } from './components/modals/WeeklyRecapPopup';
import { WeeklyPopupConfig } from './types/interfaces';
import { ElectronBridge } from './utils/electronBridge';
import { OPTimeline } from './components/OPTimeline';
import { TodoReminderBar } from './components/TodoReminderBar';

// 🆕 Imports pour la synchronisation des données
import { useDataSync } from './hooks/useDataSync';
import { DataSyncConflictModal } from './components/modals/DataSyncConflictModal';
import { ConflictResolution, ConflictAction } from '@/types/dataSyncTypes';

const CHEMIN_BASE = "P:\\TGI\\Parquet\\P17 - STUP - CRIM ORG\\PRELIM EN COURS\\";

// Ordre fixe des sections (même que dans ServiceOrganizer)
const SECTIONS_ORDER = [
  'SR',
  'DCOS80',
  'Offices centraux',
  'Brigade de recherches Peronne',
  'Brigade de recherches Amiens',
  'Brigade de recherches Abbeville',
  'Brigade de recherches Montdidier',
  'SLPJ Amiens',
  'Compagnie de Amiens',
  'Compagnie de Abbeville',
  'Compagnie de Peronne',
  'Compagnie de Montdidier'
];

function AppContent() {
  const [isClient, setIsClient] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentView, setCurrentView] = useState('enquetes');
  const [searchTerm, setSearchTerm] = useState('');

  // Réinitialise la recherche à chaque changement de vue
  const handleViewChange = (view: string) => {
    setSearchTerm('');
    setCurrentView(view);
  };
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
    lastSyncResult,
    hasConflicts,
    conflicts
  } = useDataSync();

  // 🆕 État pour le modal de conflits
  const [showConflictModal, setShowConflictModal] = useState(false);

  // Hook pour les enquêtes préliminaires
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
    handleCreateAudienceAlert
  } = useEnquetes();

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
  } = useCombinedAlerts(enquetes, mesuresAIR);

  const { resetResultat } = useAudience();

  // Hook tags centralisé - simplifié
  const {
    tags,
    isLoading: tagsLoading,
    getTagsByCategory
  } = useTags();

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

  // Chargement des todos généraux au démarrage
  useEffect(() => {
    ElectronBridge.getData<ToDoItem[]>('global_todos', []).then(todos => {
      setGlobalTodos(todos || []);
    });
  }, []);

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

        // Bon jour de la semaine et heure atteinte ?
        if (now.getDay() === cfg.dayOfWeek && now.getHours() >= cfg.hour) {
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

  // Calculer dynamiquement les sections personnalisées depuis les tags organisés
  const customSections = useMemo(() => {
    const allUsedSections = new Set<string>();
    
    // Parcourir tous les tags de services pour trouver les sections utilisées
    tags
      .filter(tag => tag.category === 'services' && tag.organization?.section)
      .forEach(tag => {
        allUsedSections.add(tag.organization!.section);
      });
    
    // Retirer les sections par défaut pour ne garder que les personnalisées
    const customSectionsArray = Array.from(allUsedSections).filter(
      section => !SECTIONS_ORDER.includes(section)
    );
    
    return customSectionsArray.sort(); // Tri alphabétique des sections personnalisées
  }, [tags]);

  // Fonction pour obtenir l'ordre d'une section (même logique que ServiceOrganizer)
  const getSectionOrder = (sectionName: string) => {
    const orderIndex = SECTIONS_ORDER.indexOf(sectionName);
    if (orderIndex !== -1) return orderIndex;
    
    const customIndex = customSections.indexOf(sectionName);
    if (customIndex !== -1) return SECTIONS_ORDER.length + customIndex;
    
    if (sectionName === 'AUTRES SERVICES') return 9999; // Toujours en dernier
    
    return SECTIONS_ORDER.length + customSections.length; // Autres sections
  };

  const handleManualSave = async () => {
    try {
      setIsSaving(true);
      await StorageManager.addManualSaveToHistory();
      
      const backupSuccess = await backupManager.createBackup();
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

  // 🆕 Gestionnaire de résolution de conflit
  const handleConflictResolution = async (resolution: ConflictResolution) => {
    if (!lastSyncResult || !lastSyncResult.localData || !lastSyncResult.serverData) {
      showToast('Données manquantes pour résoudre le conflit', 'error');
      return;
    }

    try {
      showToast('Résolution des conflits en cours...', 'info');
      await resolveConflicts(resolution, lastSyncResult);
      setShowConflictModal(false);
      showToast('Conflits résolus avec succès', 'success');
      
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      console.error('Erreur résolution:', error);
      showToast('Erreur lors de la résolution des conflits', 'error');
    }
  };

  const handleExportData = async () => {
    try {
      const enquetesData = await StorageManager.get('enquetes', []);
      const instructionsData = await StorageManager.get('instructions', []);
      const alertRulesData = await StorageManager.get('alertRules', []);
      const tagsData = await StorageManager.get('tags', []);
      const airMesuresData = await StorageManager.get('air_mesures', []);
      
      const data = {
        enquetes: enquetesData,
        instructions: instructionsData,
        alertRules: alertRulesData,
        tags: tagsData,
        airMesures: airMesuresData,
        exportDate: new Date().toISOString(),
        version: '2.0'
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sauvegarde_complete_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showToast(`Exportation réussie: ${enquetesData.length} enquêtes, ${instructionsData.length} instructions`, 'success');
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
              
              showToast('Import réussi', 'success');
              
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
    if (currentView === 'instructions') {
      setShowNewInstructionModal(true);
    } else {
      setShowNewEnqueteModal(true);
    }
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

  const activeEnquetes = useMemo(() =>
    mergedFilteredEnquetes.filter(e => e.statut !== 'archive'),
    [mergedFilteredEnquetes]
  );

  // Organisation des enquêtes par section
  const enquetesByOrganization = useMemo(() => {
    const organized: { [section: string]: any[] } = {};
    const fallback: any[] = [];
    
    activeEnquetes.forEach(enquete => {
      const serviceTag = enquete.tags?.find(tag => tag.category === 'services');
      
      if (serviceTag) {
        // Chercher le tag central correspondant pour récupérer l'organization
        const centralTag = tags.find(t => t.value === serviceTag.value && t.category === 'services');
        
        if (centralTag?.organization?.section) {
          // Enquête organisée
          const section = centralTag.organization.section;
          if (!organized[section]) organized[section] = [];
          organized[section].push(enquete);
        } else {
          // Enquête non organisée → fallback
          fallback.push(enquete);
        }
      } else {
        // Enquête sans tag service → fallback
        fallback.push(enquete);
      }
    });
    
    // Toujours inclure la section fallback
    if (fallback.length > 0) {
      organized['AUTRES SERVICES'] = fallback;
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

  if (!isClient || tagsLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-lg">Chargement...</div>
      </div>
    );
  }

return (
    <div className="flex h-screen bg-gray-100">
      <div className="no-print">
        <SideBar 
          isOpen={sidebarOpen}
          currentView={currentView}
          onViewChange={handleViewChange}
          onNewEnquete={handleNewEnquete}
          alertCount={activeAlertsCount}
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
          />
        </div>

        {(currentView === 'enquetes' || currentView === 'instructions') && (
          <FilterBar
            selectedTags={selectedTags}
            onTagSelect={(tag) => setSelectedTags([...selectedTags, tag])}
            onTagRemove={(tagId) => setSelectedTags(selectedTags.filter(t => t.id !== tagId))}
            sortOrder={sortOrder}
            onSortChange={setSortOrder}
          />
        )}

        <main className="flex-1 overflow-auto p-6">
          {currentView === 'enquetes' && (
            <div className="space-y-6">
              <OPTimeline enquetes={activeEnquetes} />
              <TodoReminderBar
                enquetes={activeEnquetes}
                globalTodos={globalTodos}
                onUpdateEnquete={handleUpdateEnquete}
                onGlobalTodosChange={handleGlobalTodosChange}
              />
              {Object.entries(enquetesByOrganization)
                .sort(([a], [b]) => getSectionOrder(a) - getSectionOrder(b))
                .map(([section, sectionEnquetes]) => (
                  <div key={section} className="space-y-4">
                    <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
                      <div className="w-0.5 h-4 rounded-full bg-green-700/50 flex-shrink-0" />
                      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        {section}
                      </h2>
                      <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-bold leading-none">
                        {sectionEnquetes.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 justify-items-center">
                      {sectionEnquetes.map(enquete => (
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
                          onTogglePriority={() => {
                            const hasPriorityTag = enquete.tags.some(tag => 
                              tag.category === 'priorite' && tag.value === 'Prioritaire'
                            );

                            const newTags = hasPriorityTag
                              ? enquete.tags.filter(tag => !(tag.category === 'priorite' && tag.value === 'Prioritaire'))
                              : [...enquete.tags, { id: 'prioritaire', value: 'Prioritaire', category: 'priorite' }];

                            handleUpdateEnquete(enquete.id, { tags: newTags });
                          }}
                          onStartEnquete={handleStartEnquete}
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
                                                            'geolocalisations']?.map(a => 
                                a.id === acteId ? { ...a, statut: 'en_cours' } : a
                              )
                            });
                            showToast('Autorisation validée', 'success');
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ))
              }
            </div>
          )}

          {currentView === 'instructions' && (
            <InstructionsPage
              instructions={instructions}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              onUpdateInstruction={handleUpdateInstruction}
              onAddInstruction={handleAddInstruction}
              onDeleteInstruction={handleDeleteInstruction}
            />
          )}

          {currentView === 'archives' && (
            <ArchivePage
              enquetes={enquetes}
              searchTerm={searchTerm}
              onUpdateEnquete={handleUpdateEnquete}
              onDeleteEnquete={handleDeleteEnquete}
              onUnarchiveEnquete={handleUnarchiveEnquete}
              onAjoutCR={handleAjoutCR}
              onUpdateCR={handleUpdateCR}
              onDeleteCR={handleDeleteCR}
            />
          )}

          {currentView === 'permanence' && (
            <PermanencePage />
          )}

          {currentView === 'air' && (
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

          {currentView === 'tags' && (
            <TagManagementPage />
          )}

          {currentView === 'alertes' && (
            <AlertsPage
              rules={alertRules}
              onUpdateRule={handleUpdateAlertRule}
              onDuplicateRule={handleDuplicateRule}
              onDeleteRule={handleDeleteRule}
              onShowWeeklyPopup={() => setShowWeeklyPopup(true)}
            />
          )}

          {currentView === 'statistiques' && (
            <StatsPage enquetes={enquetes} />
          )}

          {currentView === 'sauvegardes' && (
            <SavePage
              onExport={handleExportData}
              onImport={handleImportData}
              onManualSave={handleManualSave}
              lastSaveDate={StorageManager.getLastSave()}
              onRepairServer={repairServer}
              isSyncing={isSyncing}
              syncStatus={syncStatus}
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
                      a.id === selectedActe.id ? { ...a, datePose: date, statut: 'en_cours' } : a
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
                    const dateFinCalculee = DateUtils.calculateActeEndDate(acte.datePose || acte.dateDebut, nouvelleDuree);

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
          />
        </>
      )}

      {/* 🆕 Modal de gestion des conflits de synchronisation */}
{showConflictModal && lastSyncResult && (
  <DataSyncConflictModal
    isOpen={showConflictModal}
    onClose={() => setShowConflictModal(false)}
    conflicts={conflicts}
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
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}