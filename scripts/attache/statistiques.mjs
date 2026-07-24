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
 * Conventions reprises de l'app (à conserver en miroir) :
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

// ── Confiscations / saisies (port de migrateConfiscations + accumulation) ──

function migrateConf(raw) {
  if (!raw) return { vehicules: [], immeubles: [], numeraire: 0, saisiesBancaires: [], cryptomonnaies: [], objetsMobiliers: [] }
  if (Array.isArray(raw.vehicules)) return raw
  return {
    vehicules: Array.from({ length: raw.vehicules || 0 }, () => ({})),
    immeubles: Array.from({ length: raw.immeubles || 0 }, () => ({})),
    numeraire: raw.argentTotal || 0,
    saisiesBancaires: [], cryptomonnaies: [], objetsMobiliers: [],
  }
}

function accumulerAvoirs(cible, raw) {
  if (!raw) return
  const c = migrateConf(raw)
  cible.vehicules += c.vehicules.length
  cible.immeubles += c.immeubles.length
  cible.numeraire += c.numeraire || 0
  const bancaire = (c.saisiesBancaires || []).reduce((s, b) => s + (b.montant || 0), 0)
  cible.bancaire += bancaire
  const crypto = (c.cryptomonnaies || []).reduce((s, x) => s + (x.montantEur || 0), 0)
  cible.crypto += crypto
  cible.total += (c.numeraire || 0) + bancaire + crypto
  cible.objets += (c.objetsMobiliers || []).reduce((s, o) => s + (o.quantite || 1), 0)
  if (c.stupefiants?.types?.length) cible.stupefiants += 1
}

const avoirsVides = () => ({ vehicules: 0, immeubles: 0, numeraire: 0, bancaire: 0, crypto: 0, total: 0, objets: 0, stupefiants: 0 })

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

// ── Actes TSE sur période (miroir computeActeStats, prédicat par plage) ──

const MAX_DUREE_ESTIMABLE_JOURS = 760

function datesProlongations(acte, initialPeriodDays, fallback) {
  const base = isoDay(acte.dateDebut) || fallback
  const historique = acte.prolongationsHistory
  if (historique && historique.length > 0) return historique.map((h) => isoDay(h.date) || base)
  if (initialPeriodDays !== undefined && acte.dateDebut && acte.dateFin) {
    const debut = new Date(isoDay(acte.dateDebut))
    const fin = new Date(isoDay(acte.dateFin))
    if (Number.isFinite(debut.getTime()) && Number.isFinite(fin.getTime())) {
      const dureeJours = Math.floor((fin.getTime() - debut.getTime()) / 86_400_000)
      if (dureeJours > initialPeriodDays && dureeJours <= MAX_DUREE_ESTIMABLE_JOURS) {
        const count = Math.floor((dureeJours - initialPeriodDays) / 30)
        if (count > 0) {
          return Array.from({ length: count }, (_, k) =>
            new Date(debut.getTime() + (initialPeriodDays + k * 30) * 86_400_000).toISOString().slice(0, 10))
        }
      }
    }
  }
  if (acte.prolongationData || acte.prolongationDate) {
    return [isoDay(acte.prolongationDate) || isoDay(acte.prolongationData?.dateDebut) || base]
  }
  return []
}

function actesTse(enquetes, du, au) {
  const stats = { ecoutes: 0, geolocalisations: 0, autresActes: 0, prolongationsEcoutes: 0, prolongationsGeo: 0, prolongationsAutres: 0 }
  const dans = (d) => Boolean(d && d >= du && d <= au)
  for (const e of enquetes) {
    const fallback = isoDay(e.dateCreation)
    for (const a of e.ecoutes || []) {
      if (dans(isoDay(a.dateDebut) || fallback)) stats.ecoutes++
      stats.prolongationsEcoutes += datesProlongations(a, 30, fallback).filter(dans).length
    }
    for (const a of e.geolocalisations || []) {
      if (dans(isoDay(a.dateDebut) || fallback)) stats.geolocalisations++
      stats.prolongationsGeo += datesProlongations(a, 15, fallback).filter(dans).length
    }
    for (const a of e.actes || []) {
      if (dans(isoDay(a.dateDebut) || fallback)) stats.autresActes++
      stats.prolongationsAutres += datesProlongations(a, undefined, fallback).filter(dans).length
    }
  }
  const totalActes = stats.ecoutes + stats.geolocalisations + stats.autresActes
  const totalProlongations = stats.prolongationsEcoutes + stats.prolongationsGeo + stats.prolongationsAutres
  return { ...stats, totalActes, totalProlongations, totalAvecProlongations: totalActes + totalProlongations }
}

// ── Agrégats d'audience sur période (port de calculateAudienceStats) ──

function statsAudience(resultats, enquetes, du, au) {
  // Même périmètre que getYearlyStats : résultats datés dans la période ;
  // les résultats standards exigent une enquête ARCHIVÉE.
  const valides = resultats.filter((r) => {
    if (!r.dateAudience || !inPeriod(r.dateAudience, du, au)) return false
    if (r.isDirectResult || r.isClassement || r.isOI) return true
    const e = enquetes.find((x) => x.id === r.enqueteId)
    return Boolean(e && e.statut === 'archive')
  })

  const oi = valides.filter((r) => r.isOI === true)
  const classements = valides.filter((r) => r.isClassement === true)
  const pendings = valides.filter((r) => r.isAudiencePending === true)
  const normaux = valides.filter((r) => r.isOI !== true && r.isAudiencePending !== true && r.isClassement !== true)

  const s = {
    nombreCondamnations: 0, nombreAudiences: 0,
    nombreCRPC: 0, nombreCI: 0, nombreCOPJ: 0, nombreOI: oi.length, nombreCDD: 0, nombreClassements: classements.length,
    nombreDeferementsALAudience: 0,
    peines: { fermes: 0, probation: 0, simple: 0, mixtesProbation: 0, mixtesSimple: 0 },
    totalMoisFermes: 0, totalMoisProbation: 0, totalMoisSimple: 0, totalMoisMixtesFermes: 0, totalMoisMixtesProbation: 0, totalMoisMixtesSimpleFermes: 0, totalMoisMixtesSimple: 0,
    totalPeinePrison: 0, montantTotalAmendes: 0,
    interdictionsParaitre: 0, interdictionsGerer: 0,
    dureeTotale: 0, dureeCount: 0,
    confiscations: avoirsVides(), saisies: avoirsVides(),
    peinesParInfraction: {},
  }
  const audiencesUniques = new Set()

  const duree = (r) => {
    if (r.isDirectResult || r.isAudiencePending) return
    const e = enquetes.find((x) => x.id === r.enqueteId)
    if (!e?.dateDebut || !r.dateAudience) return
    const j = joursEntre(e.dateDebut, r.dateAudience)
    if (j != null) { s.dureeTotale += j; s.dureeCount++ }
  }

  for (const r of [...oi, ...classements, ...pendings]) {
    duree(r)
    accumulerAvoirs(s.saisies, r.saisies)
  }

  for (const r of normaux) {
    duree(r)
    audiencesUniques.add(r.numeroAudience || `${r.enqueteId}-${r.dateAudience}`)
    const types = new Set((r.condamnations || []).map((c) => c?.typeAudience))
    if (types.has('CI')) s.nombreCI++
    if (types.has('COPJ')) s.nombreCOPJ++
    if (types.has('OI')) s.nombreOI++
    if (types.has('CDD')) s.nombreCDD++

    let deferesDuResultat = 0
    for (const c of r.condamnations || []) {
      if (!c) continue
      if (c.typeAudience === 'CRPC-Def') s.nombreCRPC++
      if (c.defere) { s.nombreDeferementsALAudience++; deferesDuResultat++ }

      const prison = Number(c.peinePrison) || 0
      const probation = Number(c.sursisProbatoire) || 0
      const simple = Number(c.sursisSimple) || 0
      const amende = Number(c.peineAmende) || 0

      const infrKey = r.infractionNatinfCodes?.[0] ?? r.typeInfraction
      if (infrKey && !s.peinesParInfraction[infrKey]) {
        const entry = /^\d+$/.test(String(infrKey)) ? natinfEntry(infrKey) : null
        s.peinesParInfraction[infrKey] = {
          libelle: entry?.libelle || String(infrKey),
          categorie: labelCategorie(entry || { code: '', libelle: String(infrKey), theme: undefined }),
          condamnations: 0, moisFermes: 0, moisProbation: 0, moisSimple: 0,
        }
      }
      const pi = infrKey ? s.peinesParInfraction[infrKey] : null
      if (pi) pi.condamnations++

      if (prison > 0 && probation === 0 && simple === 0) { s.peines.fermes++; s.totalMoisFermes += prison; if (pi) pi.moisFermes += prison }
      else if (prison === 0 && probation > 0 && simple === 0) { s.peines.probation++; s.totalMoisProbation += probation; if (pi) pi.moisProbation += probation }
      else if (prison === 0 && probation === 0 && simple > 0) { s.peines.simple++; s.totalMoisSimple += simple; if (pi) pi.moisSimple += simple }
      else if (prison > 0 && probation > 0) { s.peines.mixtesProbation++; s.totalMoisMixtesFermes += prison; s.totalMoisMixtesProbation += probation; if (pi) pi.moisFermes += prison }
      else if (prison > 0 && simple > 0) { s.peines.mixtesSimple++; s.totalMoisMixtesSimpleFermes += prison; s.totalMoisMixtesSimple += simple; if (pi) pi.moisFermes += prison }

      s.montantTotalAmendes += amende
      s.nombreCondamnations++
      if (c.interdictionParaitre) s.interdictionsParaitre++
      if (c.interdictionGerer) s.interdictionsGerer++
    }

    // Défèrements saisis au niveau du résultat (surplus, comme calculateAudienceStats)
    const nb = Number(r.nombreDeferes) || 0
    if (nb > deferesDuResultat) s.nombreDeferementsALAudience += nb - deferesDuResultat

    accumulerAvoirs(s.confiscations, r.confiscations)
    accumulerAvoirs(s.saisies, r.saisies)
  }

  s.totalPeinePrison = s.totalMoisFermes + s.totalMoisMixtesFermes + s.totalMoisMixtesSimpleFermes
  s.nombreAudiences = audiencesUniques.size
  const arrondi = (v) => Math.round(v * 10) / 10
  return {
    nombreAudiences: s.nombreAudiences,
    nombreCondamnations: s.nombreCondamnations,
    orientations: {
      crpc: s.nombreCRPC, ci: s.nombreCI, copj: s.nombreCOPJ, oi: s.nombreOI, cdd: s.nombreCDD, classements: s.nombreClassements,
      note: '1 par dossier (CI, OI, CDD, classement) ; 1 par prévenu pour les CRPC — comme la page Statistiques.',
    },
    deferementsDossiersJuges: s.nombreDeferementsALAudience,
    peines: {
      fermes: { nombre: s.peines.fermes, moyenneMois: s.peines.fermes ? arrondi(s.totalMoisFermes / s.peines.fermes) : 0 },
      probation: { nombre: s.peines.probation, moyenneMois: s.peines.probation ? arrondi(s.totalMoisProbation / s.peines.probation) : 0 },
      sursisSimple: { nombre: s.peines.simple, moyenneMois: s.peines.simple ? arrondi(s.totalMoisSimple / s.peines.simple) : 0 },
      mixtesFermeProbation: { nombre: s.peines.mixtesProbation },
      mixtesFermeSimple: { nombre: s.peines.mixtesSimple },
      totalPrisonFermeMois: s.totalPeinePrison,
      montantTotalAmendes: s.montantTotalAmendes,
      interdictionsParaitre: s.interdictionsParaitre,
      interdictionsGerer: s.interdictionsGerer,
    },
    peinesParInfraction: s.peinesParInfraction,
    saisiesEnquete: s.saisies,
    confiscationsAudience: s.confiscations,
    dureeMoyenneEnqueteJours: s.dureeCount ? Math.round(s.dureeTotale / s.dureeCount) : 0,
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
      ...actesTse(enquetes, du, au),
      note: 'Techniques spéciales d\'enquête (écoutes, géolocalisations, autres actes) rattachées à leur date réelle de début / de prolongation.',
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
