/**
 * SIRAL — registre des tribunaux judiciaires (TJ).
 *
 * Chaque TJ est un espace de données STRICTEMENT séparé (coffres, documents,
 * trousseaux, événements…) : voir tjDataDir/tjFile dans store.ts. Ce module
 * gère le registre (tjs.json à la racine des données) :
 *  - le TJ « default » (le TJ d'origine) est créé automatiquement et reste
 *    sur les chemins de données historiques — aucune migration ;
 *  - un code d'accès par TJ (haché scrypt, jamais stocké en clair) protège
 *    la première inscription d'un utilisateur dans ce TJ ;
 *  - la création/gestion des TJ est réservée à l'administrateur.
 */
import crypto from 'crypto'
import { dataDir, readJson, writeJson, withFileLock, DEFAULT_TJ_ID, isSafeTjId } from './store'
import { hashPassword, verifyPassword } from './password'
import { setupCode, safeEqual } from './auth'

export interface TjEntry {
  id: string
  name: string
  /** Hachage scrypt du code d'accès (première inscription). Absent = pas de code propre. */
  codeHash?: string
  createdAt: string
  createdBy: string
  codeUpdatedAt?: string
}

const DEFAULT_TJ_NAME = 'TJ Amiens'

function registryPath() { return dataDir('tjs.json') }

function defaultEntry(): TjEntry {
  return {
    id: DEFAULT_TJ_ID,
    name: DEFAULT_TJ_NAME,
    createdAt: new Date().toISOString(),
    createdBy: 'system',
  }
}

/** Registre complet — le TJ par défaut existe toujours, même sans tjs.json. */
export function listTjs(): TjEntry[] {
  const stored = readJson<TjEntry[]>(registryPath(), [])
  if (!stored.some((t) => t.id === DEFAULT_TJ_ID)) {
    return [defaultEntry(), ...stored]
  }
  return stored
}

export function findTj(id: string): TjEntry | null {
  return listTjs().find((t) => t.id === id) || null
}

async function saveTjs(mutate: (entries: TjEntry[]) => TjEntry[]): Promise<TjEntry[]> {
  return withFileLock('tjs', async () => {
    const next = mutate(listTjs())
    writeJson(registryPath(), next)
    return next
  })
}

/** Identifiant technique dérivé du nom (« TJ Lille » → « lille »), unique. */
function slugOf(name: string, existing: TjEntry[]): string {
  const base = name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\btj\b|\btribunal( judiciaire)?\b/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'tj'
  let slug = base
  let n = 2
  while (existing.some((t) => t.id === slug) || !isSafeTjId(slug)) {
    slug = `${base}-${n++}`
  }
  return slug
}

/**
 * Code d'accès lisible et dictable (Crockford base32, ~75 bits) : remis par
 * l'admin au futur utilisateur, exigé UNIQUEMENT à la première inscription.
 */
export function generateTjCode(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  const rnd = crypto.randomBytes(15)
  let s = ''
  for (let i = 0; i < 15; i++) {
    s += alphabet[rnd[i] % 32]
    if (i % 5 === 4 && i < 14) s += '-'
  }
  return s
}

/** Normalise un code saisi (espaces, minuscules, confusions O/0 et I/L/1). */
export function normalizeTjCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1')
}

export async function createTj(name: string, createdBy: string): Promise<{ entry: TjEntry, code: string }> {
  const cleanName = name.trim().slice(0, 80)
  if (cleanName.length < 2) throw new Error('Nom de tribunal trop court')
  const code = generateTjCode()
  let created: TjEntry | null = null
  await saveTjs((entries) => {
    if (entries.some((t) => t.name.toLowerCase() === cleanName.toLowerCase())) {
      throw new Error('Un tribunal porte déjà ce nom')
    }
    created = {
      id: slugOf(cleanName, entries),
      name: cleanName,
      codeHash: hashPassword(normalizeTjCode(code)),
      createdAt: new Date().toISOString(),
      createdBy,
      codeUpdatedAt: new Date().toISOString(),
    }
    return [...entries, created]
  })
  return { entry: created!, code }
}

export async function renameTj(id: string, name: string): Promise<TjEntry> {
  const cleanName = name.trim().slice(0, 80)
  if (cleanName.length < 2) throw new Error('Nom de tribunal trop court')
  let updated: TjEntry | null = null
  await saveTjs((entries) => entries.map((t) => {
    if (t.id !== id) return t
    updated = { ...t, name: cleanName }
    return updated
  }))
  if (!updated) throw new Error('Tribunal introuvable')
  return updated
}

/** (Ré)génère le code d'accès d'un TJ — l'ancien code cesse de fonctionner. */
export async function regenerateTjCode(id: string): Promise<{ entry: TjEntry, code: string }> {
  const code = generateTjCode()
  let updated: TjEntry | null = null
  await saveTjs((entries) => entries.map((t) => {
    if (t.id !== id) return t
    updated = { ...t, codeHash: hashPassword(normalizeTjCode(code)), codeUpdatedAt: new Date().toISOString() }
    return updated
  }))
  if (!updated) throw new Error('Tribunal introuvable')
  return { entry: updated, code }
}

/**
 * Retrouve le TJ correspondant à un code d'accès saisi à l'inscription.
 * Le code identifie le TJ à lui seul (pas de sélection préalable).
 */
export function resolveTjByCode(code: string): TjEntry | null {
  const normalized = normalizeTjCode(code)
  if (!normalized) return null
  for (const t of listTjs()) {
    if (t.codeHash && verifyPassword(normalized, t.codeHash)) return t
  }
  return null
}

/**
 * TJ auquel donne droit le code saisi à l'INSCRIPTION :
 *  - un code de TJ (généré par l'admin) rattache au TJ correspondant ;
 *  - le code d'enrôlement historique (SIRAL_SETUP_CODE) reste accepté pour le
 *    TJ par défaut tant que celui-ci n'a pas de code propre — et toujours pour
 *    le tout premier compte du serveur (amorçage de l'admin).
 * Lève une erreur si le code n'ouvre aucun TJ.
 */
export function resolveRegistrationTj(code: string, isFirstAccount: boolean): TjEntry {
  const byCode = resolveTjByCode(code)
  if (byCode) return byCode
  const legacy = setupCode()
  if (legacy && safeEqual(code, legacy)) {
    const def = findTj(DEFAULT_TJ_ID)!
    if (isFirstAccount || !def.codeHash) return def
  }
  throw new Error("Code d'accès incorrect")
}
