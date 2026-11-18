/**
 * SIRAL — Attaché de justice · journal d'audit.
 *
 * audit.jsonl : CHAQUE action de l'attaché (outil appelé, écriture, run) —
 * visible du seul administrateur, entrées chiffrées avec la clé « global »
 * (le disque ne voit rien en clair).
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
