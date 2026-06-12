/**
 * SIRAL — chiffrement côté client (E2EE).
 * AES-256-GCM via WebCrypto, clé dérivée de la phrase secrète par
 * PBKDF2-SHA256 (600 000 itérations, sel serveur public).
 * La phrase secrète et la clé ne quittent JAMAIS le navigateur.
 */

export interface CipherEnvelope {
  v: number
  encrypted: true
  iv: string   // base64
  ct: string   // base64
  savedAt?: string
  savedBy?: string
}

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(s)
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export function b64urlToBytes(s: string): Uint8Array {
  return b64decode(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))
}

export async function deriveKey(passphrase: string, saltB64url: string, iterations: number): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const material = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64urlToBytes(saltB64url) as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptJson(key: CryptoKey, payload: unknown, meta?: { savedAt?: string, savedBy?: string }): Promise<CipherEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(JSON.stringify(payload))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data as BufferSource)
  return { v: 1, encrypted: true, iv: b64encode(iv), ct: b64encode(ct), ...meta }
}

export async function decryptJson<T = unknown>(key: CryptoKey, envelope: CipherEnvelope): Promise<T> {
  const iv = b64decode(envelope.iv)
  const ct = b64decode(envelope.ct)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource)
  return JSON.parse(new TextDecoder().decode(plain)) as T
}

export async function encryptBytes(key: CryptoKey, bytes: Uint8Array): Promise<{ iv: string, ct: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, bytes as BufferSource)
  return { iv: b64encode(iv), ct: new Uint8Array(ct) }
}

export async function decryptBytes(key: CryptoKey, ivB64: string, ct: Uint8Array): Promise<Uint8Array> {
  const iv = b64decode(ivB64)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource)
  return new Uint8Array(plain)
}

export const b64 = { encode: b64encode, decode: b64decode }
