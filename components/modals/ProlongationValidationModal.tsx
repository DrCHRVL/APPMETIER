import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useState, useEffect } from 'react';
import { Label } from '../ui/label';
import { DateUtils } from '@/utils/dateUtils';
import { useToast } from '@/contexts/ToastContext';
import { Alert, AlertCircle } from 'lucide-react';

interface ProlongationValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onValidate: (date: string, duration: string) => void;
  originalStartDate?: string;
  originalDuration?: string;
  poseDate?: string;
}

export const ProlongationValidationModal = ({
  isOpen,
  onClose,
  onValidate,
  originalStartDate,
  originalDuration,
  poseDate
}: ProlongationValidationModalProps) => {
  const [date, setDate] = useState('');
  const [duration, setDuration] = useState('30');
  const [calculatedEndDate, setCalculatedEndDate] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const { showToast } = useToast();

  // Pré-remplir avec la date du jour à l'ouverture
  useEffect(() => {
    if (isOpen) {
      const today = new Date().toISOString().split('T')[0];
      setDate(today);
      setDuration('30');
    }
  }, [isOpen]);

  // Calculer la date de fin initiale
  const initialEndDate = poseDate && originalDuration 
    ? DateUtils.calculateActeEndDate(poseDate, originalDuration)
    : null;

  useEffect(() => {
    if (date && initialEndDate) {
      // Vérifier si la date d'autorisation est postérieure à la date de fin initiale
      if (DateUtils.isAfter(date, initialEndDate)) {
        setWarning("Attention : la date d'autorisation est postérieure à la date de fin initiale de l'acte");
      } else {
        setWarning(null);
      }
    }
  }, [date, initialEndDate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      onValidate(date, duration);
      showToast('Prolongation validée', 'success');
      setTimeout(() => onClose(), 500);
    } catch (error) {
      showToast('Erreur lors de la validation', 'error');
    }
  };

  const handleDurationChange = (newDuration: string) => {
    setDuration(newDuration);
    if (initialEndDate) {
      const endDate = DateUtils.calculateProlongationEndDate(initialEndDate, newDuration);
      setCalculatedEndDate(endDate);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Validation de la prolongation</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="text-sm text-gray-600">
            <p>Date d'autorisation initiale: {DateUtils.formatDate(originalStartDate || '')}</p>
            <p>Date de pose: {DateUtils.formatDate(poseDate || '')}</p>
            <p>Durée initiale: {originalDuration} jours</p>
            <p>Date de fin initiale: {DateUtils.formatDate(initialEndDate || '')}</p>
          </div>

          {warning && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 my-2">
              <div className="flex items-center">
                <AlertCircle className="h-5 w-5 text-yellow-400 mr-2" />
                <p className="text-sm text-yellow-700">{warning}</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Date de prolongation JLD</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className={warning ? 'border-yellow-400' : ''}
            />
          </div>

          <div className="space-y-2">
            <Label>Durée autorisée (jours)</Label>
            <Input
              type="number"
              min="1"
              value={duration}
              onChange={(e) => handleDurationChange(e.target.value)}
              required
            />
          </div>

          {calculatedEndDate && (
            <div className="text-sm text-gray-600">
              <p>Nouvelle date de fin : {DateUtils.formatDate(calculatedEndDate)}</p>
              <p>Durée totale: {parseInt(originalDuration || '0') + parseInt(duration)} jours</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit">
              Valider la prolongation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};