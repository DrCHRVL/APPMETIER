import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { 
  Plus, 
  Users, 
  Calendar, 
  Gavel,
  Clock,
  Trash2,
  Edit3,
  UserCheck
} from 'lucide-react';
import { EnqueteInstruction, OP, DebatParquet, MisEnExamen } from '@/types/interfaces';
import { calculateDPDates, calculateTotalDebats } from '@/utils/instructionUtils';
import { OPModal, OPCreationData } from './OPModal';
import { useToast } from '@/contexts/ToastContext';

interface OPManagerProps {
  instruction: EnqueteInstruction;
  onUpdate: (id: number, updates: Partial<EnqueteInstruction>) => void;
  isEditing: boolean;
}

export const OPManager = ({
  instruction,
  onUpdate,
  isEditing
}: OPManagerProps) => {
  const { showToast } = useToast();
  const [showOPModal, setShowOPModal] = useState(false);
  
  const ops = (instruction.ops || []);

  // Ajout rapide OP (sans interpellations)
  const handleQuickAdd = () => {
    const today = new Date().toISOString().split('T')[0];
    
    const newOP: OP = {
      id: Date.now(),
      date: today,
      dureeJours: 1,
      description: `OP du ${new Date(today).toLocaleDateString()}`,
      interpellations: [],
      nbInterpellations: 0,
      nbDebats: 0
    };

    const updatedOPs = [...ops, newOP];
    onUpdate(instruction.id, { ops: updatedOPs });
    showToast('Phase OP ajoutée (rapide)', 'success');
  };

  // Ajout OP complet avec modale
  const handleOPCreation = (opData: OPCreationData) => {
    const newOP: OP = {
      id: Date.now(),
      date: opData.date,
      dureeJours: opData.dureeJours,
      description: opData.description || `OP du ${new Date(opData.date).toLocaleDateString()}`,
      interpellations: opData.interpellations.map(interp => ({
        id: interp.id,
        nomPersonne: interp.nomPersonne,
        misEnExamenId: interp.misEnExamenId,
        dateInterpellation: interp.dateInterpellation,
        debatParquetId: undefined // Sera rempli après création du débat si nouveau placement
      })),
      nbInterpellations: opData.interpellations.length,
      nbDebats: 0 // Sera recalculé
    };

    // Créer les débats parquet seulement pour les nouveaux placements DP
    const newDebats: DebatParquet[] = [];
    const updatedMisEnExamen: MisEnExamen[] = [...(instruction.misEnExamen || [])];
    let nbNouveauxDebats = 0;

    opData.interpellations.forEach(interp => {
      // Seulement créer un débat si c'est un nouveau placement DP
      if (interp.placementDP && interp.dureeDP && !interp.isExistingMisEnExamen) {
        // Créer le débat parquet
        const debatId = Date.now() + Math.random();
        const newDebat: DebatParquet = {
          id: debatId,
          date: interp.dateInterpellation,
          type: 'placement_dp',
          issue: 'Accordé', // Par défaut
          notes: `Placement DP - ${interp.nomPersonne}`,
          concernedDetenu: interp.misEnExamenId,
          originatedFromOP: newOP.id,
          sourceType: 'op_generated'
        };
        newDebats.push(newDebat);
        nbNouveauxDebats++;

        // Mettre à jour l'interpellation avec l'ID du débat
        const interpellation = newOP.interpellations?.find(i => i.id === interp.id);
        if (interpellation) {
          interpellation.debatParquetId = debatId;
        }

        // Mettre à jour ou créer le mis en examen
        if (interp.misEnExamenId) {
          // Mise à jour d'un mis en examen existant
          const mexIndex = updatedMisEnExamen.findIndex(mex => mex.id === interp.misEnExamenId);
          if (mexIndex !== -1) {
            const dates = calculateDPDates(interp.dateInterpellation, interp.dureeDP);
            updatedMisEnExamen[mexIndex] = {
              ...updatedMisEnExamen[mexIndex],
              role: 'detenu',
              datePlacementDP: interp.dateInterpellation,
              dureeInitialeDP: interp.dureeDP,
              dateFinDP: dates.dateFin,
              debatsHistory: [
                ...(updatedMisEnExamen[mexIndex].debatsHistory || []),
                {
                  debatId: debatId,
                  type: 'placement_dp',
                  date: interp.dateInterpellation,
                  decision: 'Accordé'
                }
              ]
            };
          }
        } else {
          // Créer un nouveau mis en examen
          const dates = calculateDPDates(interp.dateInterpellation, interp.dureeDP);
          const newMex: MisEnExamen = {
            id: Date.now() + Math.random(),
            nom: interp.nomPersonne,
            dateExamen: interp.dateInterpellation,
            chefs: [],
            role: 'detenu',
            datePlacementDP: interp.dateInterpellation,
            dureeInitialeDP: interp.dureeDP,
            dateFinDP: dates.dateFin,
            debatsHistory: [{
              debatId: debatId,
              type: 'placement_dp',
              date: interp.dateInterpellation,
              decision: 'Accordé'
            }]
          };
          updatedMisEnExamen.push(newMex);
          
          // Mettre à jour l'interpellation avec le nouvel ID
          if (interpellation) {
            interpellation.misEnExamenId = newMex.id;
          }
        }
      }
      // Si c'est un mis en examen existant sans nouveau placement, juste lier l'interpellation
      else if (interp.isExistingMisEnExamen && interp.misEnExamenId) {
        // Pas de nouveau débat, mais on peut ajouter une note dans l'historique
        const mexIndex = updatedMisEnExamen.findIndex(mex => mex.id === interp.misEnExamenId);
        if (mexIndex !== -1) {
          // Optionnel : ajouter une note dans l'historique que cette personne a été interpellée dans cette OP
          // Pour l'instant, on ne fait rien de spécial
        }
      }
    });

    // Mettre à jour le nombre de débats de l'OP
    newOP.nbDebats = nbNouveauxDebats;

    // Mettre à jour toutes les données
    const updates: Partial<EnqueteInstruction> = {
      ops: [...ops, newOP],
      misEnExamen: updatedMisEnExamen
    };

    if (newDebats.length > 0) {
      updates.debatsParquet = [...(instruction.debatsParquet || []), ...newDebats];
    }

    onUpdate(instruction.id, updates);
    
    const messageParts = [`OP créée avec ${opData.interpellations.length} interpellation(s)`];
    if (nbNouveauxDebats > 0) {
      messageParts.push(`${nbNouveauxDebats} nouveau(x) débat(s)`);
    }
    const existingCount = opData.interpellations.filter(i => i.isExistingMisEnExamen).length;
    if (existingCount > 0) {
      messageParts.push(`${existingCount} mis en examen existant(s)`);
    }
    
    showToast(messageParts.join(' et '), 'success');
  };

  // Suppression OP
  const handleDelete = (opId: number) => {
    if (confirm('Supprimer cette phase OP ? Les débats liés seront aussi supprimés.')) {
      // Supprimer l'OP
      const updatedOPs = ops.filter(op => op.id !== opId);
      
      // Supprimer les débats générés par cette OP
      const updatedDebats = (instruction.debatsParquet || []).filter(
        debat => debat.originatedFromOP !== opId
      );

      // Mettre à jour les mis en examen (retirer le statut détenu si plus de débats)
      const updatedMisEnExamen = (instruction.misEnExamen || []).map(mex => {
        const hasOtherDebats = updatedDebats.some(debat => debat.concernedDetenu === mex.id);
        if (!hasOtherDebats && mex.role === 'detenu') {
          return {
            ...mex,
            role: 'libre' as const,
            datePlacementDP: undefined,
            dureeInitialeDP: undefined,
            dateFinDP: undefined,
            debatsHistory: (mex.debatsHistory || []).filter(
              hist => !instruction.debatsParquet?.find(d => d.id === hist.debatId && d.originatedFromOP === opId)
            )
          };
        }
        return mex;
      });

      onUpdate(instruction.id, { 
        ops: updatedOPs,
        debatsParquet: updatedDebats,
        misEnExamen: updatedMisEnExamen
      });
      
      showToast('Phase OP supprimée', 'success');
    }
  };

  // Calculs totaux
  const totals = {
    phases: ops.length,
    interpellations: ops.reduce((sum, op) => sum + (op.nbInterpellations || 0), 0),
    debats: ops.reduce((sum, op) => sum + (op.nbDebats || 0), 0),
    joursTotal: ops.reduce((sum, op) => sum + (op.dureeJours || 0), 0)
  };

  // Calcul du total des débats (avec correction pour éviter double comptage)
  const totalDebatsCorrect = calculateTotalDebats(instruction);

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Phases interpellation - OP ({totals.phases})
            </div>
            
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-blue-600 hover:bg-blue-50"
                onClick={() => setShowOPModal(true)}
                title="Créer phase OP avec interpellations"
              >
                <Edit3 className="h-3 w-3" />
              </Button>
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Stats rapides */}
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div className="bg-blue-50 p-2 rounded text-center">
              <div className="font-semibold text-blue-700">{totals.phases}</div>
              <div className="text-blue-600">Phases</div>
            </div>
            <div className="bg-green-50 p-2 rounded text-center">
              <div className="font-semibold text-green-700">{totals.interpellations}</div>
              <div className="text-green-600">Interpell.</div>
            </div>
            <div className="bg-orange-50 p-2 rounded text-center">
              <div className="font-semibold text-orange-700">{totals.debats}</div>
              <div className="text-orange-600">Débats OP</div>
            </div>
            <div className="bg-purple-50 p-2 rounded text-center">
              <div className="font-semibold text-purple-700">{totalDebatsCorrect}</div>
              <div className="text-purple-600">Total débats</div>
            </div>
          </div>

          {/* Liste des phases OP */}
          <div className="space-y-2 max-h-48 overflow-auto">
            {ops.length === 0 ? (
              <div className="text-center py-4 text-gray-500">
                <Users className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                <p className="text-xs">Aucune phase OP</p>
                <p className="text-xs text-gray-400">Cliquez sur l'icône pour créer une OP avec interpellations</p>
              </div>
            ) : (
              ops.map(op => (
                <div
                  key={op.id}
                  className="p-2 rounded border text-xs bg-blue-50 border-blue-200"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Calendar className="h-3 w-3 text-blue-600" />
                        <span className="font-medium">
                          {new Date(op.date).toLocaleDateString()}
                        </span>
                        <Badge variant="outline" className="text-xs bg-blue-100">
                          <Clock className="h-3 w-3 mr-1" />
                          {op.dureeJours || 1}j
                        </Badge>
                      </div>
                      
                      <div className="flex items-center gap-3 text-xs text-gray-600">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {op.nbInterpellations || 0} interp.
                        </span>
                        <span className="flex items-center gap-1">
                          <Gavel className="h-3 w-3" />
                          {op.nbDebats || 0} débats
                        </span>
                      </div>
                      
                      {op.description && (
                        <div className="text-xs text-gray-500 italic mt-1 truncate">
                          {op.description}
                        </div>
                      )}

                      {/* Affichage des interpellations */}
                      {op.interpellations && op.interpellations.length > 0 && (
                        <div className="mt-2 space-y-1">
                          <div className="text-xs text-gray-600 font-medium">Interpellations:</div>
                          {op.interpellations.slice(0, 3).map(interp => {
                            const mexExistant = instruction.misEnExamen?.find(mex => mex.id === interp.misEnExamenId);
                            const isExisting = !!mexExistant;
                            
                            return (
                              <div key={interp.id} className="text-xs text-gray-500 flex items-center gap-1">
                                <span>• {interp.nomPersonne}</span>
                                {isExisting && (
                                  <Badge variant="outline" className="text-xs bg-green-100 text-green-700">
                                    <UserCheck className="h-2 w-2 mr-1" />
                                    MEX
                                  </Badge>
                                )}
                                {interp.debatParquetId && (
                                  <Badge variant="outline" className="text-xs bg-orange-100 text-orange-700">
                                    DP
                                  </Badge>
                                )}
                              </div>
                            );
                          })}
                          {op.interpellations.length > 3 && (
                            <div className="text-xs text-gray-400">
                              +{op.interpellations.length - 3} autres...
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {isEditing && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 text-red-600 hover:bg-red-100"
                          onClick={() => handleDelete(op.id)}
                          title="Supprimer (supprime aussi les débats liés)"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Résumé si il y a des phases */}
          {ops.length > 0 && (
            <div className="pt-3 border-t bg-gray-50 rounded p-3">
              <h4 className="text-sm font-medium mb-2">Résumé des phases OP</h4>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="text-gray-600">Total interpellations:</div>
                  <div className="font-medium">{totals.interpellations}</div>
                </div>
                <div>
                  <div className="text-gray-600">Débats générés par OP:</div>
                  <div className="font-medium">{totals.debats}</div>
                </div>
                <div>
                  <div className="text-gray-600">Durée totale:</div>
                  <div className="font-medium">{totals.joursTotal} jours</div>
                </div>
                <div>
                  <div className="text-gray-600">Nombre de phases:</div>
                  <div className="font-medium">{totals.phases}</div>
                </div>
              </div>
              
              {totals.debats !== totalDebatsCorrect && (
                <div className="mt-2 p-2 bg-yellow-100 border border-yellow-300 rounded text-xs text-yellow-800">
                  <Gavel className="h-3 w-3 inline mr-1" />
                  Total débats instruction: {totalDebatsCorrect} (OP: {totals.debats} + manuels: {totalDebatsCorrect - totals.debats})
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <OPModal
        isOpen={showOPModal}
        onClose={() => setShowOPModal(false)}
        onConfirm={handleOPCreation}
        instruction={instruction}
      />
    </>
  );
};