/**
 * SIRAL — Attaché de justice · dépôt majordome (réception + rangement).
 *
 * Le magistrat CONFIE une pièce (audition récupérée dans NPP, ordonnance,
 * retour d'expertise, memento, documentation ministère…) sans décider où elle
 * va : trombone du panneau (la pièce part chiffrée dans la zone de dépôt
 * `_depot`) ou pièce jointe d'un mail transféré. L'attaché l'identifie, la
 * NOMME proprement et la RANGE — soit dans la bonne zone d'un DOSSIER
 * (Geoloc/Ecoutes/Actes/PV/DML), soit dans la BASE DE CONNAISSANCES quand
 * c'est un document de référence durable — puis l'exploite (lecture,
 * détection → propositions).
 *
 * Le rangement au dossier écrit le même format que le client web (blob SIR1 +
 * index) : la pièce apparaît dans la section documents au prochain scan,
 * signée du nom de l'administrateur (l'attaché ne laisse aucune trace). Le
 * rangement à la base de connaissances EXTRAIT le texte de la pièce côté
 * serveur (comme le fait le navigateur au téléversement) et n'en conserve que
 * le texte, chiffré — jamais l'octet du PDF ne transite par la conversation.
 * Un dépôt supprimé part en Corbeille/ du dépôt — rien n'est jamais détruit à
 * sec.
 */
import { attacheTj, listDocsMeta, readDocBlob, writeDocBlob, deleteDocBlob, docServerKey } from './store.mjs'
import { encryptDocBlob, decryptDocBlob } from './crypto.mjs'
import { extractPdfText } from './ocr.mjs'
import { extractOfficeText, isOfficeExt } from './officeText.mjs'
import { saveKbEntry, setKbReflexe } from './kb.mjs'

import { enqueteExiste, numeroCanonique } from './dossier.mjs'
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
 * Extrait le TEXTE d'une pièce déchiffrée d'après son extension : PDF (couche
 * texte native, OCR de secours si scan), texte/HTML bruts, bureautique
 * (ODT/DOCX/RTF). Renvoie { ok, texte, source?, tronque? } ou
 * { ok:false, error, scanned? }. `max` borne la longueur retournée.
 */
export async function extractTextByName(plain, name, { max = 200_000 } = {}) {
  const lower = String(name || '').toLowerCase()
  const bound = (t) => {
    const s = String(t)
    return { texte: s.slice(0, max), tronque: s.length > max }
  }
  if (lower.endsWith('.pdf')) {
    const res = await extractPdfText(plain)
    if (res.ok) return { ok: true, ...bound(res.texte), source: res.source }
    return { ok: false, error: res.error, scanned: res.scanned }
  }
  if (/\.(txt|html?|md|markdown|csv|json|eml)$/.test(lower)) {
    return { ok: true, ...bound(plain.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')) }
  }
  if (isOfficeExt(lower)) {
    const res = extractOfficeText(plain, lower)
    if (res.ok) return { ok: true, ...bound(res.texte), source: res.source }
    return { ok: false, error: res.error }
  }
  return { ok: false, error: `Type non textuel (${lower.split('.').pop()}) — ${plain.length} octets — range-la d'après son nom et la consigne` }
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
  const res = await extractTextByName(plain, rel, { max: 200_000 })
  if (res.ok) return { ok: true, texte: res.texte, source: res.source, tronque: res.tronque }
  return { ok: false, error: res.error, scanned: res.scanned }
}

/**
 * Texte d'une pièce JOINTE d'un mail transféré — pour l'identifier ou la
 * classer AVANT de la ranger (au dossier ou à la base de connaissances). La
 * longueur est bornée (`max`, défaut 12 000 caractères) : c'est une aide à
 * l'identification, pas le stockage — le rangement conserve la pièce entière.
 */
export async function readMailPieceText(keys, { mailId, piece, max = 12_000 } = {}) {
  const rec = readInboxMessage(keys, String(mailId || ''))
  if (!rec) return { ok: false, error: 'Message introuvable dans la boîte — voir boite_lister' }
  const att = (rec.attachments || []).find((a) => a.nom === piece)
  if (!att) return { ok: false, error: `Pièce jointe « ${piece} » absente — pièces : ${(rec.attachments || []).map((a) => a.nom).join(', ') || '(aucune)'}` }
  const plain = Buffer.from(att.b64, 'base64')
  const bound = Math.min(200_000, Math.max(500, Number(max) || 12_000))
  const res = await extractTextByName(plain, att.nom, { max: bound })
  if (!res.ok) return res
  return { ok: true, piece: att.nom, type: att.type, taille: att.taille, texte: res.texte, source: res.source, tronque: res.tronque }
}

/**
 * Résout une pièce (mail transféré ou dépôt) en { blob (chiffré, prêt à
 * writeDocBlob), plain (octets en clair, pour extraction), originalName,
 * depotRel }. Source commune à rangerDocument et rangerPieceDansKb.
 */
async function resolvePiece(keys, { source, rel, mailId, piece }) {
  if (source === 'mail') {
    const rec = readInboxMessage(keys, String(mailId || ''))
    if (!rec) throw new Error('Message introuvable dans la boîte')
    const att = (rec.attachments || []).find((a) => a.nom === piece)
    if (!att) throw new Error(`Pièce jointe « ${piece} » absente — pièces : ${(rec.attachments || []).map((a) => a.nom).join(', ') || '(aucune)'}`)
    const plain = Buffer.from(att.b64, 'base64')
    return { blob: encryptDocBlob(keys.global, plain), plain, originalName: att.nom, depotRel: null }
  }
  const depotRel = String(rel || '')
  const blob = readDocBlob(attacheTj(), DEPOT_KEY, depotRel)
  if (!blob) throw new Error(`Pièce « ${depotRel} » absente du dépôt — voir depot_lister`)
  const meta = listDocsMeta(attacheTj(), DEPOT_KEY).find((d) => d.rel === depotRel)
  return { blob, plain: decryptDocBlob(keys.global, blob), originalName: meta?.originalName || depotRel.split('/').pop(), depotRel }
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
  // Écriture CANONIQUE du numéro : une pièce rangée sous « 85103/843/2026 »
  // doit se retrouver dans les documents de l'enquête « 85103/843/2026 -
  // GRIVESNES 2 » — le rangement suit la clé de l'enquête, pas la variante.
  if (enqueteExiste(keys, numero)) numero = numeroCanonique(keys, numero)

  const { blob, originalName, depotRel } = await resolvePiece(keys, { source, rel, mailId, piece })

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
  if (source !== 'mail' && depotRel) deleteDocBlob(attacheTj(), DEPOT_KEY, depotRel)

  return { ok: true, dossier: numero, chemin: finalRel, note: 'Pièce rangée — lis-la (lire_document) et déclenche tes détections (proposer_mec / proposer_acte / proposer_cr) si elle apporte du neuf.' }
}

/**
 * Intègre une pièce à la BASE DE CONNAISSANCES : depuis le dépôt (`rel`) ou
 * une pièce jointe de la boîte dédiée (`mailId` + `piece`). Le TEXTE est
 * extrait côté serveur (comme le navigateur au téléversement) — seul le texte
 * est conservé, chiffré ; l'octet du PDF ne transite jamais par la
 * conversation. L'attaché CLASSE dès réception : titre, catégorie, chemin de
 * pochette, description ; `reflexe` épingle la pièce comme référence de
 * premier rang (Memento, etc.). Une pièce du dépôt est CONSOMMÉE (retirée du
 * dépôt) après intégration ; une pièce jointe de mail reste dans la boîte.
 */
export async function rangerPieceDansKb(keys, { source, rel, mailId, piece, titre, categorie, chemin, description, reflexe }) {
  if (!String(titre || '').trim()) throw new Error('Titre requis pour l\'entrée de base de connaissances')

  const { plain, originalName, depotRel } = await resolvePiece(keys, { source, rel, mailId, piece })
  if (!plain) throw new Error('Déchiffrement impossible (format inattendu) — rien n\'a été enregistré')

  const extrait = await extractTextByName(plain, originalName, { max: 400_000 })
  if (!extrait.ok) {
    if (extrait.scanned) {
      throw new Error(`Pièce « ${originalName} » : PDF scanné sans couche texte (OCR de secours ${extrait.error ? '— ' + extrait.error : 'indisponible'}). Demande une version texte/lisible avant de l'ajouter à la base — RIEN n'a été enregistré.`)
    }
    throw new Error(`Pièce « ${originalName} » : ${extrait.error}. Impossible d'en extraire le texte pour la base de connaissances — RIEN n'a été enregistré.`)
  }

  const { id, categorie: cat } = await saveKbEntry(keys, {
    titre,
    categorie: categorie || 'autre',
    chemin,
    description,
    contenu: extrait.texte,
    source: `pièce confiée : ${originalName}`,
  })

  let reflexeOk = false
  let reflexeNote
  if (reflexe) {
    try { reflexeOk = Boolean((await setKbReflexe(keys, id, true)).reflexe) }
    catch (e) { reflexeNote = String(e?.message || e) }
  }

  if (source !== 'mail' && depotRel) deleteDocBlob(attacheTj(), DEPOT_KEY, depotRel)

  return {
    ok: true,
    id,
    categorie: cat,
    chemin: chemin || undefined,
    titre,
    reflexe: reflexeOk,
    ...(extrait.tronque ? { tronque: true } : {}),
    ...(reflexeNote ? { reflexeNote } : {}),
    note: 'Document intégré à la base de connaissances (texte extrait, chiffré). Complète son classement avec kb_decrire au besoin (description, catégorie, chemin) ; kb_lire pour t\'en resservir.',
  }
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
