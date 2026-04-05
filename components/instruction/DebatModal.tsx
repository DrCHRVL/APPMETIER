import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Gavel, AlertTriangle, Info } from 'lucide-react';
import { EnqueteInstruction, MisEnExamen } from '@/types/interfaces';

interface DebatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (detenuId: number, type: 'placement_dp' | 'prolongation_dp', issue?: string) => void;
  instruction: EnqueteInstruction;
  type: 'placement_dp' | 'prolongation_dp';
}

export const DebatModal = ({
  isOpen,
  onClose,
  onConfirm,
  instruction,
  type
}: DebatModalProps) => {
  const [selectedDetenu, setSelectedDetenu] = useState<number | null>(null);
  const [issue, setIssue] = useState('');
  const [debatDate, setDebatDate] = useState(new Date().toISOString().split('T')[0]);
  
  // Pour les placements DP : tous les mis en examen
  // Pour les prolongations DP : seulement les détenus actuels
  const availableMisEnExamen = type === 'placement_dp' 
    ? instruction.misEnExamen || []
    : (instruction.misEnExamen?.filter(mex => 
        mex.statut === 'detenu' || mex.role === 'detenu'
      ) || []);

  const handleConfirm = () => {
    if (!selectedDetenu) {
      alert('Veuillez sélectionner un mis en examen');
      return;
    }
    if (!debatDate) {
      alert('Veuillez sélectionner une date');
      return;
    }
    
    // Mettre à jour le statut du mis en examen selon l'issue
    updateMisEnExamenStatut(selectedDetenu, issue.trim());
    
    onConfirm(selectedDetenu, type, issue.trim() || undefined);
    setSelectedDetenu(null);
    setIssue('');
    setDebatDate(new Date().toISOString().split('T')[0]);
    onClose();
  };

  // Fonction pour mettre à jour le statut du mis en examen selon l'issue du débat
  const updateMisEnExamenStatut = (mexId: number, issue: string) => {
    if (!issue) return;

    const issueNormalized = issue.toLowerCase().trim();
    const currentMex = instruction.misEnExamen?.find(m => m.id === mexId);
    if (!currentMex) return;

    let newStatut = currentMex.statut;
    let newRole = currentMex.role;
    let updates: any = {};

    // Mise à jour selon l'issue du débat
    if (type === 'placement_dp') {
      if (issueNormalized === 'accordé' || issueNormalized === 'accorde') {
        newStatut = 'detenu';
        newRole = 'detenu';
        // Ajouter les dates DP si ce n'est pas déjà fait
        if (!currentMex.datePlacementDP) {
          updates.datePlacementDP = debatDate;
          updates.dureeInitialeDP = 1; // 1 mois par défaut
          const finDP = new Date(debatDate);
          finDP.setMonth(finDP.getMonth() + 1);
          updates.dateFinDP = finDP.toISOString().split('T')[0];
        }
      } else if (issueNormalized.includes('cj') || issueNormalized.includes('contrôle')) {
        newStatut = 'cj';
        newRole = 'libre';
      } else if (issueNormalized.includes('arse')) {
        newStatut = 'arse';
        newRole = 'libre';
      } else if (issueNormalized === 'rejeté' || issueNormalized === 'rejete') {
        newStatut = 'libre';
        newRole = 'libre';
      }
    }

    // Appliquer les mises à jour si nécessaire
    if (newStatut !== currentMex.statut || newRole !== currentMex.role || Object.keys(updates).length > 0) {
      const updatedMisEnExamen = instruction.misEnExamen?.map(mex =>
        mex.id === mexId ? {
          ...mex,
          statut: newStatut,
          role: newRole,
          ...updates
        } : mex
      );

      // Vous devrez adapter cette partie selon votre architecture pour mettre à jour l'instruction
      if (typeof (instruction as any).onUpdate === 'function') {
        (instruction as any).onUpdate(instruction.id, { misEnExamen: updatedMisEnExamen });
      }
    }
  };

  const typeLabel = type === 'placement_dp' ? 'Placement en détention provisoire' : 'Prolongation de détention provisoire';

  if (availableMisEnExamen.length === 0) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Aucun mis en examen
            </DialogTitle>
          </DialogHeader>
          <div className="p-4">
            <p className="text-sm text-gray-600 mb-4">
              {type === 'placement_dp' 
                ? "Vous devez d'abord avoir des mis en examen pour pouvoir créer un débat de placement."
                : "Vous devez d'abord avoir des mis en examen avec le statut \"détenu\" pour pouvoir créer un débat de prolongation."
              }
            </p>
            <Button onClick={onClose} className="w-full">
              Fermer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <Gavel className="h-5 w-5 text-orange-500" />
            {typeLabel}
          </DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-4">
          {/* Info contextuelle selon le type */}
          {type === 'placement_dp' && (
            <div className="bg-blue-50 border border-blue-200 rounded p-3 flex items-start gap-2">
              <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-blue-700">
                <div className="font-medium mb-1">Débat de placement DP</div>
                <div className="text-xs">
                  Sélectionnez le mis en examen concerné (quelque soit son statut actuel). 
                  Précisez l'issue : "Accordé", "CJ", "Rejeté", etc.
                </div>
              </div>
            </div>
          )}

          {type === 'prolongation_dp' && (
            <div className="bg-orange-50 border border-orange-200 rounded p-3 flex items-start gap-2">
              <Info className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-orange-700">
                <div className="font-medium mb-1">Débat de prolongation DP</div>
                <div className="text-xs">
                  Seuls les mis en examen actuellement détenus sont proposés.
                </div>
              </div>
            </div>
          )}

          <p className="text-sm text-gray-600">
            Sélectionnez le mis en examen concerné par ce débat :
          </p>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {availableMisEnExamen.map(mex => {
              // Badges de statut avec couleurs
              const getStatutBadge = (mex: MisEnExamen) => {
                const statut = mex.statut || mex.role || 'libre';
                const statutColors = {
                  libre: 'bg-green-100 text-green-700 border-green-300',
                  cj: 'bg-blue-100 text-blue-700 border-blue-300',
                  detenu: 'bg-red-100 text-red-700 border-red-300',
                  arse: 'bg-purple-100 text-purple-700 border-purple-300'
                };
                const statutLabels = {
                  libre: 'Libre',
                  cj: 'CJ',
                  detenu: 'Détenu',
                  arse: 'ARSE'
                };

                return (
                  <Badge 
                    variant="outline" 
                    className={`text-xs h-5 px-2 ${statutColors[statut] || statutColors.libre}`}
                  >
                    {statutLabels[statut] || statut}
                  </Badge>
                );
              };

              const isExpiredDP = mex.dateFinDP && new Date(mex.dateFinDP) < new Date();

              return (
                <div
                  key={mex.id}
                  className={`p-3 border rounded cursor-pointer transition-colors ${
                    selectedDetenu === mex.id
                      ? 'border-orange-300 bg-orange-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setSelectedDetenu(mex.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="font-medium text-sm">{mex.nom}</div>
                        {getStatutBadge(mex)}
                        {isExpiredDP && (
                          <Badge variant="outline" className="text-xs h-5 px-2 bg-red-100 text-red-700 border-red-300">
                            DP expirée
                          </Badge>
                        )}
                      </div>
                      
                      <div className="text-xs text-gray-500 space-y-0.5">
                        <div>Mis en examen le: {new Date(mex.dateExamen).toLocaleDateString()}</div>
                        
                        {mex.datePlacementDP && (
                          <div className="text-orange-600">
                            DP du: {new Date(mex.datePlacementDP).toLocaleDateString()}
                            {mex.dateFinDP && (
                              <span className={isExpiredDP ? 'text-red-600 font-medium' : ''}>
                                {' '}au {new Date(mex.dateFinDP).toLocaleDateString()}
                                {isExpiredDP && ' (expirée)'}
                              </span>
                            )}
                          </div>
                        )}
                        
                        {mex.chefs && mex.chefs.length > 0 && (
                          <div className="text-gray-500">
                            Chefs: {mex.chefs.slice(0, 2).join(', ')}
                            {mex.chefs.length > 2 && ` (+${mex.chefs.length - 2})`}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center">
                      <input
                        type="radio"
                        checked={selectedDetenu === mex.id}
                        onChange={() => setSelectedDetenu(mex.id)}
                        className="h-4 w-4"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Date du débat *
              </label>
              <Input
                type="date"
                value={debatDate}
                onChange={(e) => setDebatDate(e.target.value)}
                className="w-full"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Issue du débat {type === 'placement_dp' ? '(ex: Accordé, CJ, Rejeté...)' : '(ex: Accordé, Rejeté...)'}
              </label>
              <Input
                value={issue}
                onChange={(e) => setIssue(e.target.value)}
                placeholder={type === 'placement_dp' 
                  ? "Accordé, CJ, Rejeté, Reporté..." 
                  : "Accordé, Rejeté, Reporté..."
                }
                autoFocus
              />
            </div>
          </div>

          {/* Suggestions rapides */}
          <div className="mb-4">
            <div className="text-xs text-gray-600 mb-2">Suggestions rapides :</div>
            <div className="flex gap-1 flex-wrap">
              {type === 'placement_dp' ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-6"
                    onClick={() => setIssue('Accordé')}
                  >
                    Accordé → DP
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-6"
                    onClick={() => setIssue('CJ')}
                  >
                    CJ → Contrôle judiciaire
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-6"
                    onClick={() => setIssue('ARSE')}
                  >
                    ARSE → Assignation
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-6"
                    onClick={() => setIssue('Rejeté')}
                  >
                    Rejeté → Libre
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-6"
                    onClick={() => setIssue('Accordé')}
                  >
                    Accordé
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-6"
                    onClick={() => setIssue('Rejeté')}
                  >
                    Rejeté
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-6"
                    onClick={() => setIssue('Reporté')}
                  >
                    Reporté
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button onClick={handleConfirm} className="flex-1" disabled={!selectedDetenu || !debatDate}>
              Créer débat {type === 'placement_dp' ? 'placement' : 'prolongation'}
            </Button>
            <Button variant="outline" onClick={onClose}>
              Annuler
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};