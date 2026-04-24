// hooks/useAlerts.ts
//
// Règles d'alertes globales personnelles. Les règles sont lues/écrites dans
// la prefs utilisateur (`UserPreferencesFile.alertRules.global`) ; la liste
// d'alertes actives (`alerts`) reste un cache machine. Le seed initial copie
// l'ancienne clé globale `alert_rules` une fois par utilisateur.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Alert, AlertRule, Enquete } from '@/types/interfaces';
import { APP_CONFIG } from '@/config/constants';
import { ElectronBridge } from '@/utils/electronBridge';
import { AlertManager } from '@/utils/alerts/alertManager';
import { alertSyncService } from '@/utils/dataSync/AlertSyncService';
import { useUserPreferences } from './useUserPreferences';
import { AlertValidations } from '@/types/interfaces';
import throttle from 'lodash/throttle';

const ALERT_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes
const THROTTLE_DELAY = 3000; // 3 secondes

export const useAlerts = (enquetes: Enquete[]) => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const {
    alertRules: alertRulesPrefs,
    alertValidations: alertValidationsPrefs,
    isLoading: prefsLoading,
    setAlertRulesGlobal,
    seedAlertRulesGlobal,
    seedAlertValidations,
  } = useUserPreferences();

  const alertRules = useMemo<AlertRule[]>(
    () => (alertRulesPrefs?.global && alertRulesPrefs.global.length > 0)
      ? alertRulesPrefs.global
      : APP_CONFIG.DEFAULT_ALERT_RULES,
    [alertRulesPrefs?.global]
  );

  const enquetesRef = useRef<Enquete[]>([]);
  const alertRulesRef = useRef<AlertRule[]>([]);
  const isLoadingRef = useRef(true);
  const lastProcessedEnquetes = useRef<Record<number, string>>({});
  const alertsLoaded = useRef(false);
  const seedAttemptedRef = useRef(false);
  const seedValidationsAttemptedRef = useRef(false);

  useEffect(() => { enquetesRef.current = enquetes; }, [enquetes]);
  useEffect(() => { alertRulesRef.current = alertRules; }, [alertRules]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

  // Seed initial : pull alerts-data.json global une dernière fois,
  // puis copier les règles dans la prefs utilisateur (no-op si déjà seedé).
  useEffect(() => {
    if (prefsLoading) return;
    if (alertRulesPrefs?.seeded) return;
    if (seedAttemptedRef.current) return;
    seedAttemptedRef.current = true;
    (async () => {
      try {
        await alertSyncService.sync();
        const legacy = await ElectronBridge.getData<AlertRule[]>(
          APP_CONFIG.STORAGE_KEYS.ALERT_RULES,
          APP_CONFIG.DEFAULT_ALERT_RULES,
        );
        const arr = Array.isArray(legacy) && legacy.length > 0
          ? legacy
          : APP_CONFIG.DEFAULT_ALERT_RULES;
        await seedAlertRulesGlobal(arr);
      } catch (error) {
        console.error('Seed alertRules global échoué:', error);
        seedAttemptedRef.current = false;
      }
    })();
  }, [prefsLoading, alertRulesPrefs?.seeded, seedAlertRulesGlobal]);

  // Seed initial des validations : copie l'historique partagé existant dans
  // la prefs personnelle, une seule fois par utilisateur.
  useEffect(() => {
    if (prefsLoading) return;
    if (alertValidationsPrefs?.seeded) return;
    if (seedValidationsAttemptedRef.current) return;
    seedValidationsAttemptedRef.current = true;
    (async () => {
      try {
        const legacy = await ElectronBridge.getData<AlertValidations>(
          APP_CONFIG.STORAGE_KEYS.ALERT_VALIDATIONS,
          {},
        );
        const entries = legacy && typeof legacy === 'object' && !Array.isArray(legacy)
          ? legacy
          : {};
        await seedAlertValidations(entries);
      } catch (error) {
        console.error('Seed alertValidations échoué:', error);
        seedValidationsAttemptedRef.current = false;
      }
    })();
  }, [prefsLoading, alertValidationsPrefs?.seeded, seedAlertValidations]);

  // Charger les alertes actives/snoozed (cache machine).
  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        const existingAlerts = await ElectronBridge.getData<Alert[]>('alerts', []);
        setAlerts(Array.isArray(existingAlerts) ? existingAlerts : []);
        alertsLoaded.current = true;
      } catch (error) {
        console.error('❌ Erreur lors du chargement des alertes:', error);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const updateAlerts = useCallback(
    throttle(async () => {
      if (isLoading || !alertsLoaded.current) return;

      try {
        const currentEnquetes = enquetesRef.current;
        const currentAlertRules = alertRulesRef.current;

        const enqueteSignature: Record<number, string> = {};
        let hasChanges = false;

        currentEnquetes.forEach(e => {
          const signature = `${e.id}-${e.statut}-${e.actes?.length || 0}-${e.ecoutes?.length || 0}-${e.geolocalisations?.length || 0}`;
          enqueteSignature[e.id] = signature;
          if (lastProcessedEnquetes.current[e.id] !== signature) {
            hasChanges = true;
          }
        });

        if (!hasChanges && Object.keys(lastProcessedEnquetes.current).length > 0) {
          console.log('⏭️ Pas de changements dans les enquêtes, skip update');
          return;
        }

        console.log('🔄 Mise à jour des alertes...');
        lastProcessedEnquetes.current = enqueteSignature;

        const activeEnquetes = currentEnquetes.filter(e => e.statut === 'en_cours');
        let newAlerts: Alert[] = [];

        for (let i = 0; i < activeEnquetes.length; i += 5) {
          const batch = activeEnquetes.slice(i, i + 5);

          for (const enquete of batch) {
            const enqueteAlerts = await AlertManager.checkEnquete(enquete, currentAlertRules);

            for (const alert of enqueteAlerts) {
              const wasValidated = await AlertManager.wasRecentlyValidated(
                alert.enqueteId,
                alert.type,
                alert.acteId
              );

              if (!wasValidated) {
                const existingAlert = alerts.find(a =>
                  a.enqueteId === alert.enqueteId &&
                  a.type === alert.type &&
                  (a.acteId === alert.acteId || (!a.acteId && !alert.acteId))
                );

                if (existingAlert?.status === 'snoozed') {
                  const snoozeEndDate = new Date(existingAlert.snoozedUntil!);
                  if (new Date() < snoozeEndDate) {
                    alert.status = 'snoozed';
                    alert.snoozedUntil = existingAlert.snoozedUntil;
                    alert.snoozedCount = existingAlert.snoozedCount;
                  }
                }

                newAlerts.push(alert);
              }
            }
          }

          if (i + 5 < activeEnquetes.length) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }

        const alertsChanged = JSON.stringify(newAlerts.map(a => a.id).sort()) !==
                             JSON.stringify(alerts.map(a => a.id).sort());

        if (alertsChanged) {
          console.log('✅ Alertes mises à jour:', newAlerts.length);
          setAlerts(newAlerts);
          await ElectronBridge.setData('alerts', newAlerts);
        } else {
          console.log('⏭️ Alertes inchangées');
        }
      } catch (error) {
        console.error('❌ Erreur mise à jour alertes:', error);
      }
    }, THROTTLE_DELAY),
    [isLoading, alerts]
  );

  useEffect(() => {
    if (!isLoading && alertsLoaded.current) {
      const initialTimeout = setTimeout(() => {
        updateAlerts();
      }, 2000);

      const interval = setInterval(updateAlerts, ALERT_CHECK_INTERVAL);

      return () => {
        clearTimeout(initialTimeout);
        clearInterval(interval);
        updateAlerts.cancel();
      };
    }
  }, [updateAlerts, isLoading]);

  const handleUpdateAlertRule = useCallback(async (updatedRule: AlertRule) => {
    const exists = alertRules.find(rule => rule.id === updatedRule.id);
    const newRules = exists
      ? alertRules.map(rule => rule.id === updatedRule.id ? updatedRule : rule)
      : [...alertRules, updatedRule];
    await setAlertRulesGlobal(newRules);
  }, [alertRules, setAlertRulesGlobal]);

  const handleSnoozeAlert = useCallback(
    throttle(async (alertId: number) => {
      const snoozeDate = new Date();
      snoozeDate.setDate(snoozeDate.getDate() + 7);

      const updatedAlerts = alerts.map(alert =>
        alert.id === alertId
          ? {
              ...alert,
              status: 'snoozed',
              snoozedUntil: snoozeDate.toISOString(),
              snoozedCount: (alert.snoozedCount || 0) + 1
            }
          : alert
      );

      setAlerts(updatedAlerts);
      await ElectronBridge.setData('alerts', updatedAlerts);
    }, THROTTLE_DELAY),
    [alerts]
  );

  const handleValidateAlert = useCallback(
    throttle(async (alertId: number | number[]) => {
      const alertsToValidate = Array.isArray(alertId)
        ? alerts.filter(a => alertId.includes(a.id))
        : alerts.filter(a => a.id === alertId);

      for (const alert of alertsToValidate) {
        await AlertManager.markAlertAsValidated(alert);
      }

      const updatedAlerts = alerts.filter(alert => {
        return !(Array.isArray(alertId) ? alertId.includes(alert.id) : alert.id === alertId);
      });

      setAlerts(updatedAlerts);
      await ElectronBridge.setData('alerts', updatedAlerts);
    }, THROTTLE_DELAY),
    [alerts]
  );

  const handleDuplicateRule = useCallback(async (rule: AlertRule) => {
    const duplicatedRule: AlertRule = {
      ...rule,
      id: Date.now(),
      name: `${rule.name} (copie)`,
      enabled: true,
      isSystemRule: false
    };
    await handleUpdateAlertRule(duplicatedRule);
  }, [handleUpdateAlertRule]);

  const handleDeleteRule = useCallback(
    throttle(async (ruleId: number) => {
      const newRules = alertRules.filter(rule => rule.id !== ruleId);
      await setAlertRulesGlobal(newRules);
    }, THROTTLE_DELAY),
    [alertRules, setAlertRulesGlobal]
  );

  return {
    alerts: alerts.filter(alert => alert.status === 'active'),
    alertRules,
    isLoading: isLoading || prefsLoading,
    updateAlerts,
    handleUpdateAlertRule,
    handleDuplicateRule,
    handleDeleteRule,
    handleSnoozeAlert,
    handleValidateAlert
  };
};
