// components/modals/JLDEcoutesCreationModal.tsx

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';
import { Badge } from '../ui/badge';
import { 
  FileText, 
  Phone, 
  Calendar, 
  Users, 
  Edit3, 
  CheckCircle, 
  AlertTriangle,
  Info
} from 'lucide-react';
import { JLDAnalysisResult, JLDPhoneNumber } from '@/utils/documents/JLDOrderAnalyzer';
import { EcouteData } from '@/types/interfaces';
import { useToast } from '@/contexts/ToastContext';

interface EditableEcoute extends JLDPhoneNumber {
  id: string;
  selected: boolean;
  dateDebut: string;
  duree: string;
  datePose: string;
}

interface JLDEcoutesCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateEcoutes: (ecoutes: Partial<EcouteData>[]) => void;
  analysisResult: JLDAnalysisResult;
  fileName: string;
}

export const JLDEcoutesCreationModal = ({
  isOpen,
  onClose,
  onCreateEcoutes,
  analysisResult,
  fileName
}: JLDEcoutesCreationModalProps) => {
  
  const [editableEcoutes, setEditableEcoutes] = useState<EditableEcoute[]>([]);
  const [globalDateDebut, setGlobalDateDebut] = useState('');
  const [globalDuree, setGlobalDuree] = useState('30');
  const [globalDatePose, setGlobalDatePose] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const { showToast } = useToast();

  // Initialiser les données quand le modal s'ouvre
  useEffect(() => {
    if (isOpen && analysisResult.phoneNumbers.length > 0) {
      const initialEcoutes: EditableEcoute[] = analysisResult.phoneNumbers.map((phone, index) => ({
        ...phone,
        id: `ecoute-${index}`,
        selected: true,
        dateDebut: analysisResult.signatureDate,
        duree: analysisResult.duration,
        datePose: analysisResult.signatureDate
      }));
      
      setEditableEcoutes(initialEcoutes);
      setGlobalDateDebut(analysisResult.signatureDate);
      setGlobalDuree(analysisResult.duration);
      setGlobalDatePose(analysisResult.signatureDate);
      setErrors({});
    }
  }, [isOpen, analysisResult]);

  // Appliquer la configuration globale à toutes les écoutes sélectionnées
  const applyGlobalConfig = () => {
    setEditableEcoutes(prev => 
      prev.map(ecoute => 
        ecoute.selected 
          ? {
              ...ecoute,
              dateDebut: globalDateDebut,
              duree: globalDuree,
              datePose: globalDatePose
            }
          : ecoute
      )
    );
  };

  // Mettre à jour une écoute individuelle
  const updateEcoute = (id: string, field: keyof EditableEcoute, value: string | boolean) => {
    setEditableEcoutes(prev =>
      prev.map(ecoute =>
        ecoute.id === id ? { ...ecoute, [field]: value } : ecoute
      )
    );
  };

  // Validation du formulaire
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    const selectedEcoutes = editableEcoutes.filter(e => e.selected);
    
    if (selectedEcoutes.length === 0) {
      newErrors.general = 'Veuillez sélectionner au moins une écoute à créer';
    }
    
    // Vérifier les doublons de numéros
    const numbers = selectedEcoutes.map(e => e.lastFourDigits);
    const duplicates = numbers.filter((num, index) => numbers.indexOf(num) !== index);
    if (duplicates.length > 0) {
      newErrors.general = `Numéros en double: ${duplicates.join(', ')}`;
    }
    
    // Validation des champs individuels
    selectedEcoutes.forEach(ecoute => {
      if (!ecoute.lastFourDigits.trim()) {
        newErrors[`numero-${ecoute.id}`] = 'Numéro requis';
      }
      if (!ecoute.user.trim()) {
        newErrors[`user-${ecoute.id}`] = 'Utilisateur requis';
      }
      if (!ecoute.dateDebut) {
        newErrors[`date-${ecoute.id}`] = 'Date requise';
      }
      if (!ecoute.duree || parseInt(ecoute.duree) <= 0) {
        newErrors[`duree-${ecoute.id}`] = 'Durée invalide';
      }
    });
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Créer les écoutes
  const handleCreateEcoutes = () => {
    if (!validateForm()) {
      showToast('Veuillez corriger les erreurs avant de continuer', 'error');
      return;
    }
    
    const selectedEcoutes = editableEcoutes.filter(e => e.selected);
    
    const ecoutesToCreate: Partial<EcouteData>[] = selectedEcoutes.map(ecoute => ({
      numero: ecoute.lastFourDigits,
      cible: ecoute.user,
      description: `Ligne ${ecoute.fullNumber}\n${ecoute.usageType} ${ecoute.user}\nAutorisation JLD du ${formatDate(ecoute.dateDebut)}`,
      dateDebut: ecoute.dateDebut,
      dateFin: calculateEndDate(ecoute.datePose || ecoute.dateDebut, ecoute.duree),
      duree: ecoute.duree,
      datePose: ecoute.datePose || ecoute.dateDebut,
      statut: 'en_cours'
    }));
    
    onCreateEcoutes(ecoutesToCreate);
    showToast(`${ecoutesToCreate.length} écoute(s) créée(s) avec succès`, 'success');
    onClose();
  };

  // Calculer la date de fin
  const calculateEndDate = (startDate: string, duration: string): string => {
    const start = new Date(startDate);
    const end = new Date(start);
    end.setDate(end.getDate() + parseInt(duration));
    return end.toISOString().split('T')[0];
  };

  // Formater la date pour l'affichage
  const formatDate = (dateStr: string): string => {
    try {
      return new Date(dateStr).toLocaleDateString('fr-FR');
    } catch {
      return dateStr;
    }
  };

  const selectedCount = editableEcoutes.filter(e => e.selected).length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-blue-600" />
            Création d'écoutes depuis ordonnance JLD
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-6">
          {/* Informations du document */}
          <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-4 w-4 text-blue-600" />
              <span className="font-medium text-blue-900">Document analysé</span>
            </div>
            <div className="text-sm text-blue-800">
              <p><strong>Fichier :</strong> {fileName}</p>
              <p><strong>Tribunal :</strong> {analysisResult.tribunal} - <strong>Date :</strong> {formatDate(analysisResult.signatureDate)}</p>
              <p><strong>Confiance :</strong> 
                <Badge variant="outline" className={`ml-2 ${
                  analysisResult.confidence >= 0.8 ? 'bg-green-50 text-green-700' :
                  analysisResult.confidence >= 0.6 ? 'bg-yellow-50 text-yellow-700' :
                  'bg-red-50 text-red-700'
                }`}>
                  {Math.round(analysisResult.confidence * 100)}%
                </Badge>
              </p>
            </div>
          </div>

          {/* Configuration globale */}
          <div className="bg-gray-50 p-4 rounded-lg border">
            <h3 className="font-medium text-gray-900 mb-3">Configuration globale</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="globalDateDebut">Date de début</Label>
                <Input
                  id="globalDateDebut"
                  type="date"
                  value={globalDateDebut}
                  onChange={(e) => setGlobalDateDebut(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="globalDatePose">Date de pose</Label>
                <Input
                  id="globalDatePose"
                  type="date"
                  value={globalDatePose}
                  onChange={(e) => setGlobalDatePose(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="globalDuree">Durée (jours)</Label>
                <Input
                  id="globalDuree"
                  type="number"
                  min="1"
                  value={globalDuree}
                  onChange={(e) => setGlobalDuree(e.target.value)}
                />
              </div>
            </div>
            <Button 
              type="button" 
              variant="outline" 
              size="sm" 
              onClick={applyGlobalConfig}
              className="mt-3"
            >
              Appliquer à toutes les écoutes sélectionnées
            </Button>
          </div>

          {/* Liste des écoutes */}
          <div>
            <h3 className="font-medium text-gray-900 mb-3">
              {editableEcoutes.length} écoute(s) détectée(s)
              {selectedCount > 0 && (
                <Badge variant="outline" className="ml-2 bg-green-50 text-green-700">
                  {selectedCount} sélectionnée(s)
                </Badge>
              )}
            </h3>
            
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {editableEcoutes.map((ecoute) => (
                <div
                  key={ecoute.id}
                  className={`border rounded-lg p-3 transition-colors ${
                    ecoute.selected ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <Checkbox
                      checked={ecoute.selected}
                      onCheckedChange={(checked) => 
                        updateEcoute(ecoute.id, 'selected', checked as boolean)
                      }
                    />
                    <Edit3 className="h-4 w-4 text-gray-400" />
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-2">
                      <div>
                        <Label className="text-xs text-gray-600">Numéro</Label>
                        <Input
                          value={ecoute.lastFourDigits}
                          onChange={(e) => updateEcoute(ecoute.id, 'lastFourDigits', e.target.value)}
                          className={`text-sm ${errors[`numero-${ecoute.id}`] ? 'border-red-500' : ''}`}
                          disabled={!ecoute.selected}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-gray-600">Utilisateur</Label>
                        <Input
                          value={ecoute.user}
                          onChange={(e) => updateEcoute(ecoute.id, 'user', e.target.value)}
                          className={`text-sm ${errors[`user-${ecoute.id}`] ? 'border-red-500' : ''}`}
                          disabled={!ecoute.selected}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-gray-600">Date début</Label>
                        <Input
                          type="date"
                          value={ecoute.dateDebut}
                          onChange={(e) => updateEcoute(ecoute.id, 'dateDebut', e.target.value)}
                          className={`text-sm ${errors[`date-${ecoute.id}`] ? 'border-red-500' : ''}`}
                          disabled={!ecoute.selected}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-gray-600">Durée (j)</Label>
                        <Input
                          type="number"
                          min="1"
                          value={ecoute.duree}
                          onChange={(e) => updateEcoute(ecoute.id, 'duree', e.target.value)}
                          className={`text-sm ${errors[`duree-${ecoute.id}`] ? 'border-red-500' : ''}`}
                          disabled={!ecoute.selected}
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-xs text-gray-600 pl-8">
                    <p><strong>Ligne complète :</strong> {ecoute.fullNumber}</p>
                    <p><strong>Type :</strong> {ecoute.usageType}</p>
                    {ecoute.selected && ecoute.dateDebut && ecoute.duree && (
                      <p><strong>Fin prévue :</strong> {formatDate(calculateEndDate(ecoute.datePose || ecoute.dateDebut, ecoute.duree))}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Erreurs générales */}
          {errors.general && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <span className="text-sm text-red-800">{errors.general}</span>
            </div>
          )}

          {/* Erreurs d'analyse */}
          {analysisResult.errors.length > 0 && (
            <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <span className="font-medium text-yellow-900">Avertissements d'analyse</span>
              </div>
              <ul className="text-sm text-yellow-800 space-y-1">
                {analysisResult.errors.map((error, index) => (
                  <li key={index}>• {error}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Informations */}
          <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
            <div className="flex items-center gap-2 mb-1">
              <Info className="h-4 w-4 text-blue-600" />
              <span className="font-medium text-blue-900">Informations</span>
            </div>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Les écoutes seront créées avec le statut "en cours"</li>
              <li>• Vous pourrez les modifier individuellement après création</li>
              <li>• La description contiendra automatiquement les détails de l'ordonnance JLD</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <div className="flex justify-between items-center w-full">
            <span className="text-sm text-gray-500">
              {selectedCount} écoute(s) seront créées
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Annuler
              </Button>
              <Button 
                onClick={handleCreateEcoutes}
                disabled={selectedCount === 0}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Créer les écoutes
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
