import { GeolocData, EcouteData, AutreActe, ActeStatus } from '@/types/interfaces';
import { DateUtils } from './dateUtils';
import { ElectronBridge } from './electronBridge';

const DELETED_ACTE_IDS_KEY = 'deleted_acte_ids';

/**
 * Mémorise l'ID d'un acte/écoute/géoloc supprimé pour empêcher la resynchronisation.
 * Même pattern que deleted_enquete_ids.
 */
export async function trackDeletedActeId(id: number): Promise<void> {
  try {
    const existing = await ElectronBridge.getData<Array<{ id: number; deletedAt: string }>>(
      DELETED_ACTE_IDS_KEY,
      []
    );
    const normalized = (Array.isArray(existing) ? existing : []).filter(e => e.id !== id);
    await ElectronBridge.setData(DELETED_ACTE_IDS_KEY, [
      ...normalized,
      { id, deletedAt: new Date().toISOString() }
    ]);
  } catch (error) {
    console.error('❌ Erreur mémorisation ID acte supprimé:', error);
  }
}

export function getStatutBadgeProps(statut: ActeStatus): { label: string; className: string } {
  switch (statut) {
    case 'autorisation_pending': return { label: 'Autorisation en attente', className: 'bg-purple-100 text-purple-700 border-purple-200' };
    case 'pose_pending':         return { label: 'Pose en attente',         className: 'bg-yellow-100 text-yellow-700 border-yellow-200' };
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
  statut: string;
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

  createActe: (
    acte: Omit<Acte, 'id' | 'statut'>,
    withPose: boolean
  ): Acte => {
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
      } as Acte;
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