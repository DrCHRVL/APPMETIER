// config/instructionConfig.ts
//
// Configuration par défaut du module Instruction (cabinets, palettes, libellés).

import type {
  Cabinet,
  EtatReglement,
  OrientationPrevisible,
  InstructionAlertRule,
  InstructionAlertTrigger,
} from '@/types/instructionTypes';

// ──────────────────────────────────────────────
// CABINETS PAR DÉFAUT (4 cabinets, configurables ensuite via l'admin)
// ──────────────────────────────────────────────

export const DEFAULT_CABINETS: Cabinet[] = [
  { id: 'cab-1', label: 'Cabinet 1', color: '#ec4899', order: 1, enabled: true }, // rose
  { id: 'cab-2', label: 'Cabinet 2', color: '#f59e0b', order: 2, enabled: true }, // ambre
  { id: 'cab-3', label: 'Cabinet 3', color: '#16a34a', order: 3, enabled: true }, // vert
  { id: 'cab-4', label: 'Cabinet 4', color: '#3b82f6', order: 4, enabled: true }, // bleu
];

// ──────────────────────────────────────────────
// PALETTE DE COULEURS POUR L'AJOUT D'UN CABINET
// ──────────────────────────────────────────────

export const CABINET_COLOR_PALETTE: string[] = [
  '#ec4899', '#f59e0b', '#16a34a', '#3b82f6', // les 4 par défaut
  '#9333ea', '#dc2626', '#0891b2', '#ca8a04',
  '#be185d', '#ea580c', '#14b8a6', '#6366f1',
];

// ──────────────────────────────────────────────
// LIBELLÉS
// ──────────────────────────────────────────────

export const ETAT_REGLEMENT_LABELS: Record<EtatReglement, string> = {
  'en_cours':         'Information en cours',
  '175_recu':         '175 reçu',
  'reqdef_redigees':  'Réquisitions définitives',
  'ordonnance_rendue': 'Ordonnance rendue',
};

export const ETAT_REGLEMENT_BADGE_COLORS: Record<EtatReglement, string> = {
  'en_cours':         'bg-gray-100 text-gray-700 border-gray-200',
  '175_recu':         'bg-yellow-100 text-yellow-800 border-yellow-200',
  'reqdef_redigees':  'bg-blue-100 text-blue-800 border-blue-200',
  'ordonnance_rendue':'bg-green-100 text-green-800 border-green-200',
};

export const ORIENTATION_LABELS: Record<OrientationPrevisible, string> = {
  'TC':       'Tribunal correctionnel',
  'CCD':      'CCD',
  'Assises':  'Assises',
  'TPE':      'TPE',
  'CAM':      'CAM',
  'non_lieu': 'Non-lieu',
  'incertain':'Incertain',
};

// ──────────────────────────────────────────────
// FALLBACK COULEUR (cabinet introuvable)
// ──────────────────────────────────────────────

export const FALLBACK_CABINET_COLOR = '#6b7280'; // gris

// ──────────────────────────────────────────────
// RÈGLES D'ALERTES INSTRUCTION PAR DÉFAUT
// ──────────────────────────────────────────────

export const INSTRUCTION_TRIGGER_LABELS: Record<InstructionAlertTrigger, string> = {
  dp_fin_proche:           'Fin de période DP imminente',
  dp_fin_echue:            'Période DP échue',
  debat_jld_proche:        'Débat JLD imminent',
  dml_echeance_proche:     'Échéance DML imminente',
  dml_retard:              'DML en retard',
  op_ji_proche:            'OP du JI imminente',
  dossier_dormant:         'Dossier sans activité',
  verif_periodique_due:    'Vérification périodique due',
  motivation_renforcee_due:'DP correctionnelle > 8 mois (motivation renforcée)',
  dp_max_legal_atteinte:   'Durée légale max DP atteinte',
};

export const INSTRUCTION_TRIGGER_COLORS: Record<InstructionAlertTrigger, string> = {
  dp_fin_proche:            '#dc2626',
  dp_fin_echue:             '#7f1d1d',
  debat_jld_proche:         '#4f46e5',
  dml_echeance_proche:      '#9333ea',
  dml_retard:               '#b91c1c',
  op_ji_proche:             '#2563eb',
  dossier_dormant:          '#6b7280',
  verif_periodique_due:     '#d97706',
  motivation_renforcee_due: '#ea580c',
  dp_max_legal_atteinte:    '#7f1d1d',
};

export const DEFAULT_INSTRUCTION_ALERT_RULES: InstructionAlertRule[] = [
  {
    id: 1,
    trigger: 'dp_fin_proche',
    label: INSTRUCTION_TRIGGER_LABELS.dp_fin_proche,
    seuil: 30,
    enabled: true,
    priority: 1,
    color: INSTRUCTION_TRIGGER_COLORS.dp_fin_proche,
    isSystemRule: true,
  },
  {
    id: 2,
    trigger: 'dp_fin_echue',
    label: INSTRUCTION_TRIGGER_LABELS.dp_fin_echue,
    seuil: 0,
    enabled: true,
    priority: 1,
    color: INSTRUCTION_TRIGGER_COLORS.dp_fin_echue,
    isSystemRule: true,
  },
  {
    id: 3,
    trigger: 'debat_jld_proche',
    label: INSTRUCTION_TRIGGER_LABELS.debat_jld_proche,
    seuil: 14,
    enabled: true,
    priority: 2,
    color: INSTRUCTION_TRIGGER_COLORS.debat_jld_proche,
    isSystemRule: true,
  },
  {
    id: 4,
    trigger: 'dml_echeance_proche',
    label: INSTRUCTION_TRIGGER_LABELS.dml_echeance_proche,
    seuil: 3,
    enabled: true,
    priority: 1,
    color: INSTRUCTION_TRIGGER_COLORS.dml_echeance_proche,
    isSystemRule: true,
  },
  {
    id: 5,
    trigger: 'dml_retard',
    label: INSTRUCTION_TRIGGER_LABELS.dml_retard,
    seuil: 0,
    enabled: true,
    priority: 1,
    color: INSTRUCTION_TRIGGER_COLORS.dml_retard,
    isSystemRule: true,
  },
  {
    id: 6,
    trigger: 'op_ji_proche',
    label: INSTRUCTION_TRIGGER_LABELS.op_ji_proche,
    seuil: 7,
    enabled: true,
    priority: 3,
    color: INSTRUCTION_TRIGGER_COLORS.op_ji_proche,
    isSystemRule: true,
  },
  {
    id: 7,
    trigger: 'dossier_dormant',
    label: INSTRUCTION_TRIGGER_LABELS.dossier_dormant,
    seuil: 60,
    enabled: true,
    priority: 4,
    color: INSTRUCTION_TRIGGER_COLORS.dossier_dormant,
    isSystemRule: true,
  },
  {
    id: 8,
    trigger: 'verif_periodique_due',
    label: INSTRUCTION_TRIGGER_LABELS.verif_periodique_due,
    seuil: 30,
    enabled: true,
    priority: 4,
    color: INSTRUCTION_TRIGGER_COLORS.verif_periodique_due,
    isSystemRule: true,
  },
  {
    id: 9,
    trigger: 'motivation_renforcee_due',
    label: INSTRUCTION_TRIGGER_LABELS.motivation_renforcee_due,
    seuil: 0,
    enabled: true,
    priority: 2,
    color: INSTRUCTION_TRIGGER_COLORS.motivation_renforcee_due,
    isSystemRule: true,
  },
  {
    id: 10,
    trigger: 'dp_max_legal_atteinte',
    label: INSTRUCTION_TRIGGER_LABELS.dp_max_legal_atteinte,
    seuil: 0,
    enabled: true,
    priority: 1,
    color: INSTRUCTION_TRIGGER_COLORS.dp_max_legal_atteinte,
    isSystemRule: true,
  },
];
