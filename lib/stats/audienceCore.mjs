/**
 * SIRAL — cœur du calcul des statistiques d'audience.
 *
 * SOURCE UNIQUE des règles d'agrégation (peines, orientations, défèrements,
 * saisies/confiscations, durées), partagée par :
 *  - la page Statistiques et l'export PDF de l'app (utils/audienceStats.ts,
 *    qui re-exporte ces fonctions avec leurs types) ;
 *  - le service attaché (scripts/attache/statistiques.mjs), qui applique les
 *    mêmes règles sur une période libre pour les bilans d'activité.
 *
 * Module JavaScript pur (aucune dépendance, aucun import React/Node) : il
 * s'exécute tel quel dans le navigateur (bundle Next) comme dans le service
 * attaché (Node). Logique déplacée à l'identique depuis utils/audienceStats.ts
 * et types/audienceTypes.ts — toute évolution des règles se fait ICI, une
 * seule fois.
 */

// ── Confiscations / saisies (ancien types/audienceTypes.ts) ──

/** Crée un objet Confiscations vide */
export function emptyConfiscations() {
  return {
    vehicules: [],
    immeubles: [],
    numeraire: 0,
    saisiesBancaires: [],
    cryptomonnaies: [],
    objetsMobiliers: [],
  }
}

/** Vrai si au moins une saisie est renseignée (toutes catégories confondues). */
export function hasAnySaisies(s) {
  if (!s) return false
  return (
    s.vehicules.length > 0 ||
    s.immeubles.length > 0 ||
    (s.numeraire || 0) > 0 ||
    s.saisiesBancaires.length > 0 ||
    s.cryptomonnaies.length > 0 ||
    s.objetsMobiliers.length > 0 ||
    (s.stupefiants?.types?.length ?? 0) > 0
  )
}

/** Migre l'ancien format (compteurs simples) vers le nouveau format détaillé */
export function migrateConfiscations(raw) {
  if (!raw) return emptyConfiscations()
  // Déjà au nouveau format (vehicules est un tableau)
  if (Array.isArray(raw.vehicules)) return raw
  // Ancien format : vehicules: number, immeubles: number, argentTotal: number
  return {
    vehicules: Array.from({ length: raw.vehicules || 0 }, () => ({ type: 'voiture' })),
    immeubles: Array.from({ length: raw.immeubles || 0 }, () => ({ type: 'autre' })),
    numeraire: raw.argentTotal || 0,
    saisiesBancaires: [],
    cryptomonnaies: [],
    objetsMobiliers: [],
  }
}

// ── Agrégation (ancien utils/audienceStats.ts, à l'identique) ──

export function calculateAudienceStats(resultats, enquetes) {
  const resultsArray = Array.isArray(resultats) ? resultats : Object.values(resultats)

  const validResults = resultsArray.filter((resultat) => {
    if (!resultat || !resultat.dateAudience) {
      return false
    }

    // Si c'est un résultat direct, on accepte sans vérifier l'enquête
    if (resultat.isDirectResult) {
      return true
    }

    // Pour les résultats standards, on vérifie l'enquête comme avant
    const enquete = enquetes.find((e) => e.id === resultat.enqueteId)
    if (!enquete) {
      return false
    }

    return true
  })

  if (validResults.length === 0) {
    return null
  }

  // Séparation des résultats OI, classements, en attente et normaux
  const oiResults = validResults.filter((r) => r.isOI === true)
  const classementResults = validResults.filter((r) => r.isClassement === true)
  const pendingResults = validResults.filter((r) => r.isAudiencePending === true)
  const normalResults = validResults.filter((r) =>
    r.isOI !== true &&
    r.isAudiencePending !== true &&
    r.isClassement !== true
  )

  // Initialisation des compteurs
  let totalPrison = 0
  let totalProbation = 0
  let totalSimple = 0
  let nombrePeinesFermes = 0
  let nombrePeinesProbation = 0
  let nombrePeinesSimple = 0
  let nombrePeinesMixtesProbation = 0
  let nombrePeinesMixtesSimple = 0
  let totalMixtesFermes = 0
  let totalMixtesProbation = 0
  let totalMixtesSimpleFermes = 0
  let totalMixtesSimple = 0
  let totalAmende = 0
  let totalCondamnations = 0
  let totalInterdictionsParaitre = 0
  let totalInterdictionsGerer = 0
  let totalDureeEnquetes = 0
  let nombreEnquetesTerminees = 0
  let totalVehicules = 0
  let totalImmeubles = 0
  let totalArgent = 0
  let totalNumeraire = 0
  let totalBancaire = 0
  let totalCrypto = 0
  let totalObjets = 0
  let totalStupefiants = 0
  // Saisies (phase enquête)
  let totalSaisiesVehicules = 0
  let totalSaisiesImmeubles = 0
  let totalSaisiesArgent = 0
  let totalSaisiesNumeraire = 0
  let totalSaisiesBancaire = 0
  let totalSaisiesCrypto = 0
  let totalSaisiesObjets = 0
  // Compteurs des biens/avoirs marqués "remise/vente avant jugement"
  // (toutes catégories : véhicules, immeubles, avoirs, objets, crypto). On
  // additionne saisies (phase enquête) ET confiscations (audience) pour ne pas
  // double-compter selon où l'utilisateur saisit l'info.
  let nombreRemisesAvantJugement = 0
  let nombreVentesAvantJugement = 0

  /** Itère tous les items d'un Confiscations et incrémente les compteurs remise/vente. */
  const countPreJugementFlags = (c) => {
    const lists = [
      c.vehicules,
      c.immeubles,
      c.saisiesBancaires,
      c.cryptomonnaies,
      c.objetsMobiliers,
    ]
    for (const list of lists) {
      for (const item of list) {
        if (item.remiseAvantJugement) nombreRemisesAvantJugement++
        if (item.venteAvantJugement) nombreVentesAvantJugement++
      }
    }
  }

  const accumulateSaisies = (saisies) => {
    if (!saisies) return
    const sais = migrateConfiscations(saisies)
    totalSaisiesVehicules += sais.vehicules.length
    totalSaisiesImmeubles += sais.immeubles.length
    totalSaisiesNumeraire += sais.numeraire || 0
    const sBancaire = sais.saisiesBancaires.reduce((s, b) => s + (b.montant || 0), 0)
    totalSaisiesBancaire += sBancaire
    const sCrypto = sais.cryptomonnaies.reduce((s, c) => s + (c.montantEur || 0), 0)
    totalSaisiesCrypto += sCrypto
    totalSaisiesArgent += (sais.numeraire || 0) + sBancaire + sCrypto
    totalSaisiesObjets += sais.objetsMobiliers.reduce((s, o) => s + (o.quantite || 1), 0)
    countPreJugementFlags(sais)
  }

  // Compteurs pour les types d'orientation
  const audiencesUniques = new Set()
  let nombreCRPC = 0
  let nombreCI = 0
  let nombreCOPJ = 0
  let nombreOI = 0
  let nombreCDD = 0
  let nombreClassements = 0
  let nombreDeferements = 0
  const deferementsParMois = {}

  // Compter directement les OI et classements
  nombreOI = oiResults.length
  nombreClassements = classementResults.length

  // Statistiques par type d'infraction
  const infractionStats = {}

  // OI, classements et audiences en attente : pas de peines à traiter.
  // Les audiences EN ATTENTE (dateAudience future) ne comptent ni dans le
  // nombre d'audiences ni dans les durées d'enquête : le dossier n'est pas
  // encore jugé, l'inclure gonflerait les moyennes avec des dates à venir.
  for (const special of [...oiResults, ...classementResults, ...pendingResults]) {
    // Calcul de la durée d'enquête (OI et classements : la date de la décision
    // clôt bien l'enquête ; en attente d'audience : durée non acquise, ignorée)
    if (!special.isDirectResult && !special.isAudiencePending) {
      const enquete = enquetes.find((e) => e.id === special.enqueteId)
      if (enquete?.dateDebut && special.dateAudience) {
        const dateDebut = new Date(enquete.dateDebut)
        const dateFin = new Date(special.dateAudience)
        const dureeEnJours = Math.floor((dateFin.getTime() - dateDebut.getTime()) / (1000 * 60 * 60 * 24))
        if (dureeEnJours >= 0) {
          totalDureeEnquetes += dureeEnJours
          nombreEnquetesTerminees++
        }
      }
    }

    // Compter les saisies (réalisées pendant l'enquête, donc acquises même
    // avant jugement)
    accumulateSaisies(special.saisies)
  }

  // Traitement normal uniquement pour les résultats standards
  normalResults.forEach((resultat) => {
    const enquete = enquetes.find((e) => e.id === resultat.enqueteId)

    // Gestion des audiences uniques (deux dossiers appelés à la même audience
    // — même numeroAudience — comptent pour une seule audience)
    const audienceId = resultat.numeroAudience || `${resultat.enqueteId}-${resultat.dateAudience}`
    audiencesUniques.add(audienceId)

    // Calcul de la durée d'enquête - ne pas compter pour les résultats directs
    if (!resultat.isDirectResult && enquete?.dateDebut && resultat.dateAudience) {
      const dateDebut = new Date(enquete.dateDebut)
      const dateFin = new Date(resultat.dateAudience)
      const dureeEnJours = Math.floor((dateFin.getTime() - dateDebut.getTime()) / (1000 * 60 * 60 * 24))
      if (dureeEnJours >= 0) {
        totalDureeEnquetes += dureeEnJours
        nombreEnquetesTerminees++
      }
    }

    // Comptage des types d'audience (1 par dossier). NB : un résultat normal
    // peut porter une condamnation typée 'OI' (disjonction partielle : une
    // partie du dossier jugée, l'autre à l'information) — elle s'ajoute aux
    // résultats marqués isOI, qui eux n'ont pas de condamnations.
    const audienceTypes = new Set((resultat.condamnations || []).map((c) => c.typeAudience))
    if (audienceTypes.has('CI')) nombreCI++
    if (audienceTypes.has('COPJ')) nombreCOPJ++
    if (audienceTypes.has('OI')) nombreOI++
    if (audienceTypes.has('CDD')) nombreCDD++

    // Traitement des condamnations
    let deferesDuResultat = 0
    resultat.condamnations?.forEach((condamnation) => {
      if (!condamnation) return

      // Compter chaque CRPC séparément
      if (condamnation.typeAudience === 'CRPC-Def') {
        nombreCRPC++
      }

      // Compter chaque déférement séparément
      // NOUVEAU : Utiliser dateDefere si disponible, sinon dateAudience (compatibilité)
      if (condamnation.defere) {
        nombreDeferements++
        deferesDuResultat++

        // Compter par mois selon la vraie date de déférement
        const dateDef = condamnation.dateDefere || resultat.dateAudience
        if (dateDef) {
          const date = new Date(dateDef)
          if (!isNaN(date.getTime())) {
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
            deferementsParMois[monthKey] = (deferementsParMois[monthKey] || 0) + 1
          }
        }
      }

      const prison = Number(condamnation.peinePrison) || 0
      const probation = Number(condamnation.sursisProbatoire) || 0
      const simple = Number(condamnation.sursisSimple) || 0
      const amende = Number(condamnation.peineAmende) || 0

      // Clé d'agrégation des peines : code NATINF du résultat si présent (stats
      // justes, indépendantes du libellé), sinon repli sur le type d'infraction
      // (chaîne) pour les résultats non encore migrés.
      const infrKey = resultat.infractionNatinfCodes?.[0] ?? resultat.typeInfraction

      // Initialisation des stats par type d'infraction si nécessaire
      if (infrKey && !infractionStats[infrKey]) {
        infractionStats[infrKey] = {
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
          countPeinesMixtesSimple: 0,
        }
      }

      if (prison > 0 && probation === 0 && simple === 0) {
        nombrePeinesFermes++
        totalPrison += prison
        if (infrKey) {
          infractionStats[infrKey].totalMoisFerme += prison
          infractionStats[infrKey].countFerme++
        }
      } else if (prison === 0 && probation > 0 && simple === 0) {
        nombrePeinesProbation++
        totalProbation += probation
        if (infrKey) {
          infractionStats[infrKey].totalMoisProbation += probation
          infractionStats[infrKey].countProbation++
        }
      } else if (prison === 0 && probation === 0 && simple > 0) {
        nombrePeinesSimple++
        totalSimple += simple
        if (infrKey) {
          infractionStats[infrKey].totalMoisSimple += simple
          infractionStats[infrKey].countSimple++
        }
      } else if (prison > 0 && probation > 0) {
        nombrePeinesMixtesProbation++
        totalMixtesFermes += prison
        totalMixtesProbation += probation
        if (infrKey) {
          infractionStats[infrKey].totalMixtesFermes += prison
          infractionStats[infrKey].totalMixtesProbation += probation
          infractionStats[infrKey].countPeinesMixtesProbation++
        }
      } else if (prison > 0 && simple > 0) {
        nombrePeinesMixtesSimple++
        totalMixtesSimpleFermes += prison
        totalMixtesSimple += simple
        if (infrKey) {
          infractionStats[infrKey].totalMixtesSimpleFermes += prison
          infractionStats[infrKey].totalMixtesSimple += simple
          infractionStats[infrKey].countPeinesMixtesSimple++
        }
      }

      totalAmende += amende
      totalCondamnations++

      if (condamnation.interdictionParaitre) {
        totalInterdictionsParaitre++
      }
      if (condamnation.interdictionGerer) {
        totalInterdictionsGerer++
      }
    })

    // Déférements saisis au niveau du RÉSULTAT (champ `nombreDeferes`) et non
    // cochés condamnation par condamnation : compter le surplus, pour que les
    // deux modes de saisie donnent le même total (Math.max implicite — si les
    // deux sont renseignés pour les mêmes déférés, pas de double compte).
    const nombreDeferesResultat = Number(resultat.nombreDeferes) || 0
    if (nombreDeferesResultat > deferesDuResultat) {
      const surplus = nombreDeferesResultat - deferesDuResultat
      nombreDeferements += surplus
      const dateDef = resultat.dateDefere || resultat.dateAudience
      if (dateDef) {
        const date = new Date(dateDef)
        if (!isNaN(date.getTime())) {
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
          deferementsParMois[monthKey] = (deferementsParMois[monthKey] || 0) + surplus
        }
      }
    }

    // Traitement des confiscations (avec migration de l'ancien format)
    if (resultat.confiscations) {
      const conf = migrateConfiscations(resultat.confiscations)
      totalVehicules += conf.vehicules.length
      totalImmeubles += conf.immeubles.length
      totalNumeraire += conf.numeraire || 0
      const bancaire = conf.saisiesBancaires.reduce((s, b) => s + (b.montant || 0), 0)
      totalBancaire += bancaire
      const crypto = conf.cryptomonnaies.reduce((s, c) => s + (c.montantEur || 0), 0)
      totalCrypto += crypto
      totalArgent += (conf.numeraire || 0) + bancaire + crypto
      totalObjets += conf.objetsMobiliers.reduce((s, o) => s + (o.quantite || 1), 0)
      if (conf.stupefiants?.types?.length) totalStupefiants++
      countPreJugementFlags(conf)
    }

    // Traitement des saisies (phase enquête)
    accumulateSaisies(resultat.saisies)
  })

  // Préparation des statistiques par type d'infraction
  const peinesParInfraction = {}

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
      countPeinesMixtesSimple: stats.countPeinesMixtesSimple,
    }
  })

  // Construction des statistiques finales
  const stats = {
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
    nombrePeinesFermes,
    nombrePeinesProbation,
    nombrePeinesSimple,
    nombrePeinesMixtesProbation,
    nombrePeinesMixtesSimple,
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
    nombreRemisesAvantJugement,
    nombreVentesAvantJugement,
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
    tauxSursis: totalCondamnations > 0 ? Math.round(((nombrePeinesProbation + nombrePeinesSimple) / totalCondamnations) * 100) : 0,
  }

  return stats
}
