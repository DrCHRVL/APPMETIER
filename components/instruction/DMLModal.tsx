import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Calendar, AlertTriangle } from 'lucide-react';
import { EnqueteInstruction, MisEnExamen } from '@/types/interfaces';

interface DMLModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (detenus: number[]) => void;
  instruction: EnqueteInstruction;
}

export const DMLModal = ({
  isOpen,
  onClose,
  onConfirm,
  instruction
}: DMLModalProps) => {
  const [selectedDetenus, setSelectedDetenus] = useState<number[]>([]);
  
  // Filtrer les mis en examen détenus - CORRECTION: vérifier le statut ET le role
  const detenus = instruction.misEnExamen?.filter(mex => 
    mex.statut === 'detenu' || mex.role === 'detenu'
  ) || [];

  console.log('Mis en examen disponibles:', instruction.misEnExamen);
  console.log('Détenus filtrés:', detenus);

  const handleToggleDetenu = (mexId: number) => {
    setSelectedDetenus(prev => 
      prev.includes(mexId) 
        ? prev.filter(id => id !== mexId)
        : [...prev, mexId]
    );
  };

  const handleConfirm = () => {
    if (selectedDetenus.length === 0) {
      alert('Veuillez sélectionner au moins un détenu');
      return;
    }
    onConfirm(selectedDetenus);
    setSelectedDetenus([]);
    onClose();
  };

  if (detenus.length === 0) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Aucun détenu
            </DialogTitle>
          </DialogHeader>
          <div className="p-4">
            <p className="text-sm text-gray-600 mb-4">
              Vous devez d'abord avoir des mis en examen avec le statut "détenu" pour pouvoir créer une DML.
            </p>
            
            {/* DEBUG: Affichage pour diagnostic */}
            <div className="text-xs text-gray-500 mb-4 bg-gray-50 p-2 rounded">
              <strong>Debug:</strong><br/>
              Mis en examen total: {instruction.misEnExamen?.length || 0}<br/>
              {instruction.misEnExamen?.map(mex => (
                <div key={mex.id}>
                  - {mex.nom}: statut="{mex.statut}", role="{mex.role}"
                </div>
              ))}
            </div>
            
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
            <Calendar className="h-5 w-5 text-purple-500" />
            Nouvelle DML
          </DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-600">
            Sélectionnez le(s) détenu(s) concerné(s) par cette DML :
          </p>

          <div className="space-y-2">
            {detenus.map(detenu => (
              <div
                key={detenu.id}
                className={`p-3 border rounded cursor-pointer transition-colors ${
                  selectedDetenus.includes(detenu.id)
                    ? 'border-purple-300 bg-purple-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => handleToggleDetenu(detenu.id)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{detenu.nom}</div>
                    <div className="text-xs text-gray-500">
                      Mis en examen le: {new Date(detenu.dateExamen).toLocaleDateString()}
                    </div>
                    {detenu.dateFinDP && (
                      <div className="text-xs text-orange-600">
                        DP jusqu'au: {new Date(detenu.dateFinDP).toLocaleDateString()}
                      </div>
                    )}
                    <div className="text-xs text-gray-400">
                      Statut: {detenu.statut} | Rôle: {detenu.role}
                    </div>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedDetenus.includes(detenu.id)}
                      onChange={() => handleToggleDetenu(detenu.id)}
                      className="h-4 w-4"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-4">
            <Button onClick={handleConfirm} className="flex-1">
              Créer DML ({selectedDetenus.length} détenu{selectedDetenus.length > 1 ? 's' : ''})
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