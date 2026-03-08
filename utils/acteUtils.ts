import { GeolocData, EcouteData, AutreActe, ActeStatus } from '@/types/interfaces';
import { DateUtils } from './dateUtils';

export function getStatutBadgeProps(statut: ActeStatus): { label: string; className: string } {
  switch (statut) {
    case 'autorisation_pending': return { label: 'Autorisation en attente', className: 'bg-purple-100 text-purple-700 border-purple-200' };
    case 'pose_pending':         return { label: 'Pose en attente',         className: 'bg-yellow-100 text-yellow-700 border-yellow-200' };
    case 'en_cours':             return { label: 'En cours',                className: 'bg-green-100 text-green-700 border-green-200' };
    case 'prolongation_pending': return { label: 'Prolongation à valider',  className: 'bg-orange-100 text-orange-700 border-orange-200' };
    case 'a_renouveler':         return { label: 'À renouveler',            className: 'bg-amber-100 text-amber-700 border-amber-200' };
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
  calculateProlongation: (
  acte: Acte,
  prolongationDate: string,
  prolongationDuration: string,
  prolongationDureeUnit?: 'jours' | 'mois'
): ProlongationResult => {
  try {
    const acteDureeUnit = acte.dureeUnit || 'jours';
    // Unité de la prolongation : celle passée explicitement, sinon celle de l'acte
    const pUnit = prolongationDureeUnit || acteDureeUnit;

    // Calculer la date de fin initiale basée sur la date de pose
    const initialEndDate = endDateForActe(acte.datePose || acte.dateDebut, acte.duree, acteDureeUnit);

    // Vérifier si la date d'autorisation est postérieure à la date de fin initiale
    let warning;
    if (DateUtils.isAfter(prolongationDate, initialEndDate)) {
      warning = "Attention : la date d'autorisation est postérieure à la date de fin initiale de l'acte";
    }

    // Calculer la nouvelle date de fin à partir de la date de fin initiale
    const newEndDate = DateUtils.calculateEndDateWithUnit(initialEndDate, prolongationDuration, pUnit);

    // Durée totale : addition des valeurs (meaningful si même unité)
    const totalDuration = (parseInt(acte.duree) + parseInt(prolongationDuration)).toString();

    return {
      dateFin: newEndDate,
      duree: totalDuration,
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