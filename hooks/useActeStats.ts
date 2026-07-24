import { useMemo } from 'react';
import { Enquete } from '@/types/interfaces';
import { computeActeStatsCore } from '@/lib/stats/actesCore.mjs';

// La LOGIQUE de rattachement des actes/prolongations à leur date réelle
// (historique explicite, estimation par durée plafonnée, prolongation héritée)
// vit dans le module PARTAGÉ lib/stats/actesCore.mjs — source unique, aussi
// utilisée par le service attaché pour les bilans par période. Ce hook
// n'apporte que le typage et la mémoïsation React.

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
  return computeActeStatsCore(enquetes, { year }) as ActeStats;
}

export function useActeStats(enquetes: Enquete[], year?: number): ActeStats {
  return useMemo(() => computeActeStats(enquetes, year), [enquetes, year]);
}
