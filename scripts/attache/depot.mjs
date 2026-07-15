/**
 * SIRAL — Attaché de justice · dépôt majordome (réception + rangement).
 *
 * Le magistrat CONFIE une pièce (audition récupérée dans NPP, ordonnance,
 * retour d'expertise…) sans décider où elle va : trombone du panneau (la
 * pièce part chiffrée dans la zone de dépôt `_depot`) ou pièce jointe d'un
 * mail transféré. L'attaché l'identifie, la NOMME proprement et la RANGE
 * dans la bonne zone (Geoloc/Ecoutes/Actes/PV/DML) du bon dossier — puis
 * l'exploite (lecture, détection → propositions).
 *
 * Le rangement écrit le même format que le client web (blob SIR1 + index) :
 * la pièce apparaît dans la section documents au prochain scan, signée du
 * nom de l'administrateur (l'attaché ne laisse aucune trace). Un dépôt
 * supprimé part en Corbeille/ du dépôt — rien n'est jamais détruit à sec.
 */
import { createRequire } from 'node:module'
import { attacheTj, listDocsMeta, readDocBlob, writeDocBlob, deleteDocBlob, docServerKey } from './store.mjs'
import { encryptDocBlob, decryptDocBlob } from './crypto.mjs'

const require = createRequire(import.meta.url)
import { enqueteExiste } from './dossier.mjs'
import { instructionExiste } from './instru.mjs'
import { readInboxMessage } from './mail.mjs'

export const ZONES = { geoloc: 'Geoloc', ecoutes: 'Ecoutes', actes: 'Actes', pv: 'PV', dml: 'DML' }

const DEPOT_KEY = docServerKey('_depot')

function authorOf(keys) {
  return keys?.grantedBy || 'admin'
}

function sanitizeName(nom, fallback = 'piece') {
  const base = String(nom || fallback)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return base || fallback
}

/** Pièces en attente de rangement (hors corbeille), plus ancienne d'abord. */
export function listDepot() {
  return listDocsMeta(attacheTj(), DEPOT_KEY)
    .filter((d) => !d.rel.startsWith('Corbeille/'))
    .map((d) => ({ rel: d.rel, nomOriginal: d.originalName, taille: d.size, deposeLe: d.savedAt }))
    .sort((a, b) => String(a.deposeLe).localeCompare(String(b.deposeLe)))
}

/**
 * Texte d'une pièce ENCORE au dépôt — pour l'identifier (dossier, nature)
 * avant de la ranger. PDF extrait à la volée ; texte/HTML bruts.
 */
export async function readDepotText(keys, rel) {
  const blob = readDocBlob(attacheTj(), DEPOT_KEY, String(rel || ''))
  if (!blob) return { ok: false, error: 'Pièce absente du dépôt — voir depot_lister' }
  const plain = decryptDocBlob(keys.global, blob)
  if (!plain) return { ok: false, error: 'Déchiffrement impossible (format inattendu)' }
  const lower = String(rel).toLowerCase()
  if (lower.endsWith('.pdf')) {
    try {
      const pdfParse = require('pdf-parse/lib/pdf-parse.js')
      const parsed = await pdfParse(plain)
      return { ok: true, texte: String(parsed.text || '').slice(0, 200_000) }
    } catch (e) {
      return { ok: false, error: 'Extraction PDF échouée : ' + (e?.message || e) }
    }
  }
  if (/\.(txt|html?|md|csv|json|eml)$/.test(lower)) {
    return { ok: true, texte: plain.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200_000) }
  }
  return { ok: false, error: `Type non textuel (${String(rel).split('.').pop()}) — ${plain.length} octets — range-la d'après son nom et la consigne` }
}

/**
 * Range une pièce dans un dossier : depuis le dépôt (`rel`) ou depuis une
 * pièce jointe de la boîte dédiée (`mailId` + `piece`).
 * `zone` : geoloc | ecoutes | actes | pv | dml. `nom` : nom final proposé
 * par l'attaché (daté, explicite) — l'extension d'origine est préservée.
 */
export async function rangerDocument(keys, { source, rel, mailId, piece, numero, zone, nom }) {
  const prefix = ZONES[String(zone || '').toLowerCase()]
  if (!prefix) throw new Error(`Zone inconnue « ${zone} » — attendu : ${Object.keys(ZONES).join(', ')}`)
  if (!String(numero || '').trim()) throw new Error('Numéro de dossier requis')
  if (!enqueteExiste(keys, numero) && !instructionExiste(keys, numero)) {
    throw new Error(`Dossier « ${numero} » introuvable (ni enquête, ni instruction) — vérifier lister_dossiers / instru_lister`)
  }

  let blob
  let originalName
  if (source === 'mail') {
    const rec = readInboxMessage(keys, String(mailId || ''))
    if (!rec) throw new Error('Message introuvable dans la boîte')
    const att = (rec.attachments || []).find((a) => a.nom === piece)
    if (!att) throw new Error(`Pièce jointe « ${piece} » absente — pièces : ${(rec.attachments || []).map((a) => a.nom).join(', ') || '(aucune)'}`)
    blob = encryptDocBlob(keys.global, Buffer.from(att.b64, 'base64'))
    originalName = att.nom
  } else {
    const depotRel = String(rel || '')
    blob = readDocBlob(attacheTj(), DEPOT_KEY, depotRel)
    if (!blob) throw new Error(`Pièce « ${depotRel} » absente du dépôt — voir depot_lister`)
    const meta = listDocsMeta(attacheTj(), DEPOT_KEY).find((d) => d.rel === depotRel)
    originalName = meta?.originalName || depotRel.split('/').pop()
  }

  // Nom final : celui proposé par l'attaché, extension d'origine préservée.
  const extMatch = /\.[a-zA-Z0-9]{1,8}$/.exec(originalName || '')
  const ext = extMatch ? extMatch[0].toLowerCase() : ''
  let base = sanitizeName(nom || originalName)
  if (ext && !base.toLowerCase().endsWith(ext)) base += ext

  const dossierKey = docServerKey(numero)
  const existing = new Set(listDocsMeta(attacheTj(), dossierKey).map((d) => d.rel))
  let finalRel = `${prefix}/${base}`
  for (let n = 2; existing.has(finalRel); n++) {
    const dot = base.lastIndexOf('.')
    finalRel = `${prefix}/${dot > 0 ? base.slice(0, dot) + '_' + n + base.slice(dot) : base + '_' + n}`
  }

  writeDocBlob(attacheTj(), dossierKey, finalRel, blob, {
    savedBy: authorOf(keys),
    category: prefix,
    originalName,
  })
  if (source !== 'mail') deleteDocBlob(attacheTj(), DEPOT_KEY, String(rel))

  return { ok: true, dossier: numero, chemin: finalRel, note: 'Pièce rangée — lis-la (lire_document) et déclenche tes détections (proposer_mec / proposer_acte / proposer_cr) si elle apporte du neuf.' }
}

/** Écarte une pièce du dépôt (spam, doublon) — déplacée en Corbeille/, jamais détruite. */
export async function ecarterDepot(rel) {
  const depotRel = String(rel || '')
  const blob = readDocBlob(attacheTj(), DEPOT_KEY, depotRel)
  if (!blob) throw new Error(`Pièce « ${depotRel} » absente du dépôt`)
  const meta = listDocsMeta(attacheTj(), DEPOT_KEY).find((d) => d.rel === depotRel)
  const dest = 'Corbeille/' + new Date().toISOString().slice(0, 10) + '_' + (depotRel.split('/').pop() || 'piece')
  writeDocBlob(attacheTj(), DEPOT_KEY, dest, blob, { savedBy: meta?.savedBy || 'attache', originalName: meta?.originalName, category: 'Corbeille' })
  deleteDocBlob(attacheTj(), DEPOT_KEY, depotRel)
  return { ok: true, corbeille: dest }
}
