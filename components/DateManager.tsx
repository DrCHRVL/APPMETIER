import React, { useState, useEffect } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';

interface DateManagerData {
  dateDebut: string;
  dateFin: string;
  datePose: string | null;
  duree: string;
}

interface DateManagerProps {
  onSubmit: (dates: DateManagerData) => void;
  initialData?: DateManagerData | null;
  type: 'ecoute' | 'geoloc' | 'acte';
  disableDateInput?: boolean;
}

const DateManager = ({ 
  onSubmit, 
  initialData = undefined,
  type,
  disableDateInput = false
}: DateManagerProps) => {
  const [dates, setDates] = useState({
    dateDebut: initialData?.dateDebut || '',
    datePose: initialData?.datePose || '',
    duree: initialData?.duree || '30'
  });

  const calculerDateFin = () => {
    if ((!dates.datePose && !dates.dateDebut) || !dates.duree) return '';
    const debut = new Date(dates.datePose || dates.dateDebut);
    debut.setDate(debut.getDate() + parseInt(dates.duree));
    return debut.toISOString().split('T')[0];
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const dateFin = calculerDateFin();
    
    onSubmit({
      dateDebut: dates.dateDebut,
      dateFin,
      datePose: dates.datePose,
      duree: dates.duree
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!disableDateInput && (
        <div>
          <Label>Date d'autorisation</Label>
          <Input
            type="date"
            value={dates.dateDebut}
            onChange={(e) => setDates(prev => ({
              ...prev,
              dateDebut: e.target.value
            }))}
            required={!disableDateInput}
          />
        </div>
      )}

      <div>
        <Label>Durée (jours)</Label>
        <Input
          type="number"
          min="1"
          value={dates.duree}
          onChange={(e) => setDates(prev => ({
            ...prev,
            duree: e.target.value
          }))}
          required
        />
      </div>

      {!disableDateInput && (
        <div>
          <Label>Date de pose</Label>
          <Input
            type="date"
            value={dates.datePose}
            onChange={(e) => setDates(prev => ({
              ...prev,
              datePose: e.target.value
            }))}
            min={dates.dateDebut}
          />
        </div>
      )}

      {calculerDateFin() && !disableDateInput && (
        <p className="text-sm text-gray-600">
          Date de fin calculée: {new Date(calculerDateFin()).toLocaleDateString()}
        </p>
      )}

      {disableDateInput && (
        <p className="text-sm text-amber-600">
          Cet acte nécessite une autorisation JLD. Vous pourrez renseigner la date après validation par le juge.
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="submit">
          {initialData ? 'Modifier' : 'Ajouter'}
        </Button>
      </div>
    </form>
  );
};

export default DateManager;