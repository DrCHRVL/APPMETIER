/**
 * SIRAL — Attaché de justice · mémoire globale.
 *
 * Un document markdown vivant, PAS une boîte noire : l'attaché le relit au
 * début de chaque intervention et y consigne ce qu'il apprend des habitudes
 * du magistrat (plans de synthèse préférés, réflexes, consignes durables).
 * L'administrateur le lit, le corrige et l'efface depuis l'interface — la
 * mémoire évolue TOUJOURS à découvert. Chiffrée au repos (clé globale),
 * versionnée à chaque écriture.
 */
import { readEnvelopeFile, writeEnvelopeFile } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'

const FILE = 'memory.json'

const DEFAULT_MEMORY = `# Mémoire de l'attaché de justice

## Consignes permanentes
- Toujours répondre en français, de façon dense et structurée.
- Ne jamais rien envoyer à l'extérieur : seule l'adresse du magistrat est autorisée.
- Toute écriture dans SIRAL est réversible et journalisée : agir, puis rendre compte.

## Préférences du magistrat
(à compléter au fil des échanges)

## Réflexes appris
(à compléter au fil des échanges)
`

export function readMemory(keys) {
  const env = readEnvelopeFile(FILE)
  if (!env) return DEFAULT_MEMORY
  try {
    const { content } = decryptJson(keys.global, env)
    return typeof content === 'string' ? content : DEFAULT_MEMORY
  } catch {
    return DEFAULT_MEMORY
  }
}

export async function writeMemory(keys, content, savedBy) {
  const env = encryptJson(keys.global, { content: String(content).slice(0, 200_000) }, {
    savedAt: new Date().toISOString(),
    savedBy,
  })
  await writeEnvelopeFile(FILE, env)
}

/** Ajout ciblé sous une section (## …) — crée la section si absente. */
export async function appendMemory(keys, section, note, savedBy) {
  const current = readMemory(keys)
  const line = `- ${String(note).trim().replace(/\n+/g, ' ')} _(${new Date().toISOString().slice(0, 10)})_`
  const header = `## ${section.trim()}`
  let next
  if (current.includes(header)) {
    // insérer la ligne juste après l'en-tête de section
    next = current.replace(header, `${header}\n${line}`)
  } else {
    next = `${current.trimEnd()}\n\n${header}\n${line}\n`
  }
  await writeMemory(keys, next, savedBy)
  return line
}
