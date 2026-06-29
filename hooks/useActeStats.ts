import { useMemo } from 'react';
import { Enquete } from '@/types/interfaces';

// Estimation par durée : repli pour les actes hérités sans historique
// structuré. Plafonnée pour neutraliser une dateFin aberrante (année mal
// saisie, import de document approximatif…) qui, sans garde-fou, est lue comme
// des milliers de renouvellements et fait exploser les totaux du tableau de
// bord (ex. « 24 400 prolongations », moyenne « 154.56 »).
// Une écoute/géoloc en préliminaire se renouvelle mensuellement, dans la limite
// légale de ~2 ans (≈ 24 prolongations) : au-delà, la durée est aberrante.
const MAX_DUREE_ESTIMABLE_JOURS = 760; // ~25 mois, marge au-delà des 2 ans légaux

// Structure minimale commune aux écoutes, géolocs et autres actes.
type ProlongableActe = {
  dateDebut?: string;
  dateFin?: string;
  prolongationsHistory?: unknown[];
  prolongationData?: unknown;
  prolongationDate?: unknown;
};

/**
 * Nombre de prolongations d'un acte, en privilégiant les données explicites
 * plutôt que l'estimation par durée :
 *
 *   1. `prolongationsHistory` fait foi. Chaque prolongation validée y est
 *      enregistrée et la `dateFin` est recalculée en conséquence
 *      (cf. ActeUtils.replayDateFin) : c'est le décompte exact.
 *   2. À défaut (actes hérités sans historique), on se rabat sur :
 *      a. l'estimation par durée (si l'acte a une période initiale), plafonnée ;
 *      b. une prolongation unique héritée ou en attente (`prolongationData`/
 *         `prolongationDate`).
 *
 * `initialPeriodDays` = durée initiale légale (écoute 30 j, géoloc 15 j) ;
 * `undefined` pour les « autres actes » qui n'ont pas d'estimation par durée.
 */
function countProlongations(acte: ProlongableActe, initialPeriodDays?: number): number {
  // 1. Source de vérité : l'historique explicite.
  const historique = acte.prolongationsHistory?.length ?? 0;
  if (historique > 0) return historique;

  // 2a. Repli : estimation par durée, plafonnée contre les dates aberrantes.
  let estimation = 0;
  if (initialPeriodDays !== undefined && acte.dateDebut && acte.dateFin) {
    const debut = new Date(acte.dateDebut);
    const fin = new Date(acte.dateFin);
    const dureeJours = Math.floor((fin.getTime() - debut.getTime()) / (1000 * 60 * 60 * 24));
    if (dureeJours > initialPeriodDays && dureeJours <= MAX_DUREE_ESTIMABLE_JOURS) {
      estimation = Math.floor((dureeJours - initialPeriodDays) / 30);
    }
  }

  // 2b. Repli : prolongation unique héritée ou en attente de validation.
  const legacy = (acte.prolongationData || acte.prolongationDate) ? 1 : 0;

  return Math.max(estimation, legacy);
}

export interface ActeStats {
  ecoutes: number;
  geolocalisations: number;
  autresActes: number;
  prolongationsEcoutes: number;
  prolongationsGeo: number;
  prolongationsAutres: number;
  totalActes: number;
  totalProlongations: number;
  totalAvecProlongations: number;
}

export function useActeStats(enquetes: Enquete[]): ActeStats {
  return useMemo(() => {
    const stats = enquetes.reduce((acc, e) => {
      const ecoutes = e.ecoutes?.length || 0;
      const geolocalisations = e.geolocalisations?.length || 0;
      const autresActes = e.actes?.length || 0;

      // Période initiale légale : écoute 30 j, géoloc 15 j.
      const prolongationsEcoutes = e.ecoutes?.reduce((sum, ecoute) => sum + countProlongations(ecoute, 30), 0) || 0;
      const prolongationsGeo = e.geolocalisations?.reduce((sum, geoloc) => sum + countProlongations(geoloc, 15), 0) || 0;
      // Autres actes : pas d'estimation par durée, uniquement l'historique / la prolongation héritée.
      const prolongationsAutres = e.actes?.reduce((sum, acte) => sum + countProlongations(acte), 0) || 0;

      return {
        ecoutes: acc.ecoutes + ecoutes,
        geolocalisations: acc.geolocalisations + geolocalisations,
        autresActes: acc.autresActes + autresActes,
        prolongationsEcoutes: acc.prolongationsEcoutes + prolongationsEcoutes,
        prolongationsGeo: acc.prolongationsGeo + prolongationsGeo,
        prolongationsAutres: acc.prolongationsAutres + prolongationsAutres,
      };
    }, {
      ecoutes: 0,
      geolocalisations: 0,
      autresActes: 0,
      prolongationsEcoutes: 0,
      prolongationsGeo: 0,
      prolongationsAutres: 0,
    });

    const totalActes = stats.ecoutes + stats.geolocalisations + stats.autresActes;
    const totalProlongations = stats.prolongationsEcoutes + stats.prolongationsGeo + stats.prolongationsAutres;

    return {
      ...stats,
      totalActes,
      totalProlongations,
      totalAvecProlongations: totalActes + totalProlongations,
    };
  }, [enquetes]);
}
