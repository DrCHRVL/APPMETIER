import { Alert, AlertValidation, AlertValidations } from '@/types/interfaces';
import { ElectronBridge } from '../electronBridge';

const ALERTS_KEY = 'alerts';
const VALIDATED_ALERTS_KEY = 'alert_validations';
const VALIDATION_CLEANUP_INTERVAL = 30 * 24 * 60 * 60 * 1000; // 30 jours en millisecondes

export const AlertStorage = {
  async saveAlerts(alerts: Alert[]): Promise<void> {
    const activeAlerts = alerts.filter(alert => alert.status === 'active');
    const validatedAlerts = alerts.filter(alert => alert.status === 'validated');
    
    await Promise.all([
      ElectronBridge.setData(ALERTS_KEY, activeAlerts),
      ElectronBridge.setData(VALIDATED_ALERTS_KEY, validatedAlerts)
    ]);
  },

  async getAlerts(): Promise<Alert[]> {
    try {
      const activeAlerts = await ElectronBridge.getData<Alert[]>(ALERTS_KEY, []);
      const validatedAlerts = await ElectronBridge.getData<Alert[]>(VALIDATED_ALERTS_KEY, []);
      
      // S'assurer que validatedAlerts est un tableau, sinon utiliser un tableau vide
      return [...(Array.isArray(activeAlerts) ? activeAlerts : []), 
              ...(Array.isArray(validatedAlerts) ? validatedAlerts : [])];
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