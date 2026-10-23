/**
 * SIRAL — cœur du calcul de la section « ENTRAIDE » de la page Statistiques.
 *
 * SOURCE UNIQUE des chiffres, partagée par l'écran
 * (components/stats/EntraideStats.tsx) et le connecteur Claude web
 * (outil entraide_stats) : l'agent lit EXACTEMENT les mêmes nombres que le
 * magistrat. Chaque carte porte sa règle de calcul.
 *
 * Tout se déduit de la chronologie des demandes (lib/entraide/core.mjs) :
 * aucune saisie dédiée aux statistiques.
 */
import { aujourdhui, dateDepart, etatDemande, evenementsTries, joursEntre, TYPE_LABELS } from '../entraide/core.mjs'

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

function mediane(xs) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2)
}

const pct = (n, d) => (d ? Math.round((100 * n) / d) : null)

/** Durées entre un événement « début » et le premier événement « fin » qui le suit. */
function durees(d, debut, fin, dans) {
  const evs = evenementsTries(d)
  const out = []
  let ouvert = null
  for (const e of evs) {
    if (debut(e) && !ouvert) ouvert = e.date
    else if (ouvert && fin(e)) {
      if (dans(e.date)) out.push(joursEntre(ouvert, e.date))
      ouvert = null
    }
  }
  return out
}

/**
 * Statistiques d'une année civile. L'année en cours s'arrête à aujourd'hui.
 * `libelleService(id, autre)` rend le nom d'un service (fiche du registre).
 */
export function computeEntraideStats(demandes, annee, maintenant = new Date(), libelleService = (id, autre) => autre || id || 'Non renseigné') {
  const auj = aujourdhui(maintenant)
  const debut = `${annee}-01-01`
  const finAnnee = `${annee}-12-31`
  const fin = finAnnee < auj ? finAnnee : auj
  const dans = (iso) => !!iso && iso >= debut && iso <= fin
  const liste = (demandes || []).filter(Boolean)
  const etats = new Map(liste.map((d) => [d.id, etatDemande(d, fin)]))
  const etatsAuj = new Map(liste.map((d) => [d.id, etatDemande(d, auj)]))

  const entrees = liste.filter((d) => dans(dateDepart(d)))
  const cloturees = liste.filter((d) => dans(etats.get(d.id).dateCloture))
  const stock = liste.filter((d) => {
    const dep = dateDepart(d)
    const clo = etats.get(d.id).dateCloture
    return dep && dep <= fin && !(clo && clo <= fin)
  })

  // ── Activité ──
  const parTypeSens = {}
  for (const d of entrees) {
    const k = `${d.type}:${d.sens}`
    parTypeSens[k] = (parTypeSens[k] || 0) + 1
  }
  const detailEntrees = Object.entries(parTypeSens)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => { const [t, s] = k.split(':'); return `${TYPE_LABELS[t]} ${s === 'recue' ? 'reçues' : 'émises'} : ${n}` })
    .join(' · ')

  // ── Délais ──
  const traitement = {}
  for (const d of cloturees) {
    const k = `${d.type}:${d.sens}`
    ;(traitement[k] = traitement[k] || []).push(joursEntre(dateDepart(d), etats.get(d.id).dateCloture))
  }
  const delaisParType = Object.entries(traitement).map(([k, xs]) => {
    const [t, s] = k.split(':')
    return { type: t, sens: s, libelle: `${TYPE_LABELS[t]} ${s === 'recue' ? 'reçues' : 'émises'}`, nombre: xs.length, medianeJours: mediane(xs) }
  }).sort((a, b) => b.nombre - a.nombre)

  const retoursEnq = liste.flatMap((d) => durees(d,
    (e) => e.type === 'envoi_enqueteurs',
    (e) => e.type === 'retour_enqueteurs' && !e.partiel, dans))
  const traductions = liste.flatMap((d) => durees(d, (e) => e.type === 'traduction_demandee', (e) => e.type === 'traduction_recue', dans))

  // ── Délais légaux DEE (échéances tombées dans la période) ──
  const legal = (code) => {
    let tenus = 0
    let total = 0
    for (const d of liste) {
      const l = etatsAuj.get(d.id).echeancesLegales.find((x) => x.code === code)
      if (!l || !dans(l.date) || l.statut === 'non_renseigne' || l.statut === 'en_cours') continue
      total++
      if (l.statut === 'respecte') tenus++
    }
    return { tenus, total, taux: pct(tenus, total) }
  }
  const exec90 = legal('execution_dee')
  const arB = legal('ar_annexe_b')

  // ── Relances (dossiers clôturés dans la période) ──
  const relances = cloturees.map((d) => etats.get(d.id).nbRelances)
  const relancees = relances.filter((n) => n > 0).length

  // ── Services enquêteurs ──
  const services = new Map()
  const svc = (d) => {
    const cle = d.serviceId || `autre:${d.serviceAutre || ''}`
    if (!services.has(cle)) services.set(cle, { service: libelleService(d.serviceId, d.serviceAutre), confies: 0, enCours: 0, enRetard: 0, retours: [] })
    return services.get(cle)
  }
  for (const d of liste.filter((x) => x.sens === 'recue')) {
    const envois = evenementsTries(d).filter((e) => e.type === 'envoi_enqueteurs' && dans(e.date))
    const ret = durees(d, (e) => e.type === 'envoi_enqueteurs', (e) => e.type === 'retour_enqueteurs' && !e.partiel, dans)
    const e = etatsAuj.get(d.id)
    if (!envois.length && !ret.length && e.etape !== 'chez_enqueteurs') continue
    const s = svc(d)
    s.confies += envois.length
    s.retours.push(...ret)
    if (e.etape === 'chez_enqueteurs') {
      s.enCours++
      if (e.niveau === 'retard') s.enRetard++
    }
  }
  const parService = Array.from(services.values())
    .map((s) => ({ service: s.service, confies: s.confies, enCours: s.enCours, enRetard: s.enRetard, delaiMedianRetourJours: mediane(s.retours) }))
    .sort((a, b) => b.enCours - a.enCours || b.confies - a.confies)

  // ── Ancienneté du stock en fin de période ──
  const tranches = [['< 3 mois', 0, 91], ['3 à 6 mois', 91, 183], ['6 à 12 mois', 183, 365], ['12 à 24 mois', 365, 730], ['> 24 mois', 730, Infinity]]
  const anciennete = tranches.map(([libelle, a, b]) => ({
    libelle,
    nombre: stock.filter((d) => { const j = joursEntre(dateDepart(d), fin); return j >= a && j < b }).length,
  }))

  // ── Pays ──
  const pays = (sens) => {
    const m = {}
    for (const d of entrees.filter((x) => x.sens === sens)) m[d.pays || '—'] = (m[d.pays || '—'] || 0) + 1
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => ({ pays: p, nombre: n }))
  }

  // ── Évolution mensuelle ──
  const dernierMois = Number(fin.slice(5, 7))
  const mensuel = Array.from({ length: dernierMois }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0')
    const dansMois = (iso) => !!iso && iso.slice(0, 7) === `${annee}-${mm}`
    return {
      mois: MOIS[i],
      entrees: entrees.filter((d) => dansMois(dateDepart(d))).length,
      cloturees: cloturees.filter((d) => dansMois(etats.get(d.id).dateCloture)).length,
    }
  })

  const cartes = [
    { id: 'entrees', titre: 'Demandes entrées', valeur: entrees.length, detail: detailEntrees,
      regle: "Demandes dont la date de réception (reçues) ou d'enregistrement (émises) tombe dans l'année." },
    { id: 'cloturees', titre: 'Demandes clôturées', valeur: cloturees.length,
      regle: "Demandes dont l'événement « Clôture » tombe dans l'année (une réouverture annule la clôture)." },
    { id: 'stock', titre: 'Dossiers en cours en fin de période', valeur: stock.length,
      regle: "Demandes entrées au plus tard à la fin de la période et non clôturées à cette date (fin de période = 31/12, ou aujourd'hui pour l'année en cours)." },
    { id: 'solde', titre: 'Écart entrées – clôtures', valeur: entrees.length - cloturees.length,
      regle: 'Positif : le stock grossit ; négatif : il se résorbe.' },
    { id: 'retour_enqueteurs', titre: 'Délai médian de retour des enquêteurs', valeur: mediane(retoursEnq), unite: 'jours', detail: `${retoursEnq.length} retour(s) · ${retoursEnq.filter((j) => j > 90).length} au-delà de 90 jours`,
      regle: 'Du soit-transmis aux enquêteurs (T1) au retour complet, pour les retours reçus dans l’année. Médiane, pas moyenne : un dossier très ancien ne la fausse pas.' },
    { id: 'dee_90', titre: 'DEE reçues exécutées dans le délai légal', valeur: exec90.taux, unite: '%', detail: `${exec90.tenus} sur ${exec90.total}`,
      regle: "DEE reçues dont l'échéance d'exécution (réception + 30 j de reconnaissance + 90 j, art. 12 dir. 2014/41/UE) tombe dans l'année : part de celles dont le retour (T3) est parti à temps." },
    { id: 'ar_annexe_b', titre: 'Accusés de réception (annexe B) sous 7 jours', valeur: arB.taux, unite: '%', detail: `${arB.tenus} sur ${arB.total}`,
      regle: 'DEE reçues dont l’échéance de 7 jours (art. 16 dir. 2014/41/UE) tombe dans l’année : part des accusés de réception adressés à temps.' },
    { id: 'traduction', titre: 'Délai médian de traduction', valeur: mediane(traductions), unite: 'jours', detail: `${traductions.length} traduction(s)`,
      regle: 'De la transmission pour traduction à la traduction reçue, pour les traductions revenues dans l’année.' },
    { id: 'relances', titre: 'Dossiers clôturés ayant nécessité une relance', valeur: pct(relancees, relances.length), unite: '%',
      detail: relances.length ? `${relancees} sur ${relances.length} · ${(relances.reduce((a, b) => a + b, 0) / relances.length).toFixed(1).replace('.', ',')} relance(s) en moyenne` : '',
      regle: 'Parmi les demandes clôturées dans l’année : relances des enquêteurs (mail ou soit-transmis) et de l’autorité étrangère.' },
  ]

  return {
    annee,
    periode: { du: debut, au: fin },
    cartes,
    delaisParType,
    parService,
    anciennete,
    paysRecues: pays('recue'),
    paysEmises: pays('emise'),
    mensuel,
  }
}
