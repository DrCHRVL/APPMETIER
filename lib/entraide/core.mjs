/**
 * SIRAL — cœur du module « Entraide internationale ».
 *
 * SOURCE UNIQUE de la logique métier, partagée par :
 *  - l'écran (hooks/useEntraide.ts, components/entraide/*) ;
 *  - le connecteur Claude web (scripts/attache/entraide.mjs).
 *
 * Une demande ne porte jamais son étape ni son échéance : on les DÉDUIT de sa
 * chronologie (`evenements`). Chaque bouton de l'écran ajoute un événement ;
 * la saisie se réduit à des clics et, rarement, à une date corrigée.
 */

// ── Délais (modifiables ici, une seule fois) ──
export const DELAIS = {
  /** Retour attendu des enquêteurs après un soit-transmis (T1/T2). */
  enqueteursMois: 3,
  /** Réponse attendue de l'autorité étrangère après l'envoi d'une demande émise. */
  emiseMois: 4,
  /** Nouveau délai après relance de l'autorité étrangère (T4) ou prorogation. */
  relanceMois: 3,
  /** Retour de traduction. */
  traductionJours: 30,
  /** DEE reçue : accusé de réception (annexe B) — art. 16 dir. 2014/41/UE. */
  arAnnexeBJours: 7,
  /** DEE reçue : reconnaissance 30 j + exécution 90 j — art. 12 dir. 2014/41/UE. */
  executionDeeJours: 120,
  /** En deçà, l'échéance est « proche ». */
  procheJours: 30,
  /** Sans échéance ni mouvement depuis ce délai : dossier « dormant ». */
  dormantJours: 180,
}

export const TYPE_LABELS = {
  dee: 'DEE',
  do: 'Dénonciation officielle',
  cri: 'CRI',
  execution: 'Exécution',
  civil: 'Civil',
}

export const TYPE_COURTS = { dee: 'DEE', do: 'DO', cri: 'CRI', execution: 'EXÉC.', civil: 'CIVIL' }

export const SENS_LABELS = { recue: 'Reçue', emise: 'Émise' }

export const DOC_LABELS = {
  t1: 'Soit-transmis aux enquêteurs (T1)',
  t2: 'Soit-transmis de relance (T2)',
  t3: "Retour à l'autorité étrangère (T3)",
  t4: "Relance de l'autorité étrangère (T4)",
}

/** Événement d'envoi qui solde un courrier signé. */
export const ENVOI_PAR_DOC = {
  t1: 'envoi_enqueteurs',
  t2: 'relance_enqueteurs',
  t3: 'envoi_autorite',
  t4: 'relance_autorite',
}

export const ETAPE_LABELS = {
  a_traiter: 'À traiter',
  en_traduction: 'En traduction',
  a_signer: 'À signer',
  a_envoyer: 'Signé, à envoyer',
  chez_enqueteurs: 'Chez les enquêteurs',
  avis_magistrat: 'Avis du magistrat',
  attente_etranger: "Attente de l'autorité étrangère",
  attente_ar: "Attente de l'accusé de réception",
  a_cloturer: 'À clôturer',
  cloturee: 'Clôturée',
}

const CHEZ_PAR_ETAPE = {
  a_traiter: 'greffe',
  en_traduction: 'traduction',
  a_signer: 'magistrat',
  a_envoyer: 'greffe',
  chez_enqueteurs: 'enqueteurs',
  avis_magistrat: 'magistrat',
  attente_etranger: 'autorite',
  attente_ar: 'autorite',
  a_cloturer: 'greffe',
  cloturee: 'aucun',
}

export const EVENEMENT_LABELS = {
  reception: 'Demande reçue',
  enregistrement: 'Demande enregistrée',
  ar_annexe_b: 'Accusé de réception (annexe B) adressé',
  traduction_demandee: 'Transmise pour traduction',
  traduction_recue: 'Traduction reçue',
  document_prepare: 'Courrier préparé, à signer',
  signature: 'Courrier signé',
  envoi_enqueteurs: 'Soit-transmis envoyé aux enquêteurs',
  relance_enqueteurs_mail: 'Relance des enquêteurs par mail',
  relance_enqueteurs: 'Soit-transmis de relance envoyé',
  retour_enqueteurs: 'Retour des enquêteurs',
  transmission_magistrat: 'Dossier transmis au magistrat pour avis',
  envoi_autorite: "Envoyé à l'autorité étrangère",
  relance_autorite: "Relance de l'autorité étrangère",
  prorogation: 'Nouveau délai',
  retour_execution: 'Exécution reçue',
  ar_recu: 'Accusé de réception reçu',
  cloture: 'Clôture',
  reouverture: 'Réouverture',
  note: 'Note',
}

// ── Dates (AAAA-MM-JJ, calcul en UTC) ──

export function aujourdhui(maintenant = new Date()) {
  const d = maintenant
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parse(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

function fmt(ms) {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export function estDate(iso) {
  return parse(iso) !== null
}

export function ajouterJours(iso, n) {
  const t = parse(iso)
  return t === null ? null : fmt(t + n * 86400000)
}

/** Ajoute n mois ; le 31 janvier + 1 mois donne le dernier jour de février. */
export function ajouterMois(iso, n) {
  const t = parse(iso)
  if (t === null) return null
  const d = new Date(t)
  const jour = d.getUTCDate()
  const cible = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
  const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate()
  cible.setUTCDate(Math.min(jour, dernier))
  return fmt(cible.getTime())
}

export function joursEntre(de, a) {
  const x = parse(de)
  const y = parse(a)
  return x === null || y === null ? null : Math.round((y - x) / 86400000)
}

export function dateFr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

// ── Chronologie ──

export function evenementsTries(d) {
  return [...(d?.evenements || [])]
    .filter((e) => e && estDate(e.date))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.creeLe || '').localeCompare(String(b.creeLe || '')))
}

/** Date de réception (reçue) ou d'enregistrement (émise) qui fait courir les délais. */
export function dateDepart(d) {
  const ev = evenementsTries(d).find((e) => e.type === 'reception' || e.type === 'enregistrement')
  return ev?.date || d?.dateEnregistrement || null
}

/**
 * État déduit d'une demande à la date `jour` (AAAA-MM-JJ).
 * Rend l'étape, chez qui est le dossier, l'échéance interne en cours, les
 * délais légaux, le courrier en attente et le niveau d'urgence.
 */
export function etatDemande(d, jour = aujourdhui()) {
  const s = {
    etape: 'a_traiter',
    echeance: null,
    echeanceTrad: null,
    doc: null,
    apresRetour: false,
    dateCloture: null,
    avantCloture: null,
    arB: null,
    execFaite: null,
    nbRelances: 0,
  }
  const evs = evenementsTries(d)
  const delai = (ev, mois) => ev.echeance && estDate(ev.echeance) ? ev.echeance : ajouterMois(ev.date, ev.delaiMois || mois)

  for (const ev of evs) {
    // Un dossier clôturé le reste : un événement tardif (AR reçu, retour
    // saisi après coup) ne le rouvre pas — seule la réouverture le fait.
    if (s.etape === 'cloturee' && ev.type !== 'reouverture' && ev.type !== 'cloture') {
      if (ev.type === 'ar_annexe_b') s.arB = s.arB || ev.date
      continue
    }
    switch (ev.type) {
      case 'traduction_demandee':
        s.etape = 'en_traduction'
        s.echeanceTrad = { date: ajouterJours(ev.date, DELAIS.traductionJours), libelle: 'Retour de la traduction' }
        break
      case 'traduction_recue':
        s.echeanceTrad = null
        s.etape = s.apresRetour ? 'avis_magistrat' : 'a_traiter'
        break
      case 'document_prepare':
        s.doc = { doc: ev.doc || 't1', langue: ev.langue, depuis: ev.date }
        s.etape = 'a_signer'
        break
      case 'signature':
        if (s.doc && (!ev.doc || ev.doc === s.doc.doc)) {
          s.doc = { ...s.doc, signeLe: ev.date, signePar: ev.par }
          s.etape = 'a_envoyer'
        }
        break
      case 'envoi_enqueteurs':
        s.doc = null
        s.etape = 'chez_enqueteurs'
        s.echeance = { date: delai(ev, DELAIS.enqueteursMois), libelle: 'Retour des enquêteurs' }
        break
      case 'relance_enqueteurs':
        s.doc = null
        s.nbRelances++
        s.etape = 'chez_enqueteurs'
        s.echeance = { date: delai(ev, DELAIS.enqueteursMois), libelle: 'Retour des enquêteurs (après relance)' }
        break
      case 'relance_enqueteurs_mail':
        s.nbRelances++
        break
      case 'retour_enqueteurs':
        if (!ev.partiel) {
          s.echeance = null
          s.etape = 'avis_magistrat'
          s.apresRetour = true
        }
        break
      case 'transmission_magistrat':
        s.etape = 'avis_magistrat'
        break
      case 'envoi_autorite':
        s.doc = null
        if (d.sens === 'recue') {
          s.etape = 'attente_ar'
          s.echeance = null
          s.execFaite = s.execFaite || ev.date
        } else {
          s.etape = 'attente_etranger'
          s.echeance = { date: delai(ev, DELAIS.emiseMois), libelle: "Réponse de l'autorité étrangère" }
        }
        break
      case 'relance_autorite':
        s.doc = null
        s.nbRelances++
        s.etape = 'attente_etranger'
        s.echeance = { date: delai(ev, DELAIS.relanceMois), libelle: "Réponse de l'autorité étrangère (après relance)" }
        break
      case 'prorogation':
        s.echeance = { date: delai(ev, DELAIS.relanceMois), libelle: s.echeance?.libelle || 'Dossier à représenter' }
        break
      case 'retour_execution':
        s.echeance = null
        s.etape = 'avis_magistrat'
        s.apresRetour = true
        break
      case 'ar_recu':
        if (s.etape === 'attente_ar') s.etape = 'a_cloturer'
        break
      case 'ar_annexe_b':
        s.arB = s.arB || ev.date
        break
      case 'cloture':
        if (s.etape !== 'cloturee') s.avantCloture = { etape: s.etape, echeance: s.echeance }
        s.etape = 'cloturee'
        s.dateCloture = ev.date
        break
      case 'reouverture':
        s.etape = s.avantCloture?.etape || 'a_traiter'
        s.echeance = s.avantCloture?.echeance || null
        s.dateCloture = null
        break
      default:
        break
    }
  }

  const cloturee = s.etape === 'cloturee'

  // ── Délais légaux ──
  const statutDe = (date, faitLe) => {
    if (faitLe) return faitLe <= date ? 'respecte' : 'depasse_fait'
    if (cloturee) return 'non_renseigne'
    return jour > date ? 'depasse' : 'en_cours'
  }
  const legales = []
  const depart = dateDepart(d)
  if (d.sens === 'recue' && d.type === 'dee' && depart) {
    const dateB = ajouterJours(depart, DELAIS.arAnnexeBJours)
    legales.push({ code: 'ar_annexe_b', libelle: 'Accusé de réception (annexe B) — 7 jours', date: dateB, statut: statutDe(dateB, s.arB), ...(s.arB ? { faitLe: s.arB } : {}) })
    const dateX = ajouterJours(depart, DELAIS.executionDeeJours)
    const fait = s.execFaite
    legales.push({ code: 'execution_dee', libelle: 'Exécution — 30 j de reconnaissance + 90 j', date: dateX, statut: statutDe(dateX, fait), ...(fait ? { faitLe: fait } : {}) })
  }
  for (const m of d.echeancesLegales || []) {
    if (!m || !estDate(m.date)) continue
    legales.push({ code: `manuelle:${m.id}`, libelle: m.libelle || 'Échéance légale', date: m.date, statut: statutDe(m.date, s.dateCloture) })
  }

  // ── Échéance interne & urgence ──
  const echeance = cloturee ? null : (s.echeance || (s.etape === 'en_traduction' ? s.echeanceTrad : null))
  const candidates = []
  if (echeance?.date) candidates.push(echeance.date)
  for (const l of legales) if (l.statut === 'en_cours' || l.statut === 'depasse') candidates.push(l.date)
  candidates.sort()
  const prochaineDate = cloturee ? null : (candidates[0] || null)
  const joursRestants = prochaineDate ? joursEntre(jour, prochaineDate) : null
  const dernier = evs.length ? evs[evs.length - 1].date : (d.dateEnregistrement || null)
  const niveau = cloturee ? 'cloturee'
    : joursRestants === null ? 'aucune'
      : joursRestants < 0 ? 'retard'
        : joursRestants <= DELAIS.procheJours ? 'proche' : 'ok'
  const dormant = !cloturee && !prochaineDate && !!dernier && (joursEntre(dernier, jour) ?? 0) > DELAIS.dormantJours

  return {
    etape: s.etape,
    libelleEtape: s.etape === 'a_signer' && s.doc ? `À signer — ${s.doc.doc.toUpperCase()}`
      : s.etape === 'a_envoyer' && s.doc ? `Signé, à envoyer — ${s.doc.doc.toUpperCase()}`
        : ETAPE_LABELS[s.etape],
    chez: CHEZ_PAR_ETAPE[s.etape],
    echeance,
    echeancesLegales: legales,
    docEnAttente: cloturee ? null : s.doc,
    prochaineDate,
    joursRestants,
    niveau,
    dormant,
    dernierEvenement: dernier,
    dateCloture: s.dateCloture,
    nbRelances: s.nbRelances,
  }
}

/** Clé de tri : retards d'abord, puis échéances proches, puis le reste. */
export function cleUrgence(etat) {
  if (etat.niveau === 'cloturee') return 9e6
  if (etat.joursRestants === null) return etat.dormant ? 5e6 : 6e6
  return etat.joursRestants
}

/**
 * Actions proposées sur une demande, la première `primaire` étant la
 * « prochaine étape ». Pure : les droits (qui peut signer) sont vérifiés
 * par l'écran.
 */
export function prochainesActions(d, etat) {
  const A = (action, libelle, extra = {}) => ({ action, libelle, ...extra })
  const recue = d.sens === 'recue'
  const retard = etat.niveau === 'retard' && !!etat.echeance && (etat.joursRestants ?? 0) < 0
  const out = []
  const arBAFaire = recue && d.type === 'dee' && etat.echeancesLegales.some((l) => l.code === 'ar_annexe_b' && (l.statut === 'en_cours' || l.statut === 'depasse'))

  switch (etat.etape) {
    case 'a_traiter':
      if (recue) {
        out.push(A('preparer', 'Préparer le soit-transmis (T1)', { doc: 't1', primaire: true }))
        if (arBAFaire) out.push(A('ar_annexe_b', 'AR annexe B adressé'))
        out.push(A('traduction_demandee', 'Transmettre pour traduction'))
        out.push(A('transmission_magistrat', 'Transmettre au magistrat'))
      } else {
        out.push(A('envoi_autorite', 'Demande envoyée', { primaire: true }))
        out.push(A('traduction_demandee', 'Transmettre pour traduction'))
      }
      break
    case 'en_traduction':
      out.push(A('traduction_recue', 'Traduction reçue', { primaire: true }))
      break
    case 'a_signer':
      out.push(A('signer', 'Valider et signer', { doc: etat.docEnAttente?.doc, primaire: true }))
      break
    case 'a_envoyer':
      out.push(A('envoyer', 'Marquer envoyé', { doc: etat.docEnAttente?.doc, primaire: true }))
      break
    case 'chez_enqueteurs':
      if (retard) {
        out.push(A('preparer', 'Préparer le ST de relance (T2)', { doc: 't2', primaire: true }))
        out.push(A('relance_mail', 'Relance par mail'))
        out.push(A('retour_enqueteurs', 'Retour reçu'))
      } else {
        out.push(A('retour_enqueteurs', 'Retour reçu', { primaire: true }))
        out.push(A('relance_mail', 'Relance par mail'))
      }
      out.push(A('retour_partiel', 'Retour partiel'))
      out.push(A('prorogation', 'Nouveau délai'))
      break
    case 'avis_magistrat':
      if (recue) {
        out.push(A('preparer', "Préparer le retour à l'autorité (T3)", { doc: 't3', primaire: true }))
        out.push(A('preparer', 'Relancer les enquêteurs (T2)', { doc: 't2' }))
      } else {
        out.push(A('cloturer', 'Clôturer', { primaire: true }))
        out.push(A('traduction_demandee', 'Transmettre pour traduction'))
        out.push(A('preparer', "Relancer l'autorité (T4)", { doc: 't4' }))
      }
      out.push(A('cloturer', 'Clôturer'))
      break
    case 'attente_etranger':
      if (retard) {
        out.push(A('transmission_magistrat', 'Représenter au magistrat', { primaire: true }))
        out.push(A('preparer', "Relancer l'autorité (T4)", { doc: 't4' }))
      } else {
        out.push(A('retour_execution', 'Exécution reçue', { primaire: true }))
        out.push(A('preparer', "Relancer l'autorité (T4)", { doc: 't4' }))
      }
      out.push(A('prorogation', 'Nouveau délai'))
      if (retard) out.push(A('retour_execution', 'Exécution reçue'))
      break
    case 'attente_ar':
      out.push(A('ar_recu', 'AR international reçu', { primaire: true }))
      out.push(A('cloturer', 'Clôturer'))
      break
    case 'a_cloturer':
      out.push(A('cloturer', 'Clôturer', { primaire: true }))
      break
    case 'cloturee':
      out.push(A('reouvrir', 'Rouvrir', { primaire: true }))
      break
    default:
      break
  }
  // Pendant l'attente d'un courrier, l'AR annexe B reste proposé s'il manque.
  if (arBAFaire && etat.etape !== 'a_traiter') out.push(A('ar_annexe_b', 'AR annexe B adressé'))
  // Dédoublonnage (même action + même doc), la première occurrence gagne.
  const vus = new Set()
  return out.filter((x) => {
    const k = `${x.action}:${x.doc || ''}`
    if (vus.has(k)) return false
    vus.add(k)
    return true
  })
}

// ── Recherche ──

export function normaliser(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim()
}

export function texteRecherche(d, extra = '') {
  return normaliser([
    d.refEsabora, d.refEtrangere, d.pays, d.autoriteNom, d.objet, d.personnes,
    d.serviceAutre, d.observations, TYPE_LABELS[d.type], extra,
  ].filter(Boolean).join(' '))
}

/** Mots qui valent la peine d'être appris (≥ 3 lettres, hors mots vides). */
const MOTS_VIDES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'pres', 'aupres', 'van', 'von', 'der', 'den', 'het', 'the', 'of'])

export function motsSignificatifs(s) {
  return normaliser(s).split(' ').filter((w) => w.length >= 3 && !MOTS_VIDES.has(w))
}

/**
 * Classe les autorités pour une saisie : chaque mot tapé doit se retrouver
 * (en début de mot) dans le nom, la ville, le pays ou les mots-clés appris.
 */
export function chercherAutorites(autorites, requete, pays) {
  const q = normaliser(requete).split(' ').filter(Boolean)
  const p = normaliser(pays)
  const res = []
  for (const a of autorites || []) {
    const champs = normaliser([a.nom, a.ville, a.pays, ...(a.motsCles || [])].join(' ')).split(' ')
    let score = 0
    let ok = true
    for (const w of q) {
      const exact = champs.includes(w)
      const debut = !exact && champs.some((c) => c.startsWith(w))
      if (!exact && !debut) { ok = false; break }
      score += exact ? 3 : 1
      if ((a.motsCles || []).some((m) => normaliser(m) === w)) score += 2
    }
    if (!ok) continue
    if (p && normaliser(a.pays) === p) score += 2
    res.push({ autorite: a, score })
  }
  return res.sort((x, y) => y.score - x.score || x.autorite.nom.localeCompare(y.autorite.nom)).map((r) => r.autorite)
}

/** Mots-clés appris : les mots tapés qui ne figuraient ni dans le nom ni dans la ville. */
export function apprendreMotsCles(autorite, requete) {
  const connus = new Set(motsSignificatifs([autorite.nom, autorite.ville, autorite.pays].join(' ')))
  const actuels = new Set((autorite.motsCles || []).map(normaliser))
  const nouveaux = motsSignificatifs(requete).filter((w) => !connus.has(w) && !actuels.has(w))
  return nouveaux.length ? [...(autorite.motsCles || []), ...nouveaux].slice(-30) : autorite.motsCles || []
}
