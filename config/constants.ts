import { AlertRule, VisualAlertRule, VisualAlertColorKey } from '@/types/interfaces';

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
    ALERT_VALIDATIONS: 'alert_validations',
    VISUAL_ALERT_RULES: 'visualAlertRules'
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

// Palette de couleurs pour les alertes visuelles
// IMPORTANT: toutes les classes Tailwind sont écrites en dur pour la purge CSS
export const VISUAL_ALERT_COLOR_PALETTE: Record<VisualAlertColorKey, {
  fond: string;
  bordureLeft: string;
  bordureRight: string;
  dot: string;
  label: string;
}> = {
  'red':      { fond: 'bg-red-50',     bordureLeft: 'border-l-red-500',    bordureRight: 'border-r-red-500',    dot: 'bg-red-500',    label: 'Rouge' },
  'red-dark': { fond: 'bg-red-100',    bordureLeft: 'border-l-red-600',    bordureRight: 'border-r-red-600',    dot: 'bg-red-600',    label: 'Rouge foncé' },
  'orange':   { fond: 'bg-orange-100', bordureLeft: 'border-l-orange-400', bordureRight: 'border-r-orange-400', dot: 'bg-orange-400', label: 'Orange' },
  'amber':    { fond: 'bg-amber-50',   bordureLeft: 'border-l-amber-300',  bordureRight: 'border-r-amber-300',  dot: 'bg-amber-400',  label: 'Ambre' },
  'yellow':   { fond: 'bg-yellow-50',  bordureLeft: 'border-l-yellow-400', bordureRight: 'border-r-yellow-400', dot: 'bg-yellow-400', label: 'Jaune' },
  'green':    { fond: 'bg-green-50',   bordureLeft: 'border-l-green-500',  bordureRight: 'border-r-green-500',  dot: 'bg-green-500',  label: 'Vert' },
  'blue':     { fond: 'bg-blue-50',    bordureLeft: 'border-l-blue-500',   bordureRight: 'border-r-blue-500',   dot: 'bg-blue-500',   label: 'Bleu' },
  'purple':   { fond: 'bg-purple-50',  bordureLeft: 'border-l-purple-500', bordureRight: 'border-r-purple-500', dot: 'bg-purple-500', label: 'Violet' },
  'gray':     { fond: 'bg-gray-100',   bordureLeft: 'border-l-gray-400',   bordureRight: 'border-r-gray-400',   dot: 'bg-gray-400',   label: 'Gris' },
};

export const VISUAL_ALERT_COLOR_KEYS: VisualAlertColorKey[] = [
  'red', 'red-dark', 'orange', 'amber', 'yellow', 'green', 'blue', 'purple', 'gray'
];

export const VISUAL_ALERT_TRIGGER_LABELS: Record<string, string> = {
  'op_active': 'OP en cours (date dépassée)',
  'op_proche': 'OP proche',
  'acte_critique': 'Acte critique',
  'cr_retard': 'CR en retard',
  'prolongation_pending': 'Prolongation en attente',
  'autorisation_pending': 'Autorisation JLD en attente',
  'jld_pending': 'JLD en attente (autorisation ou prolongation)',
};

export const DEFAULT_VISUAL_ALERT_RULES: VisualAlertRule[] = [
  { id: 1, trigger: 'op_active',    label: 'OP en cours',           seuil: 0,  mode: 'fond_bordure', fondColor: 'red',    bordureColor: 'red',    enabled: true, priority: 1, isSystemRule: true },
  { id: 2, trigger: 'op_proche',    label: 'OP très proche (≤4j)',  seuil: 4,  mode: 'fond_bordure', fondColor: 'orange', bordureColor: 'orange', enabled: true, priority: 2, isSystemRule: true },
  { id: 3, trigger: 'op_proche',    label: 'OP dans la semaine',    seuil: 7,  mode: 'fond_bordure', fondColor: 'amber',  bordureColor: 'amber',  enabled: true, priority: 3, isSystemRule: true },
  { id: 4, trigger: 'acte_critique', label: 'Acte expire (≤3j)',    seuil: 3,  mode: 'fond_bordure', fondColor: 'red',    bordureColor: 'red-dark', enabled: true, priority: 4, isSystemRule: true },
  { id: 5, trigger: 'cr_retard',    label: 'CR en retard (≥7j)',    seuil: 7,  mode: 'bordure',      fondColor: 'amber',  bordureColor: 'amber',  enabled: false, priority: 5, isSystemRule: true },
  { id: 6, trigger: 'prolongation_pending',  label: 'Prolongation en attente (≥2j)',        seuil: 2, mode: 'bordure', fondColor: 'purple', bordureColor: 'purple', enabled: false, priority: 6, isSystemRule: true },
  { id: 7, trigger: 'autorisation_pending',  label: 'Autorisation JLD en attente (≥1j)',    seuil: 1, mode: 'bordure', fondColor: 'purple', bordureColor: 'purple', enabled: false, priority: 7, isSystemRule: true },
  { id: 8, trigger: 'jld_pending',           label: 'JLD en attente — autorisation ou prolong. (≥1j)', seuil: 1, mode: 'bordure', fondColor: 'purple', bordureColor: 'purple', enabled: false, priority: 8, isSystemRule: true },
];

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