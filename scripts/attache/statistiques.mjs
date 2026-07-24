/**
 * SIRAL — Attaché de justice · statistiques du contentieux confié, par PÉRIODE.
 *
 * Le pendant serveur de la page Statistiques et du rapport PDF de l'app
 * (utils/audienceStats.ts, components/pdf/ExportPdfButton.tsx,
 * utils/generateStatsPdf.ts) — mêmes règles de calcul, mais sur une période
 * LIBRE (bilan semestriel, trimestriel, annuel…) et enrichi des LISTES de
 * dossiers qui fondent chaque chiffre : l'attaché peut identifier les
 * procédures terminées depuis le 1er janvier, les défèrements, les tendances
 * par catégorie d'infraction — puis plonger dans chaque dossier (lire_dossier).
 *
 * Sources : le coffre du contentieux (enquêtes + résultats d'audience — le
 * même SyncData que poussent les clients web) et le module instruction.
 * LECTURE SEULE, aucun jeton : tout est déterministe.
 *
 * LES RÈGLES DE CALCUL NE SONT PAS DUPLIQUÉES : ce module consomme les MÊMES
 * fonctions que l'écran et l'export PDF —
 *   lib/stats/audienceCore.mjs  (peines, orientations, saisies, durées),
 *   lib/stats/actesCore.mjs     (actes TSE et prolongations datées),
 *   lib/natinf/nataffRegles.mjs (catégories d'infraction, via nataff.mjs).
 * Il n'apporte que la fenêtre de PÉRIODE, les LISTES de dossiers et la mise
 * en forme du bilan.
 *
 * Conventions reprises de l'app :
 * - « Procédures terminées » = enquêtes archivées jugées dans la période
 *   (par leur date d'audience) + procédures directes (permanence), HORS
 *   classements sans suite et ouvertures d'information pour le chiffre-phare.
 * - Défèrements comptés à leur DATE RÉELLE (dateDefere, sinon date
 *   d'audience) — comme la courbe « Déférements par mois » du rapport PDF.
 * - Orientations : 1 par dossier (CI, OI, CDD, classement), 1 par prévenu
 *   pour les CRPC — comme calculateAudienceStats.
 */
import { loadContentieux } from './dossier.mjs'
import { attacheContentieux } from './store.mjs'
import { natinfEntry } from './natinf.mjs'
import { labelCategorie } from './nataff.mjs'
import { listInstructionDossiers } from './instru.mjs'
import { calculateAudienceStats } from '../../lib/stats/audienceCore.mjs'
import { computeActeStatsCore } from '../../lib/stats/actesCore.mjs'

// ── Dates ──

/** 'YYYY-MM-DD' d'une date quelconque, ou null. Comparaison lexicale sûre. */
export function isoDay(s) {
  const str = String(s || '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10)
  if (!str) return null
  const d = new Date(str)
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null
}

const inPeriod = (s, du, au) => {
  const d = isoDay(s)
  return Boolean(d && d >= du && d <= au)
}

const moisKey = (s) => {
  const d = isoDay(s)
  return d ? d.slice(0, 7) : null
}

/** Mois calendaires ['2026-01', …] couverts par la période (bornes incluses). */
export function moisDePeriode(du, au) {
  const out = []
  let [y, m] = [Number(du.slice(0, 4)), Number(du.slice(5, 7))]
  const fin = au.slice(0, 7)
  while (out.length < 60) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    out.push(key)
    if (key >= fin) break
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** Libellé d'un mois '2026-01' → 'janvier' (année ajoutée si la période en couvre plusieurs). */
export function labelMois(key, avecAnnee = false) {
  const m = MOIS_FR[Number(key.slice(5, 7)) - 1] || key
  return avecAnnee ? `${m} ${key.slice(0, 4)}` : m
}

/** Même date un an plus tôt (borne 29 février ramenée au 28). */
export function unAnAvant(jour) {
  const y = Number(jour.slice(0, 4)) - 1
  const mmdd = jour.slice(5) === '02-29' ? '02-28' : jour.slice(5)
  return `${y}-${mmdd}`
}

function joursEntre(debut, fin) {
  const a = new Date(isoDay(debut)); const b = new Date(isoDay(fin))
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return null
  const j = Math.floor((b.getTime() - a.getTime()) / 86_400_000)
  return j >= 0 ? j : null
}

// ── Données du contentieux ──

/**
 * Enquêtes + résultats d'audience du contentieux confié — même périmètre que
 * l'écran : résultats du contentieux courant dont l'enquête existe encore,
 * plus les procédures directes (permanence).
 */
function donnees(keys) {
  const { data } = loadContentieux(keys)
  const enquetes = data.enquetes || []
  const ctx = attacheContentieux()
  const ids = new Set(enquetes.map((e) => e.id))
  const resultats = Object.values(data.audienceResultats || {}).filter((r) =>
    r && (r.contentieuxId || 'crimorg') === ctx
    && (r.isDirectResult === true || ids.has(r.enqueteId)))
  return { enquetes, resultats, customTags: data.customTags || [] }
}

const resultatDe = (resultats, enqueteId) => resultats.find((r) => r.enqueteId === enqueteId && !r.isDirectResult)

// ── Infractions d'une enquête → catégories (miroir useInfractionNatinf + nataff) ──

function categoriesEnquete(e, customTags) {
  const cats = new Set()
  const codes = Array.isArray(e.infractionNatinfCodes) ? e.infractionNatinfCodes : []
  if (codes.length > 0) {
    for (const code of codes) {
      const entry = natinfEntry(code)
      cats.add(labelCategorie(entry || { code: String(code), libelle: `NATINF ${code}`, theme: undefined }))
    }
    return [...cats]
  }
  // Dossiers non migrés : tags d'infraction, résolus via leur rattachement NATINF
  for (const t of e.tags || []) {
    if (t.category !== 'infractions') continue
    const def = customTags.find((d) => d.category === 'infractions' && d.value === t.value)
    const code = def?.natinfCodes?.[0]
    const entry = code ? natinfEntry(code) : null
    cats.add(labelCategorie(entry || { code: code || '', libelle: t.value, theme: undefined }))
  }
  return [...cats]
}

const servicesEnquete = (e) => (e.tags || []).filter((t) => t.category === 'services').map((t) => t.value).filter(Boolean)

// ── Défèrements (miroir « Déférements par mois » du rapport PDF) ──

function deferementsDuResultat(r, du, au) {
  const out = []
  if (r.nombreDeferes && r.dateDefere) {
    if (inPeriod(r.dateDefere, du, au)) out.push({ date: isoDay(r.dateDefere), nombre: Number(r.nombreDeferes) || 0 })
  } else {
    for (const c of r.condamnations || []) {
      if (!c?.defere) continue
      const date = c.dateDefere || r.dateAudience
      if (inPeriod(date, du, au)) out.push({ date: isoDay(date), nombre: 1, nom: c.nom || undefined })
    }
  }
  return out.filter((d) => d.nombre > 0)
}

// ── Agrégats d'audience sur période — le CŒUR PARTAGÉ fait le calcul ──

/**
 * Applique calculateAudienceStats (lib/stats/audienceCore.mjs — le même code
 * que la page Statistiques) aux résultats de la période, puis remet le
 * résultat en forme pour le bilan. Même périmètre que getYearlyStats :
 * résultats datés dans la fenêtre ; les résultats standards exigent une
 * enquête ARCHIVÉE.
 */
function statsAudience(resultats, enquetes, du, au) {
  const valides = resultats.filter((r) => {
    if (!r.dateAudience || !inPeriod(r.dateAudience, du, au)) return false
    if (r.isDirectResult || r.isClassement || r.isOI) return true
    const e = enquetes.find((x) => x.id === r.enqueteId)
    return Boolean(e && e.statut === 'archive')
  })

  const core = calculateAudienceStats(valides, enquetes)

  const peinesParInfraction = {}
  for (const [infrKey, p] of Object.entries(core?.peinesParInfraction || {})) {
    const entry = /^\d+$/.test(String(infrKey)) ? natinfEntry(infrKey) : null
    peinesParInfraction[infrKey] = {
      libelle: entry?.libelle || String(infrKey),
      categorie: labelCategorie(entry || { code: '', libelle: String(infrKey), theme: undefined }),
      ...p,
    }
  }

  return {
    nombreAudiences: core?.nombreAudiences || 0,
    nombreCondamnations: core?.nombreCondamnations || 0,
    orientations: {
      crpc: core?.nombreCRPC || 0,
      ci: core?.nombreCI || 0,
      copj: core?.nombreCOPJ || 0,
      oi: core?.nombreOI || 0,
      cdd: core?.nombreCDD || 0,
      classements: core?.nombreClassements || 0,
      note: '1 par dossier (CI, OI, CDD, classement) ; 1 par prévenu pour les CRPC — comme la page Statistiques.',
    },
    deferementsDossiersJuges: core?.nombreDeferements || 0,
    peines: {
      fermes: { nombre: core?.nombrePeinesFermes || 0, moyenneMois: core?.moyennePrison || 0 },
      probation: { nombre: core?.nombrePeinesProbation || 0, moyenneMois: core?.moyenneProbation || 0 },
      sursisSimple: { nombre: core?.nombrePeinesSimple || 0, moyenneMois: core?.moyenneSimple || 0 },
      mixtesFermeProbation: { nombre: core?.nombrePeinesMixtesProbation || 0, moyenneMois: core?.moyenneMixtesProbation || '' },
      mixtesFermeSimple: { nombre: core?.nombrePeinesMixtesSimple || 0, moyenneMois: core?.moyenneMixtesSimple || '' },
      totalPrisonFermeMois: core?.totalPeinePrison || 0,
      montantTotalAmendes: core?.montantTotalAmendes || 0,
      interdictionsParaitre: core?.totalInterdictionsParaitre || 0,
      interdictionsGerer: core?.totalInterdictionsGerer || 0,
    },
    peinesParInfraction,
    saisiesEnquete: {
      vehicules: core?.totalSaisiesVehicules || 0,
      immeubles: core?.totalSaisiesImmeubles || 0,
      numeraire: core?.totalSaisiesNumeraire || 0,
      bancaire: core?.totalSaisiesBancaire || 0,
      crypto: core?.totalSaisiesCrypto || 0,
      objets: core?.totalSaisiesObjets || 0,
      total: core?.totalSaisiesArgent || 0,
    },
    confiscationsAudience: {
      vehicules: core?.totalVehicules || 0,
      immeubles: core?.totalImmeubles || 0,
      numeraire: core?.totalNumeraire || 0,
      bancaire: core?.totalBancaire || 0,
      crypto: core?.totalCrypto || 0,
      objets: core?.totalObjets || 0,
      stupefiants: core?.totalStupefiants || 0,
      total: core?.totalArgent || 0,
    },
    remisesVentesAvantJugement: {
      remises: core?.nombreRemisesAvantJugement || 0,
      ventes: core?.nombreVentesAvantJugement || 0,
    },
    dureeMoyenneEnqueteJours: core?.dureeMoyenneEnquete || 0,
  }
}

// ── Bilan complet ──

/** Valide et normalise la période. Défaut : du 1er janvier de l'année en cours à aujourd'hui. */
export function periodeNormalisee(du, au) {
  const today = new Date().toISOString().slice(0, 10)
  const d = isoDay(du) || `${today.slice(0, 4)}-01-01`
  const a = isoDay(au) || today
  if (d > a) throw new Error(`Période invalide : du ${d} au ${a}`)
  if (moisDePeriode(d, a).length > 60) throw new Error('Période trop longue (max 5 ans)')
  return { du: d, au: a }
}

/**
 * Le bilan chiffré complet de la période : procédures terminées (avec la
 * LISTE des dossiers), défèrements (liste datée), ouvertures, orientations,
 * peines, saisies/confiscations, actes TSE, répartitions par service et par
 * catégorie d'infraction, tendance mensuelle des catégories, suivi JIRS/PG,
 * photographie du module instruction, et comparatif avec la même période un
 * an plus tôt.
 */
export function bilanStatistiques(keys, { du: duBrut, au: auBrut } = {}) {
  const { du, au } = periodeNormalisee(duBrut, auBrut)
  const { enquetes, resultats, customTags } = donnees(keys)
  const mois = moisDePeriode(du, au)
  const zeroParMois = () => Object.fromEntries(mois.map((m) => [m, 0]))

  // ── Procédures terminées (enquêtes archivées jugées dans la période + directes)
  const terminees = []
  for (const e of enquetes) {
    if (e.statut !== 'archive') continue
    const r = resultatDe(resultats, e.id)
    if (!r?.dateAudience || !inPeriod(r.dateAudience, du, au)) continue
    const defs = deferementsDuResultat(r, '0000-01-01', '9999-12-31')
    terminees.push({
      numero: e.numero,
      dateAudience: isoDay(r.dateAudience),
      orientation: r.isClassement ? 'classement sans suite' : r.isOI ? "ouverture d'information"
        : r.isAudiencePending ? 'en attente d\'audience'
          : [...new Set((r.condamnations || []).map((c) => c?.typeAudience).filter(Boolean))].join(' + ') || 'jugée',
      classementOuOI: Boolean(r.isClassement || r.isOI),
      condamnations: (r.condamnations || []).length || undefined,
      deferes: defs.reduce((n, d) => n + d.nombre, 0) || undefined,
      services: servicesEnquete(e),
      categories: categoriesEnquete(e, customTags),
      natinf: (e.infractionNatinfCodes || []).slice(0, 8),
      dureeJours: e.dateDebut ? joursEntre(e.dateDebut, r.dateAudience) : null,
    })
  }
  const directes = resultats.filter((r) => r.isDirectResult && r.dateAudience && inPeriod(r.dateAudience, du, au))
    .map((r) => {
      // Catégories via la même taxonomie que les enquêtes : codes NATINF du
      // résultat s'ils existent, sinon le libellé d'infraction saisi.
      const cats = new Set()
      for (const code of r.infractionNatinfCodes || []) {
        cats.add(labelCategorie(natinfEntry(code) || { code: String(code), libelle: `NATINF ${code}`, theme: undefined }))
      }
      const libelles = r.typesInfraction?.length ? r.typesInfraction : (r.typeInfraction ? [r.typeInfraction] : [])
      if (!cats.size) for (const lib of libelles) cats.add(labelCategorie({ code: '', libelle: lib, theme: undefined }))
      return {
        numero: null,
        procedureDirecte: true,
        dateAudience: isoDay(r.dateAudience),
        orientation: r.isClassement ? 'classement sans suite' : r.isOI ? "ouverture d'information"
          : [...new Set((r.condamnations || []).map((c) => c?.typeAudience).filter(Boolean))].join(' + ') || 'jugée',
        classementOuOI: Boolean(r.isClassement || r.isOI),
        condamnations: (r.condamnations || []).length || undefined,
        deferes: deferementsDuResultat(r, '0000-01-01', '9999-12-31').reduce((n, d) => n + d.nombre, 0) || undefined,
        services: r.service ? [r.service] : [],
        categories: [...cats],
        typeInfraction: r.typeInfraction || undefined,
      }
    })
  const toutesTerminees = [...terminees, ...directes].sort((a, b) => String(a.dateAudience).localeCompare(String(b.dateAudience)))
  const termineesHorsClOi = toutesTerminees.filter((t) => !t.classementOuOI && t.orientation !== 'en attente d\'audience')
  const termineesParMois = zeroParMois()
  for (const t of termineesHorsClOi) {
    const k = moisKey(t.dateAudience)
    if (k in termineesParMois) termineesParMois[k]++
  }

  // ── Défèrements à leur date réelle
  const defListe = []
  for (const r of resultats) {
    for (const d of deferementsDuResultat(r, du, au)) {
      const e = r.isDirectResult ? null : enquetes.find((x) => x.id === r.enqueteId)
      defListe.push({ date: d.date, nombre: d.nombre, numero: e?.numero || (r.isDirectResult ? '(procédure directe)' : `(enquête #${r.enqueteId})`) })
    }
  }
  defListe.sort((a, b) => a.date.localeCompare(b.date))
  const defParMois = zeroParMois()
  for (const d of defListe) {
    const k = moisKey(d.date)
    if (k in defParMois) defParMois[k] += d.nombre
  }

  // ── Ouvertures (flux) et stock en cours
  const ouvertes = enquetes.filter((e) => inPeriod(e.dateCreation, du, au))
  const ouverturesParMois = zeroParMois()
  for (const e of ouvertes) {
    const k = moisKey(e.dateCreation)
    if (k in ouverturesParMois) ouverturesParMois[k]++
  }
  const enCours = enquetes.filter((e) => e.statut === 'en_cours')
  const anciennetes = enCours.map((e) => joursEntre(e.dateDebut, new Date().toISOString())).filter((j) => j != null)

  // ── Audience (peines, orientations, avoirs) sur la période
  const audience = statsAudience(resultats, enquetes, du, au)

  // Déclinaison mensuelle (condamnations, prison ferme, amendes, orientations)
  // — le pendant du « monthlyData » du rapport PDF, borné à la période.
  const audienceParMois = Object.fromEntries(mois.map((m) => {
    const [y, mm] = [Number(m.slice(0, 4)), Number(m.slice(5, 7))]
    const dernierJour = new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10)
    const debut = `${m}-01` < du ? du : `${m}-01`
    const fin = dernierJour > au ? au : dernierJour
    const s = statsAudience(resultats, enquetes, debut, fin)
    return [m, {
      condamnations: s.nombreCondamnations,
      prisonFermeMois: s.peines.totalPrisonFermeMois,
      amendes: s.peines.montantTotalAmendes,
      orientations: s.orientations,
    }]
  }))

  // ── Répartitions
  const parService = {}
  for (const t of toutesTerminees) for (const svc of t.services || []) parService[svc] = (parService[svc] || 0) + 1

  const catTerminees = {}
  const dossiersParCategorie = {}
  const tendance = Object.fromEntries(mois.map((m) => [m, {}]))
  for (const t of termineesHorsClOi) {
    const cats = t.categories || []
    const k = moisKey(t.dateAudience)
    for (const c of cats) {
      catTerminees[c] = (catTerminees[c] || 0) + 1
      ;(dossiersParCategorie[c] = dossiersParCategorie[c] || []).push(t.numero || '(directe)')
      if (k in tendance) tendance[k][c] = (tendance[k][c] || 0) + 1
    }
  }
  const catEnCours = {}
  for (const e of enquetes) {
    if (e.statut !== 'en_cours' || !(isoDay(e.dateCreation) <= au)) continue
    for (const c of categoriesEnquete(e, customTags)) catEnCours[c] = (catEnCours[c] || 0) + 1
  }

  // ── Suivi parquet extérieur (JIRS / PG)
  const aTag = (e, v) => (e.tags || []).some((t) => t.category === 'suivi' && t.value === v)
  const suiviPertinent = enquetes.filter((e) => {
    if (!(isoDay(e.dateCreation) <= au)) return false
    if (e.statut === 'en_cours' || e.statut === 'instruction') return true
    if (e.statut === 'archive') {
      const r = resultatDe(resultats, e.id)
      if (r?.dateAudience) return inPeriod(r.dateAudience, du, au)
      return inPeriod(e.dateMiseAJour, du, au)
    }
    return false
  })
  const jirs = suiviPertinent.filter((e) => aTag(e, 'JIRS'))
  const pg = suiviPertinent.filter((e) => aTag(e, 'PG'))

  // ── Instruction (photographie du stock, indépendante de la période)
  let instruction = null
  try {
    const dossiers = listInstructionDossiers(keys)
    if (dossiers.length) {
      instruction = {
        nbDossiers: dossiers.length,
        misEnExamen: dossiers.reduce((n, d) => n + (d.mex || 0), 0),
        detenus: dossiers.reduce((n, d) => n + (d.detenus || 0), 0),
        dmlEnAttente: dossiers.reduce((n, d) => n + (d.dmlEnAttente?.length || 0), 0),
        debatsJldAVenir: dossiers.reduce((n, d) => n + (d.debatsAVenir?.length || 0), 0),
        note: 'Photographie du stock actuel — les dossiers suivis à l\'instruction se détaillent avec instru_lister / lire_dossier.',
      }
    }
  } catch { /* module instruction absent : section omise */ }

  // ── Comparatif : même période un an plus tôt
  const duPrec = unAnAvant(du); const auPrec = unAnAvant(au)
  const audiencePrec = statsAudience(resultats, enquetes, duPrec, auPrec)
  const termineesPrec = enquetes.filter((e) => {
    if (e.statut !== 'archive') return false
    const r = resultatDe(resultats, e.id)
    return Boolean(r?.dateAudience && inPeriod(r.dateAudience, duPrec, auPrec) && !r.isClassement && !r.isOI && !r.isAudiencePending)
  }).length + resultats.filter((r) => r.isDirectResult && !r.isClassement && !r.isOI && r.dateAudience && inPeriod(r.dateAudience, duPrec, auPrec)).length
  const defPrec = resultats.reduce((n, r) => n + deferementsDuResultat(r, duPrec, auPrec).reduce((x, d) => x + d.nombre, 0), 0)

  const evolution = (avant, apres) => ({ periodePrecedente: avant, periode: apres, evolution: apres - avant })

  return {
    contentieux: attacheContentieux(),
    periode: { du, au, mois: mois.map((m) => ({ cle: m, libelle: labelMois(m, mois.length > 12) })) },
    proceduresTerminees: {
      total: termineesHorsClOi.length,
      note: 'Hors classements sans suite et ouvertures d\'information — même règle que la page Statistiques. La liste ci-dessous inclut TOUT (classements et OI signalés par classementOuOI).',
      parMois: termineesParMois,
      liste: toutesTerminees,
    },
    deferements: {
      total: defListe.reduce((n, d) => n + d.nombre, 0),
      note: 'Comptés à leur date réelle de défèrement (dateDefere, à défaut la date d\'audience), toutes enquêtes confondues — comme la courbe « Déférements par mois » du rapport PDF. Peut différer du « dont X défèrements » des dossiers jugés (deferementsDossiersJuges).',
      parMois: defParMois,
      liste: defListe,
    },
    ouvertures: {
      total: ouvertes.length,
      parMois: ouverturesParMois,
      liste: ouvertes.map((e) => ({ numero: e.numero, date: isoDay(e.dateCreation), statutActuel: e.statut, categories: categoriesEnquete(e, customTags) }))
        .sort((a, b) => String(a.date).localeCompare(String(b.date))),
    },
    stockEnCours: {
      total: enCours.length,
      ancienneteMoyenneJours: anciennetes.length ? Math.round(anciennetes.reduce((a, b) => a + b, 0) / anciennetes.length) : 0,
    },
    audience,
    audienceParMois,
    actesTse: {
      ...computeActeStatsCore(enquetes, { du, au }),
      note: 'Techniques spéciales d\'enquête (écoutes, géolocalisations, autres actes) rattachées à leur date réelle de début / de prolongation — mêmes règles que le tableau de bord (lib/stats/actesCore).',
    },
    repartitionServices: Object.entries(parService).sort((a, b) => b[1] - a[1]).map(([service, count]) => ({ service, count })),
    infractions: {
      terminees: Object.entries(catTerminees).sort((a, b) => b[1] - a[1]).map(([categorie, count]) => ({ categorie, count, dossiers: dossiersParCategorie[categorie] })),
      enCours: Object.entries(catEnCours).sort((a, b) => b[1] - a[1]).map(([categorie, count]) => ({ categorie, count })),
      tendanceParMois: tendance,
      note: 'Catégories du Mémento parquet (mêmes libellés que la page Statistiques) ; une enquête compte une fois par catégorie qu\'elle touche.',
    },
    suiviParquetExterieur: {
      total: new Set([...jirs, ...pg].map((e) => e.id)).size,
      jirs: jirs.length,
      pg: pg.length,
      lesDeux: suiviPertinent.filter((e) => aTag(e, 'JIRS') && aTag(e, 'PG')).length,
      dossiersJirs: jirs.map((e) => e.numero),
    },
    instruction,
    comparatifPeriodePrecedente: {
      periode: { du: duPrec, au: auPrec },
      proceduresTerminees: evolution(termineesPrec, termineesHorsClOi.length),
      condamnations: evolution(audiencePrec.nombreCondamnations, audience.nombreCondamnations),
      prisonFermeMois: evolution(audiencePrec.peines.totalPrisonFermeMois, audience.peines.totalPrisonFermeMois),
      amendes: evolution(audiencePrec.peines.montantTotalAmendes, audience.peines.montantTotalAmendes),
      deferements: evolution(defPrec, defListe.reduce((n, d) => n + d.nombre, 0)),
      avoirsSaisis: evolution(audiencePrec.saisiesEnquete.total, audience.saisiesEnquete.total),
    },
  }
}
