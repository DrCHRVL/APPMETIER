// hooks/useCombinedAlerts.ts
//
// Alertes classiques de la cloche pour un contentieux donné. Les règles
// (délai CR, expiration actes, âge enquête, prolongation, AIR) sont
// partagées par toute l'équipe du contentieux et stockées côté serveur
// dans `contentieux-alerts/{id}.json`. Les validations restent
// personnelles (AlertStorage → UserPreferencesFile). Un utilisateur qui
// n'est pas abonné au contentieux ne voit aucune alerte dans sa cloche.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Alert, AlertRule, Enquete, AIRMesure, AlertValidations } from '@/types/interfaces';
import { APP_CONFIG } from '@/config/constants';
import { ElectronBridge } from '@/utils/electronBridge';
import { AlertManager } from '@/utils/alerts/alertManager';
import { contentieuxAlertsSyncService } from '@/utils/dataSync/ContentieuxAlertsSyncService';
import { useUserPreferences } from './useUserPreferences';
import debounce from 'lodash/debounce';

const ALERT_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const DEBOUNCE_DELAY = 1000; // 1 seconde

export const useCombinedAlerts = (enquetes: Enquete[], mesuresAIR: AIRMesure[], contentieuxId?: string) => {
  const enquetesRef = useRef(enquetes);
  enquetesRef.current = enquetes;
  const mesuresAIRRef = useRef(mesuresAIR);
  mesuresAIRRef.current = mesuresAIR;

  const alertsKey = contentieuxId ? `ctx_${contentieuxId}_alerts` : 'alerts';
  const alertsKeyRef = useRef(alertsKey);
  alertsKeyRef.current = alertsKey;

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);

  const {
    subscribedContentieuxAlerts,
    alertValidations,
    isLoading: prefsLoading,
    seedAlertValidations,
  } = useUserPreferences();

  // Seed initial des validations (one-shot par user) : recopie l'ancien
  // dictionnaire global `alert_validations` dans la prefs personnelle.
  // Évite que les alertes précédemment validées reviennent en masse après
  // migration.
  const validationsSeedTriedRef = useRef(false);
  useEffect(() => {
    if (prefsLoading) return;
    if (alertValidations?.seeded) return;
    if (validationsSeedTriedRef.current) return;
    validationsSeedTriedRef.current = true;
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
        validationsSeedTriedRef.current = false;
      }
    })();
  }, [prefsLoading, alertValidations?.seeded, seedAlertValidations]);

  // Abonnement : champ absent = auto-abonné à tous les contentieux accessibles.
  const isSubscribed = useMemo(() => {
    if (!contentieuxId) return false;
    if (!subscribedContentieuxAlerts) return true;
    return subscribedContentieuxAlerts.includes(contentieuxId);
  }, [contentieuxId, subscribedContentieuxAlerts]);

  // Chargement des règles partagées + seed lazy depuis legacy si besoin.
  useEffect(() => {
    if (!contentieuxId) {
      setAlertRules([]);
      setRulesLoading(false);
      return;
    }
    let cancelled = false;

    const load = async () => {
      setRulesLoading(true);
      try {
        await contentieuxAlertsSyncService.sync(contentieuxId);
        let rules = await contentieuxAlertsSyncService.getRules(contentieuxId);

        if (rules.length === 0) {
          // Seed lazy : reprendre les clés legacy si elles existent, sinon
          // défauts système. N'écrit côté serveur que si le fichier est
          // absent (seedFromLegacy est idempotent).
          const legacyCtx = await ElectronBridge.getData<AlertRule[]>(
            `ctx_${contentieuxId}_alertRules`,
            [],
          );
          const legacyGlobal = await ElectronBridge.getData<AlertRule[]>(
            APP_CONFIG.STORAGE_KEYS.ALERT_RULES,
            [],
          );
          const seedRules = (Array.isArray(legacyCtx) && legacyCtx.length > 0)
            ? legacyCtx
            : (Array.isArray(legacyGlobal) && legacyGlobal.length > 0)
              ? legacyGlobal
              : APP_CONFIG.DEFAULT_ALERT_RULES;
          const seeded = await contentieuxAlertsSyncService.seedFromLegacy(contentieuxId, seedRules);
          rules = seeded ? seedRules : APP_CONFIG.DEFAULT_ALERT_RULES;
        }

        if (!cancelled) setAlertRules(rules);
      } catch (error) {
        console.error(`Chargement règles partagées [${contentieuxId}] échoué:`, error);
        if (!cancelled) setAlertRules(APP_CONFIG.DEFAULT_ALERT_RULES);
      } finally {
        if (!cancelled) setRulesLoading(false);
      }
    };

    load();
    contentieuxAlertsSyncService.startPeriodic(contentieuxId);

    const handler = async (e: Event) => {
      const custom = e as CustomEvent<{ scope?: string }>;
      if (custom.detail?.scope === `contentieuxAlerts:${contentieuxId}`) {
        const rules = await contentieuxAlertsSyncService.getRules(contentieuxId);
        if (!cancelled) setAlertRules(rules.length > 0 ? rules : APP_CONFIG.DEFAULT_ALERT_RULES);
      }
    };
    window.addEventListener('global-sync-completed', handler);

    return () => {
      cancelled = true;
      window.removeEventListener('global-sync-completed', handler);
      contentieuxAlertsSyncService.stopPeriodic(contentieuxId);
    };
  }, [contentieuxId]);

  // Cache machine des alertes actives/snoozed.
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

  const isLoading = prefsLoading || alertsLoading || rulesLoading;

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

        // Non abonné → vider la cloche et nettoyer le cache persistant.
        if (!isSubscribed) {
          await ElectronBridge.setData(currentAlertsKey, []);
          setAlerts([]);
          return;
        }

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
    [alertRules, isSubscribed]
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

  // Persistance des règles partagées (écriture serveur). N'importe quel
  // appelant peut techniquement écrire : l'UI doit masquer les boutons
  // aux utilisateurs sans `manage_alerts` sur ce contentieux.
  const persistRules = useCallback(async (rules: AlertRule[]) => {
    if (!contentieuxId) return;
    setAlertRules(rules);
    await contentieuxAlertsSyncService.saveRules(contentieuxId, rules);
  }, [contentieuxId]);

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
    isSubscribed,
    updateAlerts,
    handleUpdateAlertRule,
    handleDuplicateRule,
    handleDeleteRule,
    handleSnoozeAlert,
    handleValidateAlert,
  };
};
