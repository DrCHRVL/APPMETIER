/**
 * SIRAL — trousseau de clés individuel (cloisonnement E2EE).
 *
 * Chaque utilisateur possède une phrase personnelle qui déverrouille SON
 * trousseau (coffre `keyring-<utilisateur>`). Le trousseau contient les clés
 * des données, par périmètre (« scope ») :
 *   - 'global'    : coffres partagés (tags, audience, alertes, carto, app-data,
 *                   instructions, préférences, documents, événements, audit…)
 *   - 'ctx-<id>'  : un contentieux (coffres `ctx-<id>` et `ctx-alerts-<id>`)
 *
 * Le serveur ne voit jamais une clé en clair : les trousseaux et les
 * invitations sont des enveloppes AES-GCM comme tout le reste. Donner accès à
 * un collègue = lui transmettre (hors-ligne) un code d'invitation à usage
 * unique qui déchiffre une copie des clés (coffre `grant-<utilisateur>`).
 * Révoquer = supprimer son trousseau.
 */
import { b64 } from './crypto'

export const SCOPE_GLOBAL = 'global'

/** Identifiants des contentieux connus (alignés sur CONTENTIEUX_FOLDERS de main.js). */
export const KNOWN_CONTENTIEUX = ['crimorg', 'ecofi', 'enviro']

export interface KeyringPayload {
  v: 1
  /** scope → clé AES-256 brute en base64 */
  keys: Record<string, string>
  createdAt: string
  updatedAt: string
}

export interface KdfParams { salt: string, iterations: number }

export interface ScopedKeys {
  global: CryptoKey
  byScope: Map<string, CryptoKey>
  /** scopes → clé brute base64 (nécessaire pour inviter / re-chiffrer) */
  raw: Record<string, string>
}

/** Périmètre de chiffrement d'un coffre, d'après son nom. */
export function scopeOfVault(name: string): string {
  const m = /^ctx-alerts-(.+)$/.exec(name) || /^ctx-(.+)$/.exec(name)
  if (m) return `ctx-${m[1]}`
  return SCOPE_GLOBAL
}

/** PBKDF2-SHA256 → 32 octets bruts (mêmes bits que deriveKey : compatible avec l'existant). */
export async function deriveRawKey(passphrase: string, saltB64url: string, iterations: number): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const material = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits'])
  const salt = b64urlToBytes(saltB64url)
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, material, 256)
  return new Uint8Array(bits)
}

export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export function randomRawKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

export function newKdfParams(): KdfParams {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return { salt: bytesToB64url(salt), iterations: 600_000 }
}

/**
 * Code d'invitation à usage unique : 20 caractères Crockford-base32
 * (~100 bits d'entropie), groupés pour la dictée par téléphone.
 */
export function generateInvitationCode(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  const rnd = crypto.getRandomValues(new Uint8Array(20))
  let s = ''
  for (let i = 0; i < 20; i++) {
    s += alphabet[rnd[i] % 32]
    if (i % 5 === 4 && i < 19) s += '-'
  }
  return s
}

/** Normalise un code saisi (espaces, tirets, minuscules, confusions O/0, I/L/1). */
export function normalizeInvitationCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1')
    .replace(/(.{5})(?=.)/g, '$1-')
}

export async function buildScopedKeys(payload: KeyringPayload): Promise<ScopedKeys> {
  const byScope = new Map<string, CryptoKey>()
  for (const [scope, rawB64] of Object.entries(payload.keys)) {
    byScope.set(scope, await importAesKey(b64.decode(rawB64)))
  }
  const global = byScope.get(SCOPE_GLOBAL)
  if (!global) throw new Error('Trousseau invalide : clé globale absente')
  return { global, byScope, raw: { ...payload.keys } }
}

/** Trousseau complet neuf (serveur vierge) : clés aléatoires pour tous les périmètres. */
export function freshKeyringPayload(): KeyringPayload {
  const keys: Record<string, string> = { [SCOPE_GLOBAL]: b64.encode(randomRawKey()) }
  for (const id of KNOWN_CONTENTIEUX) keys[`ctx-${id}`] = b64.encode(randomRawKey())
  const now = new Date().toISOString()
  return { v: 1, keys, createdAt: now, updatedAt: now }
}

function b64urlToBytes(s: string): Uint8Array {
  return b64.decode(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))
}

function bytesToB64url(bytes: Uint8Array): string {
  return b64.encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
