/**
 * SIRAL — Attaché de justice · accès aux dossiers du contentieux confié.
 *
 * Lecture : déchiffre le coffre `ctx-<id>` ({ data: SyncData, metadata }),
 * rend les enquêtes en markdown compact (même esprit que dossierMarkdown.ts)
 * et extrait le texte des documents chiffrés (PDF compris).
 *
 * Écriture : mutations ciblées (acte, prolongation, compte-rendu, todo) qui
 * respectent le contrat de synchronisation de l'app — dateMiseAJour et
 * version bumpées, coffre re-chiffré et archivé avant écrasement — pour que
 * les clients web fusionnent proprement (le plus récent gagne, par enquête).
 */
import { createRequire } from 'node:module'
import {
  attacheTj, attacheContentieux, readVault, writeVault,
  listDocsMeta, readDocBlob, docServerKey,
} from './store.mjs'
import { encryptJson, decryptJson, decryptDocBlob } from './crypto.mjs'

const require = createRequire(import.meta.url)

/**
 * Signature des écritures VISIBLES des autres utilisateurs (CR, metadata de
 * synchro, historique) : le NOM DE L'ADMINISTRATEUR qui a remis les clés —
 * jamais « attache-ia ». L'existence de l'assistant ne doit laisser AUCUNE
 * trace dans les données partagées ; l'attribution réelle vit dans le
 * journal d'audit chiffré, visible du seul administrateur.
 */
function authorOf(keys) {
  return keys?.grantedBy || 'admin'
}

function ctxScope() { return `ctx-${attacheContentieux()}` }

function ctxKey(keys) {
  const k = keys.byScope.get(ctxScope())
  if (!k) throw new Error(`Trousseau sans clé ${ctxScope()} — remise des clés requise`)
  return k
}

/** Charge { data, metadata } du contentieux. Coffre absent = pas encore de données. */
export function loadContentieux(keys) {
  const envelope = readVault(attacheTj(), ctxScope())
  if (!envelope) return { data: { enquetes: [], version: 0 }, metadata: null }
  return decryptJson(ctxKey(keys), envelope)
}

async function saveContentieux(keys, payload) {
  const data = payload.data || {}
  data.version = (Number(data.version) || 0) + 1
  const author = authorOf(keys)
  const metadata = {
    lastModified: new Date().toISOString(),
    modifiedBy: author,
    computerName: 'SIRAL',
    version: data.version,
  }
  const envelope = encryptJson(ctxKey(keys), { data, metadata }, {
    savedAt: metadata.lastModified,
    savedBy: author,
  })
  await writeVault(attacheTj(), ctxScope(), envelope, author)
}

function stripHtml(s) {
  return String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function findEnquete(data, numero) {
  const wanted = String(numero).trim()
  const list = data.enquetes || []
  return list.find((e) => String(e.numero).trim() === wanted)
    || list.find((e) => String(e.numero).replace(/\s+/g, '') === wanted.replace(/\s+/g, ''))
    || null
}

// ── Lecture ──

/**
 * Liste compacte des enquêtes (pour l'orientation de l'agent).
 * Le caractère « dormant » suit le SEUIL CONFIGURÉ dans SIRAL pour l'alerte
 * « dossier sans CR » (alertRules, type cr_delay) — jamais une valeur
 * arbitraire. À défaut de règle activée : 60 jours.
 */
export function listEnquetes(keys, { includeArchived = false } = {}) {
  const { data } = loadContentieux(keys)
  const crRule = (data.alertRules || []).find((r) => r && r.type === 'cr_delay' && r.enabled)
  const seuilSansCR = Number(crRule?.threshold) > 0 ? Number(crRule.threshold) : 60
  const now = Date.now()
  return (data.enquetes || [])
    .filter((e) => includeArchived || e.statut !== 'archive')
    .map((e) => {
      const lastCr = (e.comptesRendus || [])
        .map((c) => Date.parse(c.date))
        .filter(Number.isFinite)
        .sort((x, y) => y - x)[0]
      const joursSansCR = lastCr ? Math.floor((now - lastCr) / 86_400_000) : null
      return {
        numero: e.numero,
        objet: stripHtml(e.description || '').slice(0, 180),
        statut: e.statut,
        services: e.services || [],
        misEnCause: (e.misEnCause || []).length,
        ecoutes: (e.ecoutes || []).length,
        geolocalisations: (e.geolocalisations || []).length,
        autresActes: (e.actes || []).length,
        comptesRendus: (e.comptesRendus || []).length,
        documents: (e.documents || []).length,
        derniereMaj: e.dateMiseAJour,
        joursSansCR,
        seuilSansCR,
        dormant: e.statut === 'en_cours' && (joursSansCR === null || joursSansCR >= seuilSansCR),
      }
    })
}

function acteLine(kind, a) {
  const flags = []
  if (a.statut) flags.push(a.statut)
  if (a.prolongationsHistory?.length) flags.push(`${a.prolongationsHistory.length} prolongation(s)`)
  const label = kind === 'ecoute' ? `Interception ${a.numero}${a.cible ? ` (${a.cible})` : ''}`
    : kind === 'geoloc' ? `Géolocalisation ${a.objet}`
    : `${a.type || 'Acte'} — ${stripHtml(a.description || '').slice(0, 160)}`
  return `- [id ${a.id}] ${label} : ${a.dateDebut || '?'} → ${a.dateFin || '?'} (${flags.join(', ') || 'sans statut'})`
}

/** Markdown complet d'un dossier — structure + CR chronologiques. */
export function dossierMarkdown(keys, numero) {
  const { data } = loadContentieux(keys)
  const e = findEnquete(data, numero)
  if (!e) return null
  const parts = [`# Dossier ${e.numero}`]
  if (e.description) parts.push(`**Objet :** ${stripHtml(e.description)}`)
  if (e.services?.length) parts.push(`**Services :** ${e.services.join(', ')}`)
  if (e.dateOP) parts.push(`**Date d'OP :** ${e.dateOP}`)
  parts.push(`**Statut :** ${e.statut} — dernière mise à jour ${e.dateMiseAJour || '?'}`)

  if (e.misEnCause?.length) {
    parts.push('\n## Mis en cause')
    for (const m of e.misEnCause) parts.push(`- ${m.nom}${m.role ? ` — ${m.role}` : ''}${m.statut ? ` (${m.statut})` : ''}`)
  }
  if (e.ecoutes?.length) { parts.push('\n## Interceptions'); for (const a of e.ecoutes) parts.push(acteLine('ecoute', a)) }
  if (e.geolocalisations?.length) { parts.push('\n## Géolocalisations'); for (const a of e.geolocalisations) parts.push(acteLine('geoloc', a)) }
  if (e.actes?.length) { parts.push('\n## Autres actes'); for (const a of e.actes) parts.push(acteLine('autre', a)) }

  if (e.toDos?.length) {
    parts.push('\n## À faire')
    for (const t of e.toDos) parts.push(`- [${t.status === 'completed' ? 'x' : ' '}] ${t.text}`)
  }

  const docs = e.documents || []
  if (docs.length) {
    parts.push('\n## Documents déposés')
    for (const d of docs) parts.push(`- ${d.cheminRelatif} (${d.type}, ${Math.round((d.taille || 0) / 1024)} Ko, ajouté le ${d.dateAjout?.slice?.(0, 10) || '?'})`)
  }

  const crs = [...(e.comptesRendus || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  if (crs.length) {
    parts.push('\n## Comptes-rendus (chronologique)')
    for (const cr of crs) {
      parts.push(`\n### CR du ${cr.date}${cr.enqueteur ? ` — ${cr.enqueteur}` : ''}`)
      parts.push(stripHtml(cr.description || ''))
    }
  }
  return parts.join('\n').slice(0, 380_000)
}

/** Texte d'un document chiffré du dossier (PDF → texte, txt/html bruts). */
export async function readDocumentText(keys, numero, cheminRelatif) {
  const key = docServerKey(numero)
  const blob = readDocBlob(attacheTj(), key, cheminRelatif)
  if (!blob) {
    const known = listDocsMeta(attacheTj(), key).map((d) => d.rel)
    return { ok: false, error: 'Document introuvable', disponibles: known.slice(0, 60) }
  }
  const plain = decryptDocBlob(keys.global, blob)
  if (!plain) return { ok: false, error: 'Déchiffrement impossible (format inattendu)' }
  const lower = cheminRelatif.toLowerCase()
  if (lower.endsWith('.pdf')) {
    try {
      // import direct de l'implémentation : le point d'entrée de pdf-parse
      // exécute un bloc de debug quand il se croit lancé en script
      const pdfParse = require('pdf-parse/lib/pdf-parse.js')
      const parsed = await pdfParse(plain)
      return { ok: true, texte: String(parsed.text || '').slice(0, 200_000) }
    } catch (e) {
      return { ok: false, error: 'Extraction PDF échouée : ' + (e?.message || e) }
    }
  }
  if (/\.(txt|html?|md|csv|json|eml)$/.test(lower)) {
    return { ok: true, texte: stripHtml(plain.toString('utf8')).slice(0, 200_000) }
  }
  return { ok: false, error: `Type non textuel (${cheminRelatif.split('.').pop()}) — ${plain.length} octets` }
}

/**
 * Contrôle de complétude d'un dossier : points d'attention factuels que
 * l'agent commente ensuite (il a le contexte, pas cette fonction).
 */
export function verifierCompletude(keys, numero) {
  const { data } = loadContentieux(keys)
  const e = findEnquete(data, numero)
  if (!e) return null
  const now = Date.now()
  const soon = 7 * 24 * 3600 * 1000
  const findings = []
  const checkActe = (kind, a) => {
    const label = kind === 'ecoute' ? `interception ${a.numero}` : kind === 'geoloc' ? `géolocalisation ${a.objet}` : (a.type || 'acte')
    if (a.dateFin) {
      const end = Date.parse(a.dateFin)
      if (Number.isFinite(end)) {
        if (end < now && a.statut === 'en_cours') findings.push(`⚠️ ${label} [id ${a.id}] : date de fin dépassée (${a.dateFin}) mais statut "en_cours"`)
        else if (end >= now && end - now < soon && a.statut === 'en_cours') findings.push(`⏳ ${label} [id ${a.id}] : expire sous 7 jours (${a.dateFin}) — prolongation à anticiper`)
      }
    }
    if (a.statut === 'prolongation_pending') findings.push(`🕐 ${label} [id ${a.id}] : prolongation en attente JLD${a.prolongationRequestedAt ? ` depuis le ${a.prolongationRequestedAt.slice(0, 10)}` : ''}`)
    if (a.statut === 'autorisation_pending') findings.push(`🕐 ${label} [id ${a.id}] : autorisation initiale en attente JLD`)
  }
  for (const a of e.ecoutes || []) checkActe('ecoute', a)
  for (const a of e.geolocalisations || []) checkActe('geoloc', a)
  for (const a of e.actes || []) checkActe('autre', a)

  const crs = e.comptesRendus || []
  const lastCr = crs.map((c) => Date.parse(c.date)).filter(Number.isFinite).sort((x, y) => y - x)[0]
  if (!crs.length) findings.push('📋 Aucun compte-rendu au dossier')
  else if (lastCr && now - lastCr > 45 * 24 * 3600 * 1000) findings.push(`📋 Dernier CR ancien (${new Date(lastCr).toISOString().slice(0, 10)}) — point d'étape à demander ?`)

  const docsServeur = listDocsMeta(attacheTj(), docServerKey(e.numero))
  const nbActesJld = (e.ecoutes || []).length + (e.geolocalisations || []).length
  if (nbActesJld > 0 && !docsServeur.length) findings.push(`📎 ${nbActesJld} acte(s) JLD mais aucun document déposé — autorisations manquantes au dossier ?`)

  const todos = (e.toDos || []).filter((t) => t.status === 'active')
  for (const t of todos) findings.push(`☐ À faire ouvert : ${t.text}`)

  return { numero: e.numero, findings, documentsDisponibles: docsServeur.length }
}

/**
 * Diagnostic objectif d'un dossier — matière première pour l'aide au
 * contrôle et à la maîtrise (l'agent interprète ensuite). Mesure :
 *  - délais : ancienneté du dossier, durée cumulée de chaque acte
 *    (initiale + prolongations) et ancienneté des attentes JLD ;
 *  - cohérence : actes expirés encore « en_cours », demandes JLD qui
 *    traînent, actes sans document justificatif ;
 *  - éparpillement : nombre de cibles/lignes/objets distincts rapporté au
 *    nombre de mis en cause et à la durée — signal de dispersion ;
 *  - cadence des comptes-rendus (rythme de compte-rendu des enquêteurs).
 * `cadre` distingue préliminaire (délais TSE serrés) et instruction.
 */
export function diagnostiquerDossier(keys, numero) {
  const { data } = loadContentieux(keys)
  const e = findEnquete(data, numero)
  if (!e) return null
  const now = Date.now()
  const jours = (ms) => Math.floor((now - ms) / 86_400_000)

  const debut = Date.parse(e.dateOP || e.dateCreation || '') || null
  const ageJours = debut ? jours(debut) : null

  const dureeCumuleeJours = (a) => {
    const unitJ = (v, u) => (u === 'mois' ? Number(v) * 30 : Number(v)) || 0
    let total = unitJ(a.duree, a.dureeUnit)
    for (const p of a.prolongationsHistory || []) total += unitJ(p.dureeAjoutee, p.dureeUnit)
    return total
  }

  const actes = []
  const collect = (kind, list, labelOf) => {
    for (const a of list || []) {
      const dureeCumul = dureeCumuleeJours(a)
      const fin = Date.parse(a.dateFin || '') || null
      actes.push({
        kind, id: a.id, label: labelOf(a), statut: a.statut,
        dureeCumuleeJours: dureeCumul,
        nbProlongations: (a.prolongationsHistory || []).length,
        dateDebut: a.dateDebut || null, dateFin: a.dateFin || null,
        expire: fin ? jours(fin) : null, // >0 = dépassé de N jours ; <0 = dans N jours
        attenteJldJours: a.prolongationRequestedAt ? jours(Date.parse(a.prolongationRequestedAt))
          : a.autorisationRequestedAt ? jours(Date.parse(a.autorisationRequestedAt)) : null,
      })
    }
  }
  collect('interception', e.ecoutes, (a) => `${a.numero}${a.cible ? ` (${a.cible})` : ''}`)
  collect('geolocalisation', e.geolocalisations, (a) => a.objet)
  collect('autre', e.actes, (a) => a.type || 'acte')

  // incohérences objectives
  const incoherences = []
  for (const a of actes) {
    if (a.expire != null && a.expire > 0 && a.statut === 'en_cours') {
      incoherences.push(`${a.kind} « ${a.label} » : échéance dépassée de ${a.expire} j mais toujours « en cours »`)
    }
    if (a.attenteJldJours != null && a.attenteJldJours > 15) {
      incoherences.push(`${a.kind} « ${a.label} » : en attente JLD depuis ${a.attenteJldJours} j`)
    }
  }

  // éparpillement : diversité des cibles rapportée aux MEC
  const ciblesDistinctes = new Set(actes.map((a) => normalizeNom(a.label))).size
  const nbMec = (e.misEnCause || []).length
  const crs = (e.comptesRendus || []).map((c) => Date.parse(c.date)).filter(Number.isFinite).sort((x, y) => x - y)
  const dernierCr = crs.length ? jours(crs[crs.length - 1]) : null
  let intervalleMoyenCr = null
  if (crs.length >= 2) {
    let s = 0
    for (let i = 1; i < crs.length; i++) s += (crs[i] - crs[i - 1]) / 86_400_000
    intervalleMoyenCr = Math.round(s / (crs.length - 1))
  }

  return {
    numero: e.numero,
    cadre: e.statut === 'instruction' ? 'instruction' : 'préliminaire',
    ageJours,
    misEnCause: nbMec,
    delais: {
      actes: actes.map(({ kind, label, statut, dureeCumuleeJours, nbProlongations, expire, attenteJldJours }) =>
        ({ kind, label, statut, dureeCumuleeJours, nbProlongations, joursAvantEcheance: expire == null ? null : -expire, attenteJldJours })),
    },
    coherence: {
      actesTotal: actes.length,
      incoherences,
    },
    eparpillement: {
      ciblesDistinctes,
      misEnCause: nbMec,
      ratioCiblesParMec: nbMec ? Math.round((ciblesDistinctes / nbMec) * 10) / 10 : null,
      commentaireBrut: ciblesDistinctes > Math.max(4, nbMec * 2)
        ? 'Diversité de cibles élevée au regard du nombre de mis en cause — dispersion possible'
        : 'Cohérent',
    },
    comptesRendus: {
      total: crs.length,
      dernierIlYaJours: dernierCr,
      intervalleMoyenJours: intervalleMoyenCr,
    },
  }
}

// ── Écritures (réversibles : coffre archivé avant chaque écrasement) ──

async function mutate(keys, numero, fn) {
  const payload = loadContentieux(keys)
  const e = findEnquete(payload.data, numero)
  if (!e) throw new Error(`Dossier ${numero} introuvable`)
  const result = fn(e, payload.data)
  e.dateMiseAJour = new Date().toISOString()
  await saveContentieux(keys, payload)
  return result
}

/** Enregistre un nouvel acte. kind : ecoute | geolocalisation | autre. */
export async function enregistrerActe(keys, { numero, kind, dateDebut, duree, dureeUnit, cible, objet, type, description, statut }) {
  return mutate(keys, numero, (e) => {
    const id = Date.now()
    const unit = dureeUnit === 'mois' ? 'mois' : 'jours'
    const debut = dateDebut || new Date().toISOString().slice(0, 10)
    let dateFin = ''
    const d = Number(duree)
    if (Number.isFinite(d) && d > 0 && debut) {
      const end = new Date(debut + 'T00:00:00')
      if (unit === 'mois') end.setMonth(end.getMonth() + d)
      else end.setDate(end.getDate() + d)
      dateFin = end.toISOString().slice(0, 10)
    }
    const base = {
      id, dateDebut: statut === 'autorisation_pending' ? '' : debut, dateFin,
      duree: String(duree ?? ''), dureeUnit: unit,
      statut: statut || 'en_cours',
      ...(statut === 'autorisation_pending' ? { autorisationRequestedAt: new Date().toISOString() } : {}),
    }
    if (kind === 'ecoute') {
      e.ecoutes = e.ecoutes || []
      e.ecoutes.push({ ...base, numero: String(cible || objet || 'ligne à préciser'), cible: cible ? String(cible) : undefined, description: description ? String(description) : undefined })
    } else if (kind === 'geolocalisation') {
      e.geolocalisations = e.geolocalisations || []
      e.geolocalisations.push({ ...base, objet: String(objet || cible || 'objet à préciser'), description: description ? String(description) : undefined })
    } else {
      e.actes = e.actes || []
      e.actes.push({ ...base, type: String(type || 'Acte'), description: String(description || '') })
    }
    return { id, dateFin }
  })
}

function collectionOf(e, acteId) {
  for (const [name, coll] of [['ecoutes', e.ecoutes], ['geolocalisations', e.geolocalisations], ['actes', e.actes]]) {
    const a = (coll || []).find((x) => Number(x.id) === Number(acteId))
    if (a) return { name, acte: a }
  }
  return null
}

/**
 * Prolongation d'un acte.
 * mode "demande"  : marque prolongation_pending (en attente JLD).
 * mode "validee"  : applique la prolongation (historique + nouvelle dateFin).
 */
export async function acterProlongation(keys, { numero, acteId, mode, duree, dureeUnit }) {
  return mutate(keys, numero, (e) => {
    const found = collectionOf(e, acteId)
    if (!found) throw new Error(`Acte ${acteId} introuvable dans ${numero}`)
    const a = found.acte
    const unit = dureeUnit === 'mois' ? 'mois' : 'jours'
    if (mode === 'demande') {
      a.statut = 'prolongation_pending'
      a.prolongationRequestedAt = new Date().toISOString()
      a.prolongationData = { dateDebut: a.dateFin || '', duree: String(duree ?? '') }
      return { statut: a.statut }
    }
    // validée : étendre la date de fin et historiser
    const d = Number(duree)
    if (!Number.isFinite(d) || d <= 0) throw new Error('Durée de prolongation invalide')
    const from = a.dateFin ? new Date(a.dateFin + 'T00:00:00') : new Date()
    if (unit === 'mois') from.setMonth(from.getMonth() + d)
    else from.setDate(from.getDate() + d)
    a.prolongationsHistory = a.prolongationsHistory || []
    a.prolongationsHistory.push({
      date: new Date().toISOString().slice(0, 10),
      dureeAjoutee: String(d),
      dureeInitiale: String(a.duree || ''),
      dureeUnit: unit,
      dureeInitialeUnit: a.dureeUnit || 'jours',
    })
    a.prolongationDate = new Date().toISOString().slice(0, 10)
    a.dateFin = from.toISOString().slice(0, 10)
    a.statut = 'en_cours'
    delete a.prolongationData
    return { statut: a.statut, nouvelleDateFin: a.dateFin }
  })
}

/**
 * Classe une note/synthèse comme compte-rendu. Signature = le magistrat
 * administrateur (dissimulation : aucune trace « IA » dans les données
 * partagées ; l'attribution réelle est dans l'audit chiffré).
 */
export async function classerNote(keys, { numero, titre, contenu, date, enqueteur }) {
  const author = enqueteur || authorOf(keys)
  return mutate(keys, numero, (e) => {
    e.comptesRendus = e.comptesRendus || []
    const id = Date.now()
    const html = (titre ? `<b>${escapeHtml(titre)}</b><br>` : '') +
      escapeHtml(String(contenu || '')).replace(/\n/g, '<br>')
    e.comptesRendus.push({
      id,
      date: (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : new Date().toISOString().slice(0, 10),
      enqueteur: author,
      description: html,
      createdBy: author,
    })
    return { id }
  })
}

/** Normalisation d'un nom pour le dédoublonnage (accents, casse, espaces). */
export function normalizeNom(nom) {
  return String(nom).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')
}

/** Noms des mis en cause existants d'un dossier (pour le dédoublonnage). */
export function getMecNoms(keys, numero) {
  const { data } = loadContentieux(keys)
  const e = findEnquete(data, numero)
  return (e?.misEnCause || []).map((m) => m.nom)
}

/** Ajoute un mis en cause — REFUSE tout doublon (nom normalisé identique). */
export async function ajouterMec(keys, { numero, nom, role, statut }) {
  const cleanNom = String(nom || '').trim()
  if (!cleanNom) throw new Error('Nom requis')
  return mutate(keys, numero, (e) => {
    e.misEnCause = e.misEnCause || []
    const norm = normalizeNom(cleanNom)
    const doublon = e.misEnCause.find((m) => normalizeNom(m.nom) === norm)
    if (doublon) throw new Error(`Doublon : « ${doublon.nom} » figure déjà aux mis en cause`)
    const id = Date.now()
    e.misEnCause.push({ id, nom: cleanNom, role: role ? String(role).slice(0, 120) : undefined, statut: String(statut || 'mis en cause').slice(0, 60) })
    return { id }
  })
}

/**
 * DML archivées d'un dossier : la zone « DML » de la section documents
 * (fichiers déposés sous DML/…, synchronisés depuis le commun Windows).
 * Base de travail pour actualiser une DML : lire la plus récente avec
 * lire_document, reprendre sa structure, mettre à jour avec les actes
 * intervenus depuis.
 */
export function listerDml(keys, numero) {
  const docs = listDocsMeta(attacheTj(), docServerKey(numero))
  return docs
    .filter((d) => d.rel.startsWith('DML/') || String(d.category || '').toUpperCase() === 'DML')
    .map((d) => ({ chemin: d.rel, nomOriginal: d.originalName, taille: d.size, deposeLe: d.savedAt }))
    .sort((a, b) => String(b.deposeLe).localeCompare(String(a.deposeLe)))
}

/**
 * Actualise la description (l'« objet ») du dossier pour refléter l'état à
 * l'instant T — derniers CR et documents intégrés. RIEN n'est perdu : la
 * description précédente est archivée dans e.descriptionHistory (en plus du
 * versionnage du coffre). Champ additif, invisible pour l'app existante.
 */
export async function actualiserDescription(keys, { numero, description }) {
  const texte = String(description || '').trim()
  if (!texte) throw new Error('Description vide')
  return mutate(keys, numero, (e) => {
    const ancienne = String(e.description || '')
    if (ancienne.trim()) {
      e.descriptionHistory = e.descriptionHistory || []
      e.descriptionHistory.push({ date: new Date().toISOString(), description: ancienne, remplacePar: authorOf(keys) })
      // garde-fou : capé aux 20 dernières versions (le coffre versionné garde tout le reste)
      if (e.descriptionHistory.length > 20) e.descriptionHistory = e.descriptionHistory.slice(-20)
    }
    e.description = escapeHtml(texte).replace(/\n/g, '<br>')
    return { versionsConservees: (e.descriptionHistory || []).length }
  })
}

export async function ajouterTodo(keys, { numero, texte }) {
  return mutate(keys, numero, (e) => {
    e.toDos = e.toDos || []
    const id = Date.now()
    e.toDos.push({ id, text: String(texte).slice(0, 500), status: 'active', dateCreation: new Date().toISOString() })
    return { id }
  })
}
