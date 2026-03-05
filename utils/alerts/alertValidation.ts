import { AlertRule, Alert } from '@/types/interfaces';

export const AlertValidation = {
  validateRule: (rule: AlertRule): boolean => {
    if (!rule.type || !rule.threshold || rule.threshold < 1) {
      return false;
    }

    if (rule.type === 'acte_expiration' && !rule.acteType) {
      return false;
    }

    if (!rule.name || rule.name.trim() === '') {
      return false;
    }

    return true;
  },

  validateAlert: (alert: Alert): boolean => {
    if (!alert.enqueteId || !alert.type || !alert.message) {
      return false;
    }

    if (alert.type === 'acte_expiration' && !alert.deadline) {
      return false;
    }

    return true;
  }
};