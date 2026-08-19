/**
 * SIRAL — la page Statistiques, CARTE PAR CARTE : cœur de calcul partagé.
 *
 * SOURCE UNIQUE des chiffres AFFICHÉS À L'ÉCRAN. `audienceCore.mjs` agrège les
 * résultats d'audience (peines, orientations, saisies) ; ce module-ci fait le
 * reste du travail de la page Statistiques — celui qui vivait jusqu'ici dans le
 * JSX des cartes (âge moyen au classement, delta saisies/confiscations, peines
 * moyennes par type d'audience, répartition par service, comparatif N-1…) —
 * pour que les MÊMES nombres soient servis à :
 *  - l'écran (components/stats/*.tsx) et l'export PDF ;
 *  - le connecteur Claude web (scripts/attache/statsEcran.mjs → outil
 *    `stats_ecran`), qui doit rendre EXACTEMENT ce que le magistrat lit sur
 *    sa page Statistiques, sans jamais recalculer de son côté.
 *
 * Conventions reprises telles quelles de l'écran (ne pas « corriger » sans
 * changer l'écran en même temps) :
 *  - une année = celle de `dateAudience` (année civile, `new Date(...)`) ;
 *  - l'année en cours s'arrête au mois courant (comme `getMonthsToShow`) ;
 *  - « procédures terminées » = enquêtes archivées jugées dans l'année
 *    + procédures directes (permanence), HORS classements sans suite et
 *    ouvertures d'information ;
 *  - les défèrements des cartes « Évolution des déférements » sont comptés à
 *    leur date RÉELLE, toutes enquêtes confondues — différents du « dont
 *    déférements » de l'orientation, limité aux dossiers jugés dans l'année.
 *
 * Module JavaScript pur (aucune dépendance, aucun import React/Node) : il
 * tourne dans le bundle Next comme dans le service attaché. Les résolutions
 * qui dépendent du référentiel chargé (NATINF, tags, services) sont INJECTÉES
 * en paramètre, chaque environnement fournissant la sienne.
 */
import { calculateAudienceStats } from './audienceCore.mjs'
import { computeActeStatsCore } from './actesCore.mjs'

// ── Dates (mêmes primitives que l'écran) ──

/** Année civile d'une date, ou null. `new Date(...)` comme dans les composants. */
export function anneeDe(date) {
  if (!date) return null
  const d = new Date(date)
  return Number.isFinite(d.getTime()) ? d.getFullYear() : null
}

/** Mois (0-11) d'une date, ou null. */
export function moisDe(date) {
  if (!date) return null
  const d = new Date(date)
  return Number.isFinite(d.getTime()) ? d.getMonth() : null
}

const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** Libellé français d'un mois 0-11. */
export const libelleMois = (m) => MOIS_FR[m] || String(m)

/**
 * Mois affichés pour une année — miroir de `getMonthsToShow()` : l'année en
 * cours s'arrête au mois courant, une année passée (ou future) va jusqu'à
 * décembre.
 */
export function moisAffiches(annee, maintenant = new Date()) {
  const dernier = annee === maintenant.getFullYear() ? maintenant.getMonth() : 11
  return Array.from({ length: dernier + 1 }, (_, i) => i)
}

const joursEntre = (debut, fin) => {
  const a = new Date(debut); const b = new Date(fin)
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return null
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

const listeResultats = (resultats) => (Array.isArray(resultats) ? resultats : Object.values(resultats || {}))

const serieMois = (mois) => Object.fromEntries(mois.map((m) => [m, 0]))

const arrondi1 = (n) => Math.round(n * 10) / 10

// ── Populations de base ──

/** Le résultat d'audience rattaché à une enquête (miroir du `.find()` des cartes). */
export const resultatDeLEnquete = (resultats, enqueteId) =>
  listeResultats(resultats).find((r) => r && r.enqueteId === enqueteId)

/**
 * Procédures terminées de l'année — carte « Total des procédures terminées ».
 * Enquêtes ARCHIVÉES dont le résultat est daté dans l'année + procédures
 * directes (permanence) de l'année. `total` exclut classements et OI ;
 * `totalAvecClassementsEtOi` est le chiffre de bas de carte.
 */
export function proceduresTerminees(resultats, enquetes, annee, maintenant = new Date()) {
  const tous = listeResultats(resultats)

  const enquetesTerminees = enquetes.filter((e) => {
    if (e.statut !== 'archive') return false
    const r = resultatDeLEnquete(tous, e.id)
    return Boolean(r?.dateAudience) && anneeDe(r.dateAudience) === annee
  })
  const directes = tous.filter((r) => r.isDirectResult && anneeDe(r.dateAudience) === annee)

  const estClOuOi = (r) => Boolean(r && (r.isClassement || r.isOI))
  const termineesHorsClOi = enquetesTerminees.filter((e) => !estClOuOi(resultatDeLEnquete(tous, e.id)))
  const directesHorsClOi = directes.filter((r) => !estClOuOi(r))

  const mois = moisAffiches(annee, maintenant)
  const parMois = serieMois(mois)
  for (const e of termineesHorsClOi) {
    const r = resultatDeLEnquete(tous, e.id)
    const m = moisDe(r?.dateAudience)
    if (m != null && m in parMois) parMois[m]++
  }
  for (const r of directesHorsClOi) {
    const m = moisDe(r.dateAudience)
    if (m != null && m in parMois) parMois[m]++
  }

  const classements = enquetesTerminees.filter((e) => resultatDeLEnquete(tous, e.id)?.isClassement).length
    + directes.filter((r) => r.isClassement).length
  const oi = enquetesTerminees.filter((e) => resultatDeLEnquete(tous, e.id)?.isOI).length
    + directes.filter((r) => r.isOI).length

  return {
    total: termineesHorsClOi.length + directesHorsClOi.length,
    totalAvecClassementsEtOi: enquetesTerminees.length + directes.length,
    classements,
    ouverturesInformation: oi,
    parMois,
    enquetesTerminees,
    termineesHorsClOi,
    directes,
    directesHorsClOi,
  }
}

/**
 * Carte « Durée moyenne » : durée moyenne des enquêtes terminées dans l'année
 * (toutes, classements et OI compris — c'est la règle de l'écran) et ancienneté
 * moyenne du STOCK d'enquêtes en cours, tous millésimes confondus.
 */
export function dureesMoyennes(resultats, enquetes, annee, maintenant = new Date()) {
  const tous = listeResultats(resultats)
  const { enquetesTerminees } = proceduresTerminees(tous, enquetes, annee, maintenant)

  let totalT = 0; let nT = 0
  for (const e of enquetesTerminees) {
    const r = resultatDeLEnquete(tous, e.id)
    if (!r?.dateAudience || !e.dateDebut) continue
    const j = joursEntre(e.dateDebut, r.dateAudience)
    if (j == null || j < 0) continue
    totalT += j; nT++
  }

  const enCours = enquetes.filter((e) => e.statut === 'en_cours')
  let totalC = 0; let nC = 0
  for (const e of enCours) {
    if (!e.dateDebut) continue
    const j = joursEntre(e.dateDebut, maintenant)
    if (j == null || j < 0) continue
    totalC += j; nC++
  }

  return {
    termineesJours: nT > 0 ? Math.round(totalT / nT) : 0,
    nbTerminees: nT,
    enCoursJours: nC > 0 ? Math.round(totalC / nC) : 0,
    nbEnCours: enCours.length,
  }
}

/**
 * Carte « Évolution des déférements » : défèrements comptés à leur date RÉELLE
 * (dateDefere, à défaut date d'audience), toutes enquêtes confondues — y
 * compris en attente d'audience, OI et classements.
 */
export function deferementsAnnee(resultats, annee, options = {}) {
  const { maintenant = new Date(), enquetes = [] } = options
  const mois = moisAffiches(annee, maintenant)
  const parMois = serieMois(mois)
  // Détail nominatif par mois : alimente l'infobulle de la courbe à l'écran et
  // la liste datée du connecteur.
  const detailParMois = Object.fromEntries(mois.map((m) => [m, []]))
  let total = 0

  const etiquette = (r) => {
    const e = enquetes.find((x) => x.id === r.enqueteId)
    return e?.numero || r.numeroAudience || `#${r.enqueteId}`
  }
  const noter = (m, label) => { if (m != null && m in detailParMois) detailParMois[m].push(label) }

  for (const r of listeResultats(resultats)) {
    if (!r) continue
    if (r.nombreDeferes && r.dateDefere) {
      if (anneeDe(r.dateDefere) !== annee) continue
      const n = Number(r.nombreDeferes) || 0
      total += n
      const m = moisDe(r.dateDefere)
      if (m != null && m in parMois) parMois[m] += n
      for (let i = 0; i < n; i++) noter(m, etiquette(r))
      continue
    }
    for (const c of r.condamnations || []) {
      if (!c?.defere) continue
      const ref = c.dateDefere || r.dateAudience
      if (anneeDe(ref) !== annee) continue
      total++
      const m = moisDe(ref)
      if (m != null && m in parMois) parMois[m]++
      noter(m, c.nom ? `${etiquette(r)} (${c.nom})` : etiquette(r))
    }
  }

  return { total, parMois, detailParMois }
}

/**
 * Carte « Suivi parquet extérieur » : enquêtes signalées JIRS / PG actives
 * pendant l'année (créées au plus tard dans l'année, encore en cours ou
 * clôturées dans l'année).
 */
export function suiviParquetExterieur(resultats, enquetes, annee) {
  const tous = listeResultats(resultats)
  const aTag = (e, v) => (e.tags || []).some((t) => t.category === 'suivi' && t.value === v)

  const pertinentes = enquetes.filter((e) => {
    if ((anneeDe(e.dateCreation) || 0) > annee) return false
    if (e.statut === 'en_cours' || e.statut === 'instruction') return true
    if (e.statut === 'archive') {
      const r = resultatDeLEnquete(tous, e.id)
      if (r?.dateAudience) return anneeDe(r.dateAudience) === annee
      return anneeDe(e.dateMiseAJour) === annee
    }
    return false
  })

  const jirs = pertinentes.filter((e) => aTag(e, 'JIRS'))
  const pg = pertinentes.filter((e) => aTag(e, 'PG'))
  const lesDeux = pertinentes.filter((e) => aTag(e, 'JIRS') && aTag(e, 'PG'))

  return {
    total: new Set([...jirs, ...pg].map((e) => e.id)).size,
    jirs,
    pg,
    lesDeux,
  }
}

/** Carte « Nombre d'enquêtes en cours » : ouvertures de l'année (flux entrant). */
export function ouverturesAnnee(enquetes, annee, maintenant = new Date()) {
  const ouvertes = enquetes.filter((e) => anneeDe(e.dateCreation) === annee)
  const parMois = serieMois(moisAffiches(annee, maintenant))
  for (const e of ouvertes) {
    const m = moisDe(e.dateCreation)
    if (m != null && m in parMois) parMois[m]++
  }
  return { total: ouvertes.length, parMois, liste: ouvertes }
}

/**
 * Carte « Actes d'enquête en préliminaire » : actes et prolongations rattachés
 * à leur date réelle, plus l'estimation de charge affichée (35 min par acte).
 */
export function actesAnnee(enquetes, annee, maintenant = new Date()) {
  const base = computeActeStatsCore(enquetes, { year: annee })
  const MINUTES_PAR_ACTE = 35
  const minutes = base.totalAvecProlongations * MINUTES_PAR_ACTE

  const debut = new Date(annee, 0, 1)
  const fin = annee === maintenant.getFullYear() ? maintenant : new Date(annee, 11, 31)
  const semaines = Math.max(1, Math.ceil((fin.getTime() - debut.getTime()) / (7 * 24 * 60 * 60 * 1000)))
  const nbMois = annee === maintenant.getFullYear() ? maintenant.getMonth() + 1 : 12

  return {
    ...base,
    minutesParActe: MINUTES_PAR_ACTE,
    tempsEstimeMinutes: minutes,
    tempsEstimeHeures: Math.floor(minutes / 60),
    tempsEstimeMinutesRestantes: minutes % 60,
    moyenneParEnqueteConcernee: arrondi1(base.totalAvecProlongations / (base.enquetesAvecActes || 1)),
    moyenneActesParSemaine: arrondi1(base.totalAvecProlongations / semaines),
    moyenneActesParMois: arrondi1(base.totalAvecProlongations / nbMois),
    moyenneTempsParSemaineHeures: arrondi1((minutes / semaines) / 60),
    moyenneTempsParMoisHeures: arrondi1((minutes / nbMois) / 60),
  }
}

/**
 * Statistiques d'audience de l'année — miroir de `getYearlyStats` : résultats
 * datés dans l'année ; les résultats standards exigent une enquête ARCHIVÉE,
 * les directs / classements / OI sont pris tels quels.
 */
export function statsAudienceAnnee(resultats, enquetes, annee) {
  const valides = listeResultats(resultats).filter((r) => {
    if (!r?.dateAudience) return false
    if (r.isDirectResult || r.isClassement || r.isOI) return anneeDe(r.dateAudience) === annee
    const e = enquetes.find((x) => x.id === r.enqueteId)
    if (!e || e.statut !== 'archive') return false
    return anneeDe(r.dateAudience) === annee
  })
  return calculateAudienceStats(valides, enquetes)
}

/** Idem, borné à un mois (miroir de `getMonthlyStats`). */
export function statsAudienceMois(resultats, enquetes, annee, mois) {
  const valides = listeResultats(resultats).filter((r) => {
    if (!r?.dateAudience) return false
    const okDate = anneeDe(r.dateAudience) === annee && moisDe(r.dateAudience) === mois
    if (r.isDirectResult || r.isClassement || r.isOI) return okDate
    const e = enquetes.find((x) => x.id === r.enqueteId)
    if (!e || e.statut !== 'archive') return false
    return okDate
  })
  return calculateAudienceStats(valides, enquetes)
}

/** Total des orientations (dénominateur des pourcentages des cartes). */
export const totalOrientations = (s) => (s?.nombreCRPC || 0) + (s?.nombreCI || 0)
  + (s?.nombreCOPJ || 0) + (s?.nombreOI || 0) + (s?.nombreCDD || 0) + (s?.nombreClassements || 0)

/** Carte « Comparatif N-1 / N » de la page Statistiques générales. */
export function comparatifAnneePrecedente(resultats, enquetes, annee, maintenant = new Date()) {
  const precedente = annee - 1
  const now = proceduresTerminees(resultats, enquetes, annee, maintenant)
  const avant = proceduresTerminees(resultats, enquetes, precedente, maintenant)
  const sNow = statsAudienceAnnee(resultats, enquetes, annee)
  const sAvant = statsAudienceAnnee(resultats, enquetes, precedente)
  const defNow = deferementsAnnee(resultats, annee, { maintenant }).total
  const defAvant = deferementsAnnee(resultats, precedente, { maintenant }).total

  const ligne = (av, ap) => ({ anneePrecedente: av, annee: ap, evolution: ap - av })

  return {
    anneePrecedente: precedente,
    proceduresTerminees: ligne(avant.total, now.total),
    condamnations: ligne(sAvant?.nombreCondamnations || 0, sNow?.nombreCondamnations || 0),
    prisonFermeMois: ligne(sAvant?.totalPeinePrison || 0, sNow?.totalPeinePrison || 0),
    amendes: ligne(sAvant?.montantTotalAmendes || 0, sNow?.montantTotalAmendes || 0),
    deferements: ligne(defAvant, defNow),
    donneesAnneePrecedente: avant.total > 0 || (sAvant?.nombreCondamnations || 0) > 0,
  }
}

/**
 * Cartes « Répartition globale par service » et « … des enquêtes terminées ».
 * `servicesDe(enquete)` → liste des services (tags de catégorie `services`).
 * Population « globale » = enquêtes CRÉÉES dans l'année ∪ enquêtes JUGÉES dans
 * l'année (dédupliquées), plus les procédures directes de l'année.
 */
export function repartitionServices(resultats, enquetes, annee, servicesDe, maintenant = new Date()) {
  const tous = listeResultats(resultats)
  const { enquetesTerminees, directes } = proceduresTerminees(tous, enquetes, annee, maintenant)
  const ouvertes = enquetes.filter((e) => anneeDe(e.dateCreation) === annee)

  const compter = (liste, avecDirectes) => {
    const acc = {}
    const vues = new Set()
    for (const e of liste) {
      if (vues.has(e.id)) continue
      vues.add(e.id)
      for (const s of servicesDe(e) || []) if (s) acc[s] = (acc[s] || 0) + 1
    }
    if (avecDirectes) for (const r of directes) if (r.service) acc[r.service] = (acc[r.service] || 0) + 1
    return Object.entries(acc).sort((a, b) => b[1] - a[1]).map(([service, count]) => ({ service, count }))
  }

  return {
    global: compter([...ouvertes, ...enquetesTerminees], true),
    terminees: compter(enquetesTerminees, true),
  }
}

/**
 * Carte « Delta saisies vs confiscations » : poste par poste, ce que les
 * services ont saisi pendant l'enquête et ce que le tribunal a confisqué.
 * Delta positif = saisi non confisqué.
 */
export function deltaSaisiesConfiscations(stats) {
  if (!stats) return null
  const postes = [
    { poste: 'Véhicules', saisi: stats.totalSaisiesVehicules || 0, confisque: stats.totalVehicules || 0, montant: false },
    { poste: 'Immeubles', saisi: stats.totalSaisiesImmeubles || 0, confisque: stats.totalImmeubles || 0, montant: false },
    { poste: 'Numéraire', saisi: stats.totalSaisiesNumeraire || 0, confisque: stats.totalNumeraire || 0, montant: true },
    { poste: 'Bancaire', saisi: stats.totalSaisiesBancaire || 0, confisque: stats.totalBancaire || 0, montant: true },
    { poste: 'Crypto', saisi: stats.totalSaisiesCrypto || 0, confisque: stats.totalCrypto || 0, montant: true },
    { poste: 'Objets mobiliers', saisi: stats.totalSaisiesObjets || 0, confisque: stats.totalObjets || 0, montant: false },
  ].map((l) => ({ ...l, delta: l.saisi - l.confisque }))

  const avoirsSaisis = (stats.totalSaisiesNumeraire || 0) + (stats.totalSaisiesBancaire || 0) + (stats.totalSaisiesCrypto || 0)
  const avoirsConfisques = (stats.totalNumeraire || 0) + (stats.totalBancaire || 0) + (stats.totalCrypto || 0)

  return {
    lignes: postes.filter((l) => l.saisi > 0 || l.confisque > 0),
    totalAvoirs: { saisi: avoirsSaisis, confisque: avoirsConfisques, delta: avoirsSaisis - avoirsConfisques },
    aDesDonnees: postes.some((l) => l.saisi > 0 || l.confisque > 0),
  }
}

/**
 * Sélecteur de résultats : soit une ANNÉE civile (l'écran), soit un prédicat
 * (r) => boolean — c'est ainsi que le bilan par période libre du connecteur
 * (`stats_synthese`) réutilise les mêmes cartes sur sa propre fenêtre.
 */
export function selecteurResultats(selecteur) {
  if (typeof selecteur === 'function') return selecteur
  return (r) => anneeDe(r?.dateAudience) === selecteur
}

export const TYPES_AUDIENCE = ['CRPC-Def', 'CI', 'COPJ', 'CDD']

/**
 * Carte « Peines moyennes par type d'audience » : sur les condamnations de
 * l'année, ventilées ferme pur / sursis probatoire pur / mixte.
 */
export function peinesParTypeAudience(resultats, selecteur, types = TYPES_AUDIENCE) {
  const dans = selecteurResultats(selecteur)
  const condamnations = listeResultats(resultats)
    .filter((r) => r?.dateAudience && dans(r))
    .flatMap((r) => r.condamnations || [])
    .filter(Boolean)

  const moyenne = (liste, valeur) => (liste.length > 0
    ? liste.reduce((acc, c) => acc + (Number(valeur(c)) || 0), 0) / liste.length : 0)

  return types.map((type) => {
    // Forme de retour TOUJOURS complète (les types sans condamnation sont
    // filtrés en sortie) : l'écran et le connecteur lisent les mêmes champs.
    const duType = condamnations.filter((c) => c.typeAudience === type)
    const fermePur = duType.filter((c) => c.peinePrison > 0
      && (!c.sursisProbatoire || c.sursisProbatoire === 0) && (!c.sursisSimple || c.sursisSimple === 0))
    const probatoirePur = duType.filter((c) => (!c.peinePrison || c.peinePrison === 0) && c.sursisProbatoire > 0)
    const mixtes = duType.filter((c) => c.peinePrison > 0 && (c.sursisProbatoire > 0 || c.sursisSimple > 0))

    const mixteFerme = moyenne(mixtes, (c) => c.peinePrison)
    const mixteSursis = moyenne(mixtes, (c) => (Number(c.sursisProbatoire) || 0) + (Number(c.sursisSimple) || 0))

    return {
      type,
      total: duType.length,
      fermePur: { nombre: fermePur.length, moyenneMois: arrondi1(moyenne(fermePur, (c) => c.peinePrison)) },
      probatoirePur: { nombre: probatoirePur.length, moyenneMois: arrondi1(moyenne(probatoirePur, (c) => c.sursisProbatoire)) },
      mixte: {
        nombre: mixtes.length,
        moyenneTotaleMois: arrondi1(mixteFerme + mixteSursis),
        dontSursisMois: arrondi1(mixteSursis),
      },
    }
  }).filter((x) => x.total > 0)
}

/**
 * Cartes « Classements sans suite » et « Ouvertures d'information » : nombre,
 * part des orientations, âge moyen des dossiers à la décision, répartition par
 * type de fait et ventilation mensuelle.
 *
 * `drapeau` vaut 'isClassement' ou 'isOI'. `infractionsDe(enquete)` renvoie les
 * infractions canoniques de l'enquête ({ code?, label }) — résolution NATINF
 * injectée par l'appelant (hook côté écran, référentiel côté serveur).
 */
export function orientationDetail(resultats, enquetes, selecteur, drapeau, infractionsDe, options = {}) {
  const { maintenant = new Date(), avecParMois = true, statsFenetre } = options
  const dans = selecteurResultats(selecteur)
  const tous = listeResultats(resultats)
  // Dénominateur des pourcentages : les orientations de la MÊME fenêtre
  // (l'appelant peut fournir ses stats déjà calculées).
  const stats = statsFenetre !== undefined ? statsFenetre
    : statsAudienceAnnee(tous, enquetes, selecteur)
  const nombre = drapeau === 'isClassement' ? (stats?.nombreClassements || 0) : (stats?.nombreOI || 0)
  const total = totalOrientations(stats)

  const concernes = tous.filter((r) => r?.[drapeau] && r.dateAudience && dans(r))

  let totalAge = 0; let nbAge = 0
  const comptes = {}
  const libelles = {}
  for (const r of concernes) {
    const e = enquetes.find((x) => x.id === r.enqueteId)
    if (!e) continue
    const age = joursEntre(e.dateDebut, r.dateAudience)
    if (age != null && age >= 0) { totalAge += age; nbAge++ }
    for (const inf of infractionsDe(e) || []) {
      const cle = inf.code ?? inf.label
      if (!cle) continue
      comptes[cle] = (comptes[cle] || 0) + 1
      // Item représentatif (on préfère celui qui porte un code) : sert à
      // l'écran pour la pastille NATINF, au connecteur pour le libellé.
      if (!libelles[cle] || (!libelles[cle].code && inf.code)) libelles[cle] = inf
    }
  }
  const totalInfractions = Object.values(comptes).reduce((a, b) => a + b, 0)

  // Ventilation mensuelle : l'écran la tient déjà de son état `monthlyStats`
  // et passe avecParMois=false pour ne pas la recalculer à chaque rendu.
  const parMois = serieMois(moisAffiches(typeof selecteur === 'number' ? selecteur : 0, maintenant))
  if (avecParMois && typeof selecteur === 'number') {
    for (const m of Object.keys(parMois)) {
      const s = statsAudienceMois(tous, enquetes, selecteur, Number(m))
      parMois[m] = drapeau === 'isClassement' ? (s?.nombreClassements || 0) : (s?.nombreOI || 0)
    }
  }

  return {
    nombre,
    partDesOrientationsPct: total > 0 ? Math.round((nombre / total) * 1000) / 10 : 0,
    ageMoyenJours: nbAge > 0 ? Math.round(totalAge / nbAge) : 0,
    dossiersAvecAge: nbAge,
    repartitionParTypeDeFait: Object.entries(comptes)
      .sort((a, b) => b[1] - a[1])
      .map(([cle, count]) => ({
        cle,
        infraction: libelles[cle]?.label || cle,
        natinf: libelles[cle]?.code,
        rep: libelles[cle],
        count,
        partPct: totalInfractions > 0 ? Math.round((count / totalInfractions) * 1000) / 10 : 0,
      })),
    parMois,
  }
}

/** Clés canoniques d'infraction d'un RÉSULTAT d'audience (miroir de `resultInfractionKeys`). */
export function clesInfractionResultat(r) {
  if (r?.infractionNatinfCodes?.length) return r.infractionNatinfCodes
  if (r?.typesInfraction?.length) return r.typesInfraction
  return r?.typeInfraction ? [r.typeInfraction] : []
}

/**
 * Carte « Interdictions de gérer » : ratio interdictions / condamnations de
 * l'année, avec le détail par infraction (hors OI, classements et audiences en
 * attente). `libelleDe(cle)` résout un code NATINF en libellé.
 */
export function interdictionsGererParInfraction(resultats, selecteur, libelleDe = (k) => k, filtreCles = []) {
  const dans = selecteurResultats(selecteur)
  const concernes = listeResultats(resultats).filter((r) => r?.dateAudience
    && dans(r) && !r.isOI && !r.isClassement && !r.isAudiencePending)

  // Le filtre par infraction de la carte (vide = toutes) porte sur le RATIO,
  // pas sur le détail listé dessous.
  const filtres = filtreCles.length > 0
    ? concernes.filter((r) => clesInfractionResultat(r).some((k) => filtreCles.includes(k)))
    : concernes

  const totalCondamnations = filtres.reduce((n, r) => n + (r.condamnations || []).length, 0)
  const totalGerer = filtres.reduce((n, r) => n + (r.condamnations || []).filter((c) => c.interdictionGerer).length, 0)

  const acc = {}
  for (const r of concernes) {
    const cles = clesInfractionResultat(r)
    for (const cle of cles.length > 0 ? cles : ['Non renseigné']) {
      if (!acc[cle]) acc[cle] = { total: 0, gerer: 0 }
      acc[cle].total += (r.condamnations || []).length
      acc[cle].gerer += (r.condamnations || []).filter((c) => c.interdictionGerer).length
    }
  }

  return {
    total: totalGerer,
    condamnations: totalCondamnations,
    ratioPct: totalCondamnations > 0 ? Math.round((totalGerer / totalCondamnations) * 1000) / 10 : 0,
    clesDisponibles: [...new Set(concernes.flatMap(clesInfractionResultat))],
    detail: Object.entries(acc)
      .filter(([, v]) => v.gerer > 0)
      .sort(([, a], [, b]) => b.gerer - a.gerer)
      .map(([cle, v]) => ({
        infraction: libelleDe(cle),
        natinf: /^\d+$/.test(String(cle)) ? String(cle) : undefined,
        interdictions: v.gerer,
        condamnations: v.total,
        partPct: v.total > 0 ? Math.round((v.gerer / v.total) * 1000) / 10 : 0,
      })),
  }
}

/**
 * Détail « Interdictions de paraître » (popup de la carte Interdictions) :
 * les condamnés concernés, groupés par type d'infraction du dossier.
 *
 * @returns {{ typeInfraction: string, nombre: number, personnes: { nom: string,
 *   lieu?: string, dureeMois?: number, dossier: string, dateAudience: string }[] }[]}
 */
export function interdictionsParaitreDetail(resultats, enquetes, selecteur, libelleDe = (k) => k) {
  const dans = selecteurResultats(selecteur)
  const groupes = {}
  for (const r of listeResultats(resultats)) {
    if (!r?.dateAudience || !dans(r)) continue
    const e = enquetes.find((x) => x.id === r.enqueteId)
    const dossier = e?.numero || r.numeroAudience || `#${r.enqueteId}`
    const code = r.infractionNatinfCodes?.[0]
    const type = (code ? libelleDe(code) : undefined) || r.typeInfraction || 'Non renseigné'
    for (const c of r.condamnations || []) {
      if (!c?.interdictionParaitre) continue
      ;(groupes[type] = groupes[type] || []).push({
        nom: c.nom || 'Inconnu',
        lieu: c.lieuInterdictionParaitre,
        dureeMois: c.dureeInterdictionParaitre,
        dossier,
        dateAudience: r.dateAudience,
      })
    }
  }
  return Object.entries(groupes)
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([typeInfraction, personnes]) => ({ typeInfraction, nombre: personnes.length, personnes }))
}

// ── Types d'infractions (onglet « Types d'infractions ») ──

/** Enquêtes en cours retenues par l'onglet : créées au plus tard dans l'année. */
export const enquetesEnCoursPourInfractions = (enquetes, annee) =>
  enquetes.filter((e) => e.statut === 'en_cours' && anneeDe(e.dateCreation) <= annee)

/** Enquêtes terminées retenues par l'onglet : jugées dans l'année, hors classements et OI. */
export function enquetesTermineesPourInfractions(resultats, enquetes, annee) {
  const tous = listeResultats(resultats)
  return enquetes.filter((e) => {
    if (e.statut !== 'archive') return false
    const r = resultatDeLEnquete(tous, e.id)
    if (!r?.dateAudience) return false
    if (r.isClassement || r.isOI) return false
    return anneeDe(r.dateAudience) === annee
  })
}

/**
 * Répartition par catégorie d'infraction, repliée par grand titre (taxonomie
 * Mémento parquet) — miroir de `NataffBreakdownCard` : une enquête compte UNE
 * fois par catégorie qu'elle touche, quel que soit le nombre de NATINF.
 *
 * `categorieDe(infraction)` → { category: { code, label }, grandTitre: { code, label } }
 * ou null si non classé.
 */
export function repartitionCategoriesInfraction(enquetes, infractionsDe, categorieDe) {
  const parGrandTitre = new Map()
  const parCategorie = new Map()
  const grandTitreDeCategorie = new Map()
  const libelles = new Map()
  const nonClasse = new Set()

  for (const e of enquetes) {
    for (const inf of infractionsDe(e) || []) {
      const res = categorieDe(inf)
      if (!res) {
        if (inf.label) nonClasse.add(e.id)
        continue
      }
      const gt = res.grandTitre
      const cat = res.category
      libelles.set(gt.code, gt.label)
      libelles.set(cat.code, cat.label)
      grandTitreDeCategorie.set(cat.code, gt.code)
      if (!parGrandTitre.has(gt.code)) parGrandTitre.set(gt.code, new Set())
      parGrandTitre.get(gt.code).add(e.id)
      if (!parCategorie.has(cat.code)) parCategorie.set(cat.code, new Set())
      parCategorie.get(cat.code).add(e.id)
    }
  }

  const groupes = [...parGrandTitre.entries()]
    .map(([code, ids]) => ({
      code,
      grandTitre: libelles.get(code) || code,
      total: ids.size,
      categories: [...parCategorie.entries()]
        .filter(([cat]) => grandTitreDeCategorie.get(cat) === code)
        .map(([cat, s]) => ({ code: cat, categorie: libelles.get(cat) || cat, count: s.size }))
        // Tri par volume, départagé par libellé : ordre stable et identique
        // à l'écran comme au connecteur.
        .sort((a, b) => b.count - a.count || a.categorie.localeCompare(b.categorie, 'fr')),
    }))
    .sort((a, b) => b.total - a.total || a.grandTitre.localeCompare(b.grandTitre, 'fr'))

  return { groupes, nonClasse: nonClasse.size }
}
