/**
 * SIRAL — Attaché de justice · propositions à valider (✓/✗).
 *
 * Quand l'attaché DÉTECTE quelque chose en lisant (document, PV, mail) —
 * un nom nouveau, une demande d'acte, des éléments pour un CR — il ne
 * l'écrit pas directement au dossier : il dépose une PROPOSITION, déjà
 * entièrement construite. Elle apparaît dans le détail du dossier, pour le
 * seul administrateur, avec un ✓ (appliquer) et un ✗ (refuser) discrets.
 *
 * À la validation, l'écriture est signée DU NOM DE L'ADMINISTRATEUR —
 * l'assistant ne laisse aucune trace dans les données partagées. Le
 * dédoublonnage MEC est vérifié deux fois : au dépôt ET à l'application.
 */
import crypto from 'node:crypto'
import { attacheDir, ensureDir, atomicWrite, readJson, withFileLock } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { ajouterMec, enregistrerActe, classerNote, getMecNoms, normalizeNom } from './dossier.mjs'
import { appendLien } from './carto.mjs'
import { audit } from './journal.mjs'

const FILE = () => attacheDir('propositions.json')
const TYPES = ['mec', 'acte', 'cr', 'lien']

function load(keys) {
  const env = readJson(FILE(), null)
  if (!env) return []
  try {
    const { propositions } = decryptJson(keys.global, env)
    return Array.isArray(propositions) ? propositions : []
  } catch {
    return []
  }
}

async function save(keys, propositions) {
  await withFileLock('attache-propositions', async () => {
    ensureDir(attacheDir())
    // purge douce : on garde 400 entrées max (les traitées les plus anciennes partent)
    let list = propositions
    if (list.length > 400) {
      const pending = list.filter((p) => p.statut === 'en_attente')
      const done = list.filter((p) => p.statut !== 'en_attente').slice(-(400 - pending.length))
      list = [...done, ...pending]
    }
    atomicWrite(FILE(), JSON.stringify(encryptJson(keys.global, { propositions: list }, { savedAt: new Date().toISOString() })))
  })
}

/**
 * Dépose une proposition. type: mec | acte | cr.
 *  - mec  : payload { nom, role?, statut? }
 *  - acte : payload = arguments d'enregistrer_acte (kind, duree, cible, objet, type, description, statut…)
 *  - cr   : payload { titre?, contenu, date? } — contenu en prise de notes
 * `source` : d'où vient la détection (document, mail, CR…) — toujours citer.
 */
export async function addProposition(keys, { numero, type, payload, source, titre }) {
  if (!TYPES.includes(type)) throw new Error(`Type inconnu : ${type}`)
  if (!String(numero || '').trim()) throw new Error('Numéro de dossier requis')
  if (!payload || typeof payload !== 'object') throw new Error('Payload requis')
  const propositions = load(keys)

  if (type === 'mec') {
    const nom = String(payload.nom || '').trim()
    if (!nom) throw new Error('Nom du mis en cause requis')
    const norm = normalizeNom(nom)
    // doublon contre l'existant du dossier…
    const existants = getMecNoms(keys, numero)
    const deja = existants.find((n) => normalizeNom(n) === norm)
    if (deja) return { doublon: true, existant: deja, message: `« ${deja} » figure déjà aux mis en cause — proposition NON déposée` }
    // …et contre les propositions en attente
    const pendante = propositions.find((p) => p.statut === 'en_attente' && p.type === 'mec'
      && String(p.numero).trim() === String(numero).trim() && normalizeNom(p.payload.nom) === norm)
    if (pendante) return { doublon: true, existant: pendante.payload.nom, message: 'Proposition identique déjà en attente' }
  }

  const prop = {
    id: crypto.randomBytes(5).toString('hex'),
    numero: String(numero).trim(),
    type,
    titre: String(titre || defaultTitre(type, payload)).slice(0, 200),
    payload,
    source: String(source || '').slice(0, 300),
    statut: 'en_attente',
    creeLe: new Date().toISOString(),
  }
  propositions.push(prop)
  await save(keys, propositions)
  await audit(keys, 'proposition_deposee', { id: prop.id, numero: prop.numero, type, titre: prop.titre, source: prop.source })
  return { id: prop.id }
}

function defaultTitre(type, payload) {
  if (type === 'lien') return `Lien de renseignement : ${payload.sourceNom} ↔ ${payload.targetNom}${payload.label ? ` (${payload.label})` : ''}`
  if (type === 'mec') return `Nouveau mis en cause : ${payload.nom}${payload.role ? ` (${payload.role})` : ''}`
  if (type === 'acte') {
    const quoi = payload.kind === 'ecoute' ? `interception ${payload.cible || payload.objet || ''}`
      : payload.kind === 'geolocalisation' ? `géolocalisation ${payload.objet || ''}`
      : `${payload.type || 'acte'}`
    return `Nouvel acte : ${quoi}`.trim()
  }
  return `CR : ${String(payload.titre || payload.contenu || '').slice(0, 80)}`
}

export function listPropositions(keys, { numero, enAttente = true } = {}) {
  return load(keys).filter((p) =>
    (!numero || String(p.numero).trim() === String(numero).trim())
    && (!enAttente || p.statut === 'en_attente'))
}

/**
 * Décision de l'administrateur. action: valider | refuser.
 * À la validation, l'écriture réelle est faite ICI, signée de son nom.
 */
export async function decideProposition(keys, { id, action, par }) {
  if (action !== 'valider' && action !== 'refuser') throw new Error('Action attendue : valider | refuser')
  const propositions = load(keys)
  const prop = propositions.find((p) => p.id === id)
  if (!prop) throw new Error('Proposition inconnue')
  if (prop.statut !== 'en_attente') throw new Error('Proposition déjà traitée')
  const auteur = String(par || keys.grantedBy || 'admin')

  let applique = null
  if (action === 'valider') {
    if (prop.type === 'mec') {
      applique = await ajouterMec(keys, { numero: prop.numero, ...prop.payload })
    } else if (prop.type === 'acte') {
      applique = await enregistrerActe(keys, { numero: prop.numero, ...prop.payload })
    } else if (prop.type === 'cr') {
      applique = await classerNote(keys, { numero: prop.numero, ...prop.payload, enqueteur: auteur })
    } else if (prop.type === 'lien') {
      applique = await appendLien(keys, prop.payload)
    }
  }

  prop.statut = action === 'valider' ? 'validee' : 'refusee'
  prop.decideLe = new Date().toISOString()
  prop.decidePar = auteur
  await save(keys, propositions)
  await audit(keys, 'proposition_' + prop.statut, { id, numero: prop.numero, type: prop.type, titre: prop.titre, par: auteur })
  return { ok: true, statut: prop.statut, applique }
}
