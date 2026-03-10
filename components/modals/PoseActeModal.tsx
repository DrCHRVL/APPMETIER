import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { DateUtils } from '@/utils/dateUtils';
import { ActeUtils } from '@/utils/acteUtils';
import { useToast } from '@/contexts/ToastContext';

interface PoseActeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (date: string) => void;
  dateDebut: string;
  duree: string;
  dureeUnit?: 'jours' | 'mois';
}

export const PoseActeModal = ({
  isOpen,
  onClose,
  onConfirm,
  dateDebut,
  duree,
  dureeUnit = 'jours'
}: PoseActeModalProps) => {
  const [date, setDate] = useState('');
  const [calculatedEndDate, setCalculatedEndDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setDate('');
      setCalculatedEndDate(null);
      setError(null);
    }
  }, [isOpen]);

  // Initialiser avec la date d'autorisation à l'ouverture
  useEffect(() => {
    if (isOpen && dateDebut) {
      setDate(dateDebut);
      setError(null);
      setCalculatedEndDate(null);
      
      // Calculer immédiatement la date de fin
      if (DateUtils.isValidDate(dateDebut)) {
        const endDate = calculateEndDate(dateDebut);
        if (endDate) {
          setCalculatedEndDate(endDate);
        }
      }
    }
  }, [isOpen, dateDebut]);

  // Calcul de la date de fin uniquement à la validation
  const calculateEndDate = (poseDate: string): string | null => {
    try {
      if (!DateUtils.isValidDate(poseDate)) return null;
      const endDate = DateUtils.calculateEndDateWithUnit(poseDate, duree, dureeUnit);
      return endDate || null;
    } catch (err) {
      console.error('Error calculating end date:', err);
      return null;
    }
  };

  const handleDateChange = (newDate: string) => {
    setDate(newDate);
    setError(null);
    setCalculatedEndDate(null);

    // Validation basique de la date
    if (newDate && DateUtils.isValidDate(newDate)) {
      if (!ActeUtils.validateDates(dateDebut, newDate)) {
        setError('La date de pose doit être postérieure ou égale à la date d\'autorisation');
      } else {
        // Calcul de la date de fin uniquement si la date est valide
        const endDate = calculateEndDate(newDate);
        if (endDate) {
          setCalculatedEndDate(endDate);
        }
      }
    }
  };

  const validatePoseDate = (poseDate: string): boolean => {
    if (!DateUtils.isValidDate(poseDate)) {
      setError('Date invalide');
      return false;
    }

    if (!ActeUtils.validateDates(dateDebut, poseDate)) {
      setError('La date de pose doit être postérieure ou égale à la date d\'autorisation');
      return false;
    }

    const endDate = calculateEndDate(poseDate);
    if (!endDate) {
      setError('Impossible de calculer la date de fin');
      return false;
    }

    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Submit with date:", date);
    
    if (!date) {
      setError('Veuillez sélectionner une date');
      return;
    }

    try {
      if (validatePoseDate(date)) {
        console.log("Date validated, calling onConfirm with:", date);
        onConfirm(date);
        showToast('Date de pose enregistrée', 'success');
        setTimeout(() => {
          onClose();
        }, 500);
      }
    } catch (err) {
      console.error('Error submitting pose date:', err);
      setError('Une erreur est survenue lors de la validation');
      showToast('Erreur lors de l\'enregistrement de la date', 'error');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Date de pose de l'acte</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="text-sm text-gray-600">
            <p>Date d'autorisation: {DateUtils.formatDate(dateDebut)}</p>
            <p>Durée: {duree} {dureeUnit === 'mois' ? 'mois' : 'jours'}</p>
          </div>

          <div className="space-y-2">
            <Label>Date de pose</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => handleDateChange(e.target.value)}
              min={dateDebut}
              required
            />
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
          </div>

          {calculatedEndDate && (
            <div className="text-sm text-gray-600">
              <p>Date de fin calculée: {DateUtils.formatDate(calculatedEndDate)}</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button 
              type="submit"
              disabled={!!error || !date}
            >
              Valider la date de pose
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};