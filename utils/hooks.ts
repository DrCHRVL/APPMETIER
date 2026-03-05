import { useState, useEffect, useCallback } from 'react';
import { Enquete, CompteRendu, NewEnqueteData, AlertRule } from '../types/interfaces';
import { StorageManager } from './storage';
import { APP_CONFIG } from '../config/constants';
import { useAlerts } from './alerts/alertHooks';
import { createAudienceAlert } from './alertUtils';

export const useEnquetes = () => {
  const [enquetes, setEnquetes] = useState<Enquete[]>(() => 
    StorageManager.get(APP_CONFIG.STORAGE_KEYS.ENQUETES, [])
  );

  const [selectedEnquete, setSelectedEnquete] = useState<Enquete | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingCR, setEditingCR] = useState<CompteRendu | null>(null);

  const {
    alerts,
    alertRules,
    updateAlerts,
    handleUpdateAlertRule,
    handleValidateAlert,
    handleDuplicateRule,
    handleDeleteRule
  } = useAlerts(enquetes);

  const handleAjoutCR = useCallback((cr: Omit<CompteRendu, 'id'>) => {
    if (!selectedEnquete) return;

    const newCR = {
      ...cr,
      id: Date.now(),
    };

    const updatedEnquete = {
      ...selectedEnquete,
      comptesRendus: [newCR, ...selectedEnquete.comptesRendus]
    };

    setSelectedEnquete(updatedEnquete);
    setEnquetes(prev => prev.map(e => 
      e.id === selectedEnquete.id ? updatedEnquete : e
    ));
  }, [selectedEnquete]);

  const handleUpdateEnquete = useCallback((id: number, updates: Partial<Enquete>) => {
    setEnquetes(prev => prev.map(enquete => 
      enquete.id === id
        ? { ...enquete, ...updates, dateMiseAJour: new Date().toISOString() }
        : enquete
    ));

    if (selectedEnquete?.id === id) {
      setSelectedEnquete(prev => prev ? { ...prev, ...updates } : null);
    }
  }, [selectedEnquete]);

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
      geolocalisations: []
    };

    setEnquetes(prev => [...prev, newEnquete]);
  }, []);

  const handleArchiveEnquete = useCallback((id: number) => {
    setEnquetes(prev => prev.map(enquete =>
      enquete.id === id ? {
        ...enquete,
        statut: 'archive'
      } : enquete
    ));
  }, []);

  const handleDeleteEnquete = useCallback((id: number) => {
    setEnquetes(prev => prev.filter(enquete => enquete.id !== id));
  }, []);

  const handleUnarchiveEnquete = useCallback((id: number) => {
    setEnquetes(prev => prev.map(enquete =>
      enquete.id === id && !enquete.dateAudience ? { ...enquete, statut: 'en_cours' } : enquete
    ));
  }, []);

  const handleStartEnquete = useCallback((id: number, date: string) => {
    setEnquetes(prev => prev.map(enquete => {
      if (enquete.id === id) {
        const newTags = enquete.tags.filter(tag => tag.value !== 'enquête à venir');
        return {
          ...enquete,
          dateDebut: date,
          tags: newTags
        };
      }
      return enquete;
    }));
  }, []);

  const handleCreateAudienceAlert = useCallback((enqueteId: number, date: string) => {
    const alert = createAudienceAlert(enqueteId, date);
    updateAlerts(prev => [...prev, alert]);
  }, [updateAlerts]);

  useEffect(() => {
    StorageManager.set(APP_CONFIG.STORAGE_KEYS.ENQUETES, enquetes);
  }, [enquetes]);

  useEffect(() => {
    updateAlerts();
    const interval = setInterval(() => updateAlerts(), APP_CONFIG.ALERT_CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [updateAlerts]);

  return {
    enquetes,
    selectedEnquete,
    isEditing,
    alerts,
    editingCR,
    alertRules,
    setSelectedEnquete,
    setIsEditing,
    setEditingCR,
    handleAjoutCR,
    handleUpdateEnquete,
    handleAddEnquete,
    handleArchiveEnquete,
    handleDeleteEnquete,
    handleUnarchiveEnquete,
    handleStartEnquete,
    handleValidateAlert,
    handleUpdateAlertRule,
    handleDuplicateRule,
    handleDeleteRule,
    updateAlerts,
    handleCreateAudienceAlert
  };
};