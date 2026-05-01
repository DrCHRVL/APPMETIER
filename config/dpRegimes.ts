// config/dpRegimes.ts
//
// Cas de détention provisoire (référentiel légal).
// Source : art 145-1, 145-1-1, 145-2, 706-24-3 CPP.
//
// Pour chaque cas : durée initiale, durée maximale, tranche de prolongation,
// existence d'une prolongation exceptionnelle CHINS (art 145-2 al 3 / 145-1
// al 3 / 706-24-3 al 3 — exclue pour 145-1-1 §1).
//
// La pédagogie complète (motifs art 144, motivation renforcée au-delà de
// 8 mois en correctionnelle, etc.) sera affichée dans la fiche
// « vérification légale » de PR4.

import type { RegimeDetentionProvisoire } from '@/types/instructionTypes';

export interface CasDP {
  /** Identifiant stable */
  id: string;
  /** Régime applicable */
  regime: RegimeDetentionProvisoire;
  /** Libellé court (utilisé dans le sélecteur) */
  label: string;
  /** Description plus complète */
  description?: string;
  /** Durée initiale en mois */
  dureeInitialeMois: number;
  /** Durée maximale en mois (toutes prolongations comprises, hors exceptionnelle CHINS) */
  dureeMaxMois: number;
  /** Tranche de prolongation en mois (0 si aucune prolongation possible) */
  trancheProlongationMois: number;
  /** Article CPP de référence */
  article: string;
  /** Prolongation exceptionnelle CHINS possible (art 145-2 al 3 / 145-1 al 3 / 706-24-3 al 3) */
  prolongationExceptionnelleCHINS?: boolean;
  /** Détail de la prolongation exceptionnelle (durée et nb max) */
  prolongationExceptionnelle?: {
    /** Durée en mois (4 mois par défaut) */
    dureeMois: number;
    /** Nombre maximal d'occurrences */
    nbMax: number;
  };
}

// ──────────────────────────────────────────────
// CAS DP CRIMINELLE (art 145-2)
// ──────────────────────────────────────────────

export const CAS_DP_CRIMINELS: CasDP[] = [
  {
    id: 'crim-peine-inf-20',
    regime: 'criminel',
    label: 'Crime puni d\'une peine < 20 ans',
    dureeInitialeMois: 12,
    dureeMaxMois: 24,
    trancheProlongationMois: 6,
    article: 'art 145-2 al 1 et 2',
  },
  {
    id: 'crim-peine-sup-20',
    regime: 'criminel',
    label: 'Crime puni d\'une peine ≥ 20 ans',
    dureeInitialeMois: 12,
    dureeMaxMois: 36,
    trancheProlongationMois: 6,
    article: 'art 145-2 al 1 et 2',
    prolongationExceptionnelleCHINS: true,
    prolongationExceptionnelle: { dureeMois: 4, nbMax: 2 },
  },
  {
    id: 'crim-peine-inf-20-extra',
    regime: 'criminel',
    label: 'Crime puni d\'une peine < 20 ans, faits hors territoire national',
    dureeInitialeMois: 12,
    dureeMaxMois: 36,
    trancheProlongationMois: 6,
    article: 'art 145-2 al 1 et 2',
    prolongationExceptionnelleCHINS: true,
    prolongationExceptionnelle: { dureeMois: 4, nbMax: 2 },
  },
  {
    id: 'crim-peine-sup-20-extra',
    regime: 'criminel',
    label: 'Crime puni d\'une peine ≥ 20 ans, faits hors territoire national',
    dureeInitialeMois: 12,
    dureeMaxMois: 48,
    trancheProlongationMois: 6,
    article: 'art 145-2 al 1 et 2',
    prolongationExceptionnelleCHINS: true,
    prolongationExceptionnelle: { dureeMois: 4, nbMax: 2 },
  },
  {
    id: 'crim-pluriel-ou-stup-terro',
    regime: 'criminel',
    label: 'Crimes multiples livres II/IV CP, OU stupéfiants/terrorisme/proxénétisme/extorsion/BO',
    description:
      'Plusieurs crimes mentionnés aux livres II (atteintes aux personnes) et IV (nation, État, paix publique) du CP, OU crimes de trafic de stupéfiants, terrorisme, proxénétisme, extorsion de fonds, ou crime commis en bande organisée.',
    dureeInitialeMois: 12,
    dureeMaxMois: 48,
    trancheProlongationMois: 6,
    article: 'art 145-2 al 1 et 2',
    prolongationExceptionnelleCHINS: true,
    prolongationExceptionnelle: { dureeMois: 4, nbMax: 2 },
  },
];

// ──────────────────────────────────────────────
// CAS DP DÉLICTUELLE (art 145-1, 145-1-1, 706-24-3)
// ──────────────────────────────────────────────

export const CAS_DP_DELICTUELS: CasDP[] = [
  {
    id: 'del-3-5-ans',
    regime: 'correctionnel',
    label: 'Délit puni d\'une peine ≥ 3 ans et ≤ 5 ans',
    dureeInitialeMois: 4,
    dureeMaxMois: 4,
    trancheProlongationMois: 0,
    article: 'art 145-1 al 1',
  },
  {
    id: 'del-3-ans-recidive',
    regime: 'correctionnel',
    label: 'Délit ≥ 3 ans + MEX déjà condamné (peine criminelle ou emprisonnement ferme > 1 an)',
    dureeInitialeMois: 4,
    dureeMaxMois: 12,
    trancheProlongationMois: 4,
    article: 'art 145-1 al 2',
  },
  {
    id: 'del-sup-5-ans',
    regime: 'correctionnel',
    label: 'Délit puni d\'une peine > 5 ans',
    dureeInitialeMois: 4,
    dureeMaxMois: 12,
    trancheProlongationMois: 4,
    article: 'art 145-1 al 2',
  },
  {
    id: 'del-extra',
    regime: 'correctionnel',
    label: 'Délit, un des faits commis hors du territoire national',
    dureeInitialeMois: 4,
    dureeMaxMois: 24,
    trancheProlongationMois: 4,
    article: 'art 145-1 al 2',
    prolongationExceptionnelleCHINS: true,
    prolongationExceptionnelle: { dureeMois: 4, nbMax: 1 },
  },
  {
    id: 'del-stup-am-bo',
    regime: 'correctionnel',
    label: 'Stupéfiants, association de malfaiteurs, proxénétisme, extorsion, BO (peine = 10 ans)',
    description:
      'Trafic de stupéfiants, association de malfaiteurs, proxénétisme, extorsion de fonds ou infraction commise en bande organisée punie d\'une peine égale à 10 ans d\'emprisonnement.',
    dureeInitialeMois: 6,
    dureeMaxMois: 24,
    trancheProlongationMois: 6,
    article: 'art 145-1-1',
    // Prolongation exceptionnelle exclue (§1 dépêche du 14 juin 2025)
    prolongationExceptionnelleCHINS: false,
  },
  {
    id: 'del-terro',
    regime: 'correctionnel',
    label: 'Délit terroriste',
    dureeInitialeMois: 6,
    dureeMaxMois: 24,
    trancheProlongationMois: 6,
    article: 'art 706-24-3',
    prolongationExceptionnelleCHINS: true,
    prolongationExceptionnelle: { dureeMois: 4, nbMax: 1 },
  },
  {
    id: 'del-am-terro',
    regime: 'correctionnel',
    label: 'Association de malfaiteurs terroriste',
    dureeInitialeMois: 6,
    dureeMaxMois: 36,
    trancheProlongationMois: 6,
    article: 'art 706-24-3',
    prolongationExceptionnelleCHINS: true,
    prolongationExceptionnelle: { dureeMois: 4, nbMax: 1 },
  },
];

// ──────────────────────────────────────────────
// EXPORT GROUPÉ
// ──────────────────────────────────────────────

export const ALL_CAS_DP: CasDP[] = [...CAS_DP_CRIMINELS, ...CAS_DP_DELICTUELS];

export const getCasDPById = (id: string | undefined): CasDP | undefined =>
  id ? ALL_CAS_DP.find(c => c.id === id) : undefined;

// ──────────────────────────────────────────────
// SEUILS PÉDAGOGIQUES
// ──────────────────────────────────────────────

/** En correctionnelle, motivation renforcée requise au-delà de 8 mois (art 137-3) */
export const SEUIL_MOTIVATION_RENFORCEE_MOIS = 8;

/** Délai standard pour rédiger les réquisitions DML (10 jours, art 148) */
export const DELAI_DML_JOURS = 10;
