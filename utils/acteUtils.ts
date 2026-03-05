import { GeolocData, EcouteData, AutreActe } from '@/types/interfaces';
import { DateUtils } from './dateUtils';

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
  prolongationDuration: string
): ProlongationResult => {
  try {
    console.log("1. Entrée calculateProlongation:", {
      acteDebut: acte.dateDebut,
      actePose: acte.datePose,
      acteDuree: acte.duree,
      prolongationDate,
      prolongationDuration
    });

    // Calculer la date de fin initiale basée sur la date de pose
    const initialEndDate = DateUtils.calculateActeEndDate(acte.datePose, acte.duree);
    console.log("2. Date de fin initiale:", initialEndDate);

    // Vérifier si la date d'autorisation est postérieure à la date de fin initiale
    let warning;
    if (DateUtils.isAfter(prolongationDate, initialEndDate)) {
      warning = "Attention : la date d'autorisation est postérieure à la date de fin initiale de l'acte";
      console.log("3. Warning détecté:", warning);
    }

    // Calculer la nouvelle date de fin à partir de la date de fin initiale
    const newEndDate = DateUtils.addDays(initialEndDate, parseInt(prolongationDuration));
    console.log("4. Nouvelle date de fin:", newEndDate);

    const totalDuration = (parseInt(acte.duree) + parseInt(prolongationDuration)).toString();
    console.log("5. Durée totale:", totalDuration);

    const result: ProlongationResult = {
      dateFin: newEndDate,
      duree: totalDuration,
      statut: 'en_cours',
      warning,
      prolongationData: undefined
    };

    console.log("6. Résultat final:", result);
    return result;

  } catch (error) {
    console.error('7. Erreur dans calculateProlongation:', error);
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

      if (!DateUtils.validateDateRange(acte.dateDebut, poseDate)) {
        throw new Error('Pose date must be after start date');
      }

      const newEndDate = DateUtils.calculateActeEndDate(poseDate, acte.duree);
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
        dateFin = DateUtils.calculateActeEndDate(acte.datePose, acte.duree);
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