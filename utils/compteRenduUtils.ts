import { CompteRendu } from '../types/interfaces';

/**
 * Retourne le CR le plus récent par date, sans supposer d'ordre dans le tableau.
 */
export function getLastCR(comptesRendus: CompteRendu[]): CompteRendu | undefined {
  if (comptesRendus.length === 0) return undefined;
  return comptesRendus.reduce((latest, cr) =>
    new Date(cr.date) > new Date(latest.date) ? cr : latest
  );
}
