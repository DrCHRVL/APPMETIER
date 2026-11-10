/**
 * SIRAL — séquestre des clés d'un TJ pour l'administrateur général.
 *
 * Chaque TJ est chiffré de bout en bout par des clés que seuls ses membres
 * détiennent. Pour que l'administrateur du SERVEUR (et lui seul) puisse
 * accéder aux données d'un TJ en basculant dessus, sans que le serveur
 * puisse les lire :
 *  - l'administrateur général possède une paire RSA-OAEP 3072 ; la clé
 *    publique est publiée sur le serveur, la clé privée y est conservée
 *    chiffrée par sa phrase personnelle (PBKDF2 → AES-GCM) ;
 *  - l'administrateur LOCAL d'un TJ, à chaque déverrouillage, dépose une copie
 *    des clés du TJ scellée pour cette clé publique (coffre `escrow-keys`) ;
 *  - en basculant sur ce TJ, l'administrateur général ouvre ce séquestre avec
 *    sa phrase et en tire son propre trousseau pour ce TJ.
 * Le serveur ne voit que des données chiffrées ; lecture du séquestre réservée
 * à l'administrateur général, journalisée.
 */
import { b64, encryptJson, decryptJson, CipherEnvelope } from './crypto'
import { deriveRawKey, importAesKey, newKdfParams, randomRawKey } from './keyring'

const RSA = { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' } as const

export interface EscrowEnvelope extends CipherEnvelope {
  /** Clé AES du contenu, chiffrée RSA-OAEP pour l'administrateur général. */
  wrappedKey: string
  /** Empreinte de la clé publique utilisée (détecte un changement de paire). */
  publicId: string
  /** Empreinte des clés scellées (détecte un séquestre périmé) — non secrète. */
  fp: string
  /** Périmètres scellés (global, ctx-…). */
  scopes: string[]
}

export interface PrivateKeyEnvelope extends CipherEnvelope {
  kdfSalt: string
  kdfIterations: number
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource))
  return Array.from(h).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Identifiant court d'une clé publique (SPKI base64). */
export async function publicIdOf(spkiB64: string): Promise<string> {
  return (await sha256Hex(b64.decode(spkiB64))).slice(0, 24)
}

/** Empreinte d'un jeu de clés (scope → clé brute base64), indépendante de l'ordre. */
export async function keysFingerprint(keys: Record<string, string>): Promise<string> {
  const canon = Object.keys(keys).sort().map((k) => `${k}=${keys[k]}`).join(';')
  return (await sha256Hex(new TextEncoder().encode(canon))).slice(0, 32)
}

/** Nouvelle paire ; la clé privée est scellée par la phrase personnelle. */
export async function generateEscrowKeypair(phrase: string): Promise<{ publicSpki: string, publicId: string, privateEnvelope: PrivateKeyEnvelope }> {
  const pair = await crypto.subtle.generateKey(RSA, true, ['encrypt', 'decrypt']) as CryptoKeyPair
  const publicSpki = b64.encode(await crypto.subtle.exportKey('spki', pair.publicKey))
  const pkcs8 = b64.encode(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const kdf = newKdfParams()
  const key = await importAesKey(await deriveRawKey(phrase, kdf.salt, kdf.iterations))
  const env = await encryptJson(key, { pkcs8 })
  return {
    publicSpki,
    publicId: await publicIdOf(publicSpki),
    privateEnvelope: { ...env, kdfSalt: kdf.salt, kdfIterations: kdf.iterations },
  }
}

/** Ouvre la clé privée avec la phrase personnelle (lève si la phrase est fausse). */
export async function openPrivateKey(env: PrivateKeyEnvelope, phrase: string): Promise<CryptoKey> {
  const key = await importAesKey(await deriveRawKey(phrase, env.kdfSalt, env.kdfIterations))
  let pkcs8: string
  try {
    pkcs8 = (await decryptJson<{ pkcs8: string }>(key, env)).pkcs8
  } catch {
    throw new Error('Phrase incorrecte pour la clé d’administration générale')
  }
  return crypto.subtle.importKey('pkcs8', b64.decode(pkcs8) as BufferSource, RSA, false, ['decrypt'])
}

/** Scelle les clés d'un TJ pour l'administrateur général. */
export async function sealForEscrow(publicSpki: string, keys: Record<string, string>, savedBy: string): Promise<EscrowEnvelope> {
  const pub = await crypto.subtle.importKey('spki', b64.decode(publicSpki) as BufferSource, RSA, false, ['encrypt'])
  const raw = randomRawKey()
  const env = await encryptJson(await importAesKey(raw), { v: 1, keys }, { savedAt: new Date().toISOString(), savedBy })
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, raw as BufferSource)
  return {
    ...env,
    wrappedKey: b64.encode(wrapped),
    publicId: await publicIdOf(publicSpki),
    fp: await keysFingerprint(keys),
    scopes: Object.keys(keys).sort(),
  }
}

/** Ouvre un séquestre avec la clé privée de l'administrateur général. */
export async function openEscrow(privateKey: CryptoKey, env: EscrowEnvelope): Promise<Record<string, string>> {
  const raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, b64.decode(env.wrappedKey) as BufferSource))
  const { keys } = await decryptJson<{ keys: Record<string, string> }>(await importAesKey(raw), env)
  return keys
}

/**
 * Faut-il (re)déposer le séquestre ? Oui s'il manque, si la paire de
 * l'administrateur général a changé, ou si mes clés diffèrent — sans jamais
 * remplacer un séquestre plus complet par un sous-ensemble.
 */
export function escrowNeedsUpdate(
  current: { publicId: string, fp: string, scopes: string[] } | null,
  mine: { publicId: string, fp: string, scopes: string[] },
): boolean {
  if (!current) return true
  if (current.publicId !== mine.publicId) return true
  if (current.fp === mine.fp) return false
  return current.scopes.every((s) => mine.scopes.includes(s))
}

/** Accès HTTP minimal (injecté : navigateur, ou tests). */
export interface EscrowHttp {
  getJson: (path: string) => Promise<{ status: number, json: Record<string, unknown> }>
  putJson: (path: string, body: unknown) => Promise<number>
}

/**
 * Tient à jour le séquestre, après chaque déverrouillage :
 *  - l'administrateur général, au TJ d'origine, crée sa paire si elle manque ;
 *  - l'administrateur LOCAL d'un TJ y dépose une copie des clés du TJ scellée
 *    pour la clé publique de l'administrateur général.
 * Rend ce qui a été fait (pour le journal et les tests).
 */
export async function maintenirSequestre(
  keys: Record<string, string>,
  identity: { username: string, role: string },
  phrase: string,
  state: { isTjAdmin?: boolean, escrow?: { publicId: string, fp: string, scopes: string[] } | null } | null,
  tjId: string,
  http: EscrowHttp,
): Promise<'paire-creee' | 'depose' | 'a-jour' | 'rien'> {
  const pub = await http.getJson('/api/escrow')
  if (identity.role === 'admin') {
    if (pub.status === 404 && tjId === 'default' && phrase) {
      const pair = await generateEscrowKeypair(phrase)
      const st = await http.putJson('/api/escrow', pair)
      if (st !== 200) throw new Error(`Publication de la clé d'administration refusée (${st})`)
      return 'paire-creee'
    }
    return 'rien'
  }
  if (!state?.isTjAdmin || pub.status !== 200) return 'rien'
  const publicSpki = String(pub.json.publicSpki)
  const mine = { publicId: String(pub.json.publicId), fp: await keysFingerprint(keys), scopes: Object.keys(keys).sort() }
  if (!escrowNeedsUpdate(state.escrow ?? null, mine)) return 'a-jour'
  const env = await sealForEscrow(publicSpki, keys, identity.username)
  const st = await http.putJson('/api/vaults/escrow-keys', env)
  if (st !== 200) throw new Error(`Dépôt du séquestre refusé (${st})`)
  return 'depose'
}
