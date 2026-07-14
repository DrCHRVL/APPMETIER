/**
 * SIRAL — mode hors-ligne « poste préparé » (calqué sur PISTE).
 *
 * PROBLÈME RÉSOLU
 * ---------------
 * L'édition web est déjà une PWA : la coquille est en cache (service worker)
 * et les données vivent chiffrées dans IndexedDB. MAIS l'ENTRÉE dans l'app
 * passe toujours par le serveur (WebGate : /api/me + coffre `keyring-<user>` +
 * témoin `e2ee-check`). Sans réseau, on ne peut donc pas déverrouiller, alors
 * même que les données sont là, localement. Résultat : « le mode hors ligne ne
 * fonctionne pas ».
 *
 * SOLUTION
 * --------
 * « Préparer ce poste pour le hors-ligne » : on scelle une COPIE du trousseau
 * sur la machine, chiffrée sous un CODE DE DÉVERROUILLAGE hors-ligne choisi par
 * l'utilisateur (PBKDF2 → AES-GCM, exactement comme le trousseau serveur). Au
 * retour sans réseau, WebGate propose une entrée hors-ligne : ce code rouvre le
 * trousseau localement, l'app tourne en lecture/écriture contre IndexedDB, et
 * la resynchronisation se fait normalement une fois reconnecté (le moteur de
 * sync + l'arbitrage des conflits existent déjà).
 *
 * POURQUOI localStorage (et pas IndexedDB) ?
 * Le trousseau scellé doit être lisible AVANT de connaître le TJ actif, or
 * IndexedDB est cloisonné par TJ (cf. lib/web/idb.ts). localStorage n'est pas
 * cloisonné et convient à un petit blob. Seul le trousseau est chiffré ; les
 * métadonnées d'identité / TJ restent en clair sur la machine de l'utilisateur
 * (même posture que PISTE — donnée locale sur poste habilité).
 */
import { encryptJson, decryptJson, CipherEnvelope } from './crypto'
import {
  deriveRawKey, importAesKey, newKdfParams, buildScopedKeys,
  KeyringPayload, ScopedKeys, KdfParams,
} from './keyring'

export interface OfflineTj { id: string; name: string }
export interface OfflineIdentity { username: string; displayName: string; role: string }

interface OfflineBundle {
  v: 1
  identity: OfflineIdentity
  tj: OfflineTj
  tjs: OfflineTj[]
  preparedAt: string
  /** Fenêtre conseillée avant resynchro : préparation + 48 h, repoussée à
   *  chaque session en ligne réussie. Purement indicatif (jamais un verrou). */
  expiresAt: string
  kdfSalt: string
  kdfIterations: number
  keyring: CipherEnvelope
  /** Empreinte du trousseau scellé (updatedAt + périmètres). Permet de détecter,
   *  à chaque connexion en ligne, si les clés ont changé depuis la préparation. */
  keyringFp?: string
  /** true si les clés ont changé et qu'on n'a pas pu re-sceller automatiquement
   *  (aucun code en mémoire) → il faut re-préparer le poste à la main. */
  stale?: boolean
}

export interface OfflineStatus {
  prepared: boolean
  identity?: OfflineIdentity
  tj?: OfflineTj
  preparedAt?: string
  expiresAt?: string
  /** true si la fenêtre de 48 h est dépassée (avertissement, pas un blocage). */
  expired?: boolean
  /** true si le trousseau scellé n'est plus à jour (clés changées) et doit être
   *  re-préparé manuellement — le rafraîchissement auto n'a pas suffi. */
  stale?: boolean
}

/** Résultat d'un rafraîchissement auto de la copie hors-ligne (diagnostic UI). */
export interface OfflineRefresh {
  /** un poste est préparé sur cette machine */
  present: boolean
  /** la copie hors-ligne a été mise à jour (métadonnées / fenêtre / clés) */
  changed: boolean
  /** le trousseau scellé a été re-chiffré silencieusement (clés à jour) */
  resealed: boolean
  /** les clés ont changé mais on n'a pas pu re-sceller → re-préparation requise */
  stale: boolean
}

export interface OfflineUnlockResult {
  keys: ScopedKeys
  identity: OfflineIdentity
  tj: OfflineTj
  tjs: OfflineTj[]
}

const STORAGE_KEY = 'siral:offline-bundle'
const WINDOW_MS = 48 * 60 * 60 * 1000

// ── Session en ligne courante (mémoire vive uniquement) ─────────────────────
// Retenue au déverrouillage en ligne pour pouvoir « préparer le poste » sans
// redemander la phrase personnelle. Jamais persistée en clair.
let liveKeyring: KeyringPayload | null = null
let liveIdentity: OfflineIdentity | null = null
let liveTj: OfflineTj | null = null
let liveTjs: OfflineTj[] = []

// Clé de déverrouillage hors-ligne dérivée, retenue en mémoire vive après un
// « préparer le poste » ou une entrée hors-ligne. Permet de re-sceller le
// trousseau SANS redemander le code quand les clés changent en cours de
// session. Volatile : jamais persistée, effacée au rechargement de la page.
let liveOfflineKey: CryptoKey | null = null
let liveOfflineKdf: KdfParams | null = null

/** Empreinte légère du trousseau : change dès qu'une clé tourne ou qu'un
 *  périmètre est ajouté/retiré. Sert à détecter l'obsolescence de la copie. */
function keyringFingerprint(k: KeyringPayload): string {
  return `${k.updatedAt}|${Object.keys(k.keys).sort().join(',')}`
}

/** Appelé par WebGate à chaque déverrouillage (en ligne comme hors-ligne). */
export function rememberSession(
  keyring: KeyringPayload,
  identity: OfflineIdentity,
  tj: OfflineTj | null,
  tjs: OfflineTj[],
): void {
  liveKeyring = keyring
  liveIdentity = identity
  liveTj = tj
  liveTjs = tjs.length ? tjs : (tj ? [tj] : [])
}

function readBundle(): OfflineBundle | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const b = JSON.parse(raw) as OfflineBundle
    return b && b.v === 1 && b.keyring ? b : null
  } catch {
    return null
  }
}

function writeBundle(b: OfflineBundle): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(b))
}

/** Métadonnées du poste préparé (sans secret) — pour l'UI. */
export function getOfflineStatus(): OfflineStatus {
  const b = readBundle()
  if (!b) return { prepared: false }
  return {
    prepared: true,
    identity: b.identity,
    tj: b.tj,
    preparedAt: b.preparedAt,
    expiresAt: b.expiresAt,
    expired: Date.parse(b.expiresAt) < Date.now(),
    stale: !!b.stale,
  }
}

export function hasOfflineBundle(): boolean {
  return readBundle() !== null
}

/** true si une session en ligne est en mémoire → « préparer le poste » possible. */
export function canPrepareNow(): boolean {
  return liveKeyring !== null && liveIdentity !== null
}

/**
 * Scelle le trousseau courant sous le code de déverrouillage hors-ligne.
 * À appeler pendant une session EN LIGNE déverrouillée (le trousseau est en
 * mémoire depuis rememberSession).
 */
export async function prepareOffline(code: string): Promise<void> {
  if (!liveKeyring || !liveIdentity) {
    throw new Error('Session non déverrouillée : rouvrez l’application avant de préparer le poste.')
  }
  if (code.length < 8) throw new Error('Choisissez un code d’au moins 8 caractères.')
  const kdf = newKdfParams()
  const codeKey = await importAesKey(await deriveRawKey(code, kdf.salt, kdf.iterations))
  const envelope = await encryptJson(codeKey, liveKeyring, { savedBy: liveIdentity.username })
  const now = new Date()
  writeBundle({
    v: 1,
    identity: liveIdentity,
    tj: liveTj || { id: 'default', name: '' },
    tjs: liveTjs.length ? liveTjs : (liveTj ? [liveTj] : []),
    preparedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + WINDOW_MS).toISOString(),
    kdfSalt: kdf.salt,
    kdfIterations: kdf.iterations,
    keyring: envelope,
    keyringFp: keyringFingerprint(liveKeyring),
    stale: false,
  })
  // Retenir la clé dérivée : autorise le re-scellage silencieux si les clés
  // tournent plus tard dans la même session (cf. autoRefreshOffline).
  liveOfflineKey = codeKey
  liveOfflineKdf = kdf
}

/**
 * Rafraîchit la copie hors-ligne pendant une session EN LIGNE déverrouillée.
 * Appelé à chaque déverrouillage réussi : garde le « secours » à jour sans
 * intervention.
 *  - métadonnées (identité, TJ) et fenêtre de 48 h : toujours repoussées ;
 *  - trousseau scellé : re-chiffré silencieusement SI les clés ont changé ET
 *    qu'un code est en mémoire (préparation / entrée hors-ligne dans la session) ;
 *  - sinon, si les clés ont changé sans pouvoir re-sceller : marque la copie
 *    « stale » pour que l'UI invite à re-préparer le poste.
 */
export async function autoRefreshOffline(): Promise<OfflineRefresh> {
  const b = readBundle()
  if (!b) return { present: false, changed: false, resealed: false, stale: false }
  if (!liveKeyring || !liveIdentity) {
    return { present: true, changed: false, resealed: false, stale: !!b.stale }
  }
  const liveFp = keyringFingerprint(liveKeyring)
  const known = b.keyringFp !== undefined
  const keyChanged = known && b.keyringFp !== liveFp

  // Métadonnées + fenêtre : aucun secret requis, toujours rafraîchies.
  b.identity = liveIdentity
  if (liveTj) b.tj = liveTj
  if (liveTjs.length) b.tjs = liveTjs
  b.expiresAt = new Date(Date.now() + WINDOW_MS).toISOString()

  let resealed = false
  if ((keyChanged || !known) && liveOfflineKey) {
    // Re-sceller le trousseau courant sous le code retenu (clés à jour).
    const envelope = await encryptJson(liveOfflineKey, liveKeyring, { savedBy: liveIdentity.username })
    b.keyring = envelope
    if (liveOfflineKdf) { b.kdfSalt = liveOfflineKdf.salt; b.kdfIterations = liveOfflineKdf.iterations }
    b.keyringFp = liveFp
    b.stale = false
    resealed = true
  } else if (!known) {
    // Copie antérieure à cette fonctionnalité (pas d'empreinte) et pas de code
    // en mémoire : on adopte l'empreinte courante. On ne peut rien affirmer sur
    // la fraîcheur, mais rien non plus n'indique une obsolescence.
    b.keyringFp = liveFp
    b.stale = false
  } else {
    b.stale = keyChanged
  }
  writeBundle(b)
  return { present: true, changed: true, resealed, stale: !!b.stale }
}

/**
 * Test « à froid » du plan B : le code ouvre-t-il bien le trousseau scellé ?
 * Aucun effet de bord (ne mémorise pas la session). Permet de vérifier, en
 * ligne, qu'on saura entrer hors-ligne le jour où le réseau tombera.
 */
export async function verifyOfflineCode(code: string): Promise<boolean> {
  const b = readBundle()
  if (!b) return false
  try {
    const codeKey = await importAesKey(await deriveRawKey(code, b.kdfSalt, b.kdfIterations))
    await decryptJson<KeyringPayload>(codeKey, b.keyring)
    return true
  } catch {
    return false
  }
}

/**
 * Rouvre le trousseau scellé avec le code hors-ligne. Lève si le code est faux
 * (l'authentification AES-GCM échoue → le déchiffrement rejette).
 */
export async function unlockOffline(code: string): Promise<OfflineUnlockResult> {
  const b = readBundle()
  if (!b) throw new Error('Aucun poste préparé pour le hors-ligne.')
  const codeKey = await importAesKey(await deriveRawKey(code, b.kdfSalt, b.kdfIterations))
  let payload: KeyringPayload
  try {
    payload = await decryptJson<KeyringPayload>(codeKey, b.keyring)
  } catch {
    throw new Error('Code de déverrouillage incorrect.')
  }
  const keys = await buildScopedKeys(payload)
  // On garde la session en mémoire (permet de re-préparer / prolonger).
  rememberSession(payload, b.identity, b.tj, b.tjs)
  // Retenir la clé : au retour du réseau, on pourra re-sceller sans redemander
  // le code si les clés ont changé pendant la coupure.
  liveOfflineKey = codeKey
  liveOfflineKdf = { salt: b.kdfSalt, iterations: b.kdfIterations }
  return { keys, identity: b.identity, tj: b.tj, tjs: b.tjs.length ? b.tjs : [b.tj] }
}

/** Repousse la fenêtre conseillée de 48 h (à chaque session en ligne réussie). */
export function touchOfflineWindow(): void {
  const b = readBundle()
  if (!b) return
  b.expiresAt = new Date(Date.now() + WINDOW_MS).toISOString()
  writeBundle(b)
}

/** Oublie ce poste (supprime le trousseau scellé). */
export function clearOffline(): void {
  liveOfflineKey = null
  liveOfflineKdf = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
