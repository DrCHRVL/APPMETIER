/**
 * SIRAL — Attaché de justice · mémoire légère PAR DOSSIER.
 *
 * Un petit markdown (plafonné) qui retient l'essentiel des échanges du chat
 * flottant sur un dossier : ce que le magistrat a dit, décidé ou découvert.
 * Volontairement COURT — l'agent le relit au début de chaque conversation
 * (peu de tokens) et y ajoute une ligne télégraphique quand un échange
 * apporte du neuf. Chiffré (clé globale), versionné, par dossier.
 */
import { attacheDir, ensureDir, atomicWrite, readJson, docServerKey, withFileLock } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { numeroCanonique } from './dossier.mjs'

const MAX_CHARS = 4000 // plafond dur : au-delà, on élague les plus anciennes lignes

// Numéro CANONISÉ : la mémoire notée sous « 85103/843/2026 » doit être relue
// par le chat ouvert sur « 85103/843/2026 - GRIVESNES 2 » (même dossier).
function memPath(keys, numero) {
  return attacheDir('dossier-memoire', docServerKey(numeroCanonique(keys, numero)) + '.json')
}

export function readDossierMemory(keys, numero) {
  // Repli héritage : mémoire écrite avant la canonisation, restée sous
  // l'écriture brute du numéro — relue ici, elle migre au prochain ajout.
  const env = readJson(memPath(keys, numero), null)
    || readJson(attacheDir('dossier-memoire', docServerKey(numero) + '.json'), null)
  if (!env) return ''
  try {
    const { content } = decryptJson(keys.global, env)
    return typeof content === 'string' ? content : ''
  } catch {
    return ''
  }
}

async function write(keys, numero, content) {
  const p = memPath(keys, numero)
  await withFileLock('dossmem:' + numeroCanonique(keys, numero), async () => {
    ensureDir(attacheDir('dossier-memoire'))
    if (readJson(p, null)) {
      // conserve une version précédente (une seule, pour rester léger)
      const prev = readJson(p, null)
      atomicWrite(p.replace(/\.json$/, '.prev.json'), JSON.stringify(prev))
    }
    atomicWrite(p, JSON.stringify(encryptJson(keys.global, { content: content.slice(0, MAX_CHARS) }, { savedAt: new Date().toISOString() })))
  })
}

export async function setDossierMemory(keys, numero, content) {
  await write(keys, numero, String(content || ''))
  return { ok: true }
}

/**
 * Ajoute une note télégraphique, datée, en tête (le plus récent d'abord).
 * Élague les lignes les plus anciennes si le plafond est atteint.
 */
export async function appendDossierMemory(keys, numero, note) {
  const clean = String(note || '').trim().replace(/\n+/g, ' ')
  if (!clean) throw new Error('Note vide')
  const current = readDossierMemory(keys, numero)
  const header = `# Mémoire du dossier ${numero}\n`
  const body = current.startsWith('#') ? current.slice(current.indexOf('\n') + 1) : current
  const ligne = `- ${new Date().toISOString().slice(0, 10)} · ${clean.slice(0, 300)}`
  let next = header + ligne + '\n' + body.trimStart()
  // élagage : on retire les dernières lignes (les plus anciennes) jusqu'au
  // plafond, en réservant la place du marqueur d'élagage.
  if (next.length > MAX_CHARS) {
    const marqueur = '_(mémoire élaguée — anciennes notes retirées)_'
    const budget = MAX_CHARS - marqueur.length - 2
    const lines = next.split('\n')
    while (next.length > budget && lines.length > 2) {
      lines.pop()
      next = lines.join('\n')
    }
    next = next.trimEnd() + '\n' + marqueur + '\n'
  }
  await write(keys, numero, next)
  return { ajoute: ligne }
}
