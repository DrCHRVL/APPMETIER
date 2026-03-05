// hooks/useAlerts.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, AlertRule, Enquete } from '@/types/interfaces';
import { APP_CONFIG } from '@/config/constants';
import { ElectronBridge } from '@/utils/electronBridge';
import { AlertManager } from '@/utils/alerts/alertManager';
import { AlertStorage } from '@/utils/alerts/alertStorage';
import throttle from 'lodash/throttle';

// Augmenter l'intervalle de vérification des alertes
const ALERT_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes
const THROTTLE_DELAY = 3000; // 3 secondes

export const useAlerts = (enquetes: Enquete[]) => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // ✅ CORRECTION 1: Références stables pour éviter les recréations de fonctions
  const enquetesRef = useRef<Enquete[]>([]);
  const alertRulesRef = useRef<AlertRule[]>([]);
  const lastProcessedEnquetes = useRef<Record<number, string>>({});
  const alertsLoaded = useRef(false);

  // Synchroniser les refs avec les states
  useEffect(() => {
    enquetesRef.current = enquetes;
  }, [enquetes]);

  useEffect(() => {
    alertRulesRef.current = alertRules;
  }, [alertRules]);

  // ✅ CORRECTION 2: Charger les alertes et les règles UNE SEULE FOIS au démarrage
  useEffect(() => {
    const loadAlertData = async () => {
      try {
        setIsLoading(true);
        
        // Charger les règles d'alerte
        const rules = await ElectronBridge.getData(
          APP_CONFIG.STORAGE_KEYS.ALERT_RULES,
          APP_CONFIG.DEFAULT_ALERT_RULES
        );
        setAlertRules(Array.isArray(rules) ? rules : APP_CONFIG.DEFAULT_ALERT_RULES);
        
        // Charger les alertes existantes
        const existingAlerts = await ElectronBridge.getData<Alert[]>('alerts', []);
        setAlerts(Array.isArray(existingAlerts) ? existingAlerts : []);
        
        alertsLoaded.current = true;
      } catch (error) {
        console.error('❌ Erreur lors du chargement des alertes:', error);
        setAlertRules(APP_CONFIG.DEFAULT_ALERT_RULES);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadAlertData();
  }, []); // ✅ Dépendances vides = exécution unique

  // Fonction pour sauvegarder les règles d'alerte avec throttle
  const saveAlertRules = useCallback(
    throttle(async (rules: AlertRule[]) => {
      if (!isLoading) {
        try {
          await ElectronBridge.setData(APP_CONFIG.STORAGE_KEYS.ALERT_RULES, rules);
        } catch (error) {
          console.error('❌ Erreur sauvegarde règles:', error);
        }
      }
    }, THROTTLE_DELAY),
    [isLoading]
  );

  // Sauvegarder les règles d'alerte lorsqu'elles changent
  useEffect(() => {
    if (!isLoading && alertRules.length > 0) {
      saveAlertRules(alertRules);
    }
    return () => saveAlertRules.cancel();
  }, [alertRules, isLoading, saveAlertRules]);

  // ✅ CORRECTION 3: updateAlerts stable qui utilise les refs au lieu des props
  const updateAlerts = useCallback(
    throttle(async () => {
      if (isLoading || !alertsLoaded.current) return;
      
      try {
        // Utiliser les refs pour accéder aux valeurs actuelles sans recréer la fonction
        const currentEnquetes = enquetesRef.current;
        const currentAlertRules = alertRulesRef.current;
        
        // Vérifier si les enquêtes ont changé depuis la dernière vérification
        const enqueteSignature: Record<number, string> = {};
        let hasChanges = false;
        
        currentEnquetes.forEach(e => {
          const signature = `${e.id}-${e.statut}-${e.dateMiseAJour}`;
          enqueteSignature[e.id] = signature;
          
          if (lastProcessedEnquetes.current[e.id] !== signature) {
            hasChanges = true;
          }
        });
        
        // Si aucun changement significatif, ne pas mettre à jour
        if (!hasChanges && Object.keys(lastProcessedEnquetes.current).length > 0) {
          console.log('⏭️ Pas de changements dans les enquêtes, skip update');
          return;
        }
        
        console.log('🔄 Mise à jour des alertes...');
        lastProcessedEnquetes.current = enqueteSignature;
        
        // Filtrer seulement les enquêtes en cours
        const activeEnquetes = currentEnquetes.filter(e => e.statut === 'en_cours');
        
        let newAlerts: Alert[] = [];
        
        // Traiter par lots de 5 enquêtes pour ne pas bloquer le thread principal
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
                // Vérifier si l'alerte existe déjà et a été mise en pause
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
          
          // Pause entre les lots
          if (i + 5 < activeEnquetes.length) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
        
        // Mettre à jour seulement si des changements sont détectés
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
    [isLoading, alerts] // ✅ Seulement isLoading et alerts, pas enquetes ni alertRules
  );

  // ✅ CORRECTION 4: Mise à jour périodique stable
  useEffect(() => {
    if (!isLoading && alertsLoaded.current) {
      // Première mise à jour après un court délai
      const initialTimeout = setTimeout(() => {
        updateAlerts();
      }, 2000);
      
      // Mise à jour périodique
      const interval = setInterval(updateAlerts, ALERT_CHECK_INTERVAL);
      
      return () => {
        clearTimeout(initialTimeout);
        clearInterval(interval);
        updateAlerts.cancel();
      };
    }
  }, [updateAlerts, isLoading]); // ✅ updateAlerts est stable maintenant

  // Handler pour la mise à jour des règles d'alerte
  const handleUpdateAlertRule = useCallback((updatedRule: AlertRule) => {
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

  // Handler pour mettre en pause une alerte
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

  // Handler pour valider une alerte
  const handleValidateAlert = useCallback(
    throttle(async (alertId: number | number[]) => {
      const alertsToValidate = Array.isArray(alertId) 
        ? alerts.filter(a => alertId.includes(a.id))
        : alerts.filter(a => a.id === alertId);

      // Marquer les alertes comme validées
      for (const alert of alertsToValidate) {
        await AlertManager.markAlertAsValidated(alert);
      }

      // Mettre à jour l'état local
      const updatedAlerts = alerts.filter(alert => {
        return !(Array.isArray(alertId) ? alertId.includes(alert.id) : alert.id === alertId);
      });

      setAlerts(updatedAlerts);
      await ElectronBridge.setData('alerts', updatedAlerts);
    }, THROTTLE_DELAY),
    [alerts]
  );

  // Handler pour dupliquer une règle
  const handleDuplicateRule = useCallback((rule: AlertRule) => {
    const duplicatedRule: AlertRule = {
      ...rule,
      id: Date.now(),
      name: `${rule.name} (copie)`,
      enabled: true,
      isSystemRule: false
    };
    handleUpdateAlertRule(duplicatedRule);
  }, [handleUpdateAlertRule]);

  // Handler pour supprimer une règle
  const handleDeleteRule = useCallback(
    throttle(async (ruleId: number) => {
      setAlertRules(prev => {
        const updatedRules = prev.filter(rule => rule.id !== ruleId);
        ElectronBridge.setData(APP_CONFIG.STORAGE_KEYS.ALERT_RULES, updatedRules);
        return updatedRules;
      });
    }, THROTTLE_DELAY),
    []
  );

  return {
    alerts: alerts.filter(alert => alert.status === 'active'),
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
