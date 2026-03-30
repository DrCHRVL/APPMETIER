import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useToast } from '@/contexts/ToastContext';
import { ResultatAudience, emptyConfiscations } from '@/types/audienceTypes';

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
  const today = new Date().toISOString().split('T')[0];
  const [dateOI, setDateOI] = useState(today);

  const handleConfirm = () => {
    try {
      const oiResultat: ResultatAudience = {
        enqueteId,
        dateAudience: dateOI,
        typeInfraction: "OI",
        condamnations: [],
        confiscations: emptyConfiscations(),
        isOI: true,
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

        <div className="py-4 space-y-4">
          <p>Souhaitez-vous archiver cette enquête en tant qu'ouverture d'information (OI) ?</p>
          <div>
            <Label>Date de l'OI</Label>
            <Input
              type="date"
              value={dateOI}
              onChange={(e) => setDateOI(e.target.value)}
            />
            <p className="text-xs text-gray-500 mt-1">
              Par défaut : aujourd'hui. Modifiez si la saisie est faite en retard.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleConfirm} disabled={!dateOI}>Confirmer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};