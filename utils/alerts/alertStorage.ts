import { Alert, AlertValidation, AlertValidations } from '@/types/interfaces';
import { ElectronBridge } from '../electronBridge';
import { userPreferencesSyncService } from '../dataSync/UserPreferencesSyncService';

const ALERTS_KEY = 'alerts';
const VALIDATION_CLEANUP_INTERVAL = 30 * 24 * 60 * 60 * 1000; // 30 jours en millisecondes

/**
 * AlertStorage : R/W des alertes locales (par machine) + des validations
 * personnelles (par utilisateur via userPreferencesSyncService).
 *
 * Les validations vivaient dans `alert_validations` (clé globale synchronisée
 * via AlertSyncService). Elles sont maintenant attachées à l'utilisateur :
 * chaque agent a son propre journal de validations, ce qui évite qu'un
 * collègue éteigne l'alerte chez tout le monde.
 */
export const AlertStorage = {
  async saveAlerts(alerts: Alert[]): Promise<void> {
    // Sauvegarder uniquement les alertes actives et snoozées.
    // Les validations sont tracées dans la prefs utilisateur (saveValidation).
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

  async getValidations(): Promise<AlertValidations> {
    const prefs = await userPreferencesSyncService.getPreferences();
    return prefs?.alertValidations?.entries || {};
  },

  async saveValidation(key: string, validation: AlertValidation): Promise<void> {
    await userPreferencesSyncService.setAlertValidation(key, validation);
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

    await userPreferencesSyncService.setAlertValidations(updatedValidations);
  }
};
