// hooks/useInstructionAlerts.ts
import { useState, useEffect, useCallback, useMemo } from 'react';
import { EnqueteInstruction, AlerteInstruction, calculateDPAlert } from '@/types/interfaces';
import { ElectronBridge } from '@/utils/electronBridge';
import throttle from 'lodash/throttle';

const ALERT_CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes
const THROTTLE_DELAY = 2000; // 2 secondes

export const useInstructionAlerts = (instructions: EnqueteInstruction[]) => {
  const [instructionAlerts, setInstructionAlerts] = useState<AlerteInstruction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Génération automatique des alertes depuis les données
  const generateInstructionAlerts = useCallback(() => {
    const alerts: AlerteInstruction[] = [];
    let alertId = Date.now();

    instructions.forEach(instruction => {
      // Alertes DP (1 mois avant expiration)
      if (instruction.mesuresSurete?.dp) {
        const dpAlert = calculateDPAlert(instruction.mesuresSurete.dp.dateFin);
        
        if (dpAlert.alerteActive) {
          alerts.push({
            id: alertId++,
            instructionId: instruction.id,
            enqueteId: instruction.id, // Compatibilité avec le système existant
            cabinetId: instruction.cabinet,
            type: 'dp_expiration',
            alerteType: 'dp_expiration',
            message: `DP expire dans ${dpAlert.joursRestants} jour${dpAlert.joursRestants > 1 ? 's' : ''}`,
            createdAt: new Date().toISOString(),
            status: 'active',
            deadline: instruction.mesuresSurete.dp.dateFin
          });
        }
      }

      // Alertes DML en retard (si échéance dépassée)
      instruction.dmls?.forEach(dml => {
        if (dml.statut === 'en_attente') {
          const now = new Date();
          const echeance = new Date(dml.dateEcheance);
          
          if (echeance < now) {
            const joursRetard = Math.ceil((now.getTime() - echeance.getTime()) / (1000 * 60 * 60 * 24));
            
            alerts.push({
              id: alertId++,
              instructionId: instruction.id,
              enqueteId: instruction.id,
              cabinetId: instruction.cabinet,
              type: 'dml_retard',
              alerteType: 'dml_retard',
              message: `DML en retard de ${joursRetard} jour${joursRetard > 1 ? 's' : ''} (déposée le ${new Date(dml.dateDepot).toLocaleDateString()})`,
              createdAt: new Date().toISOString(),
              status: 'active',
              deadline: dml.dateEcheance,
              acteId: dml.id
            });
          }
        }
      });

      // Alertes délai 175 CPP (1 mois si détenu, 3 mois sinon)
      if (instruction.etatReglement === 'instruction') {
        const hasDetention = instruction.mesuresSurete?.dp !== undefined;
        const delaiMax = hasDetention ? 30 : 90; // jours
        
        const joursDepuis = Math.ceil(
          (new Date().getTime() - new Date(instruction.dateDebut).getTime()) / (1000 * 60 * 60 * 24)
        );
        
        // Alerte à 7 jours avant l'échéance
        if (joursDepuis >= delaiMax - 7) {
          const joursRestants = delaiMax - joursDepuis;
          
          alerts.push({
            id: alertId++,
            instructionId: instruction.id,
            enqueteId: instruction.id,
            cabinetId: instruction.cabinet,
            type: 'delai_175',
            alerteType: 'delai_175',
            message: joursRestants > 0 
              ? `Délai 175 CPP dans ${joursRestants} jour${joursRestants > 1 ? 's' : ''} ${hasDetention ? '(détenu)' : '(libre)'}`
              : `Délai 175 CPP dépassé de ${Math.abs(joursRestants)} jour${Math.abs(joursRestants) > 1 ? 's' : ''} ${hasDetention ? '(détenu)' : '(libre)'}`,
            createdAt: new Date().toISOString(),
            status: 'active',
            deadline: new Date(new Date(instruction.dateDebut).getTime() + (delaiMax * 24 * 60 * 60 * 1000)).toISOString()
          });
        }
      }
    });

    return alerts;
  }, [instructions]);

  // Mise à jour des alertes avec throttle
  const updateInstructionAlerts = useCallback(
    throttle(async () => {
      if (isLoading) return;

      try {
        // Charger les alertes existantes pour préserver les états "snoozed"
        const existingAlerts = await ElectronBridge.getData<AlerteInstruction[]>('instruction_alerts', []);
        const existingAlertsMap = new Map(
          existingAlerts.map(alert => [
            `${alert.instructionId}-${alert.type}-${alert.acteId || ''}`,
            alert
          ])
        );

        // Générer les nouvelles alertes
        const newAlerts = generateInstructionAlerts();
        
        // Préserver les états "snoozed" des alertes existantes
        const alertsWithState = newAlerts.map(alert => {
          const key = `${alert.instructionId}-${alert.type}-${alert.acteId || ''}`;
          const existing = existingAlertsMap.get(key);
          
          if (existing?.status === 'snoozed') {
            const snoozeEndDate = new Date(existing.snoozedUntil!);
            if (new Date() < snoozeEndDate) {
              return {
                ...alert,
                status: 'snoozed',
                snoozedUntil: existing.snoozedUntil,
                snoozedCount: existing.snoozedCount
              };
            }
          }
          
          return alert;
        });

        setInstructionAlerts(alertsWithState);
        await ElectronBridge.setData('instruction_alerts', alertsWithState);
      } catch (error) {
        console.error('Erreur lors de la mise à jour des alertes instruction:', error);
      }
    }, THROTTLE_DELAY),
    [generateInstructionAlerts, isLoading]
  );

  // Chargement initial
  useEffect(() => {
    const loadAlerts = async () => {
      try {
        setIsLoading(true);
        const savedAlerts = await ElectronBridge.getData<AlerteInstruction[]>('instruction_alerts', []);
        setInstructionAlerts(Array.isArray(savedAlerts) ? savedAlerts : []);
      } catch (error) {
        console.error('Erreur lors du chargement des alertes instruction:', error);
        setInstructionAlerts([]);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadAlerts();
  }, []);

  // Mise à jour périodique
  useEffect(() => {
    if (!isLoading) {
      // Première mise à jour après chargement
      const initialTimeout = setTimeout(() => {
        updateInstructionAlerts();
      }, 1000);
      
      // Mise à jour périodique
      const interval = setInterval(updateInstructionAlerts, ALERT_CHECK_INTERVAL);
      
      return () => {
        clearTimeout(initialTimeout);
        clearInterval(interval);
        updateInstructionAlerts.cancel();
      };
    }
  }, [updateInstructionAlerts, isLoading]);

  // Validation d'une alerte
  const handleValidateInstructionAlert = useCallback(
    throttle(async (alertId: number | number[]) => {
      const alertsToValidate = Array.isArray(alertId) 
        ? instructionAlerts.filter(a => alertId.includes(a.id))
        : instructionAlerts.filter(a => a.id === alertId);

      // Marquer comme validées dans un stockage persistent
      for (const alert of alertsToValidate) {
        const validationKey = `instruction_alert_validated_${alert.instructionId}_${alert.type}_${alert.acteId || 'none'}`;
        await ElectronBridge.setData(validationKey, {
          validatedAt: new Date().toISOString(),
          alertType: alert.type
        });
      }

      // Supprimer des alertes actives
      const updatedAlerts = instructionAlerts.filter(alert => {
        return !(Array.isArray(alertId) ? alertId.includes(alert.id) : alert.id === alertId);
      });

      setInstructionAlerts(updatedAlerts);
      await ElectronBridge.setData('instruction_alerts', updatedAlerts);
    }, THROTTLE_DELAY),
    [instructionAlerts]
  );

  // Mise en pause d'une alerte
  const handleSnoozeInstructionAlert = useCallback(
    throttle(async (alertId: number) => {
      const snoozeDate = new Date();
      snoozeDate.setDate(snoozeDate.getDate() + 7); // 7 jours

      const updatedAlerts = instructionAlerts.map(alert => 
        alert.id === alertId 
          ? {
              ...alert,
              status: 'snoozed',
              snoozedUntil: snoozeDate.toISOString(),
              snoozedCount: (alert.snoozedCount || 0) + 1
            }
          : alert
      );

      setInstructionAlerts(updatedAlerts);
      await ElectronBridge.setData('instruction_alerts', updatedAlerts);
    }, THROTTLE_DELAY),
    [instructionAlerts]
  );

  // Filtrer les alertes actives pour l'affichage
  const activeInstructionAlerts = useMemo(() => 
    instructionAlerts.filter(alert => alert.status === 'active'),
    [instructionAlerts]
  );

  // Stats par cabinet
  const alertStatsByCabinet = useMemo(() => {
    const stats = { '1': 0, '2': 0, '3': 0, '4': 0 };
    activeInstructionAlerts.forEach(alert => {
      if (alert.cabinetId in stats) {
        stats[alert.cabinetId as keyof typeof stats]++;
      }
    });
    return stats;
  }, [activeInstructionAlerts]);

  return {
    instructionAlerts: activeInstructionAlerts,
    allInstructionAlerts: instructionAlerts,
    isLoading,
    alertStatsByCabinet,
    updateInstructionAlerts,
    handleValidateInstructionAlert,
    handleSnoozeInstructionAlert
  };
};