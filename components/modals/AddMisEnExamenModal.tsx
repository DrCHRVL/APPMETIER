import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { AlertTriangle, Gavel } from 'lucide-react';
import { MisEnExamen } from '@/types/interfaces';

interface AddMisEnExamenModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (mexData: Omit<MisEnExamen, 'id'>) => boolean;
  existingNames?: string[]; // Pour vérifier les doublons
}

interface FormData {
  nom: string;
  dateExamen: string;
  infractions: string;
  statut: 'libre' | 'cj' | 'detenu' | 'arse';
  description: string;
  datePlacementDP: string;
  dureeDP: number;
}

export const AddMisEnExamenModal = ({ 
  isOpen, 
  onClose, 
  onConfirm,
  existingNames = []
}: AddMisEnExamenModalProps) => {
  const [formData, setFormData] = useState<FormData>({
    nom: '',
    dateExamen: new Date().toISOString().split('T')[0],
    infractions: '',
    statut: 'libre',
    description: '',
    datePlacementDP: '',
    dureeDP: 1
  });

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset du formulaire à l'ouverture
  useEffect(() => {
    if (isOpen) {
      setFormData({
        nom: '',
        dateExamen: new Date().toISOString().split('T')[0],
        infractions: '',
        statut: 'libre',
        description: '',
        datePlacementDP: '',
        dureeDP: 1
      });
      setValidationErrors({});
    }
  }, [isOpen]);

  // Validation en temps réel
  const validateField = (field: keyof FormData, value: any) => {
    const errors: Record<string, string> = {};

    switch (field) {
      case 'nom':
        if (!value?.trim()) {
          errors.nom = 'Nom requis';
        } else if (existingNames.some(name => 
          name.toLowerCase().trim() === value.toLowerCase().trim()
        )) {
          errors.nom = 'Ce nom existe déjà';
        }
        break;
        
      case 'infractions':
        if (!value?.trim()) {
          errors.infractions = 'Au moins une infraction requise';
        }
        break;
        
      case 'datePlacementDP':
        if (formData.statut === 'detenu' && !value) {
          errors.datePlacementDP = 'Date de placement DP requise pour un détenu';
        } else if (value && new Date(value) > new Date()) {
          errors.datePlacementDP = 'La date ne peut pas être dans le futur';
        }
        break;
        
      case 'dateExamen':
        if (!value) {
          errors.dateExamen = 'Date de mise en examen requise';
        } else if (new Date(value) > new Date()) {
          errors.dateExamen = 'La date ne peut pas être dans le futur';
        }
        break;
    }

    setValidationErrors(prev => ({
      ...prev,
      ...errors,
      // Nettoyer l'erreur si elle est résolue
      ...(Object.keys(errors).length === 0 && prev[field] ? { [field]: undefined } : {})
    }));

    return Object.keys(errors).length === 0;
  };

  const handleFieldChange = (field: keyof FormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Validation immédiate
    setTimeout(() => validateField(field, value), 100);
    
    // Si on change le statut vers non-détenu, nettoyer les champs DP
    if (field === 'statut' && value !== 'detenu') {
      setFormData(prev => ({ 
        ...prev, 
        datePlacementDP: '', 
        dureeDP: 1 
      }));
      setValidationErrors(prev => ({
        ...prev,
        datePlacementDP: undefined
      }));
    }
  };

  // Calcul automatique de l'échéance DP
  const calculateEcheanceDP = () => {
    if (formData.datePlacementDP && formData.dureeDP) {
      const date = new Date(formData.datePlacementDP);
      date.setMonth(date.getMonth() + formData.dureeDP);
      return date.toLocaleDateString();
    }
    return null;
  };

  // Validation complète du formulaire
  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!formData.nom.trim()) errors.nom = 'Nom requis';
    if (!formData.infractions.trim()) errors.infractions = 'Infractions requises';
    if (!formData.dateExamen) errors.dateExamen = 'Date de mise en examen requise';
    
    if (formData.statut === 'detenu') {
      if (!formData.datePlacementDP) errors.datePlacementDP = 'Date de placement DP requise';
      if (!formData.dureeDP || formData.dureeDP < 1) errors.dureeDP = 'Durée DP invalide';
    }

    // Vérifier les doublons
    if (existingNames.some(name => 
      name.toLowerCase().trim() === formData.nom.toLowerCase().trim()
    )) {
      errors.nom = 'Ce nom existe déjà';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    
    try {
      const mexData: Omit<MisEnExamen, 'id'> = {
        nom: formData.nom.trim(),
        dateExamen: formData.dateExamen,
        chefs: formData.infractions.split(',').map(inf => inf.trim()).filter(Boolean),
        role: formData.statut === 'detenu' ? 'detenu' : 'libre',
        statut: formData.statut,
        description: formData.description.trim() || undefined,
        datePlacementDP: formData.statut === 'detenu' ? formData.datePlacementDP : undefined,
        dureeInitialeDP: formData.statut === 'detenu' ? formData.dureeDP : undefined,
        dateFinDP: formData.statut === 'detenu' && formData.datePlacementDP ? (() => {
          const date = new Date(formData.datePlacementDP);
          date.setMonth(date.getMonth() + formData.dureeDP);
          return date.toISOString().split('T')[0];
        })() : undefined
      };

      const success = onConfirm(mexData);
      if (success) {
        onClose();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const echeanceDP = calculateEcheanceDP();
  const hasErrors = Object.values(validationErrors).some(error => !!error);
  const isFormValid = formData.nom.trim() && formData.infractions.trim() && !hasErrors;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="h-5 w-5" />
            Ajouter un mis en examen
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 p-1">
          {/* Informations de base */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Nom et prénom *</label>
              <Input
                value={formData.nom}
                onChange={(e) => handleFieldChange('nom', e.target.value)}
                placeholder="Nom complet"
                className={`mt-1 ${validationErrors.nom ? 'border-red-500' : ''}`}
                autoFocus
              />
              {validationErrors.nom && (
                <p className="text-red-500 text-xs mt-1">{validationErrors.nom}</p>
              )}
            </div>
            
            <div>
              <label className="text-sm font-medium text-gray-700">Date de mise en examen *</label>
              <Input
                type="date"
                value={formData.dateExamen}
                onChange={(e) => handleFieldChange('dateExamen', e.target.value)}
                className={`mt-1 ${validationErrors.dateExamen ? 'border-red-500' : ''}`}
              />
              {validationErrors.dateExamen && (
                <p className="text-red-500 text-xs mt-1">{validationErrors.dateExamen}</p>
              )}
            </div>
          </div>

          {/* Infractions et statut */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Infractions ciblées *</label>
              <Input
                value={formData.infractions}
                onChange={(e) => handleFieldChange('infractions', e.target.value)}
                placeholder="Ex: Trafic de stupéfiants, Vol..."
                className={`mt-1 ${validationErrors.infractions ? 'border-red-500' : ''}`}
              />
              {validationErrors.infractions && (
                <p className="text-red-500 text-xs mt-1">{validationErrors.infractions}</p>
              )}
              <p className="text-xs text-gray-500 mt-1">Séparer par des virgules</p>
            </div>
            
            <div>
              <label className="text-sm font-medium text-gray-700">Statut *</label>
              <Select
                value={formData.statut}
                onChange={(e) => handleFieldChange('statut', e.target.value as any)}
                className="mt-1"
              >
                <option value="libre">Libre</option>
                <option value="cj">Contrôle judiciaire</option>
                <option value="detenu">Détenu</option>
                <option value="arse">ARSE</option>
              </Select>
            </div>
          </div>

          {/* Description optionnelle */}
          <div>
            <label className="text-sm font-medium text-gray-700">Observations (optionnel)</label>
            <Input
              value={formData.description}
              onChange={(e) => handleFieldChange('description', e.target.value)}
              placeholder="Observations particulières..."
              className="mt-1"
            />
          </div>

          {/* Section DP si détenu */}
          {formData.statut === 'detenu' && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-orange-600" />
                <h4 className="text-sm font-medium text-orange-900">Détention provisoire</h4>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-orange-800">Date de placement DP *</label>
                  <Input
                    type="date"
                    value={formData.datePlacementDP}
                    onChange={(e) => handleFieldChange('datePlacementDP', e.target.value)}
                    className={`mt-1 ${validationErrors.datePlacementDP ? 'border-red-500' : ''}`}
                  />
                  {validationErrors.datePlacementDP && (
                    <p className="text-red-500 text-xs mt-1">{validationErrors.datePlacementDP}</p>
                  )}
                </div>
                
                <div>
                  <label className="text-sm font-medium text-orange-800">Durée DP (mois) *</label>
                  <Select
                    value={formData.dureeDP.toString()}
                    onChange={(e) => handleFieldChange('dureeDP', parseInt(e.target.value) || 1)}
                    className="mt-1"
                  >
                    <option value="1">1 mois</option>
                    <option value="2">2 mois</option>
                    <option value="3">3 mois</option>
                    <option value="4">4 mois</option>
                    <option value="6">6 mois</option>
                    <option value="12">12 mois</option>
                    <option value="24">24 mois</option>
                  </Select>
                </div>
              </div>
              
              {/* Calcul automatique de l'échéance */}
              {echeanceDP && (
                <div className="mt-3 p-2 bg-orange-100 border border-orange-300 rounded">
                  <p className="text-sm text-orange-800">
                    <strong>Échéance DP calculée:</strong> {echeanceDP}
                  </p>
                </div>
              )}
              
              <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded flex items-start gap-2">
                <Gavel className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-800">
                  <strong>Information:</strong> Ce placement en détention provisoire générera automatiquement 
                  un débat parquet dans le dossier.
                </p>
              </div>
            </div>
          )}

          {/* Boutons */}
          <div className="flex gap-3 pt-4 border-t">
            <Button 
              onClick={handleSubmit}
              className="flex-1"
              disabled={!isFormValid || isSubmitting}
            >
              {isSubmitting ? 'Ajout en cours...' : 'Ajouter le mis en examen'}
            </Button>
            <Button 
              variant="outline" 
              onClick={onClose}
              disabled={isSubmitting}
              className="px-6"
            >
              Annuler
            </Button>
          </div>
          
          {/* Résumé des erreurs */}
          {hasErrors && (
            <div className="bg-red-50 border border-red-200 rounded p-3">
              <p className="text-sm text-red-800 font-medium mb-1">Erreurs à corriger :</p>
              <ul className="text-xs text-red-700 space-y-1">
                {Object.entries(validationErrors)
                  .filter(([_, error]) => !!error)
                  .map(([field, error]) => (
                    <li key={field}>• {error}</li>
                  ))
                }
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};