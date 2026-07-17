/**
 * SIRAL — Attaché de justice · mémoire globale.
 *
 * Un document markdown vivant, PAS une boîte noire : l'attaché le relit au
 * début de chaque intervention et y consigne ce qu'il apprend des habitudes
 * du magistrat (plans de synthèse préférés, réflexes, consignes durables).
 * L'administrateur le lit, le corrige et l'efface depuis l'interface — la
 * mémoire évolue TOUJOURS à découvert. Chiffrée au repos (clé globale),
 * versionnée à chaque écriture.
 *
 * Relue à CHAQUE run, elle est tenue sous un BUDGET de caractères : les
 * ajouts s'accumulent entre deux consolidations (apprentissage.mjs), puis
 * un run économe la DISTILLE — règles générales, doublons fusionnés,
 * anecdotique supprimé — pour qu'elle reste courte et dense.
 */
import { readEnvelopeFile, writeEnvelopeFile } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'

const FILE = 'memory.json'

/** Budget de la mémoire consolidée (caractères ≈ jetons/4) — cible du run de consolidation. */
const boundedBudget = (v) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= 2000 && n <= 40_000 ? n : 6000
}
export const MEMORY_BUDGET = boundedBudget(process.env.SIRAL_ATTACHE_MEMOIRE_BUDGET)

const DEFAULT_MEMORY = `# Mémoire de l'attaché de justice

## Exigences du magistrat
(à compléter au fil des échanges)

## Réflexes appris
(à compléter au fil des échanges)

## Pièges à éviter
(les erreurs corrigées par le magistrat, en règles générales)
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

/** Taille de la mémoire face à son budget — pour l'interface et l'échéancier de consolidation. */
export function memoryStats(keys) {
  const chars = readMemory(keys).length
  return { chars, budget: MEMORY_BUDGET, over: chars > MEMORY_BUDGET }
}

/**
 * Réécriture COMPLÈTE par l'attaché (outil memoire_reecrire — run de
 * consolidation surtout). Garde-fous : jamais de quasi-effacement (c'est le
 * magistrat qui efface, depuis le panneau) et respect du budget (léger
 * dépassement toléré pour ne pas faire échouer un run à 2 % près).
 */
export async function rewriteMemory(keys, content, savedBy) {
  const texte = String(content || '').trim()
  if (texte.length < 80) {
    throw new Error('Mémoire quasi vide refusée — pour un simple ajout utilise memoire_noter ; l\'effacement complet appartient au magistrat (panneau).')
  }
  const plafond = Math.round(MEMORY_BUDGET * 1.15)
  if (texte.length > plafond) {
    throw new Error(`Trop long (${texte.length} caractères pour un budget de ${MEMORY_BUDGET}) — distille davantage : règles générales, pas d'anecdotes, pas de doublons du prompt système.`)
  }
  await writeMemory(keys, texte + '\n', savedBy)
  return { ok: true, chars: texte.length, budget: MEMORY_BUDGET }
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
