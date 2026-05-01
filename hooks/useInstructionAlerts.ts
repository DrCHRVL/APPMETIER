// hooks/useInstructionAlerts.ts
//
// STUB — PR1 du rebuild module instruction.
// L'ancien moteur d'alertes (DP expiration, DML retard, délai 175) reposait
// sur l'ancien modèle `EnqueteInstruction`. Il sera réécrit en PR3 (alertes
// tweakables : seuils, snooze, couleurs visuelles, etc.).
//
// En attendant, ce hook conserve l'API attendue par les composants qui
// l'utilisent (essentiellement la sync per-user des alertes archivées) mais
// ne génère plus aucune alerte automatique.

import { useCallback, useMemo } from 'react';
import { useUserPreferences } from './useUserPreferences';
import type { AlerteInstruction } from '@/types/interfaces';
import type { DossierInstruction } from '@/types/instructionTypes';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const useInstructionAlerts = (_dossiers: DossierInstruction[]) => {
  const {
    instructionAlerts: prefs,
    isLoading,
    setInstructionAlerts,
  } = useUserPreferences();

  const allAlerts = useMemo<AlerteInstruction[]>(
    () => prefs?.alerts || [],
    [prefs?.alerts],
  );

  const activeAlerts = useMemo(
    () => allAlerts.filter(a => a.status === 'active'),
    [allAlerts],
  );

  const handleValidateAlert = useCallback(
    async (alertId: number | number[]) => {
      const ids = Array.isArray(alertId) ? alertId : [alertId];
      await setInstructionAlerts(allAlerts.filter(a => !ids.includes(a.id)));
    },
    [allAlerts, setInstructionAlerts],
  );

  const handleSnoozeAlert = useCallback(
    async (alertId: number, days = 7) => {
      const snoozedUntil = new Date();
      snoozedUntil.setDate(snoozedUntil.getDate() + days);
      const next = allAlerts.map(a =>
        a.id === alertId
          ? {
              ...a,
              status: 'snoozed' as const,
              snoozedUntil: snoozedUntil.toISOString(),
              snoozedCount: (a.snoozedCount || 0) + 1,
            }
          : a,
      );
      await setInstructionAlerts(next);
    },
    [allAlerts, setInstructionAlerts],
  );

  const updateInstructionAlerts = useCallback(async () => {
    // No-op : la génération automatique sera réintroduite en PR3.
  }, []);

  return {
    instructionAlerts: activeAlerts,
    allInstructionAlerts: allAlerts,
    isLoading,
    updateInstructionAlerts,
    handleValidateInstructionAlert: handleValidateAlert,
    handleSnoozeInstructionAlert: handleSnoozeAlert,
  };
};
