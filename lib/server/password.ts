/**
 * SIRAL — authentification par mot de passe.
 *
 * Complément aux passkeys WebAuthn, destiné aux postes où Windows Hello est
 * désactivé par la stratégie d'entreprise (ex. PC pro Justice) et où le QR
 * inter-appareils est bloqué par le réseau. Un compte peut posséder à la fois
 * des passkeys ET un mot de passe.
 *
 * Hachage : scrypt (intégré à Node, résistant au matériel), sel aléatoire par
 * compte, comparaison à temps constant. Le format stocké est autodescriptif :
 *   scrypt$N$r$p$selBase64$hashBase64
 */
import crypto from 'crypto'

const N = 16384  // coût CPU/mémoire (2^14)
const R = 8
const P = 1
const KEYLEN = 32

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password: string, stored: string | undefined | null): boolean {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const n = parseInt(parts[1], 10), r = parseInt(parts[2], 10), p = parseInt(parts[3], 10)
  if (!n || !r || !p) return false
  let salt: Buffer, expected: Buffer
  try {
    salt = Buffer.from(parts[4], 'base64')
    expected = Buffer.from(parts[5], 'base64')
  } catch { return false }
  let actual: Buffer
  try {
    // maxmem relevé : scrypt par défaut plafonne à 32 Mo, insuffisant pour N élevé
    actual = crypto.scryptSync(password, salt, expected.length, { N: n, r, p, maxmem: 256 * 1024 * 1024 })
  } catch { return false }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

/** Politique minimale : 10 caractères. Le reste (robustesse) est à l'appréciation de l'agent. */
export function isAcceptablePassword(password: string): boolean {
  return typeof password === 'string' && password.length >= 10
}
