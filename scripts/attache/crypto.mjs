/**
 * SIRAL — Attaché de justice · crypto côté serveur (Node).
 *
 * Miroir EXACT du chiffrement client (lib/web/crypto.ts) : AES-256-GCM,
 * enveloppes { v:1, encrypted:true, iv, ct } en base64, JSON UTF-8.
 * Tout ce que l'attaché écrit est donc lisible par le navigateur de
 * l'administrateur (clé « global » de son trousseau), et réciproquement.
 *
 * S'y ajoute l'enveloppe « clé-maître » : le trousseau de l'attaché est
 * chiffré au repos par une clé-maître qui ne vit QUE dans l'environnement
 * du service attaché (variable ou fichier-secret), jamais dans le dépôt,
 * jamais à côté des données.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'

export const b64 = {
  encode: (buf) => Buffer.from(buf).toString('base64'),
  decode: (s) => new Uint8Array(Buffer.from(s, 'base64')),
}

/** AES-256-GCM — chiffre un JSON en enveloppe compatible client. */
export function encryptJson(rawKey, payload, meta = {}) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', rawKey, iv)
  const data = Buffer.from(JSON.stringify(payload), 'utf8')
  const ct = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()])
  return { v: 1, encrypted: true, iv: b64.encode(iv), ct: b64.encode(ct), ...meta }
}

/** Déchiffre une enveloppe client (WebCrypto colle le tag GCM en fin de ct). */
export function decryptJson(rawKey, envelope) {
  const iv = Buffer.from(envelope.iv, 'base64')
  const blob = Buffer.from(envelope.ct, 'base64')
  const tag = blob.subarray(blob.length - 16)
  const ct = blob.subarray(0, blob.length - 16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', rawKey, iv)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(ct), decipher.final()])
  return JSON.parse(plain.toString('utf8'))
}

/** Chiffre des octets bruts (documents) — même format que encryptBytes client. */
export function encryptBytes(rawKey, bytes) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', rawKey, iv)
  const ct = Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()])
  return { iv: b64.encode(iv), ct }
}

export function decryptBytes(rawKey, ivB64, ct) {
  const iv = Buffer.from(ivB64, 'base64')
  const tag = ct.subarray(ct.length - 16)
  const body = ct.subarray(0, ct.length - 16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', rawKey, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()])
}

// ── Documents chiffrés (.enc) : magic "SIR1" + iv(12) + ct ──
const DOC_MAGIC = Buffer.from([0x53, 0x49, 0x52, 0x31])

/** Déchiffre un blob document tel que déposé par le client web. */
export function decryptDocBlob(rawKey, blob) {
  if (blob.length < 16 || !blob.subarray(0, 4).equals(DOC_MAGIC)) return null
  const iv = b64.encode(blob.subarray(4, 16))
  return decryptBytes(rawKey, iv, blob.subarray(16))
}

/** Chiffre des octets au format document du client web (SIR1 + iv + ct). */
export function encryptDocBlob(rawKey, bytes) {
  const { iv, ct } = encryptBytes(rawKey, bytes)
  return Buffer.concat([DOC_MAGIC, Buffer.from(b64.decode(iv)), ct])
}

// ── Clé-maître du service attaché ──

/**
 * Charge la clé-maître (32 octets hex) depuis SIRAL_ATTACHE_MASTER_KEY ou le
 * fichier pointé par SIRAL_ATTACHE_MASTER_KEY_FILE. Retourne null si absente :
 * la fonctionnalité est alors désactivée, jamais de clé par défaut.
 */
export function loadMasterKey(env = process.env) {
  let hex = env.SIRAL_ATTACHE_MASTER_KEY || ''
  if (!hex && env.SIRAL_ATTACHE_MASTER_KEY_FILE) {
    try { hex = fs.readFileSync(env.SIRAL_ATTACHE_MASTER_KEY_FILE, 'utf8').trim() } catch { return null }
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null
  return Buffer.from(hex, 'hex')
}

/** Enveloppe la charge utile avec la clé-maître (trousseau de l'attaché au repos). */
export function wrapWithMaster(masterKey, payload) {
  return encryptJson(masterKey, payload)
}

export function unwrapWithMaster(masterKey, envelope) {
  return decryptJson(masterKey, envelope)
}
