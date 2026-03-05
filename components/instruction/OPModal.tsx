import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Select } from '../ui/select';
import { 
  Plus, 
  Users, 
  Calendar, 
  Trash2,
  Gavel,
  AlertCircle,
  UserCheck
} from 'lucide-react';
import { EnqueteInstruction, MisEnExamen } from '@/types/interfaces';
import { calculateDPDates } from '@/utils/instructionUtils';
import { useToast } from '@/contexts/ToastContext';

interface OPModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (opData: OPCreationData) => void;
  instruction: EnqueteInstruction;
}

interface InterpellationData {
  id: number;
  nomPersonne: string;
  misEnExamenId?: number;
  dateInterpellation: string;
  placementDP: boolean;
  dureeDP?: number; // en mois
  isExistingMisEnExamen?: boolean; // Flag pour distinguer nouveau vs existant
}

export interface OPCreationData {
  date: string;
  dureeJours: number;
  description: string;
  interpellations: InterpellationData[];
}

export const OPModal = ({
  isOpen,
  onClose,
  onConfirm,
  instruction
}: OPModalProps) => {
  const { showToast } = useToast();
  
  const [opData, setOpData] = useState<OPCreationData>({
    date: new Date().toISOString().split('T')[0],
    dureeJours: 1,
    description: '',
    interpellations: []
  });

  const misEnExamen = instruction.misEnExamen || [];

  const handleAddInterpellation = () => {
    const newInterpellation: InterpellationData = {
      id: Date.now(),
      nomPersonne: '',
      dateInterpellation: opData.date,
      placementDP: false,
      isExistingMisEnExamen: false
    };
    
    setOpData({
      ...opData,
      interpellations: [...opData.interpellations, newInterpellation]
    });
  };

  const handleUpdateInterpellation = (id: number, updates: Partial<InterpellationData>) => {
    setOpData({
      ...opData,
      interpellations: opData.interpellations.map(interp => {
        if (interp.id === id) {
          // Si on lie à un mis en examen existant
          if (updates.misEnExamenId && updates.misEnExamenId !== interp.misEnExamenId) {
            const mexFound = misEnExamen.find(mex => mex.id === updates.misEnExamenId);
            if (mexFound) {
              return {
                ...interp,
                ...updates,
                nomPersonne: mexFound.nom,
                dateInterpellation: mexFound.dateExamen,
                placementDP: mexFound.role === 'detenu',
                isExistingMisEnExamen: true
              };
            }
          }
          // Si on délié d'un mis en examen
          else if (updates.misEnExamenId === undefined && interp.isExistingMisEnExamen) {
            return {
              ...interp,
              ...updates,
              nomPersonne: '',
              dateInterpellation: opData.date,
              placementDP: false,
              isExistingMisEnExamen: false
            };
          }
          
          return { ...interp, ...updates };
        }
        return interp;
      })
    });
  };

  const handleRemoveInterpellation = (id: number) => {
    setOpData({
      ...opData,
      interpellations: opData.interpellations.filter(interp => interp.id !== id)
    });
  };

  const handleConfirm = () => {
    if (!opData.date) {
      showToast('Date requise', 'error');
      return;
    }

    if (opData.interpellations.length === 0) {
      showToast('Au moins une interpellation est requise', 'error');
      return;
    }

    // Vérifier que toutes les interpellations ont un nom
    const invalidInterpellations = opData.interpellations.filter(
      interp => !interp.nomPersonne.trim()
    );
    
    if (invalidInterpellations.length > 0) {
      showToast('Tous les noms d\'interpellés sont requis', 'error');
      return;
    }

    // Vérifier que les placements DP ont une durée
    const invalidDP = opData.interpellations.filter(
      interp => interp.placementDP && (!interp.dureeDP || interp.dureeDP <= 0)
    );
    
    if (invalidDP.length > 0) {
      showToast('Durée DP requise pour les placements', 'error');
      return;
    }

    onConfirm(opData);
    handleReset();
    onClose();
  };

  const handleReset = () => {
    setOpData({
      date: new Date().toISOString().split('T')[0],
      dureeJours: 1,
      description: '',
      interpellations: []
    });
  };

  const handleCancel = () => {
    handleReset();
    onClose();
  };

  // Calculer le nombre de débats qui seront générés (seulement pour les nouveaux placements DP)
  const nbDebatsGeneres = opData.interpellations.filter(interp => 
    interp.placementDP && !interp.isExistingMisEnExamen
  ).length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-500" />
            Nouvelle phase d'interpellation (OP)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 p-4">
          {/* Informations générales de l'OP */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Date de l'opération</label>
              <Input
                type="date"
                value={opData.date}
                onChange={(e) => setOpData({...opData, date: e.target.value})}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Durée (jours)</label>
              <Input
                type="number"
                min="1"
                value={opData.dureeJours}
                onChange={(e) => setOpData({...opData, dureeJours: parseInt(e.target.value) || 1})}
                placeholder="Ex: 3"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Description (optionnel)</label>
              <Input
                value={opData.description}
                onChange={(e) => setOpData({...opData, description: e.target.value})}
                placeholder="Ex: OP crackhouse, OP stups..."
                className="mt-1"
              />
            </div>
          </div>

          {/* Résumé de l'impact */}
          {opData.interpellations.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="text-sm font-medium text-blue-900 mb-2">Résumé de l'opération</h3>
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-blue-700">Interpellations:</span>
                  <span className="font-medium ml-2">{opData.interpellations.length}</span>
                </div>
                <div>
                  <span className="text-blue-700">Déjà en examen:</span>
                  <span className="font-medium ml-2">
                    {opData.interpellations.filter(i => i.isExistingMisEnExamen).length}
                  </span>
                </div>
                <div>
                  <span className="text-blue-700">Placements DP:</span>
                  <span className="font-medium ml-2">
                    {opData.interpellations.filter(i => i.placementDP).length}
                  </span>
                </div>
                <div>
                  <span className="text-blue-700">Nouveaux débats:</span>
                  <span className="font-medium ml-2">{nbDebatsGeneres}</span>
                </div>
              </div>
              
              {nbDebatsGeneres > 0 && (
                <div className="mt-2 p-2 bg-orange-100 border border-orange-200 rounded text-xs text-orange-800">
                  <AlertCircle className="h-3 w-3 inline mr-1" />
                  Cette OP générera {nbDebatsGeneres} nouveau(x) débat(s) parquet pour placement DP
                </div>
              )}
            </div>
          )}

          {/* Gestion des interpellations */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-900">
                Interpellations ({opData.interpellations.length})
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddInterpellation}
                className="text-green-600 border-green-300 hover:bg-green-50"
              >
                <Plus className="h-4 w-4 mr-1" />
                Ajouter interpellation
              </Button>
            </div>

            <div className="space-y-3 max-h-60 overflow-auto">
              {opData.interpellations.length === 0 ? (
                <div className="text-center py-8 text-gray-500 border-2 border-dashed border-gray-200 rounded-lg">
                  <Users className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">Aucune interpellation</p>
                  <p className="text-xs text-gray-400">Cliquez sur "Ajouter interpellation" pour commencer</p>
                </div>
              ) : (
                opData.interpellations.map((interp, index) => (
                  <div key={interp.id} className={`border rounded-lg p-4 ${
                    interp.isExistingMisEnExamen ? 'bg-green-50 border-green-200' : 'bg-white'
                  }`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-sm">Interpellation #{index + 1}</h4>
                        {interp.isExistingMisEnExamen && (
                          <Badge variant="outline" className="text-xs bg-green-100 text-green-700">
                            <UserCheck className="h-3 w-3 mr-1" />
                            Déjà en examen
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveInterpellation(interp.id)}
                        className="text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Sélection mis en examen existant ou nouveau */}
                    <div className="mb-3">
                      <label className="text-xs text-gray-600">Type d'interpellation</label>
                      <Select
                        value={interp.misEnExamenId?.toString() || ''}
                        onChange={(e) => handleUpdateInterpellation(interp.id, { 
                          misEnExamenId: e.target.value ? parseInt(e.target.value) : undefined 
                        })}
                        className="h-8 text-sm"
                      >
                        <option value="">Nouvelle personne interpellée</option>
                        <optgroup label="Mis en examen existants">
                          {misEnExamen.map(mex => (
                            <option key={mex.id} value={mex.id.toString()}>
                              {mex.nom} {mex.role === 'detenu' ? '(Détenu)' : '(Libre)'}
                            </option>
                          ))}
                        </optgroup>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="text-xs text-gray-600">Nom de la personne interpellée</label>
                        <Input
                          value={interp.nomPersonne}
                          onChange={(e) => handleUpdateInterpellation(interp.id, { nomPersonne: e.target.value })}
                          placeholder="Nom complet"
                          className="h-8 text-sm"
                          disabled={interp.isExistingMisEnExamen}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">Date interpellation</label>
                        <Input
                          type="date"
                          value={interp.dateInterpellation}
                          onChange={(e) => handleUpdateInterpellation(interp.id, { dateInterpellation: e.target.value })}
                          className="h-8 text-sm"
                          disabled={interp.isExistingMisEnExamen}
                        />
                        {interp.isExistingMisEnExamen && (
                          <div className="text-xs text-green-600 mt-1">
                            Date automatique (mise en examen)
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Placement DP */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={interp.placementDP}
                          onChange={(e) => handleUpdateInterpellation(interp.id, { placementDP: e.target.checked })}
                          className="h-4 w-4"
                          disabled={interp.isExistingMisEnExamen && interp.placementDP}
                        />
                        <label className="text-sm text-gray-700">Placement en détention provisoire</label>
                        {interp.isExistingMisEnExamen && interp.placementDP && (
                          <Badge variant="outline" className="text-xs bg-orange-100 text-orange-700">
                            Déjà placé
                          </Badge>
                        )}
                      </div>
                      
                      {interp.placementDP && (
                        <div className={`border rounded p-3 ${
                          interp.isExistingMisEnExamen ? 'bg-yellow-50 border-yellow-200' : 'bg-orange-50 border-orange-200'
                        }`}>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs text-gray-600">Durée DP demandée (mois)</label>
                              <Select
                                value={interp.dureeDP?.toString() || ''}
                                onChange={(e) => handleUpdateInterpellation(interp.id, { 
                                  dureeDP: parseInt(e.target.value) || undefined 
                                })}
                                className="h-8 text-xs"
                                disabled={interp.isExistingMisEnExamen}
                              >
                                <option value="">Sélectionner...</option>
                                <option value="1">1 mois</option>
                                <option value="2">2 mois</option>
                                <option value="3">3 mois</option>
                                <option value="4">4 mois</option>
                                <option value="6">6 mois</option>
                                <option value="12">12 mois</option>
                                <option value="24">24 mois</option>
                              </Select>
                            </div>
                            <div>
                              <label className="text-xs text-gray-600">Date de fin calculée</label>
                              <Input
                                value={
                                  interp.dureeDP && interp.dateInterpellation
                                    ? calculateDPDates(interp.dateInterpellation, interp.dureeDP).dateFin
                                    : ''
                                }
                                disabled
                                className="h-8 text-xs bg-gray-100"
                              />
                            </div>
                          </div>
                          
                          <div className={`mt-2 text-xs ${
                            interp.isExistingMisEnExamen 
                              ? 'text-yellow-700' 
                              : 'text-orange-700'
                          }`}>
                            <Gavel className="h-3 w-3 inline mr-1" />
                            {interp.isExistingMisEnExamen 
                              ? 'Placement DP déjà traité dans un débat précédent'
                              : 'Un débat parquet sera automatiquement créé pour ce placement'
                            }
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Boutons d'action */}
          <div className="flex gap-3 pt-4 border-t">
            <Button onClick={handleConfirm} className="flex-1">
              Créer la phase OP
              {nbDebatsGeneres > 0 && ` (+ ${nbDebatsGeneres} nouveau${nbDebatsGeneres > 1 ? 'x' : ''} débat${nbDebatsGeneres > 1 ? 's' : ''})`}
            </Button>
            <Button variant="outline" onClick={handleCancel}>
              Annuler
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};