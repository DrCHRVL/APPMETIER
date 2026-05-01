// config/instructionConfig.ts
//
// Configuration par défaut du module Instruction (cabinets, palettes, libellés).

import type { Cabinet, EtatReglement, OrientationPrevisible } from '@/types/instructionTypes';

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
