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
import { dataDir, ensureDir, readJson, writeJson, withFileLock, DEFAULT_TJ_ID } from './store'

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
  /** Juridiction de rattachement (nom lisible du TJ principal) — informatif */
  tribunal?: string
  /** TJ accessibles (identifiants du registre tjs.json). Absent = TJ par défaut. */
  tjs?: string[]
  /** Dernier TJ actif (repris à la connexion suivante s'il est toujours autorisé). */
  lastTj?: string
  credentials: StoredCredential[]
  /** Hachage scrypt du mot de passe (optionnel — complément aux passkeys). */
  passwordHash?: string
  createdAt: string
  lastLoginAt?: string
}

/** TJ accessibles d'un compte — les comptes historiques relèvent du TJ par défaut. */
export function accountTjs(account: Account): string[] {
  return account.tjs && account.tjs.length ? account.tjs : [DEFAULT_TJ_ID]
}

/** TJ actif à la connexion : le dernier utilisé s'il est encore autorisé, sinon le premier. */
export function initialTj(account: Account): string {
  const tjs = accountTjs(account)
  return account.lastTj && tjs.includes(account.lastTj) ? account.lastTj : tjs[0]
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
interface SessionPayload { u: string, r: 'admin' | 'member', tj: string, exp: number }

function sign(data: string): string {
  return crypto.createHmac('sha256', serverSecret()).update(data).digest('base64url')
}

export function createSessionCookie(account: Account, tj?: string): string {
  const active = tj && accountTjs(account).includes(tj) ? tj : initialTj(account)
  const payload: SessionPayload = {
    u: account.username,
    r: account.role,
    tj: active,
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
    // cookies émis avant le multi-TJ : ils relèvent du TJ par défaut
    if (!payload.tj) payload.tj = DEFAULT_TJ_ID
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

/**
 * Garde des routes de DONNÉES : session valide ET accès au TJ actif encore
 * autorisé sur le compte (révocation par l'admin effective immédiatement,
 * sans attendre l'expiration du cookie). Lève 401/403 sinon.
 */
export function requireTjSession(req: Request): SessionPayload {
  const s = requireSession(req)
  const account = findAccount(s.u)
  if (!account || !accountTjs(account).includes(s.tj)) {
    throw new Response(JSON.stringify({ error: 'Accès à ce tribunal révoqué — reconnectez-vous' }), {
      status: 403,
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
    // le détail (chemins, parse…) reste côté serveur : jamais dans la réponse
    console.error('[api]', e)
    return jsonResponse({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── Limiteur de tentatives en mémoire (endpoints publics sensibles) ──
const attempts = new Map<string, { count: number, resetAt: number }>()

/** Lève une 429 au-delà de `max` appels par `windowMs` pour la clé donnée (ex. IP). */
export function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs })
    if (attempts.size > 10000) {
      for (const [k, v] of attempts) { if (v.resetAt < now) attempts.delete(k) }
    }
    return
  }
  entry.count++
  if (entry.count > max) {
    throw new Response(JSON.stringify({ error: 'Trop de tentatives — réessayez plus tard' }), {
      status: 429, headers: { 'content-type': 'application/json' },
    })
  }
}

export function clientIp(req: Request): string {
  // Le serveur applicatif n'est joignable QUE par le reverse-proxy Caddy (port
  // 3000 non publié). Caddy AJOUTE l'IP réelle du client en fin de
  // X-Forwarded-For. On lit donc le DERNIER segment : le premier est fourni par
  // le client et peut être forgé pour contourner le rate-limiting (on prenait
  // le premier auparavant → limites d'anti-force-brute contournables).
  const xff = req.headers.get('x-forwarded-for')
  if (!xff) return 'local'
  const parts = xff.split(',').map(s => s.trim()).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : 'local'
}

/** Comparaison à temps constant (codes d'enrôlement…). */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}
