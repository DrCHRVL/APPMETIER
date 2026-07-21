import { AlertRule, VisualAlertRule, VisualAlertColorKey, VisualAlertTrigger } from '@/types/interfaces';

export const APP_CONFIG = {
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
    }
  ] as AlertRule[],
  
  STORAGE_KEYS: {
    ENQUETES: 'enquetes',
    INSTRUCTIONS: 'instructions', // CLÉ SÉPARÉE POUR LES INSTRUCTIONS
    INSTRUCTION_CONFIG: 'instructionConfig', // Cabinets et autres réglages du module instruction
    INSTRUCTION_RESULTATS: 'instruction_resultats', // Résultats d'audience des dossiers d'instruction (JSON séparé)
    CARTOGRAPHIE_CONFIG: 'cartographieConfig', // Pondérations du score top 10 (carto)
    ALERT_RULES: 'alertRules',
    CUSTOM_TAGS: 'customTags',
    SAVE_HISTORY: 'saveHistory',
    AUDIENCE_RESULTATS: 'audience_resultats',
    LAST_SAVE: 'lastSave',
    AIR_MESURES: 'air_mesures',
    ALERTS: 'alerts',
    ALERT_VALIDATIONS: 'alert_validations',
    VISUAL_ALERT_RULES: 'visualAlertRules',
    CLOTURE_TEMPLATE: 'clotureTemplate',
    TRAMES_FORME: 'tramesForme' // Papeteries Word (.docx à balises) définies par l'utilisateur
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
  // Fonds volontairement plus marqués (-100/-200) pour une meilleure
  // présence visuelle, tout en restant lisibles sous le texte des cartes.
  'red':      { fond: 'bg-red-100',     bordureLeft: 'border-l-red-500',     bordureRight: 'border-r-red-500',     dot: 'bg-red-500',     label: 'Rouge' },
  'red-dark': { fond: 'bg-red-200',     bordureLeft: 'border-l-red-600',     bordureRight: 'border-r-red-600',     dot: 'bg-red-600',     label: 'Rouge foncé' },
  'orange':   { fond: 'bg-orange-100',  bordureLeft: 'border-l-orange-500',  bordureRight: 'border-r-orange-500',  dot: 'bg-orange-500',  label: 'Orange' },
  'amber':    { fond: 'bg-amber-100',   bordureLeft: 'border-l-amber-400',   bordureRight: 'border-r-amber-400',   dot: 'bg-amber-400',   label: 'Ambre' },
  'yellow':   { fond: 'bg-yellow-100',  bordureLeft: 'border-l-yellow-400',  bordureRight: 'border-r-yellow-400',  dot: 'bg-yellow-400',  label: 'Jaune' },
  'lime':     { fond: 'bg-lime-100',    bordureLeft: 'border-l-lime-500',    bordureRight: 'border-r-lime-500',    dot: 'bg-lime-500',    label: 'Citron vert' },
  'green':    { fond: 'bg-green-100',   bordureLeft: 'border-l-green-500',   bordureRight: 'border-r-green-500',   dot: 'bg-green-500',   label: 'Vert' },
  'emerald':  { fond: 'bg-emerald-100', bordureLeft: 'border-l-emerald-500', bordureRight: 'border-r-emerald-500', dot: 'bg-emerald-500', label: 'Émeraude' },
  'teal':     { fond: 'bg-teal-100',    bordureLeft: 'border-l-teal-500',    bordureRight: 'border-r-teal-500',    dot: 'bg-teal-500',    label: 'Sarcelle' },
  'cyan':     { fond: 'bg-cyan-100',    bordureLeft: 'border-l-cyan-500',    bordureRight: 'border-r-cyan-500',    dot: 'bg-cyan-500',    label: 'Cyan' },
  'sky':      { fond: 'bg-sky-100',     bordureLeft: 'border-l-sky-500',     bordureRight: 'border-r-sky-500',     dot: 'bg-sky-500',     label: 'Ciel' },
  'blue':     { fond: 'bg-blue-100',    bordureLeft: 'border-l-blue-500',    bordureRight: 'border-r-blue-500',    dot: 'bg-blue-500',    label: 'Bleu' },
  'indigo':   { fond: 'bg-indigo-100',  bordureLeft: 'border-l-indigo-500',  bordureRight: 'border-r-indigo-500',  dot: 'bg-indigo-500',  label: 'Indigo' },
  'purple':   { fond: 'bg-purple-100',  bordureLeft: 'border-l-purple-500',  bordureRight: 'border-r-purple-500',  dot: 'bg-purple-500',  label: 'Violet' },
  'fuchsia':  { fond: 'bg-fuchsia-100', bordureLeft: 'border-l-fuchsia-500', bordureRight: 'border-r-fuchsia-500', dot: 'bg-fuchsia-500', label: 'Fuchsia' },
  'pink':     { fond: 'bg-pink-100',    bordureLeft: 'border-l-pink-500',    bordureRight: 'border-r-pink-500',    dot: 'bg-pink-500',    label: 'Rose vif' },
  'rose':     { fond: 'bg-rose-100',    bordureLeft: 'border-l-rose-500',    bordureRight: 'border-r-rose-500',    dot: 'bg-rose-500',    label: 'Rose' },
  'slate':    { fond: 'bg-slate-200',   bordureLeft: 'border-l-slate-500',   bordureRight: 'border-r-slate-500',   dot: 'bg-slate-500',   label: 'Ardoise' },
  'gray':     { fond: 'bg-gray-100',    bordureLeft: 'border-l-gray-400',    bordureRight: 'border-r-gray-400',    dot: 'bg-gray-400',    label: 'Gris' },
};

// Ordre d'affichage de la palette (du chaud au froid, neutres en fin).
export const VISUAL_ALERT_COLOR_KEYS: VisualAlertColorKey[] = [
  'red', 'red-dark', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald',
  'teal', 'cyan', 'sky', 'blue', 'indigo', 'purple', 'fuchsia', 'pink', 'rose',
  'slate', 'gray',
];

// Regroupement logique des déclencheurs : à l'affichage d'une carte, on ne
// retient qu'UNE seule règle (la plus prioritaire) par groupe, pour éviter la
// superposition de plusieurs paliers décrivant le même objet.
//   - groupe « op »  : OP dépassée / OP très proche / OP dans la semaine se
//     succèdent sur la même date d'OP — un seul palier doit colorer la carte.
//   - groupe « jld » : « JLD en attente » recoupe « Prolongation en attente »
//     ET « Autorisation JLD en attente » (même décision JLD attendue).
export const VISUAL_ALERT_TRIGGER_GROUP: Partial<Record<VisualAlertTrigger, string>> = {
  op_active: 'op',
  op_proche: 'op',
  prolongation_pending: 'jld',
  autorisation_pending: 'jld',
  jld_pending: 'jld',
};

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