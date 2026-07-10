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

const SAVED_BY = 'attache-ia'

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
  const metadata = {
    lastModified: new Date().toISOString(),
    modifiedBy: SAVED_BY,
    computerName: 'serveur-attache',
    version: data.version,
  }
  const envelope = encryptJson(ctxKey(keys), { data, metadata }, {
    savedAt: metadata.lastModified,
    savedBy: SAVED_BY,
  })
  await writeVault(attacheTj(), ctxScope(), envelope, SAVED_BY)
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

/** Liste compacte des enquêtes (pour l'orientation de l'agent). */
export function listEnquetes(keys, { includeArchived = false } = {}) {
  const { data } = loadContentieux(keys)
  return (data.enquetes || [])
    .filter((e) => includeArchived || e.statut !== 'archive')
    .map((e) => ({
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
    }))
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

/** Classe une note/synthèse comme compte-rendu signé « Attaché IA ». */
export async function classerNote(keys, { numero, titre, contenu }) {
  return mutate(keys, numero, (e) => {
    e.comptesRendus = e.comptesRendus || []
    const id = Date.now()
    const html = `<b>${escapeHtml(titre || 'Note de l\'attaché')}</b><br>` +
      escapeHtml(String(contenu || '')).replace(/\n/g, '<br>')
    e.comptesRendus.push({
      id,
      date: new Date().toISOString().slice(0, 10),
      enqueteur: 'Attaché IA',
      description: html,
      createdBy: SAVED_BY,
    })
    return { id }
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
