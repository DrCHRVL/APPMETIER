import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Alert } from '@/types/interfaces';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { AlertManager } from '@/utils/alerts/alertManager';
import { Input } from '../ui/input';
import { CalendarDays, Clock } from 'lucide-react';

interface AlertsModalProps {
  isOpen: boolean;
  onClose: () => void;
  alerts: Alert[];
  onValidateAlert: (alertId: number | number[]) => void;
  onSnoozeAlert: (alertId: number, daysOrDate: number | string) => void;
}

export const AlertsModal = ({
  isOpen,
  onClose,
  alerts,
  onValidateAlert,
  onSnoozeAlert
}: AlertsModalProps) => {
  const [snoozeType, setSnoozeType] = useState<'days' | 'date'>('days');
  const [snoozeDays, setSnoozeDays] = useState(7);
  const [snoozeDate, setSnoozeDate] = useState<string>('');
  const [snoozeAlertId, setSnoozeAlertId] = useState<number | null>(null);
  const [showSnoozeOptions, setShowSnoozeOptions] = useState(false);

  const handleValidateAll = async () => {
    // Marquer chaque alerte comme validée dans l'historique des validations
    for (const alert of alerts) {
      await AlertManager.markAlertAsValidated(alert);
    }
    
    const alertIds = alerts.map(alert => alert.id);
    onValidateAlert(alertIds);
    onClose();
  };

  const handleValidateAlertGroup = async (groupAlerts: Alert[]) => {
    // Marquer chaque alerte comme validée dans l'historique des validations
    for (const alert of groupAlerts) {
      await AlertManager.markAlertAsValidated(alert);
    }
    
    const alertIds = groupAlerts.map(alert => alert.id);
    onValidateAlert(alertIds);
  };

  const handleValidateSingleAlert = async (alert: Alert) => {
    // Marquer l'alerte comme validée dans l'historique des validations
    await AlertManager.markAlertAsValidated(alert);
    
    onValidateAlert(alert.id);
  };

  const openSnoozeOptions = (alertId: number) => {
    setSnoozeAlertId(alertId);
    setShowSnoozeOptions(true);
  };

  const handleSnoozeSubmit = () => {
    if (!snoozeAlertId) return;

    if (snoozeType === 'days') {
      onSnoozeAlert(snoozeAlertId, snoozeDays);
    } else if (snoozeType === 'date' && snoozeDate) {
      onSnoozeAlert(snoozeAlertId, snoozeDate);
    }

    // Réinitialiser les valeurs
    setShowSnoozeOptions(false);
    setSnoozeAlertId(null);
  };

  // Regrouper les alertes par type (enquête vs AIR)
  const alertsByGroup = alerts.reduce((acc, alert) => {
    const groupKey = alert.isAIRAlert 
      ? `air-${alert.enqueteId}`
      : `enquete-${alert.enqueteId}`;
    
    if (!acc[groupKey]) {
      acc[groupKey] = {
        type: alert.isAIRAlert ? 'air' : 'enquete',
        id: alert.enqueteId,
        title: alert.isAIRAlert 
          ? `AIR - ${alert.airIdentite || ''} ${alert.airNumeroParquet ? `(${alert.airNumeroParquet})` : ''}`
          : `Enquête ${alert.enqueteId}`,
        alerts: []
      };
    }
    acc[groupKey].alerts.push(alert);
    return acc;
  }, {} as Record<string, { type: 'air' | 'enquete', id: number, title: string, alerts: Alert[] }>);

  // Obtenir la date minimale pour le sélecteur de date (aujourd'hui)
  const today = new Date().toISOString().split('T')[0];

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader className="flex flex-row items-center justify-between">
            <DialogTitle>Alertes actives ({alerts.length})</DialogTitle>
            {alerts.length > 0 && (
              <Button
                variant="default"
                onClick={handleValidateAll}
                className="ml-4"
              >
                Tout valider
              </Button>
            )}
          </DialogHeader>
          <div className="space-y-6">
            {Object.values(alertsByGroup).map((group) => (
              <div key={`${group.type}-${group.id}`} className="border rounded-lg p-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-medium">{group.title}</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleValidateAlertGroup(group.alerts)}
                  >
                    Valider pour {group.type === 'air' ? 'cette mesure' : 'cette enquête'}
                  </Button>
                </div>
                <div className="space-y-4">
                  {group.alerts.map(alert => (
                    <div key={alert.id} className="flex items-center justify-between p-4 border rounded">
                      <div>
                        <p className="font-medium">{alert.message}</p>
                        <p className="text-sm text-gray-500">
                          il y a environ {formatDistanceToNow(new Date(alert.createdAt), { locale: fr })}
                        </p>
                        {alert.type && (
                          <div className="mt-1">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
                              ${alert.type === 'cr_delay' ? 'bg-yellow-100 text-yellow-800' : ''}
                              ${alert.type === 'acte_expiration' ? 'bg-red-100 text-red-800' : ''}
                              ${alert.type === 'enquete_age' ? 'bg-blue-100 text-blue-800' : ''}
                              ${alert.type === 'prolongation_pending' ? 'bg-purple-100 text-purple-800' : ''}
                              ${alert.type === 'air_6_mois' ? 'bg-orange-100 text-orange-800' : ''}
                              ${alert.type === 'air_12_mois' ? 'bg-red-100 text-red-800' : ''}
                              ${alert.type === 'air_rdv_delai' ? 'bg-amber-100 text-amber-800' : ''}
                            `}>
                              {alert.type === 'cr_delay' ? 'Compte rendu' : ''}
                              {alert.type === 'acte_expiration' ? 'Expiration acte' : ''}
                              {alert.type === 'enquete_age' ? 'Âge enquête' : ''}
                              {alert.type === 'prolongation_pending' ? 'Prolongation' : ''}
                              {alert.type === 'air_6_mois' ? 'AIR > 6 mois' : ''}
                              {alert.type === 'air_12_mois' ? 'AIR > 12 mois' : ''}
                              {alert.type === 'air_rdv_delai' ? 'RDV AIR délai' : ''}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => openSnoozeOptions(alert.id)}
                        >
                          Reporter
                        </Button>
                        <Button
                          variant="default"
                          onClick={() => handleValidateSingleAlert(alert)}
                        >
                          Valider
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal pour les options de report */}
      <Dialog open={showSnoozeOptions} onOpenChange={setShowSnoozeOptions}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Options de report</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={snoozeType === 'days' ? 'default' : 'outline'}
                onClick={() => setSnoozeType('days')}
                className="flex items-center gap-2"
              >
                <Clock className="h-4 w-4" />
                <span>Par nombre de jours</span>
              </Button>
              <Button
                variant={snoozeType === 'date' ? 'default' : 'outline'}
                onClick={() => setSnoozeType('date')}
                className="flex items-center gap-2"
              >
                <CalendarDays className="h-4 w-4" />
                <span>Jusqu'à une date</span>
              </Button>
            </div>

            {snoozeType === 'days' ? (
              <div>
                <label className="text-sm font-medium mb-2 block">Reporter pour combien de jours ?</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="1"
                    value={snoozeDays}
                    onChange={(e) => setSnoozeDays(Number(e.target.value))}
                    className="w-20"
                  />
                  <span>jours</span>
                </div>
              </div>
            ) : (
              <div>
                <label className="text-sm font-medium mb-2 block">Reporter jusqu'à quelle date ?</label>
                <Input
                  type="date"
                  value={snoozeDate}
                  onChange={(e) => setSnoozeDate(e.target.value)}
                  min={today}
                  className="w-full"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowSnoozeOptions(false)}>
              Annuler
            </Button>
            <Button 
              onClick={handleSnoozeSubmit}
              disabled={(snoozeType === 'date' && !snoozeDate) || (snoozeType === 'days' && (!snoozeDays || snoozeDays < 1))}
            >
              Confirmer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};