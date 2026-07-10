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

export function readEncryptedLog(file: 'feed.jsonl' | 'audit.jsonl' | 'outbox.jsonl', max = 500): Array<{ ts: number, iv: string, ct: string }> {
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

export function readMemoryEnvelope(): AttacheEnvelope | null {
  return readJson<AttacheEnvelope | null>(attacheDir('memory.json'), null)
}

/** Écrit la mémoire (enveloppe fournie par le navigateur admin), version archivée avant. */
export async function writeMemoryEnvelope(envelope: AttacheEnvelope): Promise<void> {
  const p = attacheDir('memory.json')
  await withFileLock('attache-memory', async () => {
    if (fs.existsSync(p)) {
      const vdir = path.join(path.dirname(p), '.versions', 'memory')
      ensureDir(vdir)
      const stamp = new Date().toISOString().replace(/:/g, '_')
      fs.copyFileSync(p, path.join(vdir, stamp + '.json'))
    }
    atomicWrite(p, JSON.stringify(envelope, null, 2))
  })
}
