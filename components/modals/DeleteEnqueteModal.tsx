import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { useToast } from '@/contexts/ToastContext';

interface DeleteEnqueteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  enqueteNumero: string;
}

export const DeleteEnqueteModal = ({
  isOpen,
  onClose,
  onConfirm,
  enqueteNumero
}: DeleteEnqueteModalProps) => {
   const { showToast } = useToast();

   const handleDeleteWithToast = () => {
    try {
      onConfirm();
      showToast('Enquête supprimée avec succès', 'success');
    } catch (error) {
      showToast('Erreur lors de la suppression', 'error');
    }
  };
 return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer l'enquête</DialogTitle>
        </DialogHeader>
        
        <div className="py-4">
          <p className="text-gray-600">
            Êtes-vous sûr de vouloir supprimer l'enquête n°{enqueteNumero} ?
          </p>
          <p className="text-red-600 text-sm mt-2">
            Cette action est irréversible.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="destructive" onClick={handleDeleteWithToast}>
            Supprimer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};