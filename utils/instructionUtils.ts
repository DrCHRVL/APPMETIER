// utils/instructionUtils.ts
//
// Helpers de calcul pour les dossiers d'instruction (DML, DP, échéances).

import type {
  DossierInstruction,
  MisEnExamen,
  MesureSurete,
  PeriodeDetentionProvisoire,
  RegimeDetentionProvisoire,
  DemandeMiseEnLiberte,
} from '@/types/instructionTypes';

// ──────────────────────────────────────────────
// DML
// ──────────────────────────────────────────────

/**
 * Calcule la date d'échéance d'une DML (10 jours ouvrables après le dépôt).
 * Conforme à la loi : on saute samedis et dimanches.
 */
export const calculateDMLEcheance = (dateDepot: string): string => {
  const date = new Date(dateDepot);
  let count = 0;
  while (count < 10) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return date.toISOString().split('T')[0];
};

// ──────────────────────────────────────────────
// DÉTENTION PROVISOIRE
// ──────────────────────────────────────────────

/** Date de fin théorique d'une période de DP (dateDebut + dureeMois) */
export const calculatePeriodeDPEnd = (
  dateDebut: string,
  dureeMois: number,
): string => {
  const date = new Date(dateDebut);
  date.setMonth(date.getMonth() + dureeMois);
  return date.toISOString().split('T')[0];
};

/** Récupère la dernière période de DP d'un MEX détenu (la plus récente non clôturée) */
export const getPeriodeDPCourante = (
  mex: MisEnExamen,
): PeriodeDetentionProvisoire | undefined => {
  if (mex.mesureSurete.type !== 'detenu') return undefined;
  const periodes = mex.mesureSurete.periodes;
  if (periodes.length === 0) return undefined;
  return [...periodes].sort(
    (a, b) => new Date(b.dateDebut).getTime() - new Date(a.dateDebut).getTime(),
  )[0];
};

/** Date de fin courante de la DP (= fin de la dernière période) */
export const getDateFinDPCourante = (mex: MisEnExamen): string | undefined =>
  getPeriodeDPCourante(mex)?.dateFin;

/** Nombre de jours restants avant la fin de DP (négatif si dépassé) */
export const getJoursRestantsAvantFinDP = (mex: MisEnExamen): number | null => {
  const dateFin = getDateFinDPCourante(mex);
  if (!dateFin) return null;
  const fin = new Date(dateFin);
  fin.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((fin.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

// ──────────────────────────────────────────────
// COMPTEURS DOSSIER
// ──────────────────────────────────────────────

/** Compte les MEX par statut */
export const countMexByStatut = (
  dossier: DossierInstruction,
): Record<MesureSurete['type'], number> => {
  const init: Record<MesureSurete['type'], number> = {
    libre: 0,
    cj: 0,
    arse: 0,
    detenu: 0,
  };
  for (const mex of dossier.misEnExamen) {
    init[mex.mesureSurete.type] += 1;
  }
  return init;
};

/** Total des DML déposées sur le dossier (toutes MEX confondues) */
export const countTotalDMLs = (dossier: DossierInstruction): number =>
  dossier.misEnExamen.reduce((sum, m) => sum + (m.dmls?.length || 0), 0);

/** Total des DML en attente sur le dossier */
export const countDMLsEnAttente = (dossier: DossierInstruction): number =>
  dossier.misEnExamen.reduce(
    (sum, m) =>
      sum + (m.dmls?.filter(d => d.statut === 'en_attente').length || 0),
    0,
  );

/** Âge du dossier en jours (depuis la date d'ouverture) */
export const getDossierAgeJours = (dossier: DossierInstruction): number => {
  const ouverture = new Date(dossier.dateOuverture || dossier.dateCreation);
  ouverture.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor(
    (today.getTime() - ouverture.getTime()) / (1000 * 60 * 60 * 24),
  );
};

/** Âge du dossier formaté (en mois ou années) */
export const formatDossierAge = (jours: number): string => {
  if (jours < 30) return `${jours} j`;
  if (jours < 365) return `${Math.floor(jours / 30)} mois`;
  const annees = Math.floor(jours / 365);
  const moisRestants = Math.floor((jours % 365) / 30);
  return moisRestants > 0 ? `${annees} an${annees > 1 ? 's' : ''} ${moisRestants} mois` : `${annees} an${annees > 1 ? 's' : ''}`;
};

// ──────────────────────────────────────────────
// DML EN RETARD
// ──────────────────────────────────────────────

/** Récupère toutes les DML en retard sur le dossier */
export const getDMLsEnRetard = (
  dossier: DossierInstruction,
): { mex: MisEnExamen; dml: DemandeMiseEnLiberte; joursRetard: number }[] => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const result: { mex: MisEnExamen; dml: DemandeMiseEnLiberte; joursRetard: number }[] = [];
  for (const mex of dossier.misEnExamen) {
    for (const dml of mex.dmls || []) {
      if (dml.statut !== 'en_attente') continue;
      const echeance = new Date(dml.dateEcheance);
      echeance.setHours(0, 0, 0, 0);
      if (echeance < today) {
        const joursRetard = Math.ceil(
          (today.getTime() - echeance.getTime()) / (1000 * 60 * 60 * 24),
        );
        result.push({ mex, dml, joursRetard });
      }
    }
  }
  return result;
};

// ──────────────────────────────────────────────
// CRÉATION D'UNE PÉRIODE DP (helper d'initialisation)
// ──────────────────────────────────────────────

export const buildPeriodeDP = (
  dateDebut: string,
  dureeMois: number,
  regime: RegimeDetentionProvisoire,
  type: 'placement' | 'prolongation',
): PeriodeDetentionProvisoire => ({
  id: Date.now() + Math.floor(Math.random() * 1000),
  dateDebut,
  dureeMois,
  dateFin: calculatePeriodeDPEnd(dateDebut, dureeMois),
  regime,
  type,
});
