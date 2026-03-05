import { AlertRule } from '@/types/interfaces';

export const APP_CONFIG = {
  ALERT_CHECK_INTERVAL: 3600000, // 1 hour in milliseconds
  DEFAULT_ALERT_RULES: [
    {
      id: 1,
      type: 'cr_delay',
      name: 'Délai compte rendu',
      description: 'Alerte lorsqu\'aucun compte rendu n\'a été ajouté depuis 7 jours',
      threshold: 7,
      enabled: true,
      isSystemRule: true
    },
    {
      id: 2,
      type: 'acte_expiration',
      name: 'Expiration acte',
      description: 'Alerte lorsqu\'un acte arrive à expiration dans 7 jours',
      threshold: 7,
      enabled: true,
      acteType: 'all',
      isSystemRule: true
    },
    {
      id: 3,
      type: 'enquete_age',
      name: 'Âge enquête',
      description: 'Alerte lorsqu\'une enquête atteint 45 jours',
      threshold: 45,
      enabled: true,
      isSystemRule: true
    },
    {
      id: 4,
      type: 'prolongation_pending',
      name: 'Prolongation en attente',
      description: 'Alerte pour relancer le JLD après 2 jours d\'attente',
      threshold: 2,
      enabled: true,
      isSystemRule: true
    },
    // Nouvelles règles pour AIR
    {
      id: 5,
      type: 'air_6_mois',
      name: 'Mesure AIR > 6 mois',
      description: 'Alerte lorsqu\'une mesure AIR dépasse 6 mois',
      threshold: 180, // 6 mois en jours
      enabled: true,
      isSystemRule: true
    },
    {
      id: 6,
      type: 'air_12_mois',
      name: 'Mesure AIR > 12 mois',
      description: 'Alerte lorsqu\'une mesure AIR dépasse 12 mois',
      threshold: 365, // 12 mois en jours
      enabled: true,
      isSystemRule: true
    },
    {
      id: 7,
      type: 'air_rdv_delai',
      name: 'Délai depuis RDV AIR',
      description: 'Alerte lorsqu\'aucun RDV procureur depuis 45 jours',
      threshold: 45,
      enabled: true,
      isSystemRule: true
    }
  ] as AlertRule[],
  
  STORAGE_KEYS: {
    ENQUETES: 'enquetes',
    INSTRUCTIONS: 'instructions', // CLÉ SÉPARÉE POUR LES INSTRUCTIONS
    ALERT_RULES: 'alertRules',
    CUSTOM_TAGS: 'customTags',
    SAVE_HISTORY: 'saveHistory',
    AUDIENCE_RESULTATS: 'audience_resultats',
    LAST_SAVE: 'lastSave',
    AIR_MESURES: 'air_mesures',
    ALERTS: 'alerts',
    ALERT_VALIDATIONS: 'alert_validations'
  },

  // 🆕 CONFIGURATION DES SAUVEGARDES
  BACKUP_CONFIG: {
    BACKUP_COUNT: 3,                              // Nombre de sauvegardes sélectives à conserver
    DATA_JSON_BACKUP_COUNT: 3,                    // Nombre de copies de data.json à conserver
    BACKUP_INTERVAL: 3 * 24 * 60 * 60 * 1000,    // Intervalle des sauvegardes sélectives (3 jours)
    DATA_JSON_COPY_INTERVAL: 24 * 60 * 60 * 1000, // Intervalle des copies data.json (1 jour)
    INTEGRITY_CHECK_INTERVAL: 7 * 24 * 60 * 60 * 1000 // Vérification d'intégrité (1 semaine)
  },

  ALERT_CHECK_INTERVAL: 5 * 60 * 1000, // 5 minutes
  MAX_SAVE_HISTORY: 20 // Nombre maximum d'entrées dans l'historique
};

export const DATE_FORMAT = {
  DISPLAY: 'dd/MM/yyyy',
  ISO: 'yyyy-MM-dd'
};

export const UI_CONSTANTS = {
  SIDEBAR_WIDTH: {
    OPEN: 'w-64',
    CLOSED: 'w-16'
  },
  COLORS: {
    PRIMARY: '#2B5746',
    SECONDARY: '#47725f',
    ALERT: '#dc2626'
  }
};