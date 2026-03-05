import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { useToast } from '@/contexts/ToastContext';
import { ResultatAudience } from '@/types/audienceTypes';

interface OIConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (resultat: ResultatAudience) => void;
  enqueteId: number;
}

export const OIConfirmationModal = ({
  isOpen,
  onClose,
  onConfirm,
  enqueteId
}: OIConfirmationModalProps) => {
  const { showToast } = useToast();

  const handleConfirm = () => {
    try {
      // Créer un résultat avec la date du jour et type OI
      const today = new Date().toISOString().split('T')[0];
      
      const oiResultat: ResultatAudience = {
        enqueteId,
        dateAudience: today,
        typeInfraction: "OI", // Marque spéciale pour OI
        condamnations: [],    // Pas de condamnations pour OI
        confiscations: {
          vehicules: 0,
          immeubles: 0,
          argentTotal: 0
        },
        isOI: true, // Nouveau flag pour marquer les OI
        isDirectResult: false
      };
      
      onConfirm(oiResultat);
      onClose();
    } catch (error) {
      showToast('Erreur lors de l\'archivage de l\'enquête', 'error');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ouverture d'information ?</DialogTitle>
        </DialogHeader>
        
        <div className="py-4">
          <p>Souhaitez-vous archiver cette enquête en tant qu'ouverture d'information (OI) ?</p>
          <p className="text-sm text-gray-500 mt-2">
            L'enquête sera archivée avec la date du jour.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Non</Button>
          <Button onClick={handleConfirm}>Oui</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};