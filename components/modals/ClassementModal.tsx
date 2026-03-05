import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useToast } from '@/contexts/ToastContext';

interface ClassementModalProps {
  isOpen: boolean;
  onClose: () => void;
  enqueteId: number;
  initialDate: string;
  initialMotif?: string;
  onSave: (data: { dateClassement: string; motifClassement: string }) => void;
  onDelete: () => void;
}

export const ClassementModal = ({
  isOpen,
  onClose,
  enqueteId,
  initialDate,
  initialMotif = '',
  onSave,
  onDelete
}: ClassementModalProps) => {
  const [dateClassement, setDateClassement] = useState(initialDate);
  const [motifClassement, setMotifClassement] = useState(initialMotif);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { showToast } = useToast();

  const handleSubmit = () => {
    if (!dateClassement) {
      showToast('Veuillez renseigner la date de classement', 'error');
      return;
    }

    onSave({
      dateClassement,
      motifClassement
    });
    
    onClose();
  };

  const handleDelete = () => {
    onDelete();
    setShowDeleteConfirm(false);
    onClose();
  };

  if (showDeleteConfirm) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmer la suppression</DialogTitle>
          </DialogHeader>
          
          <div className="py-4">
            <p>Êtes-vous sûr de vouloir supprimer ce classement sans suite ?</p>
            <p className="text-sm text-gray-500 mt-2">
              L'enquête redeviendra active et pourra être gérée normalement.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Modifier le classement sans suite</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="dateClassement">Date de classement</Label>
            <Input
              id="dateClassement"
              type="date"
              value={dateClassement}
              onChange={(e) => setDateClassement(e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="motifClassement">Motif du classement (optionnel)</Label>
            <textarea
              id="motifClassement"
              value={motifClassement}
              onChange={(e) => setMotifClassement(e.target.value)}
              placeholder="Ex: Insuffisance de charges, prescription..."
              className="w-full p-2 border rounded-md resize-none h-20 text-sm"
            />
          </div>
        </div>

        <DialogFooter className="flex justify-between">
          <Button 
            variant="destructive" 
            onClick={() => setShowDeleteConfirm(true)}
            className="mr-auto"
          >
            Supprimer le classement
          </Button>
          
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={!dateClassement}
            >
              Enregistrer
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};