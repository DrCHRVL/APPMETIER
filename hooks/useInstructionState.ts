import { useState, useCallback, useReducer } from 'react';
import { EnqueteInstruction, CompteRendu, MisEnExamen } from '@/types/interfaces';

// Types pour le reducer
type InstructionState = {
  isDirty: boolean;
  lastSaved: string;
  editingMexId: number | null;
  validationErrors: Record<string, string>;
};

type InstructionAction = 
  | { type: 'SET_DIRTY', isDirty: boolean }
  | { type: 'SET_LAST_SAVED', timestamp: string }
  | { type: 'SET_EDITING_MEX', mexId: number | null }
  | { type: 'SET_VALIDATION_ERROR', field: string, error: string }
  | { type: 'CLEAR_VALIDATION_ERRORS' }
  | { type: 'RESET_STATE' };

const initialState: InstructionState = {
  isDirty: false,
  lastSaved: '',
  editingMexId: null,
  validationErrors: {}
};

function instructionStateReducer(state: InstructionState, action: InstructionAction): InstructionState {
  switch (action.type) {
    case 'SET_DIRTY':
      return { ...state, isDirty: action.isDirty };
    case 'SET_LAST_SAVED':
      return { ...state, lastSaved: action.timestamp, isDirty: false };
    case 'SET_EDITING_MEX':
      return { ...state, editingMexId: action.mexId };
    case 'SET_VALIDATION_ERROR':
      return { 
        ...state, 
        validationErrors: { ...state.validationErrors, [action.field]: action.error }
      };
    case 'CLEAR_VALIDATION_ERRORS':
      return { ...state, validationErrors: {} };
    case 'RESET_STATE':
      return initialState;
    default:
      return state;
  }
}

export const useInstructionState = (instruction: EnqueteInstruction) => {
  const [state, dispatch] = useReducer(instructionStateReducer, initialState);
  
  // États des modals
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDMLModal, setShowDMLModal] = useState(false);
  const [showDebatModal, setShowDebatModal] = useState(false);
  const [showAddMexModal, setShowAddMexModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'mesures' | 'documents'>('general');
  const [debatType, setDebatType] = useState<'placement_dp' | 'prolongation_dp'>('placement_dp');
  
  // États pour l'édition des CR
  const [editingCR, setEditingCR] = useState<CompteRendu | null>(null);
  
  // Formulaire mis en examen en cours d'édition
  const [editingMexData, setEditingMexData] = useState({
    nom: '',
    dateExamen: '',
    infractions: '',
    statut: 'libre' as 'libre' | 'cj' | 'detenu' | 'arse',
    description: '',
    datePlacementDP: '',
    dureeDP: 1
  });

  // Formulaire nouveau mis en examen
  const [mexFormData, setMexFormData] = useState({
    nom: '',
    dateExamen: new Date().toISOString().split('T')[0],
    infractions: '',
    statut: 'libre' as 'libre' | 'cj' | 'detenu' | 'arse',
    description: '',
    datePlacementDP: '',
    dureeDP: 1
  });

  // État local synchronisé avec les props
  const [localInstruction, setLocalInstruction] = useState<EnqueteInstruction>(instruction);
  const [refreshKey, setRefreshKey] = useState(0);

  // Actions du reducer
  const setDirty = useCallback((isDirty: boolean) => {
    dispatch({ type: 'SET_DIRTY', isDirty });
  }, []);

  const setLastSaved = useCallback((timestamp: string) => {
    dispatch({ type: 'SET_LAST_SAVED', timestamp });
  }, []);

  const setEditingMexId = useCallback((mexId: number | null) => {
    dispatch({ type: 'SET_EDITING_MEX', mexId });
  }, []);

  const setValidationError = useCallback((field: string, error: string) => {
    dispatch({ type: 'SET_VALIDATION_ERROR', field, error });
  }, []);

  const clearValidationErrors = useCallback(() => {
    dispatch({ type: 'CLEAR_VALIDATION_ERRORS' });
  }, []);

  const resetState = useCallback(() => {
    dispatch({ type: 'RESET_STATE' });
    setEditingCR(null);
    setEditingMexData({
      nom: '',
      dateExamen: '',
      infractions: '',
      statut: 'libre',
      description: '',
      datePlacementDP: '',
      dureeDP: 1
    });
    setMexFormData({
      nom: '',
      dateExamen: new Date().toISOString().split('T')[0],
      infractions: '',
      statut: 'libre',
      description: '',
      datePlacementDP: '',
      dureeDP: 1
    });
  }, []);

  // Fonction pour forcer le re-render
  const forceRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  // Synchronisation avec les props
  const syncWithProps = useCallback((newInstruction: EnqueteInstruction) => {
    setLocalInstruction(newInstruction);
    forceRefresh();
  }, [forceRefresh]);

  // Reset du formulaire d'ajout de mis en examen
  const resetMexForm = useCallback(() => {
    setMexFormData({
      nom: '',
      dateExamen: new Date().toISOString().split('T')[0],
      infractions: '',
      statut: 'libre',
      description: '',
      datePlacementDP: '',
      dureeDP: 1
    });
  }, []);

  return {
    // État du reducer
    ...state,
    
    // États des modals
    modals: {
      showDeleteModal,
      setShowDeleteModal,
      showDMLModal,
      setShowDMLModal,
      showDebatModal,
      setShowDebatModal,
      showAddMexModal,
      setShowAddMexModal
    },
    
    // Navigation
    activeTab,
    setActiveTab,
    debatType,
    setDebatType,
    
    // Édition
    editingCR,
    setEditingCR,
    editingMexData,
    setEditingMexData,
    mexFormData,
    setMexFormData,
    
    // Instruction locale
    localInstruction,
    setLocalInstruction,
    refreshKey,
    
    // Actions
    setDirty,
    setLastSaved,
    setEditingMexId,
    setValidationError,
    clearValidationErrors,
    resetState,
    forceRefresh,
    syncWithProps,
    resetMexForm
  };
};