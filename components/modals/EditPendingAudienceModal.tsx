import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useAudience } from '@/hooks/useAudience';
import { useToast } from '@/contexts/ToastContext';

interface EditPendingAudienceModalProps {
  isOpen: boolean;
  onClose: () => void;
  enqueteId: number;
}

export const EditPendingAudienceModal = ({
  isOpen,
  onClose,
  enqueteId
}: EditPendingAudienceModalProps) => {
  const { audienceState, saveResultat } = useAudience();
  const { showToast } = useToast();
  
  const [audienceDate, setAudienceDate] = useState('');
  const [dateDefere, setDateDefere] = useState('');
  const [nombreDeferes, setNombreDeferes] = useState(0);

  useEffect(() => {
    const resultat = audienceState?.resultats?.[enqueteId];
    if (resultat) {
      setAudienceDate(resultat.dateAudience || '');
      setDateDefere(resultat.dateDefere || '');
      setNombreDeferes(resultat.nombreDeferes || 0);
    }
  }, [enqueteId, audienceState]);

  const handleSave = async () => {
    try {
      const currentResultat = audienceState?.resultats?.[enqueteId];
      if (!currentResultat) return;

      const updatedResultat = {
        ...currentResultat,
        dateAudience: audienceDate,
        dateDefere: dateDefere || undefined,
        nombreDeferes: nombreDeferes > 0 ? nombreDeferes : undefined
      };

      await saveResultat(updatedResultat);
      showToast('Informations mises à jour', 'success');
      onClose();
    } catch (error) {
      showToast('Erreur lors de la mise à jour', 'error');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier l'audience en attente</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Date d'audience</label>
            <Input
              type="date"
              value={audienceDate}
              onChange={(e) => setAudienceDate(e.target.value)}
              required
            />
          </div>
          
          <div className="border-t pt-4">
            <label className="text-sm font-medium mb-2 block">Défèrement (optionnel)</label>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-600">Date de défèrement</label>
                <Input
                  type="date"
                  value={dateDefere}
                  onChange={(e) => setDateDefere(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">Nombre de personnes déférées</label>
                <Input
                  type="number"
                  min="0"
                  value={nombreDeferes}
                  onChange={(e) => setNombreDeferes(parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={handleSave} disabled={!audienceDate}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
