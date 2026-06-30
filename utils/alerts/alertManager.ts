import { Alert, AlertRule, Enquete, AlertValidation, RecurrenceConfig, AlertValidations } from '@/types/interfaces';
import { DateUtils } from '../dateUtils';
import { AlertStorage } from './alertStorage';
import { getLastCR } from '../compteRenduUtils';
import { userPreferencesSyncService } from '../dataSync/UserPreferencesSyncService';

export class AlertManager {
  private static ALERTS_KEY = 'alerts';

  // Validités au-delà desquelles une validation obsolète est purgée du
  // journal (hygiène de stockage uniquement — ce n'est PAS la durée pendant
  // laquelle l'alerte reste muette : ça, c'est géré par l'empreinte d'état).
  private static HISTORY_CLEANUP_PERIOD = 400 * 24 * 60 * 60 * 1000; // ~13 mois

  // Clé stable d'une alerte = (enquête, type, acte). Ne contient AUCUNE
  // notion de temps : c'est l'empreinte d'état (stateKey) stockée dans la
  // validation qui décide si l'alerte est encore « la même situation ».
  private static generateAlertKey(enqueteId: number, type: string, acteId?: number): string {
    return `${enqueteId}-${type}${acteId !== undefined ? `-${acteId}` : ''}`;
  }

  /**
   * Empreinte de l'état réel qui justifie l'alerte. « Valider » mémorise
   * cette empreinte ; l'alerte ne réapparaît que lorsque l'empreinte change,
   * c.-à-d. quand la situation a réellement évolué :
   *  - cr_delay        → nouveau compte rendu, ou retard franchissant un
   *                      nouveau palier (multiple du seuil) = filet de sécurité
   *  - enquete_age     → l'enquête franchit un nouveau palier d'âge
   *  - acte_expiration → la date d'expiration change (acte renouvelé/prolongé)
   *  - prolongation    → la prolongation en attente change
   *  - air_*           → nouveau palier / nouveau RDV procureur
   */
  static computeStateKey(
    type: string,
    ctx: {
      threshold?: number;
      lastCRDate?: string;       // ISO/court, date du dernier CR
      daysSinceLastCR?: number;
      age?: number;              // jours
      acteId?: number;
      dateFin?: string;          // expiration d'acte
      prolongationStart?: string;
      dateReference?: string;    // AIR : dernier RDV ou début
      joursSansRdv?: number;
    } = {},
  ): string {
    const seuil = Math.max(ctx.threshold || 1, 1);
    switch (type) {
      case 'cr_delay': {
        const palier = Math.floor((ctx.daysSinceLastCR ?? 0) / seuil);
        return `cr#${ctx.lastCRDate || ''}#${palier}`;
      }
      case 'enquete_age': {
        const palier = Math.floor((ctx.age ?? 0) / seuil);
        return `age#${palier}`;
      }
      case 'acte_expiration':
        return `acte#${ctx.acteId ?? ''}#${ctx.dateFin || ''}`;
      case 'prolongation_pending':
        return `prol#${ctx.acteId ?? ''}#${ctx.prolongationStart || ''}`;
      case 'air_6_mois':
        return 'air6';
      case 'air_12_mois':
        return 'air12';
      case 'air_rdv_delai': {
        const palier = Math.floor((ctx.joursSansRdv ?? 0) / seuil);
        return `airrdv#${ctx.dateReference || ''}#${palier}`;
      }
      default:
        return `state#${type}`;
    }
  }

  private static async cleanupValidationHistory(): Promise<void> {
    try {
      const validations = await AlertStorage.getValidations();
      const cutoffDate = new Date();
      cutoffDate.setTime(cutoffDate.getTime() - this.HISTORY_CLEANUP_PERIOD);

      const cleanedValidations = Object.entries(validations).reduce<AlertValidations>(
        (acc, [key, validation]) => {
          if (new Date(validation.validatedAt) > cutoffDate) {
            acc[key] = validation;
          }
          return acc;
        },
        {}
      );

      await userPreferencesSyncService.setAlertValidations(cleanedValidations);
    } catch (error) {
      console.error('Erreur lors du nettoyage de l\'historique:', error);
    }
  }

  /**
   * L'alerte a-t-elle déjà été validée POUR L'ÉTAT COURANT ?
   * Vrai uniquement si une validation existe avec la même empreinte d'état.
   * Dès que la situation réelle change (empreinte différente), l'alerte
   * redevient pertinente et réapparaît. Pas de fenêtre temporelle.
   */
  static async wasAcknowledgedForState(
    enqueteId: number,
    type: string,
    acteId: number | undefined,
    stateKey: string,
  ): Promise<boolean> {
    const validations = await AlertStorage.getValidations();
    const key = this.generateAlertKey(enqueteId, type, acteId);
    const validation = validations[key];
    if (!validation) return false;
    // Validation ancienne (avant refonte, sans empreinte) : on la respecte
    // pendant une fenêtre d'extinction de 30 j pour éviter un retour massif
    // juste après la mise à jour, puis le modèle par empreinte reprend la main.
    if (validation.stateKey === undefined) {
      const LEGACY_GRACE = 30 * 24 * 60 * 60 * 1000;
      return Date.now() - new Date(validation.validatedAt).getTime() < LEGACY_GRACE;
    }
    return validation.stateKey === stateKey;
  }

  public static async markAlertAsValidated(alert: Alert): Promise<void> {
    const key = this.generateAlertKey(alert.enqueteId, alert.type, alert.acteId);
    const validation: AlertValidation = {
      validatedAt: new Date().toISOString(),
      acteId: alert.acteId,
      type: alert.type,
      stateKey: alert.stateKey,
    };
    await AlertStorage.saveValidation(key, validation);
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

      // Doublon déjà actif ?
      const alertExists = currentAlerts.some(existingAlert =>
        existingAlert.enqueteId === alert.enqueteId &&
        existingAlert.type === alert.type &&
        (existingAlert.acteId === alert.acteId || (!existingAlert.acteId && !alert.acteId)) &&
        existingAlert.status === 'active'
      );

      // Déjà validée pour cet état exact ? (silence jusqu'à changement réel)
      const acknowledged = await this.wasAcknowledgedForState(
        alert.enqueteId,
        alert.type,
        alert.acteId,
        alert.stateKey || '',
      );

      if (!alertExists && !acknowledged) {
        const newAlerts = [...currentAlerts, alert];
        await AlertStorage.saveAlerts(newAlerts);
      }
    } catch (error) {
      console.error('Error in addAlert:', error);
    }
  }

  /**
   * Ne fonctionne plus : les règles d'alertes sont désormais partagées
   * par contentieux (ContentieuxAlertsSyncService), il n'existe plus de
   * jeu « global ». La méthode reste pour compatibilité mais renvoie
   * toujours undefined — en pratique elle n'est plus appelée nulle part.
   */
  static async findAlertRule(_type: string): Promise<AlertRule | undefined> {
    return undefined;
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

    // On garde les actives, et les snoozées dont le report n'est pas expiré.
    // Un snooze expiré disparaît du cache : l'alerte sera régénérée comme
    // active au prochain scan si la condition reste vraie (et non validée).
    return alerts.filter(alert => {
      if (alert.status === 'active') return true;
      if (alert.status === 'snoozed' && alert.snoozedUntil) {
        return new Date(alert.snoozedUntil) > now;
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
    prolongationData?: { dateDebut: string; duree: string },
    stateKey?: string,
  ): Alert {
    const alert: Alert = {
      id: Date.now() + Math.random(),
      enqueteId,
      type,
      message,
      createdAt: new Date().toISOString(),
      status: 'active',
      deadline,
      acteId,
      prolongationData,
      stateKey,
    };
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

    if (!shouldAlert) continue;

    const stateKey = this.computeStateKey(rule.type, {
      threshold: rule.threshold,
      dateReference: dateReference.toISOString().split('T')[0],
      joursSansRdv: joursSansDernierRdv,
    });

    if (await this.wasAcknowledgedForState(mesure.id, rule.type, undefined, stateKey)) continue;

    const alert = this.generateAlert(
      mesure.id,
      rule.type,
      message,
      undefined,
      undefined,
      { dateReference: dateReference.toISOString() },
      stateKey,
    );
    alert.isAIRAlert = true;
    alert.airIdentite = mesure.identite;
    alert.airNumeroParquet = mesure.numeroParquet;
    alerts.push(alert);
  }

  for (const alert of alerts) {
    await this.addAlert(alert);
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
      const lastCRDate = lastCR.date.split('T')[0];
      const daysSinceLastCR = DateUtils.getDaysDifference(new Date(lastCR.date), new Date());

      if (daysSinceLastCR >= crRule.threshold) {
        // Empreinte : dernier CR + palier de retard. Un nouveau CR (ou un
        // retard qui franchit un multiple du seuil) change l'empreinte.
        const stateKey = this.computeStateKey('cr_delay', {
          threshold: crRule.threshold,
          lastCRDate,
          daysSinceLastCR,
        });
        const ack = await this.wasAcknowledgedForState(enquete.id, 'cr_delay', undefined, stateKey);
        if (!ack) {
          const alert = this.generateAlert(
            enquete.id,
            'cr_delay',
            `Aucun compte rendu depuis ${daysSinceLastCR} jours pour l'enquête ${enquete.numero}`,
            undefined,
            undefined,
            undefined,
            stateKey,
          );
          alerts.push(alert);
        }
      }
    }

    // Vérification de l'âge de l'enquête
    const ageRule = enabledRules.find(rule => rule.type === 'enquete_age');
    if (ageRule && enquete.dateDebut && !enquete.tags.some(tag => tag.value === 'enquête à venir')) {
      const enqueteAge = DateUtils.getDaysDifference(new Date(enquete.dateDebut), new Date());

      if (enqueteAge >= ageRule.threshold) {
        // Empreinte : palier d'âge. Validée à 90 j → muette jusqu'au palier
        // suivant (180 j…). Plus de retour mensuel artificiel.
        const stateKey = this.computeStateKey('enquete_age', {
          threshold: ageRule.threshold,
          age: enqueteAge,
        });
        const ack = await this.wasAcknowledgedForState(enquete.id, 'enquete_age', undefined, stateKey);
        if (!ack) {
          const alert = this.generateAlert(
            enquete.id,
            'enquete_age',
            `L'enquête ${enquete.numero} a atteint ${enqueteAge} jours`,
            undefined,
            undefined,
            undefined,
            stateKey,
          );
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
          const daysUntilExpiration = DateUtils.getDaysDifference(new Date(), new Date(acte.dateFin));

          if (daysUntilExpiration <= rule.threshold && daysUntilExpiration > 0) {
            // Empreinte : acte + date d'expiration. Renouvellement/prolongation
            // (nouvelle dateFin) → l'alerte réapparaît légitimement.
            const stateKey = this.computeStateKey('acte_expiration', {
              acteId: acte.id,
              dateFin: acte.dateFin,
            });
            const ack = await this.wasAcknowledgedForState(enquete.id, 'acte_expiration', acte.id, stateKey);
            if (!ack) {
              const alert = this.generateAlert(
                enquete.id,
                'acte_expiration',
                `Un acte expire dans ${daysUntilExpiration} jours pour l'enquête ${enquete.numero}`,
                acte.dateFin,
                acte.id,
                undefined,
                stateKey,
              );
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
        if (!acte.prolongationData) continue;
        // Empreinte : acte + début de la prolongation en attente. Disparaît
        // d'elle-même quand le statut change (prolongation validée/refusée).
        const stateKey = this.computeStateKey('prolongation_pending', {
          acteId: acte.id,
          prolongationStart: acte.prolongationData.dateDebut,
        });
        const ack = await this.wasAcknowledgedForState(enquete.id, 'prolongation_pending', acte.id, stateKey);
        if (!ack) {
          const alert = this.generateAlert(
            enquete.id,
            'prolongation_pending',
            `Prolongation en attente de validation pour l'enquête ${enquete.numero}`,
            DateUtils.addDays(new Date(), 2),
            acte.id,
            acte.prolongationData,
            stateKey,
          );
          alerts.push(alert);
        }
      }
    }

    // Nettoyage périodique (10% de chance à chaque vérification)
    if (Math.random() < 0.1) {
      await this.cleanupValidationHistory();
    }

    for (const alert of alerts) {
      await this.addAlert(alert);
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