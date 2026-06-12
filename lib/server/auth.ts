/**
 * SIRAL — authentification serveur.
 *
 * - Comptes : passkeys WebAuthn (anti-phishing, sans mot de passe).
 *   Enrôlement protégé par un code d'enrôlement (SIRAL_SETUP_CODE) défini
 *   par l'administrateur du serveur. Le premier compte créé est admin.
 * - Sessions : cookie HttpOnly signé HMAC-SHA256 (aucun stockage serveur),
 *   expiration 12 h, invalidation globale par rotation du secret.
 *
 * Le serveur n'a JAMAIS accès à la phrase secrète E2EE : l'authentification
 * (qui entre) est totalement découplée du déchiffrement (qui lit).
 */
import fs from 'fs'
import crypto from 'crypto'
import { dataDir, ensureDir, readJson, writeJson, withFileLock } from './store'

const SESSION_HOURS = 12
const COOKIE_NAME = 'siral_session'

export interface StoredCredential {
  credID: string            // base64url
  publicKey: string         // base64url
  counter: number
  transports?: string[]
  label?: string
  createdAt: string
}

export interface Account {
  id: string
  username: string
  displayName: string
  role: 'admin' | 'member'
  /** Juridiction de rattachement (ex. « TJ Marseille ») — informatif et filtrage futur */
  tribunal?: string
  credentials: StoredCredential[]
  createdAt: string
  lastLoginAt?: string
}

function accountsPath() { return dataDir('accounts.json') }

export function listAccounts(): Account[] {
  return readJson<Account[]>(accountsPath(), [])
}

export function findAccount(username: string): Account | null {
  const u = username.trim().toLowerCase()
  return listAccounts().find((a) => a.username.toLowerCase() === u) || null
}

export async function saveAccount(account: Account): Promise<void> {
  await withFileLock('accounts', async () => {
    const all = listAccounts()
    const idx = all.findIndex((a) => a.id === account.id)
    if (idx >= 0) all[idx] = account
    else all.push(account)
    writeJson(accountsPath(), all)
  })
}

export function isValidUsername(username: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9._-]{1,40}$/.test(username)
}

// ── Secret de signature des sessions ──
let cachedSecret: Buffer | null = null
export function serverSecret(): Buffer {
  if (cachedSecret) return cachedSecret
  if (process.env.SIRAL_SECRET) {
    cachedSecret = crypto.createHash('sha256').update(process.env.SIRAL_SECRET).digest()
    return cachedSecret
  }
  const p = dataDir('secret.key')
  if (fs.existsSync(p)) {
    cachedSecret = Buffer.from(fs.readFileSync(p, 'utf8').trim(), 'hex')
  } else {
    ensureDir(dataDir())
    const s = crypto.randomBytes(32)
    fs.writeFileSync(p, s.toString('hex'), { mode: 0o600 })
    cachedSecret = s
  }
  return cachedSecret
}

export function setupCode(): string | null {
  return process.env.SIRAL_SETUP_CODE || null
}

// ── Cookies de session signés ──
interface SessionPayload { u: string, r: 'admin' | 'member', exp: number }

function sign(data: string): string {
  return crypto.createHmac('sha256', serverSecret()).update(data).digest('base64url')
}

export function createSessionCookie(account: Account): string {
  const payload: SessionPayload = {
    u: account.username,
    r: account.role,
    exp: Date.now() + SESSION_HOURS * 3600 * 1000,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body)}`
}

export function verifySessionCookie(value: string | undefined | null): SessionPayload | null {
  if (!value) return null
  const dot = value.lastIndexOf('.')
  if (dot < 0) return null
  const body = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  const expected = sign(body)
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (!payload.u || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export function sessionCookieHeader(value: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === 'production' && process.env.SIRAL_INSECURE_HTTP !== '1'
  return [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}

export function clearSessionCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export function getSession(req: Request): SessionPayload | null {
  const cookies = req.headers.get('cookie') || ''
  const match = cookies.split(/;\s*/).find((c) => c.startsWith(COOKIE_NAME + '='))
  return verifySessionCookie(match ? match.slice(COOKIE_NAME.length + 1) : null)
}

/** Garde d'authentification pour les routes API. Retourne la session ou lève une Response 401. */
export function requireSession(req: Request): SessionPayload {
  const s = getSession(req)
  if (!s) {
    throw new Response(JSON.stringify({ error: 'Non authentifié' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }
  return s
}

// ── Défis WebAuthn éphémères (mémoire process, TTL 5 min) ──
const challenges = new Map<string, { challenge: string, exp: number }>()

export function storeChallenge(key: string, challenge: string) {
  // purge opportuniste
  const now = Date.now()
  for (const [k, v] of challenges) { if (v.exp < now) challenges.delete(k) }
  challenges.set(key, { challenge, exp: now + 5 * 60 * 1000 })
}

export function takeChallenge(key: string): string | null {
  const entry = challenges.get(key)
  challenges.delete(key)
  if (!entry || entry.exp < Date.now()) return null
  return entry.challenge
}

// ── RP (Relying Party) WebAuthn ──
export function rpFromRequest(req: Request): { rpID: string, origin: string, rpName: string } {
  const url = new URL(req.url)
  const fwdHost = req.headers.get('x-forwarded-host')
  const fwdProto = req.headers.get('x-forwarded-proto')
  const host = (fwdHost || url.host).split(',')[0].trim()
  const proto = (fwdProto || url.protocol.replace(':', '')).split(',')[0].trim()
  const rpID = process.env.SIRAL_RP_ID || host.split(':')[0]
  const origin = process.env.SIRAL_ORIGIN || `${proto}://${host}`
  return { rpID, origin, rpName: 'SIRAL' }
}

export function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  })
}

/** Enveloppe standard des handlers : catch des Response levées par requireSession. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof Response) return e
    const msg = e instanceof Error ? e.message : 'Erreur serveur'
    return jsonResponse({ error: msg }, { status: 500 })
  }
}
