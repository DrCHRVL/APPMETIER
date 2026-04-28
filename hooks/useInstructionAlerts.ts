// hooks/useInstructionAlerts.ts
//
// Alertes d'instruction (DP expiration, DML retard, délai 175) personnelles.
// Stockage par utilisateur dans la prefs (`instructionAlerts.alerts`) ; seed
// initial depuis l'ancienne clé locale `instruction_alerts`.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { EnqueteInstruction, AlerteInstruction } from '@/types/interfaces';
import { calculateDPAlert } from '@/utils/instructionUtils';
import { ElectronBridge } from '@/utils/electronBridge';
import { useUserPreferences } from './useUserPreferences';
import throttle from 'lodash/throttle';

const ALERT_CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes
const THROTTLE_DELAY = 2000; // 2 secondes
const LEGACY_STORAGE_KEY = 'instruction_alerts';

export const useInstructionAlerts = (instructions: EnqueteInstruction[]) => {
  const {
    instructionAlerts: instructionAlertsPrefs,
    isLoading: prefsLoading,
    setInstructionAlerts: setInstructionAlertsPrefs,
    seedInstructionAlerts,
  } = useUserPreferences();

  const seedAttemptedRef = useRef(false);

  // Seed initial depuis l'ancienne clé locale.
  useEffect(() => {
    if (prefsLoading) return;
    if (instructionAlertsPrefs?.seeded) return;
    if (seedAttemptedRef.current) return;
    seedAttemptedRef.current = true;
    (async () => {
      try {
        const legacy = await ElectronBridge.getData<AlerteInstruction[]>(LEGACY_STORAGE_KEY, []);
        await seedInstructionAlerts(Array.isArray(legacy) ? legacy : []);
      } catch (error) {
        console.error('Seed instructionAlerts échoué:', error);
        seedAttemptedRef.current = false;
      }
    })();
  }, [prefsLoading, instructionAlertsPrefs?.seeded, seedInstructionAlerts]);

  const instructionAlerts = useMemo<AlerteInstruction[]>(
    () => instructionAlertsPrefs?.alerts || [],
    [instructionAlertsPrefs?.alerts],
  );

  const generateInstructionAlerts = useCallback(() => {
    const alerts: AlerteInstruction[] = [];
    let alertId = Date.now();

    instructions.forEach(instruction => {
      if (instruction.mesuresSurete?.dp) {
        const dpAlert = calculateDPAlert(instruction.mesuresSurete.dp.dateFin);

        if (dpAlert.alerteActive) {
          alerts.push({
            id: alertId++,
            instructionId: instruction.id,
            enqueteId: instruction.id,
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

      if (instruction.etatReglement === 'instruction') {
        const hasDetention = instruction.mesuresSurete?.dp !== undefined;
        const delaiMax = hasDetention ? 30 : 90;

        const joursDepuis = Math.ceil(
          (new Date().getTime() - new Date(instruction.dateDebut).getTime()) / (1000 * 60 * 60 * 24)
        );

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

  const updateInstructionAlerts = useCallback(
    throttle(async () => {
      if (prefsLoading || !instructionAlertsPrefs?.seeded) return;

      try {
        const existingAlerts: AlerteInstruction[] = instructionAlerts;
        const existingAlertsMap = new Map<string, AlerteInstruction>(
          existingAlerts.map(alert => [
            `${alert.instructionId}-${alert.type}-${alert.acteId || ''}`,
            alert,
          ] as [string, AlerteInstruction])
        );

        const newAlerts = generateInstructionAlerts();

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

        await setInstructionAlertsPrefs(alertsWithState);
      } catch (error) {
        console.error('Erreur lors de la mise à jour des alertes instruction:', error);
      }
    }, THROTTLE_DELAY),
    [generateInstructionAlerts, prefsLoading, instructionAlertsPrefs?.seeded, instructionAlerts, setInstructionAlertsPrefs]
  );

  useEffect(() => {
    if (!prefsLoading && instructionAlertsPrefs?.seeded) {
      const initialTimeout = setTimeout(() => {
        updateInstructionAlerts();
      }, 1000);

      const interval = setInterval(updateInstructionAlerts, ALERT_CHECK_INTERVAL);

      return () => {
        clearTimeout(initialTimeout);
        clearInterval(interval);
        updateInstructionAlerts.cancel();
      };
    }
  }, [updateInstructionAlerts, prefsLoading, instructionAlertsPrefs?.seeded]);

  const handleValidateInstructionAlert = useCallback(
    throttle(async (alertId: number | number[]) => {
      const alertsToValidate = Array.isArray(alertId)
        ? instructionAlerts.filter(a => alertId.includes(a.id))
        : instructionAlerts.filter(a => a.id === alertId);

      // Conserver le marqueur de validation per-user pour ne pas régénérer.
      // Conservé sous l'ancienne clé local-only (par machine) car la
      // régénération se fait par poste ; pas critique de migrer.
      for (const alert of alertsToValidate) {
        const validationKey = `instruction_alert_validated_${alert.instructionId}_${alert.type}_${alert.acteId || 'none'}`;
        await ElectronBridge.setData(validationKey, {
          validatedAt: new Date().toISOString(),
          alertType: alert.type
        });
      }

      const updatedAlerts = instructionAlerts.filter(alert => {
        return !(Array.isArray(alertId) ? alertId.includes(alert.id) : alert.id === alertId);
      });

      await setInstructionAlertsPrefs(updatedAlerts);
    }, THROTTLE_DELAY),
    [instructionAlerts, setInstructionAlertsPrefs]
  );

  const handleSnoozeInstructionAlert = useCallback(
    throttle(async (alertId: number) => {
      const snoozeDate = new Date();
      snoozeDate.setDate(snoozeDate.getDate() + 7);

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

      await setInstructionAlertsPrefs(updatedAlerts);
    }, THROTTLE_DELAY),
    [instructionAlerts, setInstructionAlertsPrefs]
  );

  const activeInstructionAlerts = useMemo(() =>
    instructionAlerts.filter(alert => alert.status === 'active'),
    [instructionAlerts]
  );

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
    isLoading: prefsLoading,
    alertStatsByCabinet,
    updateInstructionAlerts,
    handleValidateInstructionAlert,
    handleSnoozeInstructionAlert
  };
};
