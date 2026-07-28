/**
 * SIRAL — Connecteur Claude web (serveur MCP distant) · état et OAuth.
 *
 * Permet au magistrat ADMINISTRATEUR de brancher claude.ai (« connecteur
 * personnalisé ») sur SIRAL : Claude web obtient les MÊMES outils que
 * l'attaché (lecture des dossiers, écritures réversibles, statistiques…),
 * servis par le service attaché — l'app ne détient toujours aucune clé.
 *
 * Modèle de sécurité :
 *  - OAuth 2.1 minimal côté app : enregistrement dynamique (RFC 7591),
 *    autorisation avec session admin + consentement + PKCE S256 obligatoire,
 *    jetons opaques stockés HASHÉS (sha256), refresh à rotation stricte.
 *  - Seul un ADMIN du TJ confié à l'attaché peut autoriser une connexion ;
 *    chaque appel MCP revérifie que le compte est toujours admin.
 *  - Fonctionnalité OPT-IN : désactivée par défaut, interrupteur dans
 *    Paramètres → Attaché IA. Désactivée ou attaché absent → toutes les
 *    routes répondent 404, indistinguables d'une route inexistante.
 *  - Révocation un clic (par connexion ou totale) — effet immédiat.
 *  - Les redirect_uri sont bornés aux domaines Claude (claude.ai/claude.com),
 *    extensibles via SIRAL_MCP_REDIRECT_HOSTS pour un client MCP de test.
 */
import crypto from 'crypto'
import { findAccount, accountTjs, serverSecret } from './auth'
import { attacheEnabled, attacheTjId } from './attache'
import { tjDataDir, readJson, withFileLock, atomicWrite } from './store'

const CODE_TTL_MS = 10 * 60 * 1000               // code d'autorisation : 10 min
const ACCESS_TTL_MS = 2 * 3600 * 1000            // jeton d'accès : 2 h (Claude rafraîchit seul)
const REFRESH_TTL_MS = 90 * 24 * 3600 * 1000     // jeton de rafraîchissement : 90 j, rotation à chaque usage
const MAX_CLIENTS = 10
const MAX_TOKENS = 200
const MAX_JOURNAL = 100

export interface OAuthClient {
  id: string
  name: string
  redirectUris: string[]
  /** none = client public (PKCE seul) ; sinon secret vérifié (hash). */
  authMethod: 'none' | 'client_secret_post' | 'client_secret_basic'
  secretHash?: string
  createdAt: string
  lastUsedAt?: string
}

interface AuthCode {
  h: string                 // sha256(code)
  clientId: string
  redirectUri: string
  challenge: string         // code_challenge S256
  user: string
  exp: number
  createdAt: string
}

interface TokenRecord {
  h: string                 // sha256(jeton)
  kind: 'access' | 'refresh'
  clientId: string
  user: string
  family: string            // identifiant du consentement d'origine (révocation groupée)
  exp: number
  createdAt: string
  lastUsedAt?: string
}

interface JournalEntry { at: string, type: string, who?: string, client?: string, detail?: string }

interface ConnectorState {
  enabled: boolean
  enabledBy?: string
  enabledAt?: string
  clients: OAuthClient[]
  codes: AuthCode[]
  tokens: TokenRecord[]
  journal: JournalEntry[]
}

const EMPTY: ConnectorState = { enabled: false, clients: [], codes: [], tokens: [], journal: [] }

function statePath(): string {
  return tjDataDir(attacheTjId(), 'mcp-connecteur.json')
}

export function readConnector(): ConnectorState {
  const s = readJson<ConnectorState>(statePath(), EMPTY)
  return {
    ...EMPTY,
    ...s,
    clients: s.clients || [],
    codes: s.codes || [],
    tokens: s.tokens || [],
    journal: s.journal || [],
  }
}

async function mutate<T>(fn: (s: ConnectorState) => T | Promise<T>): Promise<T> {
  return withFileLock('mcp-connecteur', async () => {
    const s = readConnector()
    const out = await fn(s)
    prune(s)
    atomicWrite(statePath(), JSON.stringify(s, null, 2))
    return out
  })
}

/** Purge opportuniste : codes/jetons expirés, bornes de taille. */
function prune(s: ConnectorState) {
  const now = Date.now()
  s.codes = s.codes.filter((c) => c.exp > now).slice(-50)
  s.tokens = s.tokens.filter((t) => t.exp > now)
  if (s.tokens.length > MAX_TOKENS) {
    s.tokens.sort((a, b) => (a.lastUsedAt || a.createdAt) < (b.lastUsedAt || b.createdAt) ? -1 : 1)
    s.tokens = s.tokens.slice(s.tokens.length - MAX_TOKENS)
  }
  if (s.journal.length > MAX_JOURNAL) s.journal = s.journal.slice(-MAX_JOURNAL)
}

function log(s: ConnectorState, entry: Omit<JournalEntry, 'at'>) {
  s.journal.push({ at: new Date().toISOString(), ...entry })
}

// ── Disponibilité ──

/** La fonctionnalité existe-t-elle sur ce serveur (attaché configuré) ? */
export function connectorConfigured(): boolean {
  return attacheEnabled()
}

/** Le connecteur est-il configuré ET activé par l'administrateur ? */
export function connectorActive(): boolean {
  return connectorConfigured() && readConnector().enabled
}

export async function setConnectorEnabled(enabled: boolean, by: string): Promise<void> {
  await mutate((s) => {
    s.enabled = enabled
    s.enabledBy = by
    s.enabledAt = new Date().toISOString()
    log(s, { type: enabled ? 'activation' : 'desactivation', who: by })
    // Désactivation = coupure immédiate : plus aucun jeton ni code valable.
    if (!enabled) { s.tokens = []; s.codes = [] }
  })
}

// ── Aides crypto ──

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex')
const randomToken = (prefix: string) => `${prefix}_${crypto.randomBytes(32).toString('base64url')}`

function safeHashEqual(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex')
  const b = Buffer.from(bHex, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Vérification PKCE S256 : challenge attendu = base64url(sha256(verifier)). */
function pkceMatches(challenge: string, verifier: string): boolean {
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false
  const computed = crypto.createHash('sha256').update(verifier).digest('base64url')
  const a = Buffer.from(computed)
  const b = Buffer.from(String(challenge))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// ── Redirections autorisées ──

/**
 * Domaines de retour OAuth admis : les domaines Claude officiels, plus les
 * hôtes listés dans SIRAL_MCP_REDIRECT_HOSTS (test avec MCP Inspector…).
 * http:// n'est toléré que pour localhost.
 */
export function allowedRedirect(uri: string): boolean {
  let u: URL
  try { u = new URL(uri) } catch { return false }
  const host = u.hostname.toLowerCase()
  const extras = (process.env.SIRAL_MCP_REDIRECT_HOSTS || '')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
  const isLocal = host === 'localhost' || host === '127.0.0.1'
  const claude = host === 'claude.ai' || host === 'claude.com'
    || host.endsWith('.claude.ai') || host.endsWith('.claude.com')
  if (u.protocol === 'https:') return claude || extras.includes(host)
  if (u.protocol === 'http:') return isLocal && (claude || extras.includes(host) || extras.includes('localhost'))
  return false
}

// ── Enregistrement dynamique (RFC 7591) ──

export async function registerClient(input: { name?: string, redirectUris: string[], authMethod?: string }): Promise<{ client: OAuthClient, secret?: string }> {
  const uris = (input.redirectUris || []).map(String).slice(0, 5)
  if (!uris.length) throw new Error('redirect_uris requis')
  for (const uri of uris) {
    if (!allowedRedirect(uri)) throw new Error(`redirect_uri refusé : ${uri}`)
  }
  const authMethod: OAuthClient['authMethod'] =
    input.authMethod === 'client_secret_post' || input.authMethod === 'client_secret_basic'
      ? input.authMethod
      : 'none'
  const client: OAuthClient = {
    id: 'smc_' + crypto.randomBytes(16).toString('hex'),
    name: String(input.name || 'Client MCP').slice(0, 80),
    redirectUris: uris,
    authMethod,
    createdAt: new Date().toISOString(),
  }
  let secret: string | undefined
  if (authMethod !== 'none') {
    secret = randomToken('smcs')
    client.secretHash = sha256(secret)
  }
  await mutate((s) => {
    // borne anti-accumulation : on écarte les clients les plus anciens SANS jeton actif
    while (s.clients.length >= MAX_CLIENTS) {
      const idx = s.clients.findIndex((c) => !s.tokens.some((t) => t.clientId === c.id))
      if (idx < 0) { s.clients.shift() } else { s.clients.splice(idx, 1) }
    }
    s.clients.push(client)
    log(s, { type: 'client_enregistre', client: client.name })
  })
  return { client, secret }
}

export function findClient(id: string): OAuthClient | null {
  return readConnector().clients.find((c) => c.id === id) || null
}

/** Authentification du client au token endpoint (public + PKCE, ou secret). */
export function clientAuthOk(client: OAuthClient, providedSecret: string | null): boolean {
  if (client.authMethod === 'none') return true
  if (!providedSecret || !client.secretHash) return false
  return safeHashEqual(sha256(providedSecret), client.secretHash)
}

// ── Codes d'autorisation ──

export async function createAuthCode(input: { clientId: string, redirectUri: string, challenge: string, user: string }): Promise<string> {
  const code = randomToken('smcc')
  await mutate((s) => {
    s.codes.push({
      h: sha256(code),
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      challenge: input.challenge,
      user: input.user,
      exp: Date.now() + CODE_TTL_MS,
      createdAt: new Date().toISOString(),
    })
  })
  return code
}

export interface IssuedTokens { accessToken: string, refreshToken: string, expiresIn: number }

/** Échange code → jetons (usage unique, PKCE obligatoire, liaison client + redirect_uri). */
export async function exchangeCode(input: { code: string, clientId: string, redirectUri: string, verifier: string }): Promise<IssuedTokens | { error: string }> {
  return mutate((s) => {
    const h = sha256(String(input.code || ''))
    const idx = s.codes.findIndex((c) => safeHashEqual(c.h, h))
    if (idx < 0) return { error: 'Code inconnu ou déjà utilisé' }
    const rec = s.codes[idx]
    s.codes.splice(idx, 1) // usage unique, même en cas d'échec plus bas
    if (rec.exp < Date.now()) return { error: 'Code expiré' }
    if (rec.clientId !== input.clientId) return { error: 'Client inattendu' }
    if (rec.redirectUri !== String(input.redirectUri || '')) return { error: 'redirect_uri différent de l\'autorisation' }
    if (!pkceMatches(rec.challenge, String(input.verifier || ''))) return { error: 'Vérification PKCE échouée' }
    return issueTokens(s, rec.clientId, rec.user, 'smcf_' + crypto.randomBytes(8).toString('hex'))
  })
}

function issueTokens(s: ConnectorState, clientId: string, user: string, family: string): IssuedTokens {
  const accessToken = randomToken('smca')
  const refreshToken = randomToken('smcr')
  const now = new Date().toISOString()
  s.tokens.push(
    { h: sha256(accessToken), kind: 'access', clientId, user, family, exp: Date.now() + ACCESS_TTL_MS, createdAt: now },
    { h: sha256(refreshToken), kind: 'refresh', clientId, user, family, exp: Date.now() + REFRESH_TTL_MS, createdAt: now },
  )
  const client = s.clients.find((c) => c.id === clientId)
  if (client) client.lastUsedAt = now
  return { accessToken, refreshToken, expiresIn: Math.floor(ACCESS_TTL_MS / 1000) }
}

/** Rafraîchissement à ROTATION STRICTE : l'ancien refresh meurt, la famille est renouvelée. */
export async function refreshAccess(input: { refreshToken: string, clientId: string }): Promise<IssuedTokens | { error: string }> {
  return mutate((s) => {
    const h = sha256(String(input.refreshToken || ''))
    const idx = s.tokens.findIndex((t) => t.kind === 'refresh' && safeHashEqual(t.h, h))
    if (idx < 0) return { error: 'Jeton de rafraîchissement inconnu ou révoqué' }
    const rec = s.tokens[idx]
    if (rec.exp < Date.now()) { s.tokens.splice(idx, 1); return { error: 'Jeton de rafraîchissement expiré' } }
    if (rec.clientId !== input.clientId) return { error: 'Client inattendu' }
    // rotation : tous les jetons de la famille tombent, une nouvelle famille naît
    s.tokens = s.tokens.filter((t) => t.family !== rec.family)
    return issueTokens(s, rec.clientId, rec.user, 'smcf_' + crypto.randomBytes(8).toString('hex'))
  })
}

// ── Validation d'un appel MCP ──

export interface ConnectorPrincipal { user: string, clientId: string, clientName: string }

/**
 * Valide un Bearer : jeton d'accès connu, non expiré, ET compte toujours
 * administrateur du TJ confié (une rétrogradation coupe l'accès sans délai).
 */
export function validateAccessToken(bearer: string | null): ConnectorPrincipal | null {
  if (!bearer) return null
  const s = readConnector()
  if (!s.enabled) return null
  const h = sha256(bearer)
  const rec = s.tokens.find((t) => t.kind === 'access' && safeHashEqual(t.h, h))
  if (!rec || rec.exp < Date.now()) return null
  const account = findAccount(rec.user)
  if (!account || account.role !== 'admin' || !accountTjs(account).includes(attacheTjId())) return null
  const client = s.clients.find((c) => c.id === rec.clientId)
  // horodatage d'usage, au plus une écriture par minute par jeton
  const last = rec.lastUsedAt ? Date.parse(rec.lastUsedAt) : 0
  if (Date.now() - last > 60_000) {
    void mutate((st) => {
      const r = st.tokens.find((t) => t.kind === 'access' && safeHashEqual(t.h, h))
      if (r) r.lastUsedAt = new Date().toISOString()
      const c = st.clients.find((x) => x.id === rec.clientId)
      if (c) c.lastUsedAt = new Date().toISOString()
    }).catch(() => {})
  }
  return { user: rec.user, clientId: rec.clientId, clientName: client?.name || 'Client MCP' }
}

// ── Révocation ──

export async function revokeClient(clientId: string, by: string): Promise<boolean> {
  return mutate((s) => {
    const client = s.clients.find((c) => c.id === clientId)
    if (!client) return false
    s.clients = s.clients.filter((c) => c.id !== clientId)
    s.tokens = s.tokens.filter((t) => t.clientId !== clientId)
    s.codes = s.codes.filter((c) => c.clientId !== clientId)
    log(s, { type: 'revocation_client', who: by, client: client.name })
    return true
  })
}

export async function revokeAll(by: string): Promise<void> {
  await mutate((s) => {
    s.clients = []
    s.tokens = []
    s.codes = []
    log(s, { type: 'revocation_totale', who: by })
  })
}

export async function logAuthorization(user: string, clientName: string): Promise<void> {
  await mutate((s) => log(s, { type: 'autorisation', who: user, client: clientName }))
}

// ── Résumé pour le panneau d'administration ──

export function connectorSummary() {
  const s = readConnector()
  const now = Date.now()
  return {
    configured: connectorConfigured(),
    enabled: s.enabled,
    enabledBy: s.enabledBy,
    enabledAt: s.enabledAt,
    clients: s.clients.map((c) => ({
      id: c.id,
      name: c.name,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
      accessActifs: s.tokens.filter((t) => t.clientId === c.id && t.kind === 'access' && t.exp > now).length,
      refreshActifs: s.tokens.filter((t) => t.clientId === c.id && t.kind === 'refresh' && t.exp > now).length,
    })),
    journal: s.journal.slice(-30).reverse(),
  }
}

// ── Jeton de consentement (anti-CSRF, en plus de SameSite=Lax) ──
// La page d'autorisation embarque une capsule HMAC des paramètres exacts de
// la demande ; le POST d'approbation doit la restituer intacte et fraîche.

export function signConsent(payload: { c: string, r: string, ch: string, st: string }): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + CODE_TTL_MS })).toString('base64url')
  const sig = crypto.createHmac('sha256', serverSecret()).update('mcp-consent:' + body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyConsent(token: string): { c: string, r: string, ch: string, st: string } | null {
  const dot = String(token || '').lastIndexOf('.')
  if (dot < 0) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = crypto.createHmac('sha256', serverSecret()).update('mcp-consent:' + body).digest('base64url')
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    return { c: String(payload.c), r: String(payload.r), ch: String(payload.ch), st: String(payload.st) }
  } catch {
    return null
  }
}
