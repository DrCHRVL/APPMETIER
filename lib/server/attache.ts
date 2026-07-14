/**
 * SIRAL — Attaché de justice · côté application web.
 *
 * L'app ne détient AUCUNE clé de l'attaché : elle garde les routes
 * (administrateur du TJ confié uniquement), relaie vers le service attaché
 * (sidecar, seul détenteur de la clé-maître) et lit sur disque les fichiers
 * d'enveloppes que le navigateur de l'admin déchiffre lui-même avec sa clé
 * « global » — le même modèle E2EE que le reste de SIRAL.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { jsonResponse, requireTjSession } from './auth'
import { tjDataDir, withFileLock, ensureDir, atomicWrite, readJson, DEFAULT_TJ_ID } from './store'

export function attacheEnabled(): boolean {
  return Boolean(process.env.SIRAL_ATTACHE_URL)
}

export function attacheTjId(): string {
  return process.env.SIRAL_ATTACHE_TJ || DEFAULT_TJ_ID
}

function serviceUrl(): string {
  return (process.env.SIRAL_ATTACHE_URL || '').replace(/\/+$/, '')
}

function bridgeSecret(): string | null {
  if (process.env.SIRAL_ATTACHE_BRIDGE_SECRET) return process.env.SIRAL_ATTACHE_BRIDGE_SECRET
  if (process.env.SIRAL_SECRET) {
    return crypto.createHash('sha256').update('attache-bridge:' + process.env.SIRAL_SECRET).digest('hex')
  }
  return null
}

/**
 * Garde des routes attaché : session admin, TJ actif = TJ confié,
 * fonctionnalité activée. L'attaché est INVISIBLE de tout autre utilisateur —
 * un non-admin reçoit le même 404 qu'une route inexistante.
 */
export function requireAttacheAdmin(req: Request) {
  const session = requireTjSession(req)
  if (session.r !== 'admin' || !attacheEnabled() || session.tj !== attacheTjId()) {
    throw new Response(JSON.stringify({ error: 'Introuvable' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    })
  }
  return session
}

/** Relaie une requête JSON vers le service attaché. */
export async function attacheFetch(pathname: string, init?: { method?: string, body?: unknown, timeoutMs?: number }): Promise<Response> {
  const secret = bridgeSecret()
  if (!secret) return jsonResponse({ error: 'Service attaché non configuré (secret absent)' }, { status: 503 })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), init?.timeoutMs ?? 30_000)
  try {
    const res = await fetch(serviceUrl() + pathname, {
      method: init?.method || 'GET',
      headers: {
        'x-attache-secret': secret,
        ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    })
    return res
  } catch {
    return jsonResponse({ error: 'Service attaché injoignable' }, { status: 503 })
  } finally {
    clearTimeout(timer)
  }
}

// ── Lectures disque (enveloppes chiffrées, déchiffrées par le navigateur admin) ──

function attacheDir(...segments: string[]): string {
  return tjDataDir(attacheTjId(), 'attache', ...segments)
}

export function readEncryptedLog(file: 'feed.jsonl' | 'audit.jsonl' | 'outbox.jsonl' | 'majordome.jsonl', max = 500): Array<{ ts: number, id?: string, iv: string, ct: string }> {
  const p = attacheDir(file)
  if (!fs.existsSync(p)) return []
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
  const out: Array<{ ts: number, iv: string, ct: string }> = []
  for (const line of lines) {
    try { out.push(JSON.parse(line)) } catch {}
  }
  return out.slice(-max)
}

export interface AttacheEnvelope { v: number, encrypted: true, iv: string, ct: string, savedAt?: string, savedBy?: string }

// ── Statuts des items du majordome (traité / ignoré) ──
// Fichier en clair MAIS indexé par ids opaques (aléatoires) : aucun contenu
// n'y transite — l'app peut donc les écrire sans détenir de clé.

export type MajordomeStatus = 'traite' | 'ignore'

export function readMajordomeStatuses(): Record<string, { status: MajordomeStatus, at: string, by: string }> {
  return readJson(attacheDir('majordome-status.json'), {})
}

export async function setMajordomeStatus(id: string, status: MajordomeStatus, by: string): Promise<void> {
  if (!/^[a-f0-9]{6,32}$/.test(id)) throw new Error('Identifiant invalide')
  await withFileLock('attache-majordome-status', async () => {
    const all = readMajordomeStatuses()
    all[id] = { status, at: new Date().toISOString(), by }
    atomicWrite(attacheDir('majordome-status.json'), JSON.stringify(all, null, 2))
  })
}

// ── Statuts des questions posées par l'attaché (répondu / ignoré) ──
// Même modèle que les statuts du majordome : fichier en clair indexé par
// ids opaques (qid aléatoires) — aucun contenu n'y transite.

export type QuestionStatus = 'repondu' | 'ignore'

export function readQuestionStatuses(): Record<string, { status: QuestionStatus, at: string, by: string }> {
  return readJson(attacheDir('questions-status.json'), {})
}

export async function setQuestionStatus(id: string, status: QuestionStatus, by: string): Promise<void> {
  if (!/^[a-f0-9]{6,32}$/.test(id)) throw new Error('Identifiant invalide')
  await withFileLock('attache-questions-status', async () => {
    const all = readQuestionStatuses()
    all[id] = { status, at: new Date().toISOString(), by }
    atomicWrite(attacheDir('questions-status.json'), JSON.stringify(all, null, 2))
  })
}

export function readMemoryEnvelope(): AttacheEnvelope | null {
  return readJson<AttacheEnvelope | null>(attacheDir('memory.json'), null)
}

/** Écrit la mémoire (enveloppe fournie par le navigateur admin), version archivée avant. */
export async function writeMemoryEnvelope(envelope: AttacheEnvelope): Promise<void> {
  await writeVersionedEnvelope('memory', envelope)
}

/** Consignes permanentes (le « prompt » du magistrat) — même modèle que la mémoire. */
export function readInstructionsEnvelope(): AttacheEnvelope | null {
  return readJson<AttacheEnvelope | null>(attacheDir('instructions.json'), null)
}

export async function writeInstructionsEnvelope(envelope: AttacheEnvelope): Promise<void> {
  await writeVersionedEnvelope('instructions', envelope)
}

// ── Collections d'enveloppes (skills, trames, base de connaissances) ──
// Un fichier-enveloppe par entrée, dans le même répertoire et au même format
// que le service attaché (attache/<collection>/) : le navigateur admin
// chiffre/déchiffre, l'app ne voit que des enveloppes. Versionnage avant
// toute réécriture ou suppression — rien n'est jamais écrasé à sec.

const ENTRY_ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/
type AttacheCollection = 'skills' | 'trames' | 'kb'

export function listCollectionEnvelopes(collection: AttacheCollection): Array<{ id: string, envelope: AttacheEnvelope }> {
  const dir = attacheDir(collection)
  if (!fs.existsSync(dir)) return []
  const out: Array<{ id: string, envelope: AttacheEnvelope }> = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue
    const id = f.slice(0, -'.json'.length)
    if (!ENTRY_ID_RE.test(id)) continue
    const envelope = readJson<AttacheEnvelope | null>(path.join(dir, f), null)
    if (envelope) out.push({ id, envelope })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export async function writeCollectionEnvelope(collection: AttacheCollection, id: string, envelope: AttacheEnvelope): Promise<void> {
  if (!ENTRY_ID_RE.test(id)) throw new Error('Identifiant invalide')
  const p = attacheDir(collection, id + '.json')
  await withFileLock(`attache-${collection}-` + id, async () => {
    if (fs.existsSync(p)) {
      const vdir = attacheDir(collection, '.versions', id)
      ensureDir(vdir)
      fs.copyFileSync(p, path.join(vdir, new Date().toISOString().replace(/:/g, '_') + '.json'))
    }
    ensureDir(path.dirname(p))
    atomicWrite(p, JSON.stringify(envelope, null, 2))
  })
}

/** Suppression réversible : la version courante est archivée avant retrait. */
export async function deleteCollectionEnvelope(collection: AttacheCollection, id: string): Promise<boolean> {
  if (!ENTRY_ID_RE.test(id)) throw new Error('Identifiant invalide')
  const p = attacheDir(collection, id + '.json')
  return withFileLock(`attache-${collection}-` + id, async () => {
    if (!fs.existsSync(p)) return false
    const vdir = attacheDir(collection, '.versions', id)
    ensureDir(vdir)
    fs.copyFileSync(p, path.join(vdir, new Date().toISOString().replace(/:/g, '_') + '~suppression.json'))
    fs.unlinkSync(p)
    return true
  })
}

export const listSkillEnvelopes = () => listCollectionEnvelopes('skills')
export const writeSkillEnvelope = (id: string, envelope: AttacheEnvelope) => writeCollectionEnvelope('skills', id, envelope)
export const deleteSkillEnvelope = (id: string) => deleteCollectionEnvelope('skills', id)

/** Écrit une enveloppe d'attaché en archivant la version précédente (jamais d'écrasement sec). */
async function writeVersionedEnvelope(name: 'memory' | 'instructions', envelope: AttacheEnvelope): Promise<void> {
  const p = attacheDir(name + '.json')
  await withFileLock('attache-' + name, async () => {
    if (fs.existsSync(p)) {
      const vdir = path.join(path.dirname(p), '.versions', name)
      ensureDir(vdir)
      const stamp = new Date().toISOString().replace(/:/g, '_')
      fs.copyFileSync(p, path.join(vdir, stamp + '.json'))
    }
    atomicWrite(p, JSON.stringify(envelope, null, 2))
  })
}
