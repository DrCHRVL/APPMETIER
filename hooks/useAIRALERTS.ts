import { useState, useEffect, useCallback } from 'react';
import { Alert, AlertRule, AIRMesure } from '@/types/interfaces';
import { APP_CONFIG } from '@/config/constants';
import { ElectronBridge } from '@/utils/electronBridge';
import { AlertManager } from '@/utils/alerts/alertManager';
import { DateUtils } from '@/utils/dateUtils';
import debounce from 'lodash/debounce';

const ALERT_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const DEBOUNCE_DELAY = 1000; // 1 seconde

export const useAIRAlerts = (mesures: AIRMesure[], existingAlerts: Alert[], alertRules: AlertRule[]) => {
  const [airAlerts, setAirAlerts] = useState<Alert[]>([]);

  // Fonction pour vérifier les mesures AIR et générer des alertes
  const checkAIRMesures = useCallback(
    debounce(async () => {
      try {
        const newAlerts: Alert[] = [];
        const now = new Date();
        
        // Filtrer les règles d'alerte activées pour les mesures AIR
        const enabledRules = alertRules.filter(rule => 
          rule.enabled && 
          (rule.type === 'air_6_mois' || rule.type === 'air_12_mois' || rule.type === 'air_rdv_delai')
        );
        
        // Si aucune règle activée, ne pas continuer
        if (enabledRules.length === 0) return;
        
        // Pour chaque mesure AIR en cours
        for (const mesure of mesures) {
          // Ignorer les mesures terminées
          if (mesure.statut === 'reussite' || mesure.statut === 'echec' || mesure.statut === 'inconnu') {
            continue;
          }
          
          // Calculer l'âge de la mesure en jours
          const dateDebut = mesure.dateDebut ? new Date(formatDateForProcessing(mesure.dateDebut)) : null;
          if (!dateDebut) continue;
          
          const mesureAge = Math.floor((now.getTime() - dateDebut.getTime()) / (1000 * 60 * 60 * 24));
          
          // Trouver la date du dernier RDV procureur
          let dernierRdvDate: Date | null = null;
          if (mesure.details?.rdv && mesure.details.rdv.length > 0) {
            // Trier par date décroissante
            const rdvsSorted = [...mesure.details.rdv].sort((a, b) => {
              return new Date(b.date).getTime() - new Date(a.date).getTime();
            });
            
            if (rdvsSorted[0].date) {
              dernierRdvDate = new Date(rdvsSorted[0].date);
            }
          }
          
          // Calculer le délai depuis le dernier RDV ou depuis le début si pas de RDV
          const dateReference = dernierRdvDate || dateDebut;
          const joursSansDernierRdv = Math.floor((now.getTime() - dateReference.getTime()) / (1000 * 60 * 60 * 24));
          
          // Vérifier pour chaque règle d'alerte
          for (const rule of enabledRules) {
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
        
        // Si des alertes ont été générées, les ajouter
        if (newAlerts.length > 0) {
          // Fusionner avec les alertes existantes et les nouvelles alertes AIR
          const allAIRAlerts = [...airAlerts.filter(a => a.isAIRAlert), ...newAlerts];
          
          // Mettre à jour l'état local
          setAirAlerts(allAIRAlerts);
          
          // Sauvegarder dans le stockage électronique
          const allAlertsToSave = [...existingAlerts.filter(a => !a.isAIRAlert), ...allAIRAlerts];
          await ElectronBridge.setData('alerts', allAlertsToSave);
        }
      } catch (error) {
        console.error('Erreur lors de la vérification des mesures AIR:', error);
      }
    }, DEBOUNCE_DELAY),
    [mesures, alertRules, existingAlerts, airAlerts]
  );

  // Convertir une date du format DD/MM/YYYY en YYYY-MM-DD pour traitement
  const formatDateForProcessing = (dateString: string): string => {
    // Si c'est déjà au format YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(dateString)) {
      return dateString;
    }
    
    // Convertir de DD/MM/YYYY vers YYYY-MM-DD
    const parts = dateString.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      const fullYear = year.length === 2 ? `20${year}` : year;
      return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    return dateString;
  };

  useEffect(() => {
    // Vérifier les mesures AIR au chargement
    checkAIRMesures();
    
    // Configurer une vérification périodique
    const interval = setInterval(checkAIRMesures, ALERT_CHECK_INTERVAL);
    
    return () => {
      clearInterval(interval);
      checkAIRMesures.cancel();
    };
  }, [checkAIRMesures]);

  return {
    airAlerts: airAlerts.filter(alert => alert.status === 'active'),
    checkAIRMesures
  };
};