/**
 * SIRAL — Attaché de justice · journal d'audit et fil d'activité.
 *
 * - audit.jsonl : CHAQUE action de l'attaché (outil appelé, écriture,
 *   envoi mail, relève boîte) — visible du seul administrateur, entrées
 *   chiffrées avec la clé « global » (le disque ne voit rien en clair).
 * - feed.jsonl : le fil « pendant votre absence » — ce que l'attaché a
 *   préparé proactivement, affiché en tête du panneau.
 */
import { appendEncryptedLine, readEncryptedLines } from './store.mjs'
import { encryptJson } from './crypto.mjs'

/** Trace une action de l'attaché. `detail` est chiffré ; `ts` reste en clair (tri). */
export async function audit(keys, action, detail = {}) {
  const ts = Date.now()
  const env = encryptJson(keys.global, { action, ...detail, at: new Date(ts).toISOString() })
  await appendEncryptedLine('audit.jsonl', { ts, iv: env.iv, ct: env.ct })
}

export function readAudit(max = 1000) {
  return readEncryptedLines('audit.jsonl', max)
}

/**
 * Publie une carte dans le fil proactif.
 * type : mail_traite | synthese | acte | prolongation | projet_reponse | alerte | note
 */
export async function publishFeed(keys, card) {
  const ts = Date.now()
  const env = encryptJson(keys.global, { ...card, at: new Date(ts).toISOString() })
  await appendEncryptedLine('feed.jsonl', { ts, iv: env.iv, ct: env.ct })
}

export function readFeed(max = 200) {
  return readEncryptedLines('feed.jsonl', max)
}
