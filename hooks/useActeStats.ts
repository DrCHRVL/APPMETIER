import { useMemo } from 'react';
import { Enquete } from '@/types/interfaces';

// Garde-fou anti-données aberrantes.
// Une écoute ou une géolocalisation en préliminaire ne se renouvelle que
// mensuellement, dans la limite légale de ~2 ans (≈ 24 prolongations).
// L'estimation du nombre de prolongations à partir de la durée
// (dateFin − dateDebut) n'a aucun plafond : une seule date de fin erronée
// (année mal saisie, import de document approximatif…) peut donc être lue
// comme des milliers de renouvellements et faire exploser les totaux du
// tableau de bord (ex. « 24 400 prolongations », moyenne « 154.56 »).
// Au-delà de ce plafond, on considère la durée comme aberrante et on
// ignore l'estimation par durée (l'historique réel, lui, reste pris en compte).
const MAX_DUREE_ESTIMABLE_JOURS = 760; // ~25 mois, marge au-delà des 2 ans légaux

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

      // Prolongations ECOUTES
      const prolongationsEcoutes = e.ecoutes?.reduce((sum, ecoute) => {
        let count = 0;

        if (ecoute.dateDebut && ecoute.dateFin) {
          const debut = new Date(ecoute.dateDebut);
          const fin = new Date(ecoute.dateFin);
          const dureeJours = Math.floor((fin.getTime() - debut.getTime()) / (1000 * 60 * 60 * 24));
          if (dureeJours > 30 && dureeJours <= MAX_DUREE_ESTIMABLE_JOURS) {
            count = Math.floor((dureeJours - 30) / 30);
          }
        }

        if (ecoute.prolongationsHistory && ecoute.prolongationsHistory.length > 0) {
          const historiqueCount = ecoute.prolongationsHistory.length;
          if (historiqueCount !== count && count > 0) {
            console.warn(`Incoherence ecoute ${ecoute.numero || ecoute.id} - Historique: ${historiqueCount}, Calcul duree: ${count}`);
          }
          count = Math.max(historiqueCount, count);
        }

        if (count === 0 && (ecoute.prolongationData || ecoute.prolongationDate)) {
          count = 1;
        }

        return sum + count;
      }, 0) || 0;

      // Prolongations GEOLOCALISATIONS
      const prolongationsGeo = e.geolocalisations?.reduce((sum, geoloc) => {
        let count = 0;

        if (geoloc.dateDebut && geoloc.dateFin) {
          const debut = new Date(geoloc.dateDebut);
          const fin = new Date(geoloc.dateFin);
          const dureeJours = Math.floor((fin.getTime() - debut.getTime()) / (1000 * 60 * 60 * 24));
          if (dureeJours > 15 && dureeJours <= MAX_DUREE_ESTIMABLE_JOURS) {
            count = Math.floor((dureeJours - 15) / 30);
          }
        }

        if (geoloc.prolongationsHistory && geoloc.prolongationsHistory.length > 0) {
          const historiqueCount = geoloc.prolongationsHistory.length;
          if (historiqueCount !== count && count > 0) {
            console.warn(`Incoherence geoloc ${geoloc.objet || geoloc.id} - Historique: ${historiqueCount}, Calcul duree: ${count}`);
          }
          count = Math.max(historiqueCount, count);
        }

        if (count === 0 && (geoloc.prolongationData || geoloc.prolongationDate)) {
          count = 1;
        }

        return sum + count;
      }, 0) || 0;

      // Prolongations AUTRES ACTES
      const prolongationsAutres = e.actes?.reduce((sum, acte) => {
        if (acte.prolongationsHistory && acte.prolongationsHistory.length > 0) {
          return sum + acte.prolongationsHistory.length;
        }
        if (acte.prolongationData || acte.prolongationDate) {
          return sum + 1;
        }
        return sum;
      }, 0) || 0;

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
