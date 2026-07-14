/**
 * SIRAL — Attaché de justice · consignes permanentes du magistrat.
 *
 * Le « prompt » personnalisable de l'attaché : un texte libre, rédigé et
 * modifié par le magistrat depuis Paramètres → Attaché IA, relu par l'agent
 * au début de CHAQUE intervention (chat, mails transférés, brief, routines).
 * Il s'ajoute à la persona et aux règles de gouvernance — il ne les remplace
 * pas. Chiffré au repos (clé globale), versionné à chaque écriture — même
 * modèle que la mémoire.
 */
import { readEnvelopeFile } from './store.mjs'
import { decryptJson } from './crypto.mjs'

const FILE = 'instructions.json'

export function readInstructions(keys) {
  const env = readEnvelopeFile(FILE)
  if (!env) return ''
  try {
    const { content } = decryptJson(keys.global, env)
    return typeof content === 'string' ? content.slice(0, 100_000) : ''
  } catch {
    return ''
  }
}
