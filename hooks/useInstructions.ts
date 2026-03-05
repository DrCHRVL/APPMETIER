// hooks/useInstructions.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { EnqueteInstruction, CompteRendu } from '../types/interfaces';
import { ElectronBridge } from '../utils/electronBridge';
import { APP_CONFIG } from '../config/constants';
import { useInstructionAlerts } from './useInstructionAlerts';
import throttle from 'lodash/throttle';

// Constantes pour l'optimisation
const SAVE_DEBOUNCE = 2500; // 2.5 secondes de debounce

// Fonction pour migrer les instructions existantes
const migrateInstructionData = (instruction: any): EnqueteInstruction => {
  // Migration si nécessaire
  if (!instruction.dmls || !Array.isArray(instruction.dmls)) {
    instruction.dmls = [];
  }
  if (!instruction.debatsParquet || !Array.isArray(instruction.debatsParquet)) {
    instruction.debatsParquet = [];
  }
  if (!instruction.misEnExamen || !Array.isArray(instruction.misEnExamen)) {
    instruction.misEnExamen = [];
  }
  if (!instruction.ops || !Array.isArray(instruction.ops)) {
    instruction.ops = [];
  }
  if (typeof instruction.cotesTomes !== 'number') {
    instruction.cotesTomes = 0;
  }
  
  // Ajouter les getters pour les compteurs calculés
  return {
    ...instruction,
    get nbDML() { return this.dmls?.length || 0; },
    get nbCotes() { return this.cotesTomes || 0; },
    get nbDebatsParquet() { return this.debatsParquet?.length || 0; },
    get nbMisEnExamen() { return this.misEnExamen?.length || 0; },
    get nbPagesTotal() { 
      const rdPages = this.rdData?.nbPages || 0;
      const rapportPages = this.rapportAppel?.nbPages || 0;
      // Si les deux sont rendus, ne compter que le RD (règle métier)
      return this.rdData?.rendu && this.rapportAppel?.rendu ? rdPages : rdPages + rapportPages;
    }
  } as EnqueteInstruction;
};

export const useInstructions = () => {
  const [instructions, setInstructions] = useState<EnqueteInstruction[]>([]);
  const [selectedInstruction, setSelectedInstruction] = useState<EnqueteInstruction | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingCR, setEditingCR] = useState<CompteRendu | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDataDirty, setIsDataDirty] = useState(false);
  
  // Référence pour éviter les re-renders
  const instructionsRef = useRef<EnqueteInstruction[]>([]);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Utiliser le hook d'alertes spécialisé pour les instructions
  const {
    instructionAlerts,
    handleValidateInstructionAlert,
    handleSnoozeInstructionAlert,
    updateInstructionAlerts
  } = useInstructionAlerts(instructions);

  // Synchronisation ref -> state
  useEffect(() => {
    instructionsRef.current = instructions;
  }, [instructions]);

  // Chargement initial des données - CORRIGÉ
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        
        // 🆕 CHARGER DEPUIS LA CLÉ SÉPARÉE INSTRUCTIONS
        const instructionsData = await ElectronBridge.getData<EnqueteInstruction[]>(
          APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS, 
          []
        );
        
        console.log('📦 Instructions chargées:', instructionsData.length);
        
        // Migrer les données si nécessaire
        const migratedInstructions = Array.isArray(instructionsData) 
          ? instructionsData.map(migrateInstructionData)
          : [];
        
        setInstructions(migratedInstructions);
        instructionsRef.current = migratedInstructions;
      } catch (error) {
        console.error('Error loading instructions:', error);
        setInstructions([]);
        instructionsRef.current = [];
      } finally {
        setIsLoading(false);
      }
    };
    
    loadData();
  }, []);



  // Sauvegarde avec debounce - CORRIGÉ POUR CLÉ SÉPARÉE
  const saveInstructions = useCallback(
    throttle(async () => {
      if (!isDataDirty || isLoading) return;
      
      try {
        console.log('💾 Sauvegarde instructions:', instructionsRef.current.length);
        
        // 🆕 SAUVEGARDER DIRECTEMENT DANS LA CLÉ INSTRUCTIONS
        const success = await ElectronBridge.setData(
          APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS, 
          instructionsRef.current
        );
        
        if (success) {
          console.log('✅ Instructions sauvegardées avec succès');
          setIsDataDirty(false);
        } else {
          console.error('❌ Échec de la sauvegarde des instructions');
        }
      } catch (error) {
        console.error('Error saving instructions:', error);
      }
    }, SAVE_DEBOUNCE),
    [isDataDirty, isLoading]
  );

  // Déclencher la sauvegarde quand les données changent
  useEffect(() => {
    if (isDataDirty && !isLoading) {
      saveInstructions();
    }
    
    return () => {
      saveInstructions.cancel();
      
      // Sauvegarde forcée lors du démontage
      if (isDataDirty && !isLoading) {
        // Sauvegarde synchrone pour le démontage
        (async () => {
          try {
            await ElectronBridge.setData(
              APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS, 
              instructionsRef.current
            );
            console.log('🔄 Sauvegarde finale instructions OK');
          } catch (error) {
            console.error('Error during final save:', error);
          }
        })();
      }
    };
  }, [saveInstructions, isDataDirty, isLoading]);

  // Fonction utilitaire pour mettre à jour les instructions
  const updateInstructionsList = useCallback((updater: (prev: EnqueteInstruction[]) => EnqueteInstruction[]) => {
    setInstructions(prev => {
      const updated = updater(prev);
      instructionsRef.current = updated;
      setIsDataDirty(true);
      console.log('🔄 Instructions mises à jour:', updated.length);
      return updated;
    });
  }, []);

  // Ajout d'une nouvelle instruction - CORRIGÉ
  const handleAddInstruction = useCallback((instructionData: Omit<EnqueteInstruction, 'id' | 'dateCreation' | 'dateMiseAJour'>) => {
    const newInstruction: EnqueteInstruction = {
      ...instructionData, // ✅ Préserver TOUTES les données de NewInstructionModal
      // Seulement ajouter les champs manquants obligatoires
      id: Date.now(),
      dateCreation: new Date().toISOString(),
      dateMiseAJour: new Date().toISOString(),
      statut: 'instruction',
      
      // Ne remplir que si ces champs n'existent pas déjà dans instructionData
      comptesRendus: instructionData.comptesRendus || [],
      actes: instructionData.actes || [],
      ecoutes: instructionData.ecoutes || [],
      geolocalisations: instructionData.geolocalisations || [],
      documents: instructionData.documents || [],
      dmls: instructionData.dmls || [],
      ops: instructionData.ops || [],
      misEnExamen: instructionData.misEnExamen || [], // ✅ Préserver les mis en examen
      debatsParquet: instructionData.debatsParquet || [], // ✅ Préserver les débats
      cotesTomes: instructionData.cotesTomes || 0,
      etatReglement: instructionData.etatReglement || 'instruction',
      
      // Getters calculés
      get nbDML() { return this.dmls?.length || 0; },
      get nbCotes() { return this.cotesTomes || 0; },
      get nbDebatsParquet() { return this.debatsParquet?.length || 0; },
      get nbMisEnExamen() { return this.misEnExamen?.length || 0; },
      get nbPagesTotal() { 
        const rdPages = this.rdData?.nbPages || 0;
        const rapportPages = this.rapportAppel?.nbPages || 0;
        return this.rdData?.rendu && this.rapportAppel?.rendu ? rdPages : rdPages + rapportPages;
      }
    };

    console.log('🆕 Nouvelle instruction créée:', {
      id: newInstruction.id,
      numeroInstruction: newInstruction.numeroInstruction,
      misEnExamen: newInstruction.misEnExamen?.length || 0,
      debatsParquet: newInstruction.debatsParquet?.length || 0,
      dmls: newInstruction.dmls?.length || 0
    });

    updateInstructionsList(prev => [...prev, newInstruction]);
  }, [updateInstructionsList]);

  // Mise à jour d'une instruction
  const handleUpdateInstruction = useCallback((id: number, updates: Partial<EnqueteInstruction>) => {
    console.log('🔄 Mise à jour instruction ID:', id, 'Updates:', Object.keys(updates));
    
    updateInstructionsList(prev => 
      prev.map(instruction => 
        instruction.id === id
          ? { ...instruction, ...updates, dateMiseAJour: new Date().toISOString() }
          : instruction
      )
    );

    // Mettre à jour l'instruction sélectionnée si nécessaire
    if (selectedInstruction?.id === id) {
      setSelectedInstruction(prev => 
        prev ? { ...prev, ...updates, dateMiseAJour: new Date().toISOString() } : null
      );
    }
  }, [updateInstructionsList, selectedInstruction]);

  // Suppression d'une instruction
  const handleDeleteInstruction = useCallback((id: number) => {
    console.log('🗑️ Suppression instruction ID:', id);
    updateInstructionsList(prev => prev.filter(instruction => instruction.id !== id));
  }, [updateInstructionsList]);

  // Ajout d'un compte rendu
  const handleAjoutCR = useCallback((cr: Omit<CompteRendu, 'id'>) => {
    if (!selectedInstruction) return;

    const newCR = {
      ...cr,
      id: Date.now(),
    };

    const updatedInstruction = {
      ...selectedInstruction,
      comptesRendus: [newCR, ...selectedInstruction.comptesRendus],
      dateMiseAJour: new Date().toISOString()
    };

    updateInstructionsList(prev => 
      prev.map(i => i.id === selectedInstruction.id ? updatedInstruction : i)
    );
    
    setSelectedInstruction(updatedInstruction);
  }, [selectedInstruction, updateInstructionsList]);

  // Mise à jour d'un compte rendu
  const handleUpdateCR = useCallback((id: number, updates: Partial<CompteRendu>) => {
    if (!selectedInstruction) return;
    
    const updatedCRs = selectedInstruction.comptesRendus.map(cr =>
      cr.id === id ? { ...cr, ...updates } : cr
    );
    
    const updatedInstruction = {
      ...selectedInstruction,
      comptesRendus: updatedCRs,
      dateMiseAJour: new Date().toISOString()
    };
    
    updateInstructionsList(prev => 
      prev.map(i => i.id === selectedInstruction.id ? updatedInstruction : i)
    );
    
    setSelectedInstruction(updatedInstruction);
  }, [selectedInstruction, updateInstructionsList]);

  // Suppression d'un compte rendu
  const handleDeleteCR = useCallback((id: number) => {
    if (!selectedInstruction) return;
    
    const updatedCRs = selectedInstruction.comptesRendus.filter(cr => cr.id !== id);
    
    const updatedInstruction = {
      ...selectedInstruction,
      comptesRendus: updatedCRs,
      dateMiseAJour: new Date().toISOString()
    };
    
    updateInstructionsList(prev => 
      prev.map(i => i.id === selectedInstruction.id ? updatedInstruction : i)
    );
    
    setSelectedInstruction(updatedInstruction);
  }, [selectedInstruction, updateInstructionsList]);

  return {
    instructions,
    selectedInstruction,
    isEditing,
    editingCR,
    isLoading,
    instructionAlerts,
    setSelectedInstruction,
    setIsEditing,
    setEditingCR,
    handleAddInstruction,
    handleUpdateInstruction,
    handleDeleteInstruction,
    handleAjoutCR,
    handleUpdateCR,
    handleDeleteCR,
    handleValidateInstructionAlert,
    handleSnoozeInstructionAlert,
    updateInstructionAlerts
  };
};