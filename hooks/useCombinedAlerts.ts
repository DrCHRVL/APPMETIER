// hooks/useCombinedAlerts.ts
//
// Variante de useAlerts qui partitionne les règles par contentieux. Les
// règles vivent désormais dans la prefs utilisateur :
//   - global → `prefs.alertRules.global`
//   - par contentieux → `prefs.alertRules.byContentieux[id]`
// Les alertes actives/snoozed restent un cache machine (clés ElectronBridge
// `ctx_{id}_alerts` ou `alerts`).

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Alert, AlertRule, Enquete, AIRMesure } from '@/types/interfaces';
import { APP_CONFIG } from '@/config/constants';
import { ElectronBridge } from '@/utils/electronBridge';
import { AlertManager } from '@/utils/alerts/alertManager';
import { useUserPreferences } from './useUserPreferences';
import debounce from 'lodash/debounce';

const ALERT_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const DEBOUNCE_DELAY = 1000; // 1 seconde

export const useCombinedAlerts = (enquetes: Enquete[], mesuresAIR: AIRMesure[], contentieuxId?: string) => {
  const enquetesRef = useRef(enquetes);
  enquetesRef.current = enquetes;
  const mesuresAIRRef = useRef(mesuresAIR);
  mesuresAIRRef.current = mesuresAIR;

  // Cache machine pour les alertes actives/snoozed (par contentieux).
  const alertsKey = contentieuxId ? `ctx_${contentieuxId}_alerts` : 'alerts';
  const alertsKeyRef = useRef(alertsKey);
  alertsKeyRef.current = alertsKey;

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);

  const {
    alertRules: alertRulesPrefs,
    isLoading: prefsLoading,
    setAlertRulesGlobal,
    setAlertRulesForContentieux,
    seedAlertRulesForContentieux,
    seedAlertRulesGlobal,
  } = useUserPreferences();

  const alertRules = useMemo<AlertRule[]>(() => {
    if (contentieuxId) {
      const stored = alertRulesPrefs?.byContentieux?.[contentieuxId];
      if (stored && stored.length > 0) return stored;
    }
    if (alertRulesPrefs?.global && alertRulesPrefs.global.length > 0) {
      return alertRulesPrefs.global;
    }
    return APP_CONFIG.DEFAULT_ALERT_RULES;
  }, [contentieuxId, alertRulesPrefs?.byContentieux, alertRulesPrefs?.global]);

  // Seed lazy : à la première ouverture d'un contentieux par cet utilisateur,
  // on copie les règles globales pré-existantes (clé locale `ctx_X_alertRules`)
  // dans sa prefs. Idem pour le seed de la partie globale (cas pas de
  // contentieuxId : seedé via useAlerts au démarrage).
  const seededRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (prefsLoading) return;
    if (!contentieuxId) {
      // Seed des règles globales si jamais useAlerts n'a pas tourné (cas
      // ServiceOrganizer/AlertsPage qui appellent useCombinedAlerts en mode
      // global). On lit la dernière clé locale connue.
      if (alertRulesPrefs?.seeded) return;
      const cacheKey = '__global__';
      if (seededRef.current.has(cacheKey)) return;
      seededRef.current.add(cacheKey);
      (async () => {
        try {
          const legacy = await ElectronBridge.getData<AlertRule[]>(
            APP_CONFIG.STORAGE_KEYS.ALERT_RULES,
            APP_CONFIG.DEFAULT_ALERT_RULES,
          );
          await seedAlertRulesGlobal(
            Array.isArray(legacy) && legacy.length > 0 ? legacy : APP_CONFIG.DEFAULT_ALERT_RULES,
          );
        } catch (error) {
          console.error('Seed global alertRules échoué:', error);
          seededRef.current.delete(cacheKey);
        }
      })();
      return;
    }

    const seededList = alertRulesPrefs?.seededContentieux || [];
    if (seededList.includes(contentieuxId)) return;
    if (seededRef.current.has(contentieuxId)) return;
    seededRef.current.add(contentieuxId);
    (async () => {
      try {
        const legacy = await ElectronBridge.getData<AlertRule[]>(
          `ctx_${contentieuxId}_alertRules`,
          APP_CONFIG.DEFAULT_ALERT_RULES,
        );
        await seedAlertRulesForContentieux(
          contentieuxId,
          Array.isArray(legacy) && legacy.length > 0 ? legacy : APP_CONFIG.DEFAULT_ALERT_RULES,
        );
      } catch (error) {
        console.error(`Seed alertRules contentieux ${contentieuxId} échoué:`, error);
        seededRef.current.delete(contentieuxId);
      }
    })();
  }, [
    contentieuxId,
    prefsLoading,
    alertRulesPrefs?.seeded,
    alertRulesPrefs?.seededContentieux,
    seedAlertRulesForContentieux,
    seedAlertRulesGlobal,
  ]);

  // Charger le cache machine des alertes actives/snoozed.
  useEffect(() => {
    const loadAlerts = async () => {
      try {
        setAlertsLoading(true);
        const existingAlerts = await ElectronBridge.getData(alertsKey, []);
        setAlerts(Array.isArray(existingAlerts) ? existingAlerts : []);
      } catch (error) {
        console.error('Erreur lors du chargement des alertes:', error);
        setAlerts([]);
      } finally {
        setAlertsLoading(false);
      }
    };
    loadAlerts();
  }, [alertsKey]);

  const isLoading = prefsLoading || alertsLoading;

  const parseDateString = (dateString: string): Date | null => {
    if (!dateString) return null;
    if (dateString.includes('/')) {
      const parts = dateString.split('/');
      if (parts.length === 3) {
        const [day, month, year] = parts;
        const fullYear = year.length === 2 ? `20${year}` : year;
        return new Date(`${fullYear}-${month}-${day}`);
      }
    } else if (/^\d{4}-\d{2}-\d{2}/.test(dateString)) {
      return new Date(dateString);
    }
    return null;
  };

  const getLastRdvDate = (mesure: AIRMesure): Date | null => {
    if (!mesure.details?.rdv || mesure.details.rdv.length === 0) return null;
    const sortedRdvs = [...mesure.details.rdv]
      .filter(rdv => rdv.date)
      .sort((a, b) => {
        const dateA = parseDateString(a.date)?.getTime() || 0;
        const dateB = parseDateString(b.date)?.getTime() || 0;
        return dateB - dateA;
      });
    if (sortedRdvs.length === 0) return null;
    return parseDateString(sortedRdvs[0].date);
  };

  const updateAlerts = useCallback(
    debounce(async () => {
      try {
        const currentAlertsKey = alertsKeyRef.current;
        const existingAlerts = await ElectronBridge.getData<Alert[]>(currentAlertsKey, []);
        const newAlerts: Alert[] = [];

        for (const enquete of enquetesRef.current) {
          if (enquete.statut === 'en_cours') {
            const enqueteAlerts = await AlertManager.checkEnquete(enquete, alertRules);
            newAlerts.push(...enqueteAlerts);
          }
        }

        const enabledAIRRules = alertRules.filter(rule =>
          rule.enabled &&
          (rule.type === 'air_6_mois' || rule.type === 'air_12_mois' || rule.type === 'air_rdv_delai')
        );

        const now = new Date();

        for (const mesure of mesuresAIRRef.current) {
          if (mesure.statut !== 'en_cours') continue;

          const dateDebut = parseDateString(mesure.dateDebut);
          if (!dateDebut) continue;

          const mesureAge = Math.floor((now.getTime() - dateDebut.getTime()) / (1000 * 60 * 60 * 24));
          const dernierRdvDate = getLastRdvDate(mesure);
          const dateReference = dernierRdvDate || dateDebut;
          const joursSansDernierRdv = Math.floor((now.getTime() - dateReference.getTime()) / (1000 * 60 * 60 * 24));

          for (const rule of enabledAIRRules) {
            const wasValidated = await AlertManager.wasRecentlyValidated(
              mesure.id,
              rule.type,
              undefined
            );
            if (wasValidated) continue;

            let shouldAlert = false;
            let message = '';

            switch(rule.type) {
              case 'air_6_mois':
                if (mesureAge >= 180 && mesureAge < 365) {
                  shouldAlert = true;
                  message = `La mesure AIR de ${mesure.identite} dépasse 6 mois (${Math.floor(mesureAge / 30)} mois)`;
                }
                break;
              case 'air_12_mois':
                if (mesureAge >= 365) {
                  shouldAlert = true;
                  message = `La mesure AIR de ${mesure.identite} dépasse 12 mois (${Math.floor(mesureAge / 30)} mois)`;
                }
                break;
              case 'air_rdv_delai':
                if (joursSansDernierRdv >= rule.threshold) {
                  shouldAlert = true;
                  message = `${mesure.identite} n'a pas eu de RDV procureur depuis ${joursSansDernierRdv} jours`;
                }
                break;
            }

            if (shouldAlert) {
              const alert = AlertManager.generateAlert(
                mesure.id,
                rule.type,
                message,
                undefined,
                undefined,
                { dateReference: dateReference.toISOString() }
              );
              alert.isAIRAlert = true;
              alert.airIdentite = mesure.identite;
              alert.airNumeroParquet = mesure.numeroParquet;
              newAlerts.push(alert);
            }
          }
        }

        const existingSnoozeAlerts = existingAlerts.filter(a => a.status === 'snoozed');
        const allAlerts = [...newAlerts, ...existingSnoozeAlerts];

        await ElectronBridge.setData(currentAlertsKey, allAlerts);
        setAlerts(allAlerts);
      } catch (error) {
        console.error('Erreur lors de la mise à jour des alertes:', error);
      }
    }, DEBOUNCE_DELAY),
    [alertRules]
  );

  useEffect(() => {
    updateAlerts();
    const interval = setInterval(updateAlerts, ALERT_CHECK_INTERVAL);
    return () => {
      clearInterval(interval);
      updateAlerts.cancel();
    };
  }, [updateAlerts]);

  useEffect(() => {
    updateAlerts();
    return () => { updateAlerts.cancel(); };
  }, [enquetes, mesuresAIR, alertsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persistance des règles : bascule sur la prefs utilisateur via le bon
  // setter (par contentieux ou global).
  const persistRules = useCallback(async (rules: AlertRule[]) => {
    if (contentieuxId) {
      await setAlertRulesForContentieux(contentieuxId, rules);
    } else {
      await setAlertRulesGlobal(rules);
    }
  }, [contentieuxId, setAlertRulesForContentieux, setAlertRulesGlobal]);

  const handleUpdateAlertRule = useCallback(async (updatedRule: AlertRule) => {
    const exists = alertRules.find(rule => rule.id === updatedRule.id);
    const newRules = exists
      ? alertRules.map(rule => rule.id === updatedRule.id ? updatedRule : rule)
      : [...alertRules, updatedRule];
    await persistRules(newRules);
  }, [alertRules, persistRules]);

  const handleSnoozeAlert = useCallback(
    debounce(async (alertId: number, daysOrDate: number | string): Promise<boolean> => {
      try {
        const currentAlertsKey = alertsKeyRef.current;
        const allAlerts = await ElectronBridge.getData<Alert[]>(currentAlertsKey, []);

        let snoozeUntil: Date;
        if (typeof daysOrDate === 'string' && daysOrDate.includes('T')) {
          snoozeUntil = new Date(daysOrDate);
        } else {
          const days = typeof daysOrDate === 'string' ? parseInt(daysOrDate, 10) : daysOrDate;
          snoozeUntil = new Date();
          snoozeUntil.setDate(snoozeUntil.getDate() + days);
        }

        const updatedAlerts = allAlerts.map(alert =>
          alert.id === alertId
            ? {
                ...alert,
                status: 'snoozed',
                snoozedUntil: snoozeUntil.toISOString(),
                snoozedCount: (alert.snoozedCount || 0) + 1
              }
            : alert
        );

        await ElectronBridge.setData(currentAlertsKey, updatedAlerts);
        setAlerts(updatedAlerts);
        return true;
      } catch (error) {
        console.error('Erreur lors du report d\'alerte:', error);
        return false;
      }
    }, DEBOUNCE_DELAY),
    []
  );

  const handleValidateAlert = useCallback(
    debounce(async (alertId: number | number[]): Promise<boolean> => {
      try {
        const currentAlertsKey = alertsKeyRef.current;
        const allAlerts = await ElectronBridge.getData<Alert[]>(currentAlertsKey, []);

        const alertsToValidate = Array.isArray(alertId)
          ? allAlerts.filter(a => alertId.includes(a.id))
          : allAlerts.filter(a => a.id === alertId);

        for (const alert of alertsToValidate) {
          await AlertManager.markAlertAsValidated(alert);
        }

        const updatedAlerts = allAlerts.filter(alert => {
          return !(Array.isArray(alertId) ? alertId.includes(alert.id) : alert.id === alertId);
        });

        await ElectronBridge.setData(currentAlertsKey, updatedAlerts);
        setAlerts(updatedAlerts);
        return true;
      } catch (error) {
        console.error('Erreur lors de la validation d\'alerte:', error);
        return false;
      }
    }, DEBOUNCE_DELAY),
    []
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
    debounce(async (ruleId: number) => {
      const newRules = alertRules.filter(rule => rule.id !== ruleId);
      await persistRules(newRules);
    }, DEBOUNCE_DELAY),
    [alertRules, persistRules]
  );

  const enqueteAlerts = useMemo(() =>
    alerts.filter(alert => !alert.isAIRAlert && alert.status === 'active'),
    [alerts]
  );

  const airAlerts = useMemo(() =>
    alerts.filter(alert => alert.isAIRAlert === true && alert.status === 'active'),
    [alerts]
  );

  return {
    alerts: alerts.filter(alert => alert.status === 'active'),
    enqueteAlerts,
    airAlerts,
    alertRules,
    isLoading,
    updateAlerts,
    handleUpdateAlertRule,
    handleDuplicateRule,
    handleDeleteRule,
    handleSnoozeAlert,
    handleValidateAlert
  };
};
