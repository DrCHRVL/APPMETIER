import { GeolocData, EcouteData, AutreActe, ActeStatus, Enquete, ModificationEntry } from '@/types/interfaces';
import { DateUtils } from './dateUtils';
import { ElectronBridge } from './electronBridge';
import { deletedIdsSyncService } from './dataSync/DeletedIdsSyncService';

const DELETED_ENQUETE_IDS_KEY = 'deleted_ids';
const DELETED_ACTE_IDS_KEY    = 'deleted_acte_ids';
const DELETED_CR_IDS_KEY      = 'deleted_cr_ids';
const DELETED_MEC_IDS_KEY     = 'deleted_mec_ids';

async function appendTombstone(key: string, id: number): Promise<void> {
  const existing = await ElectronBridge.getData<Array<{ id: number; deletedAt: string }>>(key, []);
  const normalized = (Array.isArray(existing) ? existing : []).filter(e => e.id !== id);
  await ElectronBridge.setData(key, [...normalized, { id, deletedAt: new Date().toISOString() }]);
}

/** Mémorise l'ID d'une enquête supprimée pour empêcher sa résurrection via sync. */
export async function trackDeletedEnqueteId(id: number): Promise<void> {
  try {
    await appendTombstone(DELETED_ENQUETE_IDS_KEY, id);
    deletedIdsSyncService.schedulePush();
  } catch (error) {
    console.error('❌ Erreur mémorisation ID enquête supprimée:', error);
  }
}

/** Mémorise l'ID d'un acte/écoute/géoloc supprimé pour empêcher la resynchronisation. */
export async function trackDeletedActeId(id: number): Promise<void> {
  try {
    await appendTombstone(DELETED_ACTE_IDS_KEY, id);
    deletedIdsSyncService.schedulePush();
  } catch (error) {
    console.error('❌ Erreur mémorisation ID acte supprimé:', error);
  }
}

/** Mémorise l'ID d'un compte rendu supprimé pour empêcher la resynchronisation. */
export async function trackDeletedCRId(id: number): Promise<void> {
  try {
    await appendTombstone(DELETED_CR_IDS_KEY, id);
    deletedIdsSyncService.schedulePush();
  } catch (error) {
    console.error('❌ Erreur mémorisation ID CR supprimé:', error);
  }
}

/** Mémorise l'ID d'un mis en cause supprimé pour empêcher la resynchronisation. */
export async function trackDeletedMECId(id: number): Promise<void> {
  try {
    await appendTombstone(DELETED_MEC_IDS_KEY, id);
    deletedIdsSyncService.schedulePush();
  } catch (error) {
    console.error('❌ Erreur mémorisation ID MEC supprimé:', error);
  }
}

/**
 * Normalise le statut des actes/écoutes/géolocs d'une enquête : un acte « en
 * cours » dont la `dateFin` est dépassée est en réalité terminé. Comme le statut
 * n'est jamais repassé automatiquement à « terminé » lors de la pose/prolongation,
 * on le corrige au chargement pour que la donnée persistée reflète l'état réel
 * (et non plus seulement l'affichage qui recalculait l'expiration à la volée).
 *
 * On ne touche QUE les actes posés et en cours (`en_cours`) : les statuts en
 * attente (autorisation/pose/prolongation) ne sont pas affectés, car un acte non
 * encore posé n'a pas de fin effective.
 *
 * @returns l'enquête (nouvelle référence si modifiée) et un flag `changed`.
 */
export function normalizeExpiredActeStatuses(
  enquete: Enquete,
  now: Date = new Date()
): { enquete: Enquete; changed: boolean } {
  let changed = false;

  const fixList = <T extends { statut: ActeStatus; dateFin?: string }>(list?: T[]): T[] | undefined => {
    if (!list || list.length === 0) return list;
    let listChanged = false;
    const next = list.map(a => {
      if (a.statut === 'en_cours' && a.dateFin && new Date(a.dateFin) < now) {
        listChanged = true;
        return { ...a, statut: 'termine' as ActeStatus };
      }
      return a;
    });
    if (!listChanged) return list;
    changed = true;
    return next;
  };

  const actes = fixList(enquete.actes);
  const ecoutes = fixList(enquete.ecoutes);
  const geolocalisations = fixList(enquete.geolocalisations);

  if (!changed) return { enquete, changed: false };
  return {
    enquete: { ...enquete, actes: actes!, ecoutes, geolocalisations },
    changed: true,
  };
}

export function getStatutBadgeProps(statut: ActeStatus): { label: string; className: string } {
  switch (statut) {
    case 'autorisation_pending': return { label: 'Autorisation en attente', className: 'bg-purple-100 text-purple-700 border-purple-200' };
    case 'pose_pending':         return { label: 'Pose en attente',         className: 'bg-yellow-100 text-yellow-700 border-yellow-200' };
    case 'pose_avortee':         return { label: 'Pose avortée',            className: 'bg-rose-100 text-rose-700 border-rose-200' };
    case 'en_cours':             return { label: 'En cours',                className: 'bg-green-100 text-green-700 border-green-200' };
    case 'prolongation_pending': return { label: 'Prolongation à valider',  className: 'bg-orange-100 text-orange-700 border-orange-200' };
    case 'a_renouveler':         return { label: 'À renouveler',            className: 'bg-amber-100 text-amber-700 border-amber-200' };
    case 'refuse':               return { label: 'Refusé JLD',              className: 'bg-red-100 text-red-700 border-red-200' };
    default:                     return { label: 'Terminé',                 className: 'bg-gray-100 text-gray-500 border-gray-200' };
  }
}

// Helper : calcule la date de fin selon l'unité de l'acte (jours ou mois calendaires)
function endDateForActe(startDate: string, duree: string, dureeUnit?: 'jours' | 'mois'): string {
  return DateUtils.calculateEndDateWithUnit(startDate, duree, dureeUnit || 'jours');
}

type PendingProlongationActe = {
  id: number;
  prolongationRequestedAt?: string;
  prolongationDate?: string;
  dateDebut: string;
};

/**
 * Date de référence à partir de laquelle compter l'ancienneté d'une attente JLD
 * pour une prolongation `prolongation_pending`.
 *
 * Priorité :
 *  1. `prolongationRequestedAt` — date de la demande (source fiable, posée à la soumission).
 *  2. Rétro-remplissage : dernière entrée du journal des modifications marquant le
 *     passage de cet acte au statut « prolongation à valider » (pour les actes mis en
 *     attente avant l'introduction de `prolongationRequestedAt`).
 *  3. Repli legacy : `prolongationDate` (date de la dernière prolongation validée) puis
 *     `dateDebut` (début de l'acte) — historiquement à l'origine du calcul erroné.
 */
export function getProlongationRequestDate(
  acte: PendingProlongationActe,
  modifications?: ModificationEntry[]
): string {
  if (acte.prolongationRequestedAt) return acte.prolongationRequestedAt;

  if (modifications && modifications.length > 0) {
    const pendingLabel = getStatutBadgeProps('prolongation_pending').label.toLowerCase();
    const match = modifications
      .filter(m => m.targetId === acte.id && m.label.toLowerCase().includes(pendingLabel))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
    if (match) return match.timestamp;
  }

  return acte.prolongationDate || acte.dateDebut;
}

/**
 * Date de référence à partir de laquelle compter l'ancienneté d'une attente JLD
 * pour une autorisation initiale `autorisation_pending`.
 *
 * Un acte en attente d'autorisation n'a pas encore de `dateDebut` (chaîne vide) :
 * compter dessus produit un `NaN`. On utilise donc :
 *  1. `autorisationRequestedAt` — date de la demande (posée à la création).
 *  2. `dateDebut` s'il est valide (cas limite / données futures).
 *  3. `id` (= Date.now() à la création de l'acte) — équivaut à la date de la demande,
 *     ce qui corrige aussi les actes créés avant l'introduction du champ dédié.
 */
export function getAutorisationRequestDate(
  acte: { id: number; autorisationRequestedAt?: string; dateDebut?: string }
): string {
  if (acte.autorisationRequestedAt) return acte.autorisationRequestedAt;
  if (acte.dateDebut && !isNaN(new Date(acte.dateDebut).getTime())) return acte.dateDebut;
  return new Date(acte.id).toISOString();
}

// Helper : libellé d'une durée pour affichage
export function formatDuree(value: string, unit?: 'jours' | 'mois'): string {
  const n = parseInt(value, 10);
  if (isNaN(n)) return `${value} ${unit === 'mois' ? 'mois' : 'jours'}`;
  if (unit === 'mois') return n === 1 ? '1 mois' : `${n} mois`;
  return n === 1 ? '1 jour' : `${n} jours`;
}

type Acte = GeolocData | EcouteData | AutreActe;

interface ProlongationResult {
  dateFin: string;
  duree: string;
  statut: ActeStatus;
  warning?: string;
  prolongationData?: any;
}

export const ActeUtils = {
  /**
   * Recalcule la dateFin en rejouant la chaîne : datePose + durée initiale (jours) + chaque prolongation (mois/jours).
   * Utilisé par calculateProlongation et handleDeleteProlongation pour éviter le mélange d'unités.
   */
  replayDateFin: (
    datePose: string,
    dureeInitiale: string,
    dureeInitialeUnit: 'jours' | 'mois',
    prolongations: Array<{ dureeAjoutee: string; dureeUnit?: 'jours' | 'mois' }>
  ): string => {
    // Date de fin après la durée initiale
    let dateFin = endDateForActe(datePose, dureeInitiale, dureeInitialeUnit);
    // Ajouter chaque prolongation successivement
    for (const p of prolongations) {
      const pUnit = p.dureeUnit || 'jours';
      dateFin = DateUtils.calculateEndDateWithUnit(dateFin, p.dureeAjoutee, pUnit);
    }
    return dateFin;
  },

  calculateProlongation: (
  acte: Acte,
  prolongationDate: string,
  prolongationDuration: string,
  prolongationDureeUnit?: 'jours' | 'mois',
  updatedHistory?: Array<{ dureeAjoutee: string; dureeUnit?: 'jours' | 'mois' }>
): ProlongationResult => {
  try {
    const acteDureeUnit = acte.dureeUnit || 'jours';
    const pUnit = prolongationDureeUnit || acteDureeUnit;

    // Durée initiale = celle stockée dans le premier historique, ou celle de l'acte
    const dureeInitiale = acte.prolongationsHistory?.[0]?.dureeInitiale || acte.duree;

    // Toujours recalculer dateFin en rejouant la chaîne complète
    // (datePose + durée initiale + toutes les prolongations)
    const dateReference = acte.datePose || acte.dateDebut;
    const newEndDate = ActeUtils.replayDateFin(
      dateReference,
      dureeInitiale,
      acteDureeUnit,
      updatedHistory || [
        ...(acte.prolongationsHistory || []).map(e => ({ dureeAjoutee: e.dureeAjoutee, dureeUnit: e.dureeUnit })),
        { dureeAjoutee: prolongationDuration, dureeUnit: pUnit }
      ]
    );

    // Vérifier si la date d'autorisation est postérieure à la date de fin actuelle
    let warning;
    const currentEndDate = acte.dateFin || endDateForActe(dateReference, dureeInitiale, acteDureeUnit);
    if (DateUtils.isAfter(prolongationDate, currentEndDate)) {
      warning = "Attention : la date d'autorisation est postérieure à la date de fin actuelle de l'acte";
    }

    return {
      dateFin: newEndDate,
      duree: dureeInitiale, // Ne plus accumuler : garder la durée initiale
      statut: 'en_cours',
      warning,
      prolongationData: undefined
    };

  } catch (error) {
    console.error('Erreur dans calculateProlongation:', error);
    throw error;
  }
},

  setPendingProlongation: (
    acte: Acte,
    prolongationDate: string,
    prolongationDuration: string
  ): Partial<Acte> => {
    if (!DateUtils.isValidDate(prolongationDate) || !prolongationDuration) {
      throw new Error('Invalid prolongation parameters');
    }

    return {
      statut: 'prolongation_pending',
      prolongationData: {
        dateDebut: prolongationDate,
        duree: prolongationDuration
      }
    };
  },

  setPose: (
    acte: Acte,
    poseDate: string
  ): Partial<Acte> => {
    try {
      if (!DateUtils.isValidDate(poseDate)) {
        throw new Error('Invalid pose date');
      }

      if (acte.dateDebut && !DateUtils.validateDateRange(acte.dateDebut, poseDate)) {
        throw new Error('Pose date must be after start date');
      }

      const newEndDate = endDateForActe(poseDate, acte.duree, acte.dureeUnit);
      if (!newEndDate) {
        throw new Error('Failed to calculate end date');
      }

      return {
        datePose: poseDate,
        dateFin: newEndDate,
        statut: 'en_cours'
      };
    } catch (error) {
      console.error('Error in setPose:', error);
      throw error;
    }
  },

  createActe: <T extends Omit<Acte, 'id' | 'statut'>>(
    acte: T,
    withPose: boolean
  ): T & { id: number; statut: ActeStatus; dateFin: string } => {
    try {
      if (!acte.dateDebut || !acte.duree) {
        throw new Error('Start date and duration are required');
      }

      let dateFin = '';
      if (withPose && acte.datePose) {
        dateFin = endDateForActe(acte.datePose, acte.duree, acte.dureeUnit);
        if (!dateFin) {
          throw new Error('Failed to calculate end date');
        }
      }

      return {
        ...acte,
        id: Date.now(),
        statut: withPose ? 'en_cours' : 'pose_pending',
        dateFin: dateFin
      } as T & { id: number; statut: ActeStatus; dateFin: string };
    } catch (error) {
      console.error('Error in createActe:', error);
      throw error;
    }
  },

  validateDates: (dateDebut: string, datePose?: string): boolean => {
    if (!DateUtils.isValidDate(dateDebut)) return false;
    if (!datePose) return true;
    return DateUtils.validateDateRange(dateDebut, datePose);
  }
};