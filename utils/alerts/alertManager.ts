import { Alert, AlertRule, Enquete, AlertValidation, RecurrenceConfig } from '@/types/interfaces';
import { ElectronBridge } from '../electronBridge';
import { DateUtils } from '../dateUtils';
import { AlertStorage } from './alertStorage';
import { getLastCR } from '../compteRenduUtils';

export class AlertManager {
  private static ALERTS_KEY = 'alerts';
  private static VALIDATED_ALERTS_KEY = 'alert_validations';
  
  // Périodes de validation différentes selon le type d'alerte.
  // Une fois validée, l'alerte ne réapparaît pas pendant cette durée
  // (sauf si la clé change, ex: nouveau CR pour cr_delay).
  private static VALIDATION_PERIODS = {
    'cr_delay': 30 * 24 * 60 * 60 * 1000,          // 30 jours (la clé inclut le dernier CR → reset si nouveau CR)
    'acte_expiration': 8 * 24 * 60 * 60 * 1000,     // 8 jours (> seuil 7j par défaut)
    'enquete_age': 30 * 24 * 60 * 60 * 1000,        // 30 jours
    'prolongation_pending': 24 * 60 * 60 * 1000,    // 24h (statut change vite)
    'default': 14 * 24 * 60 * 60 * 1000             // 14 jours par défaut
  };
  
  private static HISTORY_CLEANUP_PERIOD = 30 * 24 * 60 * 60 * 1000; // 30 jours

  private static generateAlertKey(enqueteId: number, type: string, acteId?: number, context?: string): string {
    // Pour les alertes d'âge d'enquête, inclure l'année et le mois actuels dans la clé
    if (type === 'enquete_age') {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      return `${enqueteId}-${type}-${yearMonth}`;
    }
    // Pour cr_delay, le contexte contient la date du dernier CR.
    // Ainsi la validation est liée à ce CR : si un nouveau CR est ajouté, la clé change
    // et l'alerte peut réapparaître après le prochain threshold.
    let key = `${enqueteId}-${type}${acteId ? `-${acteId}` : ''}`;
    if (context) key += `-${context}`;
    return key;
  }

  private static async cleanupValidationHistory(): Promise<void> {
    try {
      const validations = await AlertStorage.getValidations();
      const cutoffDate = new Date();
      cutoffDate.setTime(cutoffDate.getTime() - this.HISTORY_CLEANUP_PERIOD);

      const cleanedValidations = Object.entries(validations).reduce<Record<string, AlertValidation>>(
        (acc, [key, validation]) => {
          if (new Date(validation.validatedAt) > cutoffDate) {
            acc[key] = validation;
          }
          return acc;
        },
        {}
      );

      await ElectronBridge.setData(this.VALIDATED_ALERTS_KEY, cleanedValidations);
    } catch (error) {
      console.error('Erreur lors du nettoyage de l\'historique:', error);
    }
  }

  static async wasRecentlyValidated(enqueteId: number, type: string, acteId?: number, context?: string): Promise<boolean> {
    const validations = await AlertStorage.getValidations();
    const key = this.generateAlertKey(enqueteId, type, acteId, context);
    const validation = validations[key];
    
    if (!validation) return false;
    
    const validationDate = new Date(validation.validatedAt);
    const now = new Date();
    
    // Obtenir la période de validation appropriée pour ce type d'alerte
    const validationPeriod = this.VALIDATION_PERIODS[type as keyof typeof this.VALIDATION_PERIODS] || 
                          this.VALIDATION_PERIODS.default;
    
    // Vérifier si la validation est suffisamment récente
    const isRecent = (now.getTime() - validationDate.getTime()) < validationPeriod;
    console.log(`Validation check for ${key}: ${isRecent ? 'recently validated' : 'not recently validated'} (Period: ${validationPeriod / (24 * 60 * 60 * 1000)} days)`);
    
    return isRecent;
  }

  public static async markAlertAsValidated(alert: Alert): Promise<void> {
    // Si l'alerte est récurrente, ne pas marquer comme validée définitivement
    if (alert.recurrence?.enabled) {
      await this.handleRecurrentAlertValidation(alert);
      return;
    }

    // Sinon, procédure normale de validation
    // Pour cr_delay, le contexte (date dernier CR) est dans alert.context s'il existe
    const key = this.generateAlertKey(alert.enqueteId, alert.type, alert.acteId, (alert as any).context);
    const validation: AlertValidation = {
      validatedAt: new Date().toISOString(),
      acteId: alert.acteId,
      type: alert.type
    };

    await AlertStorage.saveValidation(key, validation);
  }

  private static async handleRecurrentAlertValidation(alert: Alert): Promise<void> {
    try {
      // Récupérer toutes les alertes
      const alerts = await this.getAlerts();
      
      // Calculer la date de prochaine récurrence
      const now = new Date();
      const recurrenceInterval = alert.recurrence?.interval || 7; // Défaut à 7 jours
      const nextRecurrenceDate = new Date();
      nextRecurrenceDate.setDate(now.getDate() + recurrenceInterval);
      
      // Mettre à jour le compteur d'occurrences
      const currentOccurrence = (alert.recurrence?.currentOccurrence || 0) + 1;
      const maxOccurrences = alert.recurrence?.maxOccurrences;
      
      // Vérifier si le nombre maximum d'occurrences est atteint
      if (maxOccurrences !== undefined && currentOccurrence >= maxOccurrences) {
        // Si oui, supprimer l'alerte
        const updatedAlerts = alerts.filter(a => a.id !== alert.id);
        await this.saveAlerts(updatedAlerts);
        return;
      }
      
      // Si non, mettre à jour l'alerte pour la prochaine récurrence
      const updatedAlerts = alerts.map(a => {
        if (a.id === alert.id) {
          return {
            ...a,
            status: 'snoozed',
            snoozedUntil: nextRecurrenceDate.toISOString(),
            lastRecurred: now.toISOString(),
            recurrence: {
              ...a.recurrence || {},
              currentOccurrence
            }
          };
        }
        return a;
      });
      
      await this.saveAlerts(updatedAlerts);
    } catch (error) {
      console.error('Error handling recurrent alert validation:', error);
    }
  }

  static async saveAlerts(alerts: Alert[]): Promise<void> {
    await AlertStorage.saveAlerts(alerts);
  }

  static async getAlerts(): Promise<Alert[]> {
    const alerts = await AlertStorage.getAlerts();
    return this.cleanupAlerts(alerts);
  }

  static async addAlert(alert: Alert): Promise<void> {
    try {
      let currentAlerts: Alert[] = [];
      
      try {
        currentAlerts = await AlertStorage.getAlerts();
      } catch (error) {
        console.warn('Failed to get current alerts, starting with empty array');
        currentAlerts = [];
      }

      // Vérifier si cette alerte existe déjà OU a été récemment validée
      const alertExists = currentAlerts.some(existingAlert => 
        existingAlert.enqueteId === alert.enqueteId &&
        existingAlert.type === alert.type &&
        (existingAlert.acteId === alert.acteId || (!existingAlert.acteId && !alert.acteId)) &&
        existingAlert.status === 'active'
      );

      // Pour les alertes non récurrentes, vérifier si elles ont été récemment validées
      let wasRecentlyValidated = false;
      if (!alert.recurrence?.enabled) {
        wasRecentlyValidated = await this.wasRecentlyValidated(
          alert.enqueteId, 
          alert.type, 
          alert.acteId
        );
      }

      // N'ajouter l'alerte que si elle n'existe pas déjà ET n'a pas été récemment validée
      if (!alertExists && !wasRecentlyValidated) {
        // Si c'est une alerte récurrente, ajouter une configuration de récurrence si nécessaire
        if (alert.recurrence?.enabled) {
          // Chercher la règle d'alerte correspondante pour obtenir les détails de récurrence
          const rule = await this.findAlertRule(alert.type);
          if (rule?.recurrence?.enabled) {
            alert.recurrence = {
              enabled: true,
              interval: rule.recurrence.defaultInterval || 7,
              maxOccurrences: rule.recurrence.maxOccurrences,
              currentOccurrence: 0
            };
          }
        }
        
        const newAlerts = [...currentAlerts, alert];
        await AlertStorage.saveAlerts(newAlerts);
      }
    } catch (error) {
      console.error('Error in addAlert:', error);
    }
  }

  static async findAlertRule(type: string): Promise<AlertRule | undefined> {
    try {
      const rules = await ElectronBridge.getData<AlertRule[]>('alert_rules', []);
      return rules.find(rule => rule.type === type && rule.enabled);
    } catch (error) {
      console.error('Error finding alert rule:', error);
      return undefined;
    }
  }

  // Méthode mise à jour pour supporter le report à une date spécifique ou pour un nombre de jours
  static async snoozeAlert(alertId: number, daysOrDate: number | string): Promise<boolean> {
    try {
      const alerts = await this.getAlerts();
      
      const updatedAlerts = alerts.map(alert => {
        if (alert.id === alertId) {
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
          
          return {
            ...alert,
            status: 'snoozed',
            snoozedUntil: snoozeUntil.toISOString(),
            snoozedCount: (alert.snoozedCount || 0) + 1
          };
        }
        return alert;
      });
      
      await this.saveAlerts(updatedAlerts);
      return true;
    } catch (error) {
      console.error('Error snoozing alert:', error);
      return false;
    }
  }

  private static cleanupAlerts(alerts: Alert[]): Alert[] {
    const now = new Date();

    // Traiter les alertes reportées (snoozed) dont la date de report est passée
    const alertsToProcess = alerts.map(alert => {
      if (alert.status === 'snoozed' && alert.snoozedUntil) {
        const snoozeUntilDate = new Date(alert.snoozedUntil);

        // Si la date de report est passée
        if (snoozeUntilDate <= now) {
          // Si c'est une alerte récurrente, la réactiver
          if (alert.recurrence?.enabled) {
            return { ...alert, status: 'active' };
          }
          // Sinon, la conserver comme reportée (et elle sera filtrée ci-dessous)
        }
      }
      return alert;
    });

    return alertsToProcess.filter(alert => {
      // Pour les alertes actives, les conserver toutes
      if (alert.status === 'active') {
        return true;
      }
      
      // Pour les alertes en report, vérifier la date de fin du report
      if (alert.status === 'snoozed' && alert.snoozedUntil) {
        const snoozeUntilDate = new Date(alert.snoozedUntil);
        return snoozeUntilDate > now;
      }

      return false;
    });
  }

  static generateAlert(
    enqueteId: number,
    type: string,
    message: string,
    deadline?: string,
    acteId?: number,
    prolongationData?: { dateDebut: string; duree: string }
  ): Alert {
    // Création de l'alerte (sans attendre la promesse, elle sera mise à jour lors de l'ajout)
    const alert: Alert = {
      id: Date.now() + Math.random(),
      enqueteId,
      type,
      message,
      createdAt: new Date().toISOString(),
      status: 'active',
      deadline,
      acteId,
      prolongationData
    };

    // Vérification et ajout de la récurrence se fera dans addAlert ou checkEnquete
    return alert;
  }
  static async checkAIRMesure(mesure: AIRMesure, rules: AlertRule[]): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const enabledRules = rules.filter(rule => rule.enabled && rule.type.startsWith('air_'));
  
  // Si aucune règle activée ou si la mesure est terminée, retourner un tableau vide
  if (enabledRules.length === 0 || 
      mesure.statut === 'reussite' || 
      mesure.statut === 'echec' || 
      mesure.statut === 'inconnu') {
    return alerts;
  }
  
  const now = new Date();
  
  // Traiter la date de début
  let dateDebut: Date | null = null;
  try {
    if (mesure.dateDebut) {
      // Si format DD/MM/YYYY
      if (mesure.dateDebut.includes('/')) {
        const [day, month, year] = mesure.dateDebut.split('/');
        const fullYear = year.length === 2 ? `20${year}` : year;
        dateDebut = new Date(`${fullYear}-${month}-${day}`);
      } else {
        // Si format YYYY-MM-DD
        dateDebut = new Date(mesure.dateDebut);
      }
    }
  } catch (error) {
    console.error('Erreur lors du parsing de la date de début AIR:', error);
    return alerts;
  }
  
  if (!dateDebut) return alerts;
  
  // Calculer l'âge de la mesure
  const mesureAge = Math.floor((now.getTime() - dateDebut.getTime()) / (1000 * 60 * 60 * 24));
  
  // Trouver la date du dernier RDV procureur
  let dernierRdvDate: Date | null = null;
  if (mesure.details?.rdv && mesure.details.rdv.length > 0) {
    // Trier par date décroissante
    const rdvsSorted = [...mesure.details.rdv].sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date(0);
      const dateB = b.date ? new Date(b.date) : new Date(0);
      return dateB.getTime() - dateA.getTime();
    });
    
    if (rdvsSorted[0].date) {
      dernierRdvDate = new Date(rdvsSorted[0].date);
    }
  }
  
  // Calculer le délai depuis le dernier RDV ou depuis le début si pas de RDV
  const dateReference = dernierRdvDate || dateDebut;
  const joursSansDernierRdv = Math.floor((now.getTime() - dateReference.getTime()) / (1000 * 60 * 60 * 24));
  
  // Vérifier les règles d'alerte
  for (const rule of enabledRules) {
    // Vérifier si cette alerte a déjà été validée récemment
    const wasValidated = await this.wasRecentlyValidated(
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
      const alert = this.generateAlert(
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
      
      alerts.push(alert);
    }
  }
  
  // Pour chaque alerte générée, vérifier à nouveau si elle n'a pas été validée
  // et l'ajouter uniquement si nécessaire
  for (const alert of alerts) {
    // Si l'alerte est récurrente, on l'ajoute sans vérifier si elle a été validée
    if (alert.recurrence?.enabled) {
      await this.addAlert(alert);
      continue;
    }
    
    const wasRecentlyValidated = await this.wasRecentlyValidated(
      alert.enqueteId, 
      alert.type, 
      alert.acteId
    );
    
    // N'ajouter l'alerte que si elle n'a pas été récemment validée
    if (!wasRecentlyValidated) {
      await this.addAlert(alert);
    }
  }
  
  return alerts;
}
  static async checkEnquete(enquete: Enquete, rules: AlertRule[]): Promise<Alert[]> {
    const alerts: Alert[] = [];
    const enabledRules = rules.filter(rule => rule.enabled);

    // Vérification des CR
    const crRule = enabledRules.find(rule => rule.type === 'cr_delay');
    if (crRule && enquete.comptesRendus.length > 0) {
      const lastCR = getLastCR(enquete.comptesRendus);
      // La clé inclut la date du dernier CR : si un nouveau CR est ajouté, la validation est réinitialisée
      const wasValidated = await this.wasRecentlyValidated(enquete.id, 'cr_delay', undefined, lastCR.date.split('T')[0]);
      if (!wasValidated) {
        const daysSinceLastCR = DateUtils.getDaysDifference(new Date(lastCR.date), new Date());

        if (daysSinceLastCR >= crRule.threshold) {
          const alert = this.generateAlert(
            enquete.id,
            'cr_delay',
            `Aucun compte rendu depuis ${daysSinceLastCR} jours pour l'enquête ${enquete.numero}`
          );
          // Stocker le contexte pour que markAlertAsValidated puisse générer la même clé
          (alert as any).context = lastCR.date.split('T')[0];
          
          // Ajouter les informations de récurrence si la règle est récurrente
          if (crRule.recurrence?.enabled) {
            alert.recurrence = {
              enabled: true,
              interval: crRule.recurrence.defaultInterval || 7,
              maxOccurrences: crRule.recurrence.maxOccurrences,
              currentOccurrence: 0
            };
          }
          
          alerts.push(alert);
        }
      }
    }

    // Vérification de l'âge de l'enquête
    const ageRule = enabledRules.find(rule => rule.type === 'enquete_age');
    if (ageRule && enquete.dateDebut && !enquete.tags.some(tag => tag.value === 'enquête à venir')) {
      const wasValidated = await this.wasRecentlyValidated(enquete.id, 'enquete_age');
      if (!wasValidated) {
        const enqueteAge = DateUtils.getDaysDifference(new Date(enquete.dateDebut), new Date());
        
        if (enqueteAge >= ageRule.threshold) {
          const alert = this.generateAlert(
            enquete.id,
            'enquete_age',
            `L'enquête ${enquete.numero} a atteint ${enqueteAge} jours`
          );
          
          // Ajouter les informations de récurrence si la règle est récurrente
          if (ageRule.recurrence?.enabled) {
            alert.recurrence = {
              enabled: true,
              interval: ageRule.recurrence.defaultInterval || 7,
              maxOccurrences: ageRule.recurrence.maxOccurrences,
              currentOccurrence: 0
            };
          }
          
          alerts.push(alert);
        }
      }
    }

    // Vérification des actes
    const acteRules = enabledRules.filter(rule => rule.type === 'acte_expiration');
    for (const rule of acteRules) {
      const actesToCheck = this.getActesToCheck(enquete, rule.acteType);

      for (const acte of actesToCheck.filter(a => a.statut === 'en_cours')) {
        if (acte.dateFin) {
          const wasValidated = await this.wasRecentlyValidated(enquete.id, 'acte_expiration', acte.id);
          if (!wasValidated) {
            const daysUntilExpiration = DateUtils.getDaysDifference(new Date(), new Date(acte.dateFin));
            
            if (daysUntilExpiration <= rule.threshold && daysUntilExpiration > 0) {
              const alert = this.generateAlert(
                enquete.id,
                'acte_expiration',
                `Un acte expire dans ${daysUntilExpiration} jours pour l'enquête ${enquete.numero}`,
                acte.dateFin,
                acte.id
              );
              
              // Ajouter les informations de récurrence si la règle est récurrente
              if (rule.recurrence?.enabled) {
                alert.recurrence = {
                  enabled: true,
                  interval: rule.recurrence.defaultInterval || 7,
                  maxOccurrences: rule.recurrence.maxOccurrences,
                  currentOccurrence: 0
                };
              }
              
              alerts.push(alert);
            }
          }
        }
      }
    }

    // Vérification des prolongations
    const prolongationRule = enabledRules.find(rule => rule.type === 'prolongation_pending');
    if (prolongationRule) {
      const allActes = this.getActesToCheck(enquete);
      for (const acte of allActes.filter(a => a.statut === 'prolongation_pending')) {
        const wasValidated = await this.wasRecentlyValidated(enquete.id, `prolongation_${acte.id}`);
        if (!wasValidated && acte.prolongationData) {
          const alert = this.generateAlert(
            enquete.id,
            'prolongation_pending',
            `Prolongation en attente de validation pour l'enquête ${enquete.numero}`,
            DateUtils.addDays(new Date(), 2),
            acte.id,
            acte.prolongationData
          );
          
          // Ajouter les informations de récurrence si la règle est récurrente
          if (prolongationRule.recurrence?.enabled) {
            alert.recurrence = {
              enabled: true,
              interval: prolongationRule.recurrence.defaultInterval || 7,
              maxOccurrences: prolongationRule.recurrence.maxOccurrences,
              currentOccurrence: 0
            };
          }
          
          alerts.push(alert);
        }
      }
    }

    // Nettoyage périodique (10% de chance à chaque vérification)
    if (Math.random() < 0.1) {
      await this.cleanupValidationHistory();
    }

    // Pour chaque alerte générée, vérifier à nouveau si elle n'a pas été validée
    // et l'ajouter uniquement si nécessaire
    for (const alert of alerts) {
      // Si l'alerte est récurrente, on l'ajoute sans vérifier si elle a été validée
      if (alert.recurrence?.enabled) {
        await this.addAlert(alert);
        continue;
      }
      
      const wasRecentlyValidated = await this.wasRecentlyValidated(
        alert.enqueteId,
        alert.type,
        alert.acteId,
        (alert as any).context
      );

      // N'ajouter l'alerte que si elle n'a pas été récemment validée
      if (!wasRecentlyValidated) {
        await this.addAlert(alert);
      }
    }

    return alerts;
  }

  private static getActesToCheck(enquete: Enquete, acteType?: string) {
    switch (acteType) {
      case 'geolocalisation':
        return enquete.geolocalisations || [];
      case 'ecoute':
        return enquete.ecoutes || [];
      case 'autre':
        return enquete.actes || [];
      default:
        return [
          ...(enquete.actes || []),
          ...(enquete.ecoutes || []),
          ...(enquete.geolocalisations || [])
        ];
    }
  }

  static async getAlertsByEnqueteId(enqueteId: number): Promise<Alert[]> {
    const alerts = await this.getAlerts();
    return alerts.filter(alert => alert.enqueteId === enqueteId);
  }
}