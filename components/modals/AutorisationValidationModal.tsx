import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { DateUtils } from '@/utils/dateUtils';
import { useToast } from '@/contexts/ToastContext';

interface AutorisationValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onValidate: (date: string) => void;
  acteType: string;
}

export const AutorisationValidationModal = ({
  isOpen,
  onClose,
  onValidate,
  acteType
}: AutorisationValidationModalProps) => {
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  // Initialiser avec la date du jour à l'ouverture
  useEffect(() => {
    if (isOpen) {
      const today = new Date().toISOString().split('T')[0];
      setDate(today);
      setError(null);
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!date) {
      setError('Veuillez sélectionner une date');
      return;
    }

    try {
      if (DateUtils.isValidDate(date)) {
        onValidate(date);
        showToast('Autorisation enregistrée', 'success');
        setTimeout(() => {
          onClose();
        }, 500);
      } else {
        setError('Date invalide');
      }
    } catch (err) {
      console.error('Error submitting autorisation date:', err);
      setError('Une erreur est survenue lors de la validation');
      showToast('Erreur lors de l\'enregistrement de l\'autorisation', 'error');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Date d'autorisation JLD</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="text-sm text-gray-600">
            <p>Type d'acte: {acteType}</p>
            <p>En attente d'autorisation JLD</p>
          </div>

          <div className="space-y-2">
            <Label>Date d'autorisation</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setError(null);
              }}
              required
            />
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button 
              type="submit"
              disabled={!!error || !date}
            >
              Valider l'autorisation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};