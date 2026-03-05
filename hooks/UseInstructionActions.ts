import { useCallback, useRef } from 'react';
import { EnqueteInstruction, CompteRendu, MisEnExamen, DebatParquet } from '@/types/interfaces';
import { useToast } from '@/contexts/ToastContext';
import debounce from 'lodash/debounce';

interface ValidationRule {
  field: string;
  validator: (value: any, instruction: EnqueteInstruction) => string | null;
}

export const useInstructionActions = (
  instruction: EnqueteInstruction,
  onUpdate: (id: number, updates: Partial<EnqueteInstruction>) => void,
  setDirty: (isDirty: boolean) => void,
  setValidationError: (field: string, error: string) => void,
  clearValidationErrors: () => void,
  setLastSaved: (timestamp: string) => void
) => {
  const { showToast } = useToast();
  const saveTimeoutRef = useRef<NodeJS.Timeout>();

  // Règles de validation
  const validationRules: ValidationRule[] = [
    {
      field: 'numeroInstruction',
      validator: (value: string) => {
        if (!value?.trim()) return 'Numéro d\'instruction requis';
        return null;
      }
    },
    {
      field: 'misEnExamen',
      validator: (mexList: MisEnExamen[]) => {
        if (!mexList || mexList.length === 0) return null;
        
        // Vérifier les doublons de noms
        const noms = mexList.map(mex => mex.nom.toLowerCase().trim());
        const duplicates = noms.filter((nom, index) => noms.indexOf(nom) !== index);
        if (duplicates.length > 0) {
          return `Noms en doublon détectés: ${duplicates.join(', ')}`;
        }
        
        // Vérifier la cohérence des dates DP
        for (const mex of mexList) {
          if (mex.datePlacementDP && mex.dateFinDP) {
            const placementDate = new Date(mex.datePlacementDP);
            const finDate = new Date(mex.dateFinDP);
            if (placementDate >= finDate) {
              return `Date de placement DP incohérente pour ${mex.nom}`;
            }
          }
        }
        
        return null;
      }
    }
  ];

  // Fonction de validation
  const validateInstruction = useCallback((updates: Partial<EnqueteInstruction>) => {
    clearValidationErrors();
    const mergedInstruction = { ...instruction, ...updates };
    let hasErrors = false;

    for (const rule of validationRules) {
      const value = mergedInstruction[rule.field as keyof EnqueteInstruction];
      const error = rule.validator(value, mergedInstruction);
      if (error) {
        setValidationError(rule.field, error);
        hasErrors = true;
      }
    }

    return !hasErrors;
  }, [instruction, clearValidationErrors, setValidationError]);

  // Fonction de mise à jour avec debouncing et validation
  const debouncedUpdate = useCallback(
    debounce(async (id: number, updates: Partial<EnqueteInstruction>) => {
      try {
        onUpdate(id, {
          ...updates,
          dateMiseAJour: new Date().toISOString()
        });
        setLastSaved(new Date().toISOString());
        setDirty(false);
      } catch (error) {
        console.error('Erreur lors de la sauvegarde:', error);
        showToast('Erreur lors de la sauvegarde', 'error');
      }
    }, 1000),
    [onUpdate, setLastSaved, setDirty, showToast]
  );

  // Mise à jour immédiate (pour les boutons)
  const updateImmediately = useCallback((id: number, updates: Partial<EnqueteInstruction>) => {
    if (!validateInstruction(updates)) {
      showToast('Erreur de validation', 'error');
      return false;
    }

    try {
      onUpdate(id, {
        ...updates,
        dateMiseAJour: new Date().toISOString()
      });
      setLastSaved(new Date().toISOString());
      setDirty(false);
      showToast('Modifications enregistrées', 'success');
      return true;
    } catch (error) {
      console.error('Erreur lors de la sauvegarde:', error);
      showToast('Erreur lors de la sauvegarde', 'error');
      return false;
    }
  }, [validateInstruction, onUpdate, setLastSaved, setDirty, showToast]);

  // Mise à jour avec debouncing (pour les champs texte)
  const updateWithDebounce = useCallback((id: number, updates: Partial<EnqueteInstruction>) => {
    if (!validateInstruction(updates)) {
      return false;
    }

    setDirty(true);
    debouncedUpdate(id, updates);
    return true;
  }, [validateInstruction, setDirty, debouncedUpdate]);

  // Actions spécifiques pour les mis en examen
  const mexActions = {
    add: useCallback((mexData: Omit<MisEnExamen, 'id'>) => {
      const newMex: MisEnExamen = {
        ...mexData,
        id: Date.now()
      };

      const updatedMex = [...(instruction.misEnExamen || []), newMex];
      
      // Si détenu, créer automatiquement un débat parquet
      let updates: Partial<EnqueteInstruction> = { misEnExamen: updatedMex };
      
      if (mexData.statut === 'detenu' && mexData.datePlacementDP) {
        const newDebat: DebatParquet = {
          id: Date.now() + 1,
          date: mexData.datePlacementDP,
          type: 'placement_dp',
          issue: 'Accordé',
          notes: `Placement DP automatique - ${mexData.nom}`,
          concernedDetenu: newMex.id,
          sourceType: 'manual'
        };
        
        updates.debatsParquet = [...(instruction.debatsParquet || []), newDebat];
        
        // Ajouter l'historique au mis en examen
        newMex.debatsHistory = [{
          debatId: newDebat.id,
          type: 'placement_dp',
          date: mexData.datePlacementDP,
          decision: 'Accordé'
        }];
      }

      const success = updateImmediately(instruction.id, updates);
      if (success) {
        showToast(
          mexData.statut === 'detenu' 
            ? 'Mis en examen ajouté avec débat parquet automatique' 
            : 'Mis en examen ajouté',
          'success'
        );
      }
      return success;
    }, [instruction, updateImmediately, showToast]),

    update: useCallback((mexId: number, mexUpdates: Partial<MisEnExamen>) => {
      const updatedMex = instruction.misEnExamen?.map(mex =>
        mex.id === mexId ? { ...mex, ...mexUpdates } : mex
      );
      
      return updateImmediately(instruction.id, { misEnExamen: updatedMex });
    }, [instruction, updateImmediately]),

    delete: useCallback((mexId: number) => {
      const updatedMex = instruction.misEnExamen?.filter(mex => mex.id !== mexId);
      const success = updateImmediately(instruction.id, { misEnExamen: updatedMex });
      if (success) {
        showToast('Mis en examen supprimé', 'success');
      }
      return success;
    }, [instruction, updateImmediately, showToast])
  };

  // Actions pour les comptes rendus
  const crActions = {
    add: useCallback((cr: Omit<CompteRendu, 'id'>) => {
      const newCR = { ...cr, id: Date.now() };
      const updatedCRs = [newCR, ...(instruction.comptesRendus || [])];
      
      const success = updateImmediately(instruction.id, { comptesRendus: updatedCRs });
      if (success) {
        showToast('Compte rendu ajouté', 'success');
      }
      return success;
    }, [instruction, updateImmediately, showToast]),

    update: useCallback((crId: number, crUpdates: Partial<CompteRendu>) => {
      const updatedCRs = instruction.comptesRendus?.map(cr =>
        cr.id === crId ? { ...cr, ...crUpdates } : cr
      );
      
      return updateWithDebounce(instruction.id, { comptesRendus: updatedCRs });
    }, [instruction, updateWithDebounce]),

    delete: useCallback((crId: number) => {
      const updatedCRs = instruction.comptesRendus?.filter(cr => cr.id !== crId);
      const success = updateImmediately(instruction.id, { comptesRendus: updatedCRs });
      if (success) {
        showToast('Compte rendu supprimé', 'success');
      }
      return success;
    }, [instruction, updateImmediately, showToast])
  };

  // Fonction pour calculer l'urgence des échéances DP
  const getUrgencyLevel = useCallback((dateFinDP: string) => {
    const today = new Date();
    const finDate = new Date(dateFinDP);
    const diffDays = Math.ceil((finDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return 'expired'; // Rouge foncé
    if (diffDays <= 7) return 'critical'; // Orange
    if (diffDays <= 30) return 'warning'; // Jaune
    return 'normal'; // Vert/gris
  }, []);

  // Nettoyage du debounce
  const cleanup = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    debouncedUpdate.cancel();
  }, [debouncedUpdate]);

  return {
    // Actions principales
    updateImmediately,
    updateWithDebounce,
    
    // Actions spécialisées
    mexActions,
    crActions,
    
    // Utilitaires
    validateInstruction,
    getUrgencyLevel,
    cleanup
  };
};