import { Alert, AlertValidation, AlertValidations } from '@/types/interfaces';
import { ElectronBridge } from '../electronBridge';

const ALERTS_KEY = 'alerts';
const VALIDATED_ALERTS_KEY = 'alert_validations';
const VALIDATION_CLEANUP_INTERVAL = 30 * 24 * 60 * 60 * 1000; // 30 jours en millisecondes

export const AlertStorage = {
  async saveAlerts(alerts: Alert[]): Promise<void> {
    // Sauvegarder uniquement les alertes actives et snoozées.
    // Les validations sont tracées via le dictionnaire alert_validations (saveValidation).
    // Ne PAS écrire dans VALIDATED_ALERTS_KEY ici : cela écraserait le dictionnaire de validations.
    const alertsToSave = alerts.filter(
      alert => alert.status === 'active' || alert.status === 'snoozed'
    );
    await ElectronBridge.setData(ALERTS_KEY, alertsToSave);
  },

  async getAlerts(): Promise<Alert[]> {
    try {
      const alerts = await ElectronBridge.getData<Alert[]>(ALERTS_KEY, []);
      return Array.isArray(alerts) ? alerts : [];
    } catch (error) {
      console.error('Error getting alerts:', error);
      return [];
    }
  },

  // Nouvelles méthodes pour la gestion des validations
  async getValidations(): Promise<AlertValidations> {
    return await ElectronBridge.getData(VALIDATED_ALERTS_KEY, {});
  },

  async saveValidation(key: string, validation: AlertValidation): Promise<void> {
    const validations = await this.getValidations();
    validations[key] = validation;
    await ElectronBridge.setData(VALIDATED_ALERTS_KEY, validations);
  },

  async cleanupValidations(): Promise<void> {
    const validations = await this.getValidations();
    const cutoffDate = new Date();
    cutoffDate.setTime(cutoffDate.getTime() - VALIDATION_CLEANUP_INTERVAL);

    const updatedValidations = Object.entries(validations).reduce<AlertValidations>(
      (acc, [key, validation]) => {
        if (new Date(validation.validatedAt) > cutoffDate) {
          acc[key] = validation;
        }
        return acc;
      },
      {}
    );

    await ElectronBridge.setData(VALIDATED_ALERTS_KEY, updatedValidations);
  }
};