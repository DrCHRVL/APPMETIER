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

const JOUR_MS = 1000 * 60 * 60 * 24;

// Structure minimale commune aux écoutes, géolocs et autres actes.
type ProlongableActe = {
  dateDebut?: string;
  dateFin?: string;
  prolongationsHistory?: { date?: string }[];
  prolongationData?: { dateDebut?: string };
  prolongationDate?: string;
};

/** Année d'une date ISO, ou null si absente/invalide. */
function yearOf(iso: string | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.getFullYear();
}

/**
 * Année de rattachement d'un acte : sa date de début, à défaut la date de
 * création de l'enquête (actes en attente d'autorisation sans dateDebut).
 */
function acteYear(acte: ProlongableActe, fallbackYear: number | null): number | null {
  return yearOf(acte.dateDebut) ?? fallbackYear;
}

/**
 * Prolongations d'un acte, réparties par année, en privilégiant les données
 * explicites plutôt que l'estimation par durée :
 *
 *   1. `prolongationsHistory` fait foi. Chaque prolongation validée y est
 *      enregistrée avec sa date : décompte exact, rattaché à l'année réelle.
 *   2. À défaut (actes hérités sans historique), on se rabat sur :
 *      a. l'estimation par durée (si l'acte a une période initiale), plafonnée
 *         contre les dates aberrantes ; chaque renouvellement estimé est daté
 *         (début + période initiale + k×30 j) pour être compté dans SON année ;
 *      b. une prolongation unique héritée ou en attente (`prolongationData`/
 *         `prolongationDate`), datée si possible.
 *
 * `initialPeriodDays` = durée initiale légale (écoute 30 j, géoloc 15 j) ;
 * `undefined` pour les « autres actes » qui n'ont pas d'estimation par durée.
 *
 * Retourne la liste des années (une entrée par prolongation, null = non datable).
 */
function prolongationYears(
  acte: ProlongableActe,
  initialPeriodDays: number | undefined,
  fallbackYear: number | null,
): (number | null)[] {
  const baseYear = acteYear(acte, fallbackYear);

  // 1. Source de vérité : l'historique explicite (daté par entrée).
  const historique = acte.prolongationsHistory;
  if (historique && historique.length > 0) {
    return historique.map(h => yearOf(h.date) ?? baseYear);
  }

  // 2a. Repli : estimation par durée, plafonnée contre les dates aberrantes.
  if (initialPeriodDays !== undefined && acte.dateDebut && acte.dateFin) {
    const debut = new Date(acte.dateDebut);
    const fin = new Date(acte.dateFin);
    if (!isNaN(debut.getTime()) && !isNaN(fin.getTime())) {
      const dureeJours = Math.floor((fin.getTime() - debut.getTime()) / JOUR_MS);
      if (dureeJours > initialPeriodDays && dureeJours <= MAX_DUREE_ESTIMABLE_JOURS) {
        const count = Math.floor((dureeJours - initialPeriodDays) / 30);
        if (count > 0) {
          // Chaque renouvellement estimé est daté : début + initiale + k×30 j.
          return Array.from({ length: count }, (_, k) => {
            const d = new Date(debut.getTime() + (initialPeriodDays + k * 30) * JOUR_MS);
            return d.getFullYear();
          });
        }
      }
    }
  }

  // 2b. Repli : prolongation unique héritée ou en attente de validation.
  if (acte.prolongationData || acte.prolongationDate) {
    const y = yearOf(acte.prolongationDate) ?? yearOf(acte.prolongationData?.dateDebut) ?? baseYear;
    return [y];
  }

  return [];
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
  /** Nombre d'enquêtes ayant au moins un acte/prolongation compté (dénominateur
   *  des moyennes « par enquête »). */
  enquetesAvecActes: number;
}

/**
 * Statistiques d'actes, TOUTES enquêtes confondues, chaque acte/prolongation
 * étant rattaché à SON année (date de début de l'acte, date de chaque
 * prolongation) — et non à l'année d'ouverture de l'enquête. Une écoute posée
 * en 2026 sur une enquête ouverte en 2025 compte donc dans 2026.
 *
 * `year` absent = aucune restriction (total historique).
 *
 * Fonction pure partagée entre l'écran (via le hook) et l'export PDF, pour
 * garantir des chiffres identiques (même plafond anti-dates aberrantes).
 */
export function computeActeStats(enquetes: Enquete[], year?: number): ActeStats {
  const inYear = (y: number | null) => year === undefined || y === year;

  const stats = {
    ecoutes: 0,
    geolocalisations: 0,
    autresActes: 0,
    prolongationsEcoutes: 0,
    prolongationsGeo: 0,
    prolongationsAutres: 0,
    enquetesAvecActes: 0,
  };

  for (const e of enquetes) {
    const fallbackYear = yearOf(e.dateCreation);
    let countedForEnquete = 0;

    // Période initiale légale : écoute 30 j, géoloc 15 j.
    for (const ecoute of e.ecoutes || []) {
      if (inYear(acteYear(ecoute, fallbackYear))) { stats.ecoutes++; countedForEnquete++; }
      const prol = prolongationYears(ecoute, 30, fallbackYear).filter(inYear).length;
      stats.prolongationsEcoutes += prol;
      countedForEnquete += prol;
    }
    for (const geoloc of e.geolocalisations || []) {
      if (inYear(acteYear(geoloc, fallbackYear))) { stats.geolocalisations++; countedForEnquete++; }
      const prol = prolongationYears(geoloc, 15, fallbackYear).filter(inYear).length;
      stats.prolongationsGeo += prol;
      countedForEnquete += prol;
    }
    // Autres actes : pas d'estimation par durée, uniquement l'historique / la
    // prolongation héritée.
    for (const acte of e.actes || []) {
      if (inYear(acteYear(acte, fallbackYear))) { stats.autresActes++; countedForEnquete++; }
      const prol = prolongationYears(acte, undefined, fallbackYear).filter(inYear).length;
      stats.prolongationsAutres += prol;
      countedForEnquete += prol;
    }

    if (countedForEnquete > 0) stats.enquetesAvecActes++;
  }

  const totalActes = stats.ecoutes + stats.geolocalisations + stats.autresActes;
  const totalProlongations = stats.prolongationsEcoutes + stats.prolongationsGeo + stats.prolongationsAutres;

  return {
    ...stats,
    totalActes,
    totalProlongations,
    totalAvecProlongations: totalActes + totalProlongations,
  };
}

export function useActeStats(enquetes: Enquete[], year?: number): ActeStats {
  return useMemo(() => computeActeStats(enquetes, year), [enquetes, year]);
}
