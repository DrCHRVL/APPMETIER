import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useState, useEffect, FormEvent } from 'react';
import { Label } from '../ui/label';
import { DateUtils } from '@/utils/dateUtils';
import { useToast } from '@/contexts/ToastContext';
import { AlertCircle } from 'lucide-react';

interface ProlongationValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onValidate: (date: string, duration: string, dureeUnit?: 'jours' | 'mois') => void;
  originalStartDate?: string;
  originalDuration?: string;
  originalDureeUnit?: 'jours' | 'mois';
  poseDate?: string;
  // Date de fin actuelle de l'acte (inclut les prolongations déjà validées)
  currentDateFin?: string;
  // Unité de la prolongation (peut différer de l'acte initial — ex: géoloc 15j puis prolongations 1 mois)
  prolongationDureeUnit?: 'jours' | 'mois';
  defaultProlongationDuree?: string;
}

export const ProlongationValidationModal = ({
  isOpen,
  onClose,
  onValidate,
  originalStartDate,
  originalDuration,
  originalDureeUnit = 'jours',
  poseDate,
  currentDateFin,
  prolongationDureeUnit = 'jours',
  defaultProlongationDuree,
}: ProlongationValidationModalProps) => {
  const defaultDuration = defaultProlongationDuree ?? (prolongationDureeUnit === 'mois' ? '1' : '30');
  const [date, setDate] = useState('');
  const [duration, setDuration] = useState(defaultDuration);
  const [calculatedEndDate, setCalculatedEndDate] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    if (isOpen) {
      const today = new Date().toISOString().split('T')[0];
      setDate(today);
      setDuration(defaultDuration);
      setCalculatedEndDate(null);
      setDateError(null);
    }
  }, [isOpen, defaultDuration]);

  // Date de fin actuelle de l'acte : utiliser currentDateFin (qui inclut les prolongations)
  // ou recalculer depuis les données initiales si non fournie
  const initialEndDate = (() => {
    if (currentDateFin) return currentDateFin;
    const ref = poseDate || originalStartDate;
    if (!ref || !originalDuration) return null;
    return DateUtils.calculateEndDateWithUnit(ref, originalDuration, originalDureeUnit);
  })();

  // La date de prolongation/autorisation doit être renseignée DANS la fenêtre de
  // validité de l'acte : au plus tard à sa date de fin. Une date postérieure est
  // bloquée (l'utilisateur doit antidater dans la fenêtre). Pour prolonger un acte
  // échu, il faut donc antidater l'autorisation au plus tard à sa date de fin.
  const refStartDate = poseDate || originalStartDate;
  useEffect(() => {
    if (!date) {
      setDateError(null);
      return;
    }
    if (initialEndDate && DateUtils.isAfter(date, initialEndDate)) {
      setDateError(
        `La date de prolongation ne peut pas être postérieure à la date de fin de l'acte (${DateUtils.formatDate(initialEndDate)}). Antidatez la prolongation dans la fenêtre de validité.`
      );
    } else if (refStartDate && DateUtils.isAfter(refStartDate, date)) {
      setDateError(
        `La date de prolongation ne peut pas être antérieure au début de l'acte (${DateUtils.formatDate(refStartDate)}).`
      );
    } else {
      setDateError(null);
    }
  }, [date, initialEndDate, refStartDate]);

  useEffect(() => {
    if (initialEndDate && duration) {
      const endDate = DateUtils.calculateEndDateWithUnit(initialEndDate, duration, prolongationDureeUnit);
      setCalculatedEndDate(endDate);
    }
  }, [duration, initialEndDate, prolongationDureeUnit]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (dateError) {
      showToast(dateError, 'error');
      return;
    }
    try {
      onValidate(date, duration, prolongationDureeUnit);
      showToast('Prolongation validée', 'success');
      setTimeout(() => onClose(), 500);
    } catch (error) {
      showToast('Erreur lors de la validation', 'error');
    }
  };

  const isMois = prolongationDureeUnit === 'mois';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Validation de la prolongation</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="text-sm text-gray-600 space-y-1">
            <p>Date d'autorisation initiale : {DateUtils.formatDate(originalStartDate || '')}</p>
            <p>Date de pose : {DateUtils.formatDate(poseDate || '')}</p>
            <p>
              Durée initiale :{' '}
              {originalDureeUnit === 'mois'
                ? `${originalDuration} mois`
                : `${originalDuration} jours`}
            </p>
            <p>Date de fin initiale : <span className="font-medium">{DateUtils.formatDate(initialEndDate || '')}</span></p>
          </div>

          {dateError && (
            <div className="bg-red-50 border-l-4 border-red-400 p-4">
              <div className="flex items-center">
                <AlertCircle className="h-5 w-5 text-red-400 mr-2 flex-shrink-0" />
                <p className="text-sm text-red-700">{dateError}</p>
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
              className={dateError ? 'border-red-400' : ''}
            />
          </div>

          <div className="space-y-2">
            <Label>Durée autorisée ({isMois ? 'mois' : 'jours'})</Label>
            {isMois ? (
              <div className="flex items-center gap-2 p-2 bg-blue-50 rounded border border-blue-200 text-sm text-blue-900">
                <span className="font-semibold">1 mois calendaire</span>
                <span className="text-blue-600">(fixé par la loi)</span>
              </div>
            ) : (
              <Input
                type="number"
                min="1"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                required
              />
            )}
          </div>

          {calculatedEndDate && (
            <div className="text-sm text-gray-600 space-y-1">
              <p>Nouvelle date de fin : <span className="font-medium">{DateUtils.formatDate(calculatedEndDate)}</span></p>
              {!isMois && (
                <p>Durée totale : {parseInt(originalDuration || '0') + parseInt(duration)} jours</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={!!dateError}>
              Valider la prolongation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
