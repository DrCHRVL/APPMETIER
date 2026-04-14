import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Alert, AlertRule, Enquete, AIRMesure } from '@/types/interfaces';
import { APP_CONFIG } from '@/config/constants';
import { ElectronBridge } from '@/utils/electronBridge';
import { AlertManager } from '@/utils/alerts/alertManager';
import debounce from 'lodash/debounce';

const ALERT_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const DEBOUNCE_DELAY = 1000; // 1 seconde

export const useCombinedAlerts = (enquetes: Enquete[], mesuresAIR: AIRMesure[], contentieuxId?: string) => {
  // Refs pour les données volatiles — évite de recréer le debounced callback à chaque changement
  const enquetesRef = useRef(enquetes);
  enquetesRef.current = enquetes;
  const mesuresAIRRef = useRef(mesuresAIR);
  mesuresAIRRef.current = mesuresAIR;
  // Clés préfixées par contentieux (fallback sur clés globales si pas de contentieux)
  const alertRulesKey = contentieuxId ? `ctx_${contentieuxId}_alertRules` : APP_CONFIG.STORAGE_KEYS.ALERT_RULES;
  const alertsKey = contentieuxId ? `ctx_${contentieuxId}_alerts` : 'alerts';
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Chargement des règles d'alerte
  useEffect(() => {
    const loadAlertRules = async () => {
      try {
        setIsLoading(true);
        const rules = await ElectronBridge.getData(
          alertRulesKey,
          APP_CONFIG.DEFAULT_ALERT_RULES
        );
        setAlertRules(Array.isArray(rules) ? rules : APP_CONFIG.DEFAULT_ALERT_RULES);
      } catch (error) {
        setAlertRules(APP_CONFIG.DEFAULT_ALERT_RULES);
      } finally {
        setIsLoading(false);
      }
    };
    
    const loadAlerts = async () => {
      try {
        const existingAlerts = await ElectronBridge.getData('alerts', []);
        setAlerts(Array.isArray(existingAlerts) ? existingAlerts : []);
      } catch (error) {
        console.error('Erreur lors du chargement des alertes:', error);
        setAlerts([]);
      }
    };
    
    loadAlertRules();
    loadAlerts();
  }, [alertRulesKey, alertsKey]);

  // Sauvegarder les règles d'alerte
  const debouncedSaveAlertRules = useCallback(
    debounce(async (rules: AlertRule[]) => {
      try {
        await ElectronBridge.setData(alertRulesKey,rules);
      } catch (error) {
        console.error('Erreur lors de la sauvegarde des règles d\'alerte:', error);
      }
    }, DEBOUNCE_DELAY),
    []
  );

  useEffect(() => {
    if (!isLoading && alertRules.length > 0) {
      debouncedSaveAlertRules(alertRules);
    }
    return () => debouncedSaveAlertRules.cancel();
  }, [alertRules, isLoading, debouncedSaveAlertRules]);

  // Convertir une date du format DD/MM/YYYY en Date
  const parseDateString = (dateString: string): Date | null => {
    if (!dateString) return null;
    
    // Si format DD/MM/YYYY
    if (dateString.includes('/')) {
      const parts = dateString.split('/');
      if (parts.length === 3) {
        const [day, month, year] = parts;
        const fullYear = year.length === 2 ? `20${year}` : year;
        return new Date(`${fullYear}-${month}-${day}`);
      }
    } 
    // Si format YYYY-MM-DD
    else if (/^\d{4}-\d{2}-\d{2}/.test(dateString)) {
      return new Date(dateString);
    }
    
    return null;
  };

  // Trouver la date du dernier RDV procureur
  const getLastRdvDate = (mesure: AIRMesure): Date | null => {
    if (!mesure.details?.rdv || mesure.details.rdv.length === 0) {
      return null;
    }
    
    // Trier les RDV par date et prendre le plus récent
    const sortedRdvs = [...mesure.details.rdv]
      .filter(rdv => rdv.date) // Filtrer les RDV sans date
      .sort((a, b) => {
        const dateA = parseDateString(a.date)?.getTime() || 0;
        const dateB = parseDateString(b.date)?.getTime() || 0;
        return dateB - dateA;
      });
    
    if (sortedRdvs.length === 0) return null;
    
    return parseDateString(sortedRdvs[0].date);
  };

  // Mise à jour des alertes — utilise les refs pour ne pas recréer le debounce à chaque changement de données
  const updateAlerts = useCallback(
    debounce(async () => {
      try {
        // Récupérer les alertes existantes
        const existingAlerts = await ElectronBridge.getData<Alert[]>(alertsKey, []);
        const newAlerts: Alert[] = [];

        // 1. Vérifier les enquêtes pour les alertes traditionnelles
        for (const enquete of enquetesRef.current) {
          if (enquete.statut === 'en_cours') {
            const enqueteAlerts = await AlertManager.checkEnquete(enquete, alertRules);
            newAlerts.push(...enqueteAlerts);
          }
        }
        
        // 2. Vérifier les mesures AIR
        const enabledAIRRules = alertRules.filter(rule => 
          rule.enabled && 
          (rule.type === 'air_6_mois' || rule.type === 'air_12_mois' || rule.type === 'air_rdv_delai')
        );
        
        const now = new Date();
        
        for (const mesure of mesuresAIRRef.current) {
          // Ignorer les mesures terminées
          if (mesure.statut !== 'en_cours') {
            continue;
          }
          
          // Calculer l'âge de la mesure en jours
          const dateDebut = parseDateString(mesure.dateDebut);
          if (!dateDebut) continue;
          
          const mesureAge = Math.floor((now.getTime() - dateDebut.getTime()) / (1000 * 60 * 60 * 24));
          
          // Trouver la date du dernier RDV procureur
          const dernierRdvDate = getLastRdvDate(mesure);
          
          // Calculer le délai depuis le dernier RDV ou depuis le début si pas de RDV
          const dateReference = dernierRdvDate || dateDebut;
          const joursSansDernierRdv = Math.floor((now.getTime() - dateReference.getTime()) / (1000 * 60 * 60 * 24));
          
          // Vérifier pour chaque règle d'alerte
          for (const rule of enabledAIRRules) {
            // Vérifier si cette alerte a déjà été validée récemment
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
              
              // Ajouter la propriété isAIRAlert pour identifier ces alertes
              alert.isAIRAlert = true;
              
              // Ajouter les informations d'identité de la mesure AIR
              alert.airIdentite = mesure.identite;
              alert.airNumeroParquet = mesure.numeroParquet;
              
              newAlerts.push(alert);
            }
          }
        }
        
        // Fusionner avec les alertes existantes en conservant les alertes "snoozed"
        const existingActiveAlerts = existingAlerts.filter(a => a.status === 'active');
        const existingSnoozeAlerts = existingAlerts.filter(a => a.status === 'snoozed');
        
        // Conserver uniquement les nouvelles alertes (enquêtes + AIR) et les alertes en snooze
        const allAlerts = [...newAlerts, ...existingSnoozeAlerts];
        
        await ElectronBridge.setData(alertsKey, allAlerts);
        setAlerts(allAlerts);
      } catch (error) {
        console.error('Erreur lors de la mise à jour des alertes:', error);
      }
    }, DEBOUNCE_DELAY),
    [alertRules] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Lancement initial + polling toutes les 5 min (ne dépend que de alertRules via updateAlerts)
  useEffect(() => {
    updateAlerts();
    const interval = setInterval(updateAlerts, ALERT_CHECK_INTERVAL);
    return () => {
      clearInterval(interval);
      updateAlerts.cancel();
    };
  }, [updateAlerts]);

  // Recalculer quand les données changent (debounced, sans recréer l'interval)
  useEffect(() => {
    updateAlerts();
  }, [enquetes, mesuresAIR]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpdateAlertRule = useCallback(async (updatedRule: AlertRule) => {
    setAlertRules(prev => {
      const newRules = prev.map(rule => 
        rule.id === updatedRule.id ? updatedRule : rule
      );
      if (!prev.find(rule => rule.id === updatedRule.id)) {
        newRules.push(updatedRule);
      }
      return newRules;
    });
  }, []);

  const handleSnoozeAlert = useCallback(
    debounce(async (alertId: number, daysOrDate: number | string): Promise<boolean> => {
      try {
        const allAlerts = await ElectronBridge.getData<Alert[]>(alertsKey, []);
        
        let snoozeUntil: Date;
        
        // Si c'est une chaîne de caractères ISO, considérer comme une date
        if (typeof daysOrDate === 'string' && daysOrDate.includes('T')) {
          snoozeUntil = new Date(daysOrDate);
        } else {
          // Sinon, considérer comme un nombre de jours
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
        
        await ElectronBridge.setData(alertsKey, updatedAlerts);
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
        const allAlerts = await ElectronBridge.getData<Alert[]>(alertsKey, []);
        
        const alertsToValidate = Array.isArray(alertId) 
          ? allAlerts.filter(a => alertId.includes(a.id))
          : allAlerts.filter(a => a.id === alertId);
    
        // Marquer chaque alerte comme validée dans l'historique des validations
        for (const alert of alertsToValidate) {
          await AlertManager.markAlertAsValidated(alert);
        }
    
        // Mettre à jour l'état local des alertes
        const updatedAlerts = allAlerts.filter(alert => {
          // Conserver les alertes qui ne sont pas dans la liste à valider
          return !(Array.isArray(alertId) ? alertId.includes(alert.id) : alert.id === alertId);
        });
    
        await ElectronBridge.setData(alertsKey, updatedAlerts);
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
    handleUpdateAlertRule(duplicatedRule);
  }, [handleUpdateAlertRule]);

  const handleDeleteRule = useCallback(
    debounce(async (ruleId: number) => {
      setAlertRules(prev => {
        const updatedRules = prev.filter(rule => rule.id !== ruleId);
        ElectronBridge.setData(APP_CONFIG.STORAGE_KEYS.ALERT_RULES, updatedRules);
        return updatedRules;
      });
    }, DEBOUNCE_DELAY),
    []
  );

  // Filtrer les alertes par type (enquête vs AIR)
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