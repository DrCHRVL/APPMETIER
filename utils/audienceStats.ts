import { ResultatAudience, AudienceStats, PeineParInfraction, migrateConfiscations, hasAnySaisies } from '@/types/audienceTypes';
import { Enquete } from '@/types/interfaces';

export const calculateAudienceStats = (resultats: ResultatAudience[] | Record<string, ResultatAudience>, enquetes: Enquete[]): AudienceStats | null => {
  const resultsArray = Array.isArray(resultats) ? resultats : Object.values(resultats);
  
  const validResults = resultsArray.filter(resultat => {
    if (!resultat || !resultat.dateAudience) {
      return false;
    }
    
    // Si c'est un résultat direct, on accepte sans vérifier l'enquête
    if (resultat.isDirectResult) {
      return true;
    }
    
    // Pour les résultats standards, on vérifie l'enquête comme avant
    const enquete = enquetes.find(e => e.id === resultat.enqueteId);
    if (!enquete) {
      return false;
    }
    
    return true;
  });

  if (validResults.length === 0) {
    return null;
  }

  // Séparation des résultats OI, classements, en attente et normaux
  const oiResults = validResults.filter(r => r.isOI === true);
  const classementResults = validResults.filter(r => r.isClassement === true);
  const pendingResults = validResults.filter(r => r.isAudiencePending === true);
  const normalResults = validResults.filter(r => 
    r.isOI !== true && 
    r.isAudiencePending !== true && 
    r.isClassement !== true
  );

  // Initialisation des compteurs
  let totalPrison = 0;
  let totalProbation = 0;
  let totalSimple = 0;
  let nombrePeinesFermes = 0;
  let nombrePeinesProbation = 0;
  let nombrePeinesSimple = 0;
  let nombrePeinesMixtesProbation = 0;
  let nombrePeinesMixtesSimple = 0;
  let totalMixtesFermes = 0;
  let totalMixtesProbation = 0;
  let totalMixtesSimpleFermes = 0;
  let totalMixtesSimple = 0;
  let totalAmende = 0;
  let totalCondamnations = 0;
  let totalInterdictionsParaitre = 0;
  let totalInterdictionsGerer = 0;
  let totalDureeEnquetes = 0;
  let nombreEnquetesTerminees = 0;
  let totalVehicules = 0;
  let totalImmeubles = 0;
  let totalArgent = 0;
  let totalNumeraire = 0;
  let totalBancaire = 0;
  let totalCrypto = 0;
  let totalObjets = 0;
  let totalStupefiants = 0;
  // Saisies (phase enquête)
  let totalSaisiesVehicules = 0;
  let totalSaisiesImmeubles = 0;
  let totalSaisiesArgent = 0;
  let totalSaisiesNumeraire = 0;
  let totalSaisiesBancaire = 0;
  let totalSaisiesCrypto = 0;
  let totalSaisiesObjets = 0;

  // Compteurs pour les types d'orientation
  const audiencesUniques = new Set<string>();
  const orientationsUniques = new Set<string>(); // Pour compter toutes les orientations (y compris classements et OI)
  let nombreCRPC = 0;
  let nombreCI = 0;
  let nombreCOPJ = 0;
  let nombreOI = 0;
  let nombreCDD = 0;
  let nombreClassements = 0;
  let nombreDeferements = 0;
  const deferementsParMois: Record<string, number> = {};

  // Compter directement les OI et classements
  nombreOI = oiResults.length;
  nombreClassements = classementResults.length;

  // Statistiques par type d'infraction
  const infractionStats: Record<string, {
    totalMoisFerme: number;
    totalMoisProbation: number;
    totalMoisSimple: number;
    countFerme: number;
    countProbation: number;
    countSimple: number;
    totalMixtesFermes: number;
    totalMixtesProbation: number;
    totalMixtesSimpleFermes: number;
    totalMixtesSimple: number;
    countPeinesMixtesProbation: number;
    countPeinesMixtesSimple: number;
  }> = {};

  // Pour les OI, classements et audiences en attente, 
  // on les compte uniquement dans le nombre total d'orientations
  for (const special of [...oiResults, ...classementResults, ...pendingResults]) {
    // Gestion des orientations uniques 
    const audienceId = special.numeroAudience || `${special.enqueteId}-${special.dateAudience}`;
    orientationsUniques.add(audienceId);

    // Ne pas compter dans les audiences (pour les statistiques de peines)
    if (!special.isOI && !special.isClassement) {
      audiencesUniques.add(audienceId);
    }

    // Calcul de la durée d'enquête
    if (!special.isDirectResult) {
      const enquete = enquetes.find(e => e.id === special.enqueteId);
      if (enquete?.dateDebut && special.dateAudience) {
        const dateDebut = new Date(enquete.dateDebut);
        const dateFin = new Date(special.dateAudience);
        const dureeEnJours = Math.floor((dateFin.getTime() - dateDebut.getTime()) / (1000 * 60 * 60 * 24));
        if (dureeEnJours >= 0) {
          totalDureeEnquetes += dureeEnJours;
          nombreEnquetesTerminees++;
        }
      }
    }

    // Compter les saisies des résultats en attente d'audience
    if (special.saisies) {
      const sais = migrateConfiscations(special.saisies);
      totalSaisiesVehicules += sais.vehicules.length;
      totalSaisiesImmeubles += sais.immeubles.length;
      totalSaisiesNumeraire += sais.numeraire || 0;
      const sBancaire = sais.saisiesBancaires.reduce((s, b) => s + (b.montant || 0), 0);
      totalSaisiesBancaire += sBancaire;
      const sCrypto = sais.cryptomonnaies.reduce((s, c) => s + (c.montantEur || 0), 0);
      totalSaisiesCrypto += sCrypto;
      totalSaisiesArgent += (sais.numeraire || 0) + sBancaire + sCrypto;
      totalSaisiesObjets += sais.objetsMobiliers.reduce((s, o) => s + (o.quantite || 1), 0);
    }
  }

  // Traitement normal uniquement pour les résultats standards
  normalResults.forEach(resultat => {
    const enquete = enquetes.find(e => e.id === resultat.enqueteId);
    
    // Gestion des audiences et orientations uniques
    const audienceId = resultat.numeroAudience || `${resultat.enqueteId}-${resultat.dateAudience}`;
    audiencesUniques.add(audienceId);
    orientationsUniques.add(audienceId);

    // Calcul de la durée d'enquête - ne pas compter pour les résultats directs
    if (!resultat.isDirectResult && enquete?.dateDebut && resultat.dateAudience) {
      const dateDebut = new Date(enquete.dateDebut);
      const dateFin = new Date(resultat.dateAudience);
      const dureeEnJours = Math.floor((dateFin.getTime() - dateDebut.getTime()) / (1000 * 60 * 60 * 24));
      if (dureeEnJours >= 0) {
        totalDureeEnquetes += dureeEnJours;
        nombreEnquetesTerminees++;
      }
    }

    // Comptage des types d'audience
    const audienceTypes = new Set(resultat.condamnations.map(c => c.typeAudience));
    if (audienceTypes.has('CI')) nombreCI++;
    if (audienceTypes.has('COPJ')) nombreCOPJ++;
    if (audienceTypes.has('OI')) nombreOI++;
    if (audienceTypes.has('CDD')) nombreCDD++;

    // Traitement des condamnations
    resultat.condamnations?.forEach(condamnation => {
      if (!condamnation) return;

      // Compter chaque CRPC séparément
      if (condamnation.typeAudience === 'CRPC-Def') {
        nombreCRPC++;
      }

      // Compter chaque déférement séparément
      // NOUVEAU : Utiliser dateDefere si disponible, sinon dateAudience (compatibilité)
      if (condamnation.defere) {
        nombreDeferements++;
        
        // Compter par mois selon la vraie date de déférement
        const dateDef = condamnation.dateDefere || resultat.dateAudience;
        if (dateDef) {
          const date = new Date(dateDef);
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          deferementsParMois[monthKey] = (deferementsParMois[monthKey] || 0) + 1;
        }
      }

      const prison = Number(condamnation.peinePrison) || 0;
      const probation = Number(condamnation.sursisProbatoire) || 0;
      const simple = Number(condamnation.sursisSimple) || 0;
      const amende = Number(condamnation.peineAmende) || 0;

      // Initialisation des stats par type d'infraction si nécessaire
      if (resultat.typeInfraction && !infractionStats[resultat.typeInfraction]) {
        infractionStats[resultat.typeInfraction] = {
          totalMoisFerme: 0,
          totalMoisProbation: 0,
          totalMoisSimple: 0,
          countFerme: 0,
          countProbation: 0,
          countSimple: 0,
          totalMixtesFermes: 0,
          totalMixtesProbation: 0,
          totalMixtesSimpleFermes: 0,
          totalMixtesSimple: 0,
          countPeinesMixtesProbation: 0,
          countPeinesMixtesSimple: 0
        };
      }

      if (prison > 0 && probation === 0 && simple === 0) {
        nombrePeinesFermes++;
        totalPrison += prison;
        if (resultat.typeInfraction) {
          infractionStats[resultat.typeInfraction].totalMoisFerme += prison;
          infractionStats[resultat.typeInfraction].countFerme++;
        }
      } else if (prison === 0 && probation > 0 && simple === 0) {
        nombrePeinesProbation++;
        totalProbation += probation;
        if (resultat.typeInfraction) {
          infractionStats[resultat.typeInfraction].totalMoisProbation += probation;
          infractionStats[resultat.typeInfraction].countProbation++;
        }
      } else if (prison === 0 && probation === 0 && simple > 0) {
        nombrePeinesSimple++;
        totalSimple += simple;
        if (resultat.typeInfraction) {
          infractionStats[resultat.typeInfraction].totalMoisSimple += simple;
          infractionStats[resultat.typeInfraction].countSimple++;
        }
      } else if (prison > 0 && probation > 0) {
        nombrePeinesMixtesProbation++;
        totalMixtesFermes += prison;
        totalMixtesProbation += probation;
        if (resultat.typeInfraction) {
          infractionStats[resultat.typeInfraction].totalMixtesFermes += prison;
          infractionStats[resultat.typeInfraction].totalMixtesProbation += probation;
          infractionStats[resultat.typeInfraction].countPeinesMixtesProbation++;
        }
      } else if (prison > 0 && simple > 0) {
        nombrePeinesMixtesSimple++;
        totalMixtesSimpleFermes += prison;
        totalMixtesSimple += simple;
        if (resultat.typeInfraction) {
          infractionStats[resultat.typeInfraction].totalMixtesSimpleFermes += prison;
          infractionStats[resultat.typeInfraction].totalMixtesSimple += simple;
          infractionStats[resultat.typeInfraction].countPeinesMixtesSimple++;
        }
      }

      totalAmende += amende;
      totalCondamnations++;
      
      if (condamnation.interdictionParaitre) {
        totalInterdictionsParaitre++;
      }
      if (condamnation.interdictionGerer) {
        totalInterdictionsGerer++;
      }
    });

    // Traitement des confiscations (avec migration de l'ancien format)
    if (resultat.confiscations) {
      const conf = migrateConfiscations(resultat.confiscations);
      totalVehicules += conf.vehicules.length;
      totalImmeubles += conf.immeubles.length;
      totalNumeraire += conf.numeraire || 0;
      const bancaire = conf.saisiesBancaires.reduce((s, b) => s + (b.montant || 0), 0);
      totalBancaire += bancaire;
      const crypto = conf.cryptomonnaies.reduce((s, c) => s + (c.montantEur || 0), 0);
      totalCrypto += crypto;
      totalArgent += (conf.numeraire || 0) + bancaire + crypto;
      totalObjets += conf.objetsMobiliers.reduce((s, o) => s + (o.quantite || 1), 0);
      if (conf.stupefiants?.types?.length) totalStupefiants++;
    }

    // Traitement des saisies (phase enquête)
    if (resultat.saisies) {
      const sais = migrateConfiscations(resultat.saisies);
      totalSaisiesVehicules += sais.vehicules.length;
      totalSaisiesImmeubles += sais.immeubles.length;
      totalSaisiesNumeraire += sais.numeraire || 0;
      const sBancaire = sais.saisiesBancaires.reduce((s, b) => s + (b.montant || 0), 0);
      totalSaisiesBancaire += sBancaire;
      const sCrypto = sais.cryptomonnaies.reduce((s, c) => s + (c.montantEur || 0), 0);
      totalSaisiesCrypto += sCrypto;
      totalSaisiesArgent += (sais.numeraire || 0) + sBancaire + sCrypto;
      totalSaisiesObjets += sais.objetsMobiliers.reduce((s, o) => s + (o.quantite || 1), 0);
    }
  });

  // Préparation des statistiques par type d'infraction
  const peinesParInfraction: Record<string, PeineParInfraction> = {};
  
  Object.entries(infractionStats).forEach(([infraction, stats]) => {
    peinesParInfraction[infraction] = {
      moyenneFerme: stats.countFerme > 0 ? Math.round(stats.totalMoisFerme / stats.countFerme * 10) / 10 : 0,
      moyenneProbation: stats.countProbation > 0 ? Math.round(stats.totalMoisProbation / stats.countProbation * 10) / 10 : 0,
      moyenneSimple: stats.countSimple > 0 ? Math.round(stats.totalMoisSimple / stats.countSimple * 10) / 10 : 0,
      countFerme: stats.countFerme,
      countProbation: stats.countProbation,
      countSimple: stats.countSimple,
      moyenneMixtesProbation: stats.countPeinesMixtesProbation > 0 ? 
        `${Math.round(stats.totalMixtesFermes / stats.countPeinesMixtesProbation * 10) / 10} + ${Math.round(stats.totalMixtesProbation / stats.countPeinesMixtesProbation * 10) / 10}` : '',
      moyenneMixtesSimple: stats.countPeinesMixtesSimple > 0 ? 
        `${Math.round(stats.totalMixtesSimpleFermes / stats.countPeinesMixtesSimple * 10) / 10} + ${Math.round(stats.totalMixtesSimple / stats.countPeinesMixtesSimple * 10) / 10}` : '',
      countPeinesMixtesProbation: stats.countPeinesMixtesProbation,
      countPeinesMixtesSimple: stats.countPeinesMixtesSimple
    };
  });

  // Construction des statistiques finales
  const stats: AudienceStats = {
    moyennePrison: nombrePeinesFermes > 0 ? Math.round(totalPrison / nombrePeinesFermes * 10) / 10 : 0,
    moyenneProbation: nombrePeinesProbation > 0 ? Math.round(totalProbation / nombrePeinesProbation * 10) / 10 : 0,
    moyenneSimple: nombrePeinesSimple > 0 ? Math.round(totalSimple / nombrePeinesSimple * 10) / 10 : 0,
    moyenneAmende: totalCondamnations > 0 ? Math.round(totalAmende / totalCondamnations) : 0,
    totalPeinePrison: totalPrison + totalMixtesFermes + totalMixtesSimpleFermes,
    tauxPeinesFermes: totalCondamnations > 0 ? Math.round((nombrePeinesFermes / totalCondamnations) * 1000) / 10 : 0,
    tauxPeinesProbation: totalCondamnations > 0 ? Math.round((nombrePeinesProbation / totalCondamnations) * 1000) / 10 : 0,
    tauxPeinesSimple: totalCondamnations > 0 ? Math.round((nombrePeinesSimple / totalCondamnations) * 1000) / 10 : 0,
    tauxPeinesMixtesProbation: totalCondamnations > 0 ? Math.round((nombrePeinesMixtesProbation / totalCondamnations) * 1000) / 10 : 0,
    tauxPeinesMixtesSimple: totalCondamnations > 0 ? Math.round((nombrePeinesMixtesSimple / totalCondamnations) * 1000) / 10 : 0,
    moyenneMixtesProbation: nombrePeinesMixtesProbation > 0 ? 
      `${Math.round(totalMixtesFermes / nombrePeinesMixtesProbation * 10) / 10} + ${Math.round(totalMixtesProbation / nombrePeinesMixtesProbation * 10) / 10}` : '',
    moyenneMixtesSimple: nombrePeinesMixtesSimple > 0 ?
      `${Math.round(totalMixtesSimpleFermes / nombrePeinesMixtesSimple * 10) / 10} + ${Math.round(totalMixtesSimple / nombrePeinesMixtesSimple * 10) / 10}` : '',
    nombreAudiences: audiencesUniques.size, // Seulement les vraies audiences (pas les OI ni les classements)
    nombreCondamnations: totalCondamnations,
    montantTotalAmendes: totalAmende,
    delaiMoyenJugement: nombreEnquetesTerminees > 0 ? Math.round(totalDureeEnquetes / nombreEnquetesTerminees) : 0,
    dureeMoyenneEnquete: nombreEnquetesTerminees > 0 ? Math.round(totalDureeEnquetes / nombreEnquetesTerminees) : 0,
    totalVehicules,
    totalImmeubles,
    totalArgent,
    totalNumeraire,
    totalBancaire,
    totalCrypto,
    totalObjets,
    totalStupefiants,
    totalSaisiesVehicules,
    totalSaisiesImmeubles,
    totalSaisiesArgent,
    totalSaisiesNumeraire,
    totalSaisiesBancaire,
    totalSaisiesCrypto,
    totalSaisiesObjets,
    ratioConfiscations: totalCondamnations > 0 ? (totalVehicules + totalImmeubles + totalObjets) / totalCondamnations : 0,
    peinesParInfraction,
    totalInterdictionsParaitre,
    ratioInterdictionsParaitre: totalCondamnations > 0 ? (totalInterdictionsParaitre / totalCondamnations) * 100 : 0,
    totalInterdictionsGerer,
    ratioInterdictionsGerer: totalCondamnations > 0 ? (totalInterdictionsGerer / totalCondamnations) * 100 : 0,
    nombreCRPC,
    nombreCI,
    nombreCOPJ,
    nombreOI,
    nombreCDD,
    nombreClassements,
    nombreDeferements,
    deferementsParMois,
    tauxSursis: totalCondamnations > 0 ? Math.round(((nombrePeinesProbation + nombrePeinesSimple) / totalCondamnations) * 100) : 0
  };

  return stats;
};

export const getStatsByPeriod = (
  resultats: ResultatAudience[] | Record<string, ResultatAudience>, 
  enquetes: Enquete[], 
  startDate: Date, 
  endDate: Date
) => {
  const resultsArray = Array.isArray(resultats) ? resultats : Object.values(resultats);
  
  const endDateTime = new Date(endDate);
  endDateTime.setHours(23, 59, 59, 999);

  const filteredResultats = resultsArray.filter(resultat => {
    if (!resultat.dateAudience) return false;
    const audienceDate = new Date(resultat.dateAudience);
    return audienceDate >= startDate && audienceDate <= endDateTime;
  });

  return calculateAudienceStats(filteredResultats, enquetes);
};

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

export const cleanupAudienceResults = (
  resultats: Record<string, ResultatAudience>,
  enquetes: Enquete[]
) => {
  const cleanedResultats: Record<string, ResultatAudience> = {};
  const enqueteIds = new Set(enquetes.map(e => e.id));

  Object.entries(resultats).forEach(([id, resultat]) => {
    // Brouillon de saisies pré-archivage : pas de dateAudience, mais on conserve
    // tant que l'enquête existe ET qu'il y a au moins une saisie renseignée.
    if (resultat.isPreArchiveSaisies) {
      if (enqueteIds.has(resultat.enqueteId) && hasAnySaisies(resultat.saisies)) {
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
  getStatsByPeriod,
  getYearlyStats,
  getMonthlyStats,
  cleanupAudienceResults
};