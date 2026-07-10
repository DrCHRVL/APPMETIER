/**
 * SIRAL — Attaché de justice · trousseau de l'attaché.
 *
 * L'attaché est traité comme un COLLÈGUE (modèle lib/web/keyring.ts) : il
 * possède son propre trousseau, limité aux périmètres que l'administrateur
 * lui remet depuis son navigateur déverrouillé (clé « global » + un seul
 * contentieux). Au repos, ce trousseau est enveloppé par la clé-maître qui
 * ne vit que dans l'environnement du service attaché.
 *
 * Révoquer = supprimer le fichier : l'attaché redevient aveugle
 * instantanément, sans toucher aux données.
 */
import fs from 'node:fs'
import { attacheDir, ensureDir, atomicWrite, readJson } from './store.mjs'
import { loadMasterKey, wrapWithMaster, unwrapWithMaster, b64 } from './crypto.mjs'

const KEYRING_FILE = () => attacheDir('keyring.enc.json')

/** Périmètres autorisés : la clé globale + le contentieux confié, rien d'autre. */
export function allowedScopes() {
  const ctx = process.env.SIRAL_ATTACHE_CONTENTIEUX || 'crimorg'
  return ['global', `ctx-${ctx}`]
}

/**
 * Remise des clés par l'administrateur : { keys: { global: b64, 'ctx-crimorg': b64 } }.
 * Toute clé hors périmètre est REFUSÉE (pas silencieusement ignorée : l'admin
 * doit savoir que sa remise ne correspond pas à la configuration).
 */
export function grantKeyring(rawKeys, grantedBy) {
  const master = loadMasterKey()
  if (!master) throw new Error('Clé-maître absente (SIRAL_ATTACHE_MASTER_KEY)')
  const scopes = Object.keys(rawKeys || {})
  const allowed = allowedScopes()
  if (!scopes.length) throw new Error('Aucune clé fournie')
  for (const s of scopes) {
    if (!allowed.includes(s)) throw new Error(`Périmètre refusé : ${s} (autorisés : ${allowed.join(', ')})`)
    const raw = b64.decode(rawKeys[s])
    if (raw.length !== 32) throw new Error(`Clé invalide pour ${s}`)
  }
  if (!scopes.includes('global')) throw new Error('La clé « global » est requise (journaux, mémoire, documents)')
  const payload = { v: 1, keys: rawKeys, grantedBy, grantedAt: new Date().toISOString() }
  const envelope = wrapWithMaster(master, payload)
  ensureDir(attacheDir())
  atomicWrite(KEYRING_FILE(), JSON.stringify({ scopes, grantedBy, grantedAt: payload.grantedAt, envelope }, null, 2))
  return { scopes }
}

/** Charge les clés déchiffrées : { global: Buffer, byScope: Map }. Null si non remis. */
export function loadKeyring() {
  const master = loadMasterKey()
  if (!master) return null
  const stored = readJson(KEYRING_FILE(), null)
  if (!stored?.envelope) return null
  let payload
  try {
    payload = unwrapWithMaster(master, stored.envelope)
  } catch {
    return null // clé-maître changée : trousseau illisible = révoqué de fait
  }
  const byScope = new Map()
  for (const [scope, rawB64] of Object.entries(payload.keys)) {
    byScope.set(scope, Buffer.from(b64.decode(rawB64)))
  }
  const global = byScope.get('global')
  if (!global) return null
  return { global, byScope, grantedBy: stored.grantedBy, grantedAt: stored.grantedAt, scopes: [...byScope.keys()] }
}

export function keyringStatus() {
  const stored = readJson(KEYRING_FILE(), null)
  if (!stored) return { granted: false }
  return { granted: true, scopes: stored.scopes, grantedBy: stored.grantedBy, grantedAt: stored.grantedAt }
}

/** Révocation : suppression du trousseau. L'attaché est aveugle immédiatement. */
export function revokeKeyring() {
  const p = KEYRING_FILE()
  if (fs.existsSync(p)) { fs.unlinkSync(p); return true }
  return false
}
