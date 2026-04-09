import { CompteRendu } from '../types/interfaces';

/**
 * Retourne le CR le plus récent par date, sans supposer d'ordre dans le tableau.
 * En cas d'égalité de date (plusieurs CRs le même jour), départage par id décroissant
 * car id = Date.now() au moment de la création.
 */
export function getLastCR(comptesRendus: CompteRendu[]): CompteRendu | undefined {
  if (comptesRendus.length === 0) return undefined;
  return comptesRendus.reduce((latest, cr) => {
    const diff = new Date(cr.date).getTime() - new Date(latest.date).getTime();
    if (diff !== 0) return diff > 0 ? cr : latest;
    return cr.id > latest.id ? cr : latest;
  });
}
