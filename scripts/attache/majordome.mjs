/**
 * SIRAL — Attaché de justice · le majordome.
 *
 * Le brief du magistrat : items structurés que l'attaché publie (échéances,
 * projets de mail aux enquêteurs, projets de DML actualisées, vérifications
 * à faire soi-même — NPP/Cassiopée —, personnes à appeler). Affichés dans le
 * widget du tableau de bord, visibles du seul administrateur.
 *
 * RIEN ne part vers les enquêteurs : chaque projet de mail porte un bouton
 * « Copier » — c'est le magistrat qui colle et envoie depuis sa messagerie.
 *
 * Stockage : items chiffrés (clé globale) en append-only ; les statuts
 * (traité / ignoré) vivent dans un fichier à part, indexé par des ids
 * opaques — aucune fuite de contenu, et l'app web peut les mettre à jour
 * sans détenir de clé.
 */
import crypto from 'node:crypto'
import { appendEncryptedLine, readEncryptedLines } from './store.mjs'
import { encryptJson } from './crypto.mjs'

export const ITEM_TYPES = ['echeance', 'projet_mail', 'projet_dml', 'verification', 'appel', 'note']

/** Identifiants forts (plaque, IMEI, ligne) servant à reconnaître un même objet. */
function extractIdentifiers(text) {
  const ids = new Set()
  const s = text || ''
  for (const m of s.matchAll(/\b[A-Z]{2}-?\d{3}-?[A-Z]{2}\b/g)) ids.add('plaque:' + m[0].replace(/-/g, '').toUpperCase())
  for (const m of s.matchAll(/\b\d{15}\b/g)) ids.add('imei:' + m[0])
  for (const m of s.matchAll(/\b0[1-9](?:[ .\-]?\d{2}){4}\b/g)) ids.add('tel:' + m[0].replace(/[ .\-]/g, ''))
  return [...ids]
}

/** Signature d'un item : même type + même dossier + mêmes identifiants = doublon. */
function itemSignature(item) {
  const ids = extractIdentifiers(`${item.titre} ${item.detail || ''}`)
  if (ids.length) return `${item.type}|${item.dossier || ''}|${ids.sort().join(',')}`
  const titre = String(item.titre || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40)
  return `${item.type}|${item.dossier || ''}|${item.echeance || ''}|${titre}`
}

/**
 * Publie des items de brief.
 * Chaque item : { type, titre, detail?, dossier?, echeance? (AAAA-MM-JJ),
 *   mail?: { destinataire, objet, corps },   — projet à copier-coller
 *   appel?: { qui, motif } }
 */
export async function publishItems(keys, items) {
  const published = []
  const seenSigs = new Set()
  for (const raw of Array.isArray(items) ? items : [items]) {
    if (!raw || !ITEM_TYPES.includes(raw.type)) continue
    const item = {
      id: crypto.randomBytes(6).toString('hex'),
      type: raw.type,
      titre: String(raw.titre || '').slice(0, 200),
      detail: raw.detail ? String(raw.detail).slice(0, 4000) : undefined,
      dossier: raw.dossier ? String(raw.dossier).slice(0, 60) : undefined,
      echeance: raw.echeance ? String(raw.echeance).slice(0, 10) : undefined,
      mail: raw.mail ? {
        destinataire: String(raw.mail.destinataire || '').slice(0, 200),
        objet: String(raw.mail.objet || '').slice(0, 300),
        corps: String(raw.mail.corps || '').slice(0, 20_000),
      } : undefined,
      appel: raw.appel ? {
        qui: String(raw.appel.qui || '').slice(0, 200),
        motif: String(raw.appel.motif || '').slice(0, 1000),
      } : undefined,
      at: new Date().toISOString(),
    }
    // Anti-doublon dans le même lot : un objet (même mesure, même plaque/ligne/
    // IMEI, même dossier) ne donne qu'un seul item, même si l'agent le formule
    // plusieurs fois. Le dédoublonnage inter-briefs se fait à l'affichage.
    const sig = itemSignature(item)
    if (seenSigs.has(sig)) continue
    seenSigs.add(sig)
    const ts = Date.now()
    const env = encryptJson(keys.global, item)
    await appendEncryptedLine('majordome.jsonl', { ts, id: item.id, iv: env.iv, ct: env.ct })
    published.push(item.id)
  }
  return published
}

export function readItems(max = 400) {
  return readEncryptedLines('majordome.jsonl', max)
}
