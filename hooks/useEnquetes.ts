// hooks/useEnquetes.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { Enquete, CompteRendu, NewEnqueteData } from '../types/interfaces';
import { ElectronBridge } from '../utils/electronBridge';
import { APP_CONFIG } from '../config/constants';
import { useAlerts } from './useAlerts';
import { AlertManager } from '../utils/alerts/alertManager';
import { ActeUtils } from '../utils/acteUtils';
import throttle from 'lodash/throttle';

// Constantes pour l'optimisation
const SAVE_THROTTLE = 2500; // 2.5 secondes de throttle

// Fonction pour migrer les enquêtes existantes qui n'ont pas de champ documents
const migrateEnqueteDocuments = (enquete: any): Enquete => {
  if (!enquete.documents || !Array.isArray(enquete.documents)) {
    enquete.documents = [];
  }
  if (!enquete.toDos || !Array.isArray(enquete.toDos)) {
    enquete.toDos = [];
  }
  return enquete as Enquete;
};

/**
 * Migration : recalcule dateFin pour les actes/écoutes/géolocs dont la durée
 * a été corrompue par le mélange d'unités jours/mois dans les prolongations.
 * Retourne true si au moins un acte a été corrigé.
 */
const migrateActeDateFin = (enquete: Enquete): boolean => {
  let modified = false;

  const fixActeArray = (actes: any[] | undefined): any[] | undefined => {
    if (!actes) return actes;
    return actes.map((acte: any) => {
      if (!acte.prolongationsHistory || acte.prolongationsHistory.length === 0) return acte;
      if (!acte.datePose && !acte.dateDebut) return acte;

      const dureeInitiale = acte.prolongationsHistory[0]?.dureeInitiale || acte.duree;
      const dureeInitialeUnit = acte.dureeUnit || 'jours';
      const dateReference = acte.datePose || acte.dateDebut;

      const correctDateFin = ActeUtils.replayDateFin(
        dateReference,
        dureeInitiale,
        dureeInitialeUnit,
        acte.prolongationsHistory.map((e: any) => ({
          dureeAjoutee: e.dureeAjoutee,
          dureeUnit: e.dureeUnit
        }))
      );

      if (correctDateFin && correctDateFin !== acte.dateFin) {
        console.log(`🔧 Migration dateFin: acte ${acte.id} (${acte.objet || acte.numero || acte.type || ''}) : ${acte.dateFin} → ${correctDateFin}`);
        modified = true;
        return { ...acte, dateFin: correctDateFin };
      }
      return acte;
    });
  };

  enquete.geolocalisations = fixActeArray(enquete.geolocalisations) as any;
  enquete.ecoutes = fixActeArray(enquete.ecoutes) as any;
  enquete.actes = fixActeArray(enquete.actes) as any;

  return modified;
};

export const useEnquetes = () => {
  const [enquetes, setEnquetes] = useState<Enquete[]>([]);
  const [selectedEnquete, setSelectedEnquete] = useState<Enquete | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingCR, setEditingCR] = useState<CompteRendu | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDataDirty, setIsDataDirty] = useState(false);
  
  // Référence pour éviter les re-renders
  const enquetesRef = useRef<Enquete[]>([]);
  const isInitialized = useRef(false);

  // Synchronisation ref -> state pour les événements asynchrones
  useEffect(() => {
    enquetesRef.current = enquetes;
  }, [enquetes]);

  // ✅ CORRECTION 1: Fonction de chargement stable avec useCallback vide
  const loadEnquetesData = useCallback(async () => {
    try {
      console.log('🔄 Chargement des enquêtes...');
      
      // ✅ Utiliser ElectronBridge qui gère le format {version, data} automatiquement
      const data = await ElectronBridge.getData<Enquete[]>(
        APP_CONFIG.STORAGE_KEYS.ENQUETES, 
        []
      );
      
      // Appliquer la migration et valider les données
      const validData = Array.isArray(data)
        ? data
          .filter(item => item.statut !== 'instruction')
          .map(migrateEnqueteDocuments)
        : [];

      // Si migration effectuée, sauvegarder immédiatement
      let needsMigration = Array.isArray(data) &&
        data.some(enquete => !enquete.documents || !Array.isArray(enquete.documents));

      if (needsMigration) {
        console.log('📦 Migration des documents des enquêtes effectuée');
      }

      // Migration dateFin : recalcule les dates corrompues par le mélange d'unités
      let dateFinMigrated = false;
      validData.forEach(enquete => {
        if (migrateActeDateFin(enquete)) {
          dateFinMigrated = true;
        }
      });
      if (dateFinMigrated) {
        console.log('📦 Migration dateFin des actes effectuée (correction mélange jours/mois)');
        needsMigration = true;
      }

      if (needsMigration) {
        await ElectronBridge.setData(APP_CONFIG.STORAGE_KEYS.ENQUETES, validData);
      }
      
      setEnquetes(validData);
      enquetesRef.current = validData;
      console.log('✅ Enquêtes chargées:', validData.length);
      
    } catch (error) {
      console.error('❌ Error loading enquetes:', error);
      setEnquetes([]);
      enquetesRef.current = [];
    }
  }, []); // ✅ Dépendances vides = fonction stable

  // ✅ CORRECTION 2: Chargement initial UNE SEULE FOIS
  useEffect(() => {
    if (isInitialized.current) return; // Éviter le double chargement en mode strict
    
    const initialize = async () => {
      setIsLoading(true);
      await loadEnquetesData();
      setIsLoading(false);
      isInitialized.current = true;
    };
    
    initialize();
  }, [loadEnquetesData]); // ✅ loadEnquetesData est stable

  // Sauvegarde avec throttle
  const saveEnquetes = useCallback(
    throttle(async () => {
      if (!isDataDirty || isLoading) return;
      
      try {
        await ElectronBridge.setData(
          APP_CONFIG.STORAGE_KEYS.ENQUETES, 
          enquetesRef.current
        );
        setIsDataDirty(false);
      } catch (error) {
        console.error('❌ Error saving enquetes:', error);
      }
    }, SAVE_THROTTLE),
    [isDataDirty, isLoading]
  );

  // Sauvegarde immédiate (bypass throttle) — utilisée par DataSyncManager avant la lecture
  const flushPendingSave = useCallback(async () => {
    if (!isDataDirty || isLoading) return;
    try {
      await ElectronBridge.setData(
        APP_CONFIG.STORAGE_KEYS.ENQUETES,
        enquetesRef.current
      );
      setIsDataDirty(false);
    } catch (error) {
      console.error('❌ Error during flush save:', error);
    }
  }, [isDataDirty, isLoading]);

  // Déclencher la sauvegarde quand les données changent
  useEffect(() => {
    if (isDataDirty && !isLoading) {
      saveEnquetes();
    }
    
    return () => {
      saveEnquetes.cancel();
      
      // Sauvegarde forcée lors du démontage du composant
      if (isDataDirty && !isLoading) {
        ElectronBridge.setData(
          APP_CONFIG.STORAGE_KEYS.ENQUETES, 
          enquetesRef.current
        ).catch(error => {
          console.error('❌ Error during final save:', error);
        });
      }
    };
  }, [saveEnquetes, isDataDirty, isLoading]);

  // ✅ CORRECTION 3: Utiliser le hook d'alertes APRÈS le chargement
  const {
    alerts,
    alertRules,
    updateAlerts,
    handleUpdateAlertRule,
    handleValidateAlert,
    handleSnoozeAlert,
    handleDuplicateRule,
    handleDeleteRule
  } = useAlerts(enquetes);

  // Fonction utilitaire pour mettre à jour les enquêtes avec un minimum de re-renders
  const updateEnquetesList = useCallback((updater: (prev: Enquete[]) => Enquete[]) => {
    setEnquetes(prev => {
      const updated = updater(prev);
      enquetesRef.current = updated;
      setIsDataDirty(true);
      return updated;
    });
  }, []);

  // Ajout d'un compte rendu
  const handleAjoutCR = useCallback((cr: Omit<CompteRendu, 'id'>) => {
    if (!selectedEnquete) return;

    const newCR = {
      ...cr,
      id: Date.now(),
    };

    const updatedEnquete = {
      ...selectedEnquete,
      comptesRendus: [newCR, ...selectedEnquete.comptesRendus],
      dateMiseAJour: new Date().toISOString()
    };

    updateEnquetesList(prev => 
      prev.map(e => e.id === selectedEnquete.id ? updatedEnquete : e)
    );
    
    setSelectedEnquete(updatedEnquete);
  }, [selectedEnquete, updateEnquetesList]);

  // Mise à jour d'une enquête
  const handleUpdateEnquete = useCallback((id: number, updates: Partial<Enquete>) => {
    updateEnquetesList(prev => 
      prev.map(enquete => 
        enquete.id === id
          ? { ...enquete, ...updates, dateMiseAJour: new Date().toISOString() }
          : enquete
      )
    );

    if (selectedEnquete?.id === id) {
      setSelectedEnquete(prev => 
        prev ? { ...prev, ...updates, dateMiseAJour: new Date().toISOString() } : null
      );
    }
  }, [updateEnquetesList, selectedEnquete]);

  // Ajout d'une nouvelle enquête avec documents vides par défaut
  const handleAddEnquete = useCallback((enqueteData: NewEnqueteData) => {
    const newEnquete: Enquete = {
      ...enqueteData,
      id: Date.now(),
      dateCreation: new Date().toISOString(),
      dateMiseAJour: new Date().toISOString(),
      statut: 'en_cours',
      comptesRendus: [],
      actes: [],
      ecoutes: [],
      geolocalisations: [],
      documents: []
    };

    updateEnquetesList(prev => [...prev, newEnquete]);
  }, [updateEnquetesList]);

  // Archivage d'une enquête
  const handleArchiveEnquete = useCallback((id: number) => {
    updateEnquetesList(prev => 
      prev.map(enquete =>
        enquete.id === id 
          ? { ...enquete, statut: 'archive', dateMiseAJour: new Date().toISOString() } 
          : enquete
      )
    );
  }, [updateEnquetesList]);

  // Suppression d'une enquête
  const handleDeleteEnquete = useCallback(async (id: number) => {
    updateEnquetesList(prev => prev.filter(enquete => enquete.id !== id));
    // Mémoriser l'ID supprimé (avec timestamp) pour que le sync ne le rajoute pas depuis le serveur
    try {
      const existing = await ElectronBridge.getData<Array<{ id: number; deletedAt: string } | number>>(
        'deleted_enquete_ids',
        []
      );
      const normalized = (Array.isArray(existing) ? existing : [])
        .map(e => (typeof e === 'number' ? { id: e, deletedAt: new Date(0).toISOString() } : e))
        .filter(e => e.id !== id); // éviter les doublons
      await ElectronBridge.setData('deleted_enquete_ids', [
        ...normalized,
        { id, deletedAt: new Date().toISOString() }
      ]);
    } catch (error) {
      console.error('❌ Erreur mémorisation ID supprimé:', error);
    }
  }, [updateEnquetesList]);

  // Désarchivage d'une enquête
  const handleUnarchiveEnquete = useCallback((id: number) => {
    updateEnquetesList(prev => 
      prev.map(enquete =>
        enquete.id === id && !enquete.dateAudience 
          ? { ...enquete, statut: 'en_cours', dateMiseAJour: new Date().toISOString() } 
          : enquete
      )
    );
  }, [updateEnquetesList]);

  // Démarrage d'une enquête
  const handleStartEnquete = useCallback((id: number, date: string) => {
    updateEnquetesList(prev => 
      prev.map(enquete => {
        if (enquete.id === id) {
          const newTags = enquete.tags.filter(tag => tag.value !== 'enquête à venir');
          return {
            ...enquete,
            dateDebut: date,
            tags: newTags,
            dateMiseAJour: new Date().toISOString()
          };
        }
        return enquete;
      })
    );
  }, [updateEnquetesList]);

  // Création d'une alerte d'audience
  const handleCreateAudienceAlert = useCallback((enqueteId: number, date: string) => {
    const alert = AlertManager.generateAlert(
      enqueteId,
      'audience',
      `Audience prévue le ${new Date(date).toLocaleDateString()}`,
      date
    );
    
    setTimeout(() => {
      updateAlerts();
    }, 500);
  }, [updateAlerts]);

  // Mise à jour d'un compte rendu
  const handleUpdateCR = useCallback((id: number, updates: Partial<CompteRendu>) => {
    if (!selectedEnquete) return;
    
    const updatedCRs = selectedEnquete.comptesRendus.map(cr =>
      cr.id === id ? { ...cr, ...updates } : cr
    );
    
    const updatedEnquete = {
      ...selectedEnquete,
      comptesRendus: updatedCRs,
      dateMiseAJour: new Date().toISOString()
    };
    
    updateEnquetesList(prev => 
      prev.map(e => e.id === selectedEnquete.id ? updatedEnquete : e)
    );
    
    setSelectedEnquete(updatedEnquete);
  }, [selectedEnquete, updateEnquetesList]);

  // Suppression d'un compte rendu
  const handleDeleteCR = useCallback((id: number) => {
    if (!selectedEnquete) return;
    
    const updatedCRs = selectedEnquete.comptesRendus.filter(cr => cr.id !== id);
    
    const updatedEnquete = {
      ...selectedEnquete,
      comptesRendus: updatedCRs,
      dateMiseAJour: new Date().toISOString()
    };
    
    updateEnquetesList(prev => 
      prev.map(e => e.id === selectedEnquete.id ? updatedEnquete : e)
    );
    
    setSelectedEnquete(updatedEnquete);
  }, [selectedEnquete, updateEnquetesList]);

  return {
    enquetes,
    selectedEnquete,
    isEditing,
    alerts,
    editingCR,
    alertRules,
    isLoading,
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
    handleValidateAlert,
    handleSnoozeAlert,
    handleUpdateAlertRule,
    handleDuplicateRule,
    handleDeleteRule,
    updateAlerts,
    handleCreateAudienceAlert,
    flushPendingSave
  };
};
