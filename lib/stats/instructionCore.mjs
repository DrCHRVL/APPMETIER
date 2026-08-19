/**
 * SIRAL — cœur du calcul des statistiques du module INSTRUCTION.
 *
 * SOURCE UNIQUE des chiffres de l'onglet « Statistiques instruction » de la
 * page Statistiques (stock de dossiers, mis en examen et mesures de sûreté,
 * âges, DML, cotes, dossiers à régler au 175, délai de clôture par cabinet),
 * partagée par :
 *  - l'écran (hooks/useInstructionStats.ts, qui n'apporte plus que le typage
 *    et la mémoïsation React) ;
 *  - le connecteur Claude web (scripts/attache/statsEcran.mjs), pour que
 *    l'agent lise EXACTEMENT les mêmes nombres que le magistrat.
 *
 * Logique déplacée à l'identique depuis hooks/useInstructionStats.ts — toute
 * évolution des règles se fait ICI, une seule fois.
 */

/** Délai (en jours) entre 175 rendu et règlement pour un détenu (art. 175 CPP). */
export const DELAI_REGLEMENT_175_DETENU_JOURS = 30

const dayDiff = (from, to) => Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))

const parseDate = (iso) => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

const isAuReglement = (d) => d.etatReglement === '175_recu' || d.etatReglement === 'reqdef_redigees'

const findEvenement175 = (d) => (d.evenements || []).find((e) => e.type === '175_rendu')

const isDetenuMex = (m) => m.mesureSurete?.type === 'detenu'

/**
 * Statistiques agrégées d'une liste de dossiers d'instruction.
 * `maintenant` permet de figer la date de référence (tests, bilans).
 */
export function computeInstructionStats(dossiers, maintenant = new Date()) {
  const now = maintenant
  const liste = dossiers || []

  const actifs = liste.filter((d) => !d.archived)
  const archives = liste.filter((d) => !!d.archived)
  const auReglement = actifs.filter(isAuReglement)

  // ── MEX & mesures de sûreté ───────────────────────────────────
  // Un MEX sans mesure de sûreté renseignée est LIBRE (c'est l'état de droit
  // par défaut) : le compter ainsi garantit détenus + ARSE + CJ + libres
  // = total des mis en examen (le camembert et les compteurs concordent).
  const allMex = actifs.flatMap((d) => d.misEnExamen || [])
  const nbDetenus = allMex.filter((m) => m.mesureSurete?.type === 'detenu').length
  const nbCJ = allMex.filter((m) => m.mesureSurete?.type === 'cj').length
  const nbARSE = allMex.filter((m) => m.mesureSurete?.type === 'arse').length
  const nbLibres = allMex.length - nbDetenus - nbCJ - nbARSE

  // ── Âge des dossiers (depuis dateOuverture) ───────────────────
  const agesActifs = []
  actifs.forEach((d) => {
    const dt = parseDate(d.dateOuverture)
    if (dt) agesActifs.push(dayDiff(dt, now))
  })
  const ageMoyenDossiersActifs = agesActifs.length
    ? agesActifs.reduce((a, b) => a + b, 0) / agesActifs.length
    : 0
  const ageMaxDossierActif = agesActifs.length ? Math.max(...agesActifs) : 0

  const agesReglement = []
  auReglement.forEach((d) => {
    const dt = parseDate(d.dateOuverture)
    if (dt) agesReglement.push(dayDiff(dt, now))
  })
  const ageMoyenAuReglement = agesReglement.length
    ? agesReglement.reduce((a, b) => a + b, 0) / agesReglement.length
    : 0

  // ── DML ───────────────────────────────────────────────────────
  let nbDmlTotal = 0
  let nbDmlEnAttente = 0
  actifs.forEach((d) => {
    (d.misEnExamen || []).forEach((m) => {
      (m.dmls || []).forEach((dml) => {
        nbDmlTotal += 1
        if (dml.statut === 'en_attente') nbDmlEnAttente += 1
      })
    })
  })
  const dmlMoyenParDossier = actifs.length ? nbDmlTotal / actifs.length : 0

  // ── Cotes / tomes ─────────────────────────────────────────────
  const cotes = actifs.map((d) => d.cotesTomes || 0)
  const cotesTotal = cotes.reduce((a, b) => a + b, 0)
  const cotesMoyennes = cotes.length ? cotesTotal / cotes.length : 0

  // ── Dossiers à régler (175 rendu) ─────────────────────────────
  const urgents = []
  let dossiersAReglerTotal = 0
  let dossiersAReglerAvecDetenu = 0
  actifs.forEach((d) => {
    const evt = findEvenement175(d)
    const hasFlag = d.etatReglement === '175_recu' || !!evt
    if (!hasFlag) return
    dossiersAReglerTotal += 1
    const aDetenu = (d.misEnExamen || []).some(isDetenuMex)
    if (!aDetenu) return
    dossiersAReglerAvecDetenu += 1
    // Date du 175 : celle de l'événement si connue. À défaut, repli sur la
    // dernière modification du dossier — approximation SIGNALÉE (approx),
    // car cette date glisse à chaque édition du dossier.
    const dateEvt = parseDate(evt?.date)
    const date175 = dateEvt || parseDate(d.dateMiseAJour)
    if (!date175) return
    const dateEcheance = new Date(date175)
    dateEcheance.setDate(dateEcheance.getDate() + DELAI_REGLEMENT_175_DETENU_JOURS)
    urgents.push({
      dossierId: d.id,
      numeroInstruction: d.numeroInstruction,
      date175: date175.toISOString(),
      dateEcheance: dateEcheance.toISOString(),
      joursRestants: dayDiff(now, dateEcheance),
      approx: !dateEvt,
    })
  })
  urgents.sort((a, b) => a.joursRestants - b.joursRestants)

  // ── Âge moyen clôture par cabinet (pondéré par nb de MEX) ─────
  const byCabinet = {}
  archives.forEach((d) => {
    const dtOuv = parseDate(d.dateOuverture)
    const dtClos = parseDate(d.dateArchivage) || parseDate(d.dateMiseAJour)
    if (!dtOuv || !dtClos) return
    const age = dayDiff(dtOuv, dtClos)
    if (age < 0) return
    const key = d.cabinetId || 'inconnu'
    const nbMex = Math.max(1, (d.misEnExamen || []).length)
    if (!byCabinet[key]) byCabinet[key] = { ages: [], mexCounts: [] }
    byCabinet[key].ages.push(age)
    byCabinet[key].mexCounts.push(nbMex)
  })
  const ageMoyenClotureParCabinet = {}
  Object.entries(byCabinet).forEach(([cab, { ages, mexCounts }]) => {
    const ageMoyenJours = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0
    const totalPondere = ages.reduce((sum, a, i) => sum + a * mexCounts[i], 0)
    const totalMex = mexCounts.reduce((a, b) => a + b, 0)
    const agePondereParMexJours = totalMex ? totalPondere / totalMex : 0
    ageMoyenClotureParCabinet[cab] = {
      ageMoyenJours,
      agePondereParMexJours,
      nbDossiers: ages.length,
      nbMexTotal: totalMex,
    }
  })

  return {
    nbDossiers: liste.length,
    nbDossiersActifs: actifs.length,
    nbDossiersArchives: archives.length,
    nbDossiersAuReglement: auReglement.length,
    nbDossiers175Recu: actifs.filter((d) => d.etatReglement === '175_recu').length,
    nbDossiersReqDef: actifs.filter((d) => d.etatReglement === 'reqdef_redigees').length,
    nbDossiersOrdonnance: liste.filter((d) => d.etatReglement === 'ordonnance_rendue').length,

    nbMisEnExamen: allMex.length,
    nbDetenus,
    nbCJ,
    nbARSE,
    nbLibres,

    ageMoyenDossiersActifs,
    ageMaxDossierActif,
    ageMoyenAuReglement,

    nbDmlTotal,
    nbDmlEnAttente,
    dmlMoyenParDossier,

    cotesMoyennes,
    cotesTotal,

    dossiersARegler: {
      total: dossiersAReglerTotal,
      avecDetenu: dossiersAReglerAvecDetenu,
      urgents,
    },

    ageMoyenClotureParCabinet,
  }
}
