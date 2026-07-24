import { ResultatAudience, AudienceStats, hasAnySaisies } from '@/types/audienceTypes';
import { Enquete } from '@/types/interfaces';
import { calculateAudienceStats as calculateAudienceStatsCore } from '@/lib/stats/audienceCore.mjs';

/**
 * Agrégation des résultats d'audience (peines, orientations, défèrements,
 * saisies/confiscations, durées). La LOGIQUE vit dans le module partagé
 * lib/stats/audienceCore.mjs — source unique, également utilisée par le
 * service attaché pour les bilans par période (stats_synthese). Ce fichier
 * n'apporte que le typage et les filtres année/mois de l'écran.
 */
export const calculateAudienceStats = (
  resultats: ResultatAudience[] | Record<string, ResultatAudience>,
  enquetes: Enquete[],
): AudienceStats | null =>
  calculateAudienceStatsCore(resultats, enquetes) as AudienceStats | null;

export const getYearlyStats = (
  resultats: ResultatAudience[] | Record<string, ResultatAudience>, 
  enquetes: Enquete[], 
  year: number
) => {
  const resultsArray = Array.isArray(resultats) ? resultats : Object.values(resultats);
  
  const validResultats = resultsArray.filter(resultat => {
    if (!resultat.dateAudience || resultat.dateAudience === '') {
      return false;
    }

    // Si c'est un résultat direct, un classement ou une OI, on l'accepte directement
    if (resultat.isDirectResult || resultat.isClassement || resultat.isOI) {
      const audienceDate = new Date(resultat.dateAudience);
      return audienceDate.getFullYear() === year;
    }

    // Pour les résultats standards, on vérifie l'enquête comme avant
    const enquete = enquetes.find(e => e.id === resultat.enqueteId);
    if (!enquete || enquete.statut !== 'archive') {
      return false;
    }

    const audienceDate = new Date(resultat.dateAudience);
    return audienceDate.getFullYear() === year;
  });

  return calculateAudienceStats(validResultats, enquetes);
};

export const getMonthlyStats = (
  resultats: ResultatAudience[] | Record<string, ResultatAudience>, 
  enquetes: Enquete[], 
  year: number,
  month: number
) => {
  const resultsArray = Array.isArray(resultats) ? resultats : Object.values(resultats);
  
  const validResultats = resultsArray.filter(resultat => {
    if (!resultat.dateAudience || resultat.dateAudience === '') {
      return false;
    }

    // Pour les résultats directs, classements ou OI
    if (resultat.isDirectResult || resultat.isClassement || resultat.isOI) {
      const audienceDate = new Date(resultat.dateAudience);
      return audienceDate.getFullYear() === year && audienceDate.getMonth() === month;
    }

    // Pour les résultats standards
    const enquete = enquetes.find(e => e.id === resultat.enqueteId);
    if (!enquete || enquete.statut !== 'archive') {
      return false;
    }

    const audienceDate = new Date(resultat.dateAudience);
    return audienceDate.getFullYear() === year && audienceDate.getMonth() === month;
  });

  return calculateAudienceStats(validResultats, enquetes);
};

/**
 * Nettoie les résultats orphelins.
 * @param resultats     Dictionnaire des résultats indexés par clé composite.
 * @param enquetePairs  Set des clés composites `${contentieuxId}__${enqueteId}`
 *                      des enquêtes encore existantes (toutes contentieux confondus).
 */
export const cleanupAudienceResults = (
  resultats: Record<string, ResultatAudience>,
  enquetePairs: Set<string>
) => {
  const cleanedResultats: Record<string, ResultatAudience> = {};

  Object.entries(resultats).forEach(([id, resultat]) => {
    // Brouillon de saisies pré-archivage : pas de dateAudience, mais on conserve
    // tant que l'enquête existe (paire contentieux+id présente) ET qu'il y a au
    // moins une saisie renseignée.
    if (resultat.isPreArchiveSaisies) {
      if (enquetePairs.has(id) && hasAnySaisies(resultat.saisies)) {
        cleanedResultats[id] = resultat;
      }
      return;
    }

    // Pour les résultats directs, OI, classements ou en attente d'audience
    if ((resultat.isDirectResult || resultat.isOI || resultat.isClassement || resultat.isAudiencePending) &&
        resultat.dateAudience && resultat.dateAudience !== '') {
      cleanedResultats[id] = resultat;
      return;
    }

    // Pour les résultats standards : conserver si le résultat a une date d'audience valide.
    // On ne filtre plus par statut car certaines enquêtes passent en instruction
    // et ne sont plus dans la liste locale, mais leur résultat reste valide.
    if (resultat.dateAudience && resultat.dateAudience !== '') {
      cleanedResultats[id] = resultat;
    }
  });

  return cleanedResultats;
};

export const AudienceStatsUtils = {
  calculateAudienceStats,
  getYearlyStats,
  getMonthlyStats,
  cleanupAudienceResults
};