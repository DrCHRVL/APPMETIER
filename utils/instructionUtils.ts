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
import { getCasDPById, SEUIL_MOTIVATION_RENFORCEE_MOIS } from '@/config/dpRegimes';

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

// ──────────────────────────────────────────────
// HELPERS LIÉS AU CAS LÉGAL DE DP
// ──────────────────────────────────────────────

/**
 * Pour un MEX détenu, calcule combien de mois de DP ont été cumulés.
 * (somme des dureeMois des périodes triées chronologiquement)
 */
export const getDureeCumuleeDPMois = (mex: MisEnExamen): number => {
  if (mex.mesureSurete.type !== 'detenu') return 0;
  return mex.mesureSurete.periodes.reduce((sum, p) => sum + (p.dureeMois || 0), 0);
};

/**
 * Mois restants avant d'atteindre la durée maximale légale (selon le cas DP).
 * Renvoie null si pas de cas légal défini ou MEX non détenu.
 * Renvoie une valeur négative si on a déjà dépassé.
 */
export const getMoisRestantsAvantMaxLegal = (mex: MisEnExamen): number | null => {
  if (mex.mesureSurete.type !== 'detenu') return null;
  const cas = getCasDPById(mex.mesureSurete.casDPId);
  if (!cas) return null;
  return cas.dureeMaxMois - getDureeCumuleeDPMois(mex);
};

/**
 * Indique si une nouvelle prolongation (de tranche standard) est encore
 * possible dans la durée légale. Pour un cas sans prolongation possible
 * (ex: délit ≥3 ans ≤5 ans), renvoie false.
 */
export const peutEtreProlonge = (mex: MisEnExamen): boolean => {
  if (mex.mesureSurete.type !== 'detenu') return false;
  const cas = getCasDPById(mex.mesureSurete.casDPId);
  if (!cas || cas.trancheProlongationMois === 0) return false;
  const cumule = getDureeCumuleeDPMois(mex);
  return cumule + cas.trancheProlongationMois <= cas.dureeMaxMois;
};

/**
 * Indique si la prolongation exceptionnelle CHINS peut être sollicitée.
 * (le cas légal le permet ET on a atteint la durée max ET le quota n'est
 * pas épuisé)
 */
export const peutDemanderProlongationExceptionnelle = (mex: MisEnExamen): boolean => {
  if (mex.mesureSurete.type !== 'detenu') return false;
  const cas = getCasDPById(mex.mesureSurete.casDPId);
  if (!cas?.prolongationExceptionnelleCHINS || !cas.prolongationExceptionnelle) return false;
  const cumule = getDureeCumuleeDPMois(mex);
  if (cumule < cas.dureeMaxMois) return false;
  const dejaAccordees = mex.mesureSurete.nbProlongationsExceptionnelles || 0;
  return dejaAccordees < cas.prolongationExceptionnelle.nbMax;
};

/**
 * Indique si la motivation renforcée est requise (correctionnel, > 8 mois cumulés).
 * Référence : art 137-3 + dépêche 23 décembre 2021.
 */
export const motivationRenforceeRequise = (mex: MisEnExamen): boolean => {
  if (mex.mesureSurete.type !== 'detenu') return false;
  const cas = getCasDPById(mex.mesureSurete.casDPId);
  if (!cas || cas.regime !== 'correctionnel') return false;
  return getDureeCumuleeDPMois(mex) >= SEUIL_MOTIVATION_RENFORCEE_MOIS;
};

// ──────────────────────────────────────────────
// RYTHME DU JUGE (mesure d'activité du dossier)
// ──────────────────────────────────────────────

/**
 * Calcule le « rythme du juge » : intervalle moyen en jours entre deux
 * événements significatifs (OP du JI, débats JLD, vérifications, notes).
 * Renvoie null si moins de 2 événements pour calculer une moyenne.
 */
export const getRythmeJugeJours = (dossier: DossierInstruction): number | null => {
  const dates: number[] = [];

  for (const op of dossier.ops) dates.push(new Date(op.date).getTime());
  for (const debat of dossier.debatsJLD) dates.push(new Date(debat.date).getTime());
  for (const v of dossier.verifications) dates.push(new Date(v.date).getTime());
  for (const n of dossier.notesPerso) dates.push(new Date(n.date).getTime());
  for (const mex of dossier.misEnExamen) {
    if (mex.mesureSurete.type === 'detenu') {
      for (const p of mex.mesureSurete.periodes) dates.push(new Date(p.dateDebut).getTime());
    }
  }
  if (dates.length < 2) return null;

  dates.sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    intervals.push((dates[i] - dates[i - 1]) / 86400000);
  }
  const sum = intervals.reduce((a, b) => a + b, 0);
  return Math.round(sum / intervals.length);
};

/**
 * Qualification visuelle du rythme :
 * - <14 jours : actif
 * - 14-45 jours : normal
 * - 46-90 jours : lent
 * - >90 jours : très lent (à pousser)
 */
export const qualifyRythme = (
  joursMoyens: number | null,
): { label: string; tone: 'green' | 'blue' | 'amber' | 'red' | 'gray' } => {
  if (joursMoyens === null) return { label: '—', tone: 'gray' };
  if (joursMoyens < 14)  return { label: 'Actif',     tone: 'green' };
  if (joursMoyens <= 45) return { label: 'Normal',    tone: 'blue' };
  if (joursMoyens <= 90) return { label: 'Lent',      tone: 'amber' };
  return { label: 'Très lent', tone: 'red' };
};
