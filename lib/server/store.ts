/**
 * SIRAL — stockage serveur.
 *
 * Toutes les données métier arrivent CHIFFRÉES côté client (E2EE) : le serveur
 * ne manipule que des enveloppes opaques. Ce module fournit :
 *  - un répertoire de données configurable (SIRAL_DATA_DIR, défaut ./srv-data)
 *  - des écritures atomiques (tmp + rename) sérialisées par fichier
 *  - le versionnage immuable des coffres : chaque PUT archive la version
 *    précédente dans .versions/<nom>/ (jamais d'écrasement d'historique)
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const DATA_DIR = process.env.SIRAL_DATA_DIR || path.join(process.cwd(), 'srv-data')

// Rétention des versions : tout < 48 h, puis 1/jour sur 30 j, puis 1/semaine sur 1 an.
const RETENTION_FULL_MS = 48 * 3600 * 1000
const RETENTION_DAILY_MS = 30 * 24 * 3600 * 1000
const RETENTION_WEEKLY_MS = 365 * 24 * 3600 * 1000

export function dataDir(...segments: string[]): string {
  const p = path.join(DATA_DIR, ...segments)
  return p
}

export function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// ── Sérialisation des écritures par fichier (évite les courses) ──
const locks = new Map<string, Promise<unknown>>()
export async function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) || Promise.resolve()
  let release: () => void
  const gate = new Promise<void>((r) => { release = r })
  // On stocke `gate` (et non `prev.then(() => gate)`) pour que le test
  // `locks.get(key) === gate` du finally réussisse et purge la Map une fois
  // le dernier verrou relâché — sinon une entrée résolue fuit par clé.
  locks.set(key, gate)
  await prev.catch(() => {})
  try {
    return await fn()
  } finally {
    release!()
    if (locks.get(key) === gate) locks.delete(key)
  }
}

export function atomicWrite(filePath: string, content: string | Buffer) {
  ensureDir(path.dirname(filePath))
  const tmp = filePath + '.tmp-' + crypto.randomBytes(4).toString('hex')
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, filePath)
}

export function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback
    const raw = fs.readFileSync(filePath, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJson(filePath: string, value: unknown) {
  atomicWrite(filePath, JSON.stringify(value, null, 2))
}

// ── Validation des noms (anti path-traversal) ──
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._@-]{0,120}$/
export function isSafeName(name: string): boolean {
  return NAME_RE.test(name) && !name.includes('..')
}

// Segments de chemins de documents : les fichiers viennent de Windows
// (espaces, accents, parenthèses…) et les enquêtes migrées de l'app bureau
// les référencent tels quels — on accepte donc tout caractère imprimable,
// en gardant l'anti-traversal strict (pas de '..', pas de segment caché :
// `.index.json` vit dans le même dossier).
const DOC_SEGMENT_RE = /^(?!\.)[^\\/\x00-\x1f]{1,160}$/
export function isSafeRelPath(rel: string): boolean {
  if (!rel || rel.length > 600) return false
  if (rel.includes('..') || rel.includes('\\') || path.isAbsolute(rel)) return false
  return rel.split('/').every((seg) => DOC_SEGMENT_RE.test(seg))
}

// ════════════════════════════════════════════════════════════════════════
// COFFRES (vaults) — enveloppes chiffrées versionnées
// ════════════════════════════════════════════════════════════════════════

export interface VaultEnvelope {
  v: number
  encrypted: boolean
  iv?: string
  ct?: string
  // métadonnées en clair, non sensibles, utiles à la synchro
  savedAt?: string
  savedBy?: string
  receivedAt?: string
  [k: string]: unknown
}

function vaultPath(name: string) { return dataDir('vaults', name + '.json') }
function versionsDir(name: string) { return dataDir('vaults', '.versions', name) }

export function readVault(name: string): VaultEnvelope | null {
  if (!isSafeName(name)) throw new Error('Nom de coffre invalide')
  return readJson<VaultEnvelope | null>(vaultPath(name), null)
}

/** Élagage de l'historique : conserve tout < 48 h, 1/jour 30 j, 1/sem 1 an. */
function pruneVersions(name: string) {
  const dir = versionsDir(name)
  if (!fs.existsSync(dir)) return
  const now = Date.now()
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      // nom = "<ISO avec _ pour :>~<user>.json" ; un timestamp illisible vaut
      // « maintenant » : on CONSERVE dans le doute, jamais de purge aveugle
      const stamp = f.split('~')[0].replace(/_/g, ':')
      const parsed = Date.parse(stamp)
      return { f, ts: Number.isFinite(parsed) && parsed > 0 ? parsed : now }
    })
    .sort((a, b) => b.ts - a.ts)
  const keep = new Set<string>()
  const dayKept = new Set<string>()
  const weekKept = new Set<string>()
  for (const { f, ts } of files) {
    const age = now - ts
    if (age < RETENTION_FULL_MS) { keep.add(f); continue }
    if (age < RETENTION_DAILY_MS) {
      const day = new Date(ts).toISOString().slice(0, 10)
      if (!dayKept.has(day)) { dayKept.add(day); keep.add(f) }
      continue
    }
    if (age < RETENTION_WEEKLY_MS) {
      const d = new Date(ts)
      const week = `${d.getUTCFullYear()}-w${Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / (7 * 24 * 3600 * 1000))}`
      if (!weekKept.has(week)) { weekKept.add(week); keep.add(f) }
    }
  }
  for (const { f } of files) {
    if (!keep.has(f)) { try { fs.unlinkSync(path.join(dir, f)) } catch {} }
  }
}

/**
 * Nom de fichier d'archive : horodatage + auteur + suffixe aléatoire court.
 * Le suffixe évite l'écrasement de deux archives écrites dans la même
 * milliseconde par le même auteur (garantie « historique jamais écrasé »).
 */
function archiveFileName(stamp: string, savedBy: string | undefined): string {
  const who = (savedBy || 'inconnu').replace(/[^a-zA-Z0-9._-]/g, '_')
  const rand = crypto.randomBytes(3).toString('hex')
  return `${stamp}~${who}~${rand}.json`
}

/**
 * Écrit la nouvelle version d'un coffre. L'ancienne version courante est
 * archivée AVANT toute écriture — l'historique ne peut jamais être écrasé.
 */
export async function writeVault(name: string, envelope: VaultEnvelope, savedBy: string): Promise<{ version: string }> {
  if (!isSafeName(name)) throw new Error('Nom de coffre invalide')
  return withFileLock('vault:' + name, async () => {
    const current = readVault(name)
    const stamp = new Date().toISOString().replace(/:/g, '_')
    if (current) {
      const vdir = versionsDir(name)
      ensureDir(vdir)
      const archName = archiveFileName(stamp, current.savedBy)
      atomicWrite(path.join(vdir, archName), JSON.stringify(current))
      pruneVersions(name)
    }
    const toStore: VaultEnvelope = { ...envelope, receivedAt: new Date().toISOString(), savedBy }
    writeJson(vaultPath(name), toStore)
    return { version: stamp }
  })
}

export function listVaultVersions(name: string): Array<{ filename: string, mtime: string, size: number }> {
  if (!isSafeName(name)) throw new Error('Nom de coffre invalide')
  const dir = versionsDir(name)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f))
      return { filename: f, mtime: st.mtime.toISOString(), size: st.size }
    })
    .sort((a, b) => (a.filename < b.filename ? 1 : -1))
}

export function readVaultVersion(name: string, filename: string): VaultEnvelope | null {
  if (!isSafeName(name) || !/^[\w.~-]+\.json$/.test(filename) || filename.includes('..')) {
    throw new Error('Nom invalide')
  }
  return readJson<VaultEnvelope | null>(path.join(versionsDir(name), filename), null)
}

/**
 * Supprime la version courante d'un coffre (révocation d'un trousseau ou
 * d'une invitation). L'historique `.versions/` est conservé : la suppression
 * est elle-même archivée, rien n'est perdu définitivement.
 */
export async function deleteVault(name: string): Promise<boolean> {
  if (!isSafeName(name)) throw new Error('Nom de coffre invalide')
  return withFileLock('vault:' + name, async () => {
    const current = readVault(name)
    if (!current) return false
    const vdir = versionsDir(name)
    ensureDir(vdir)
    const stamp = new Date().toISOString().replace(/:/g, '_')
    const archName = archiveFileName(stamp, current.savedBy)
    atomicWrite(path.join(vdir, archName), JSON.stringify(current))
    fs.unlinkSync(vaultPath(name))
    return true
  })
}

export function listVaults(): string[] {
  const dir = dataDir('vaults')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
}

// ════════════════════════════════════════════════════════════════════════
// DOCUMENTS — fichiers binaires chiffrés, par enquête
// ════════════════════════════════════════════════════════════════════════

export function docPath(enquete: string, rel: string): string {
  if (!isSafeName(enquete) || !isSafeRelPath(rel)) throw new Error('Chemin de document invalide')
  return dataDir('docs', enquete, rel + '.enc')
}

export function docMetaPath(enquete: string): string {
  if (!isSafeName(enquete)) throw new Error('Nom invalide')
  return dataDir('docs', enquete, '.index.json')
}

export interface DocMeta { rel: string, size: number, savedAt: string, savedBy: string, category?: string, originalName?: string }

export async function saveDoc(enquete: string, rel: string, content: Buffer, meta: Omit<DocMeta, 'rel' | 'size' | 'savedAt'>): Promise<DocMeta> {
  const p = docPath(enquete, rel)
  return withFileLock('docs:' + enquete, async () => {
    atomicWrite(p, content)
    const index = readJson<DocMeta[]>(docMetaPath(enquete), [])
    const entry: DocMeta = { rel, size: content.length, savedAt: new Date().toISOString(), ...meta }
    const next = index.filter((d) => d.rel !== rel).concat(entry)
    writeJson(docMetaPath(enquete), next)
    return entry
  })
}

export function readDoc(enquete: string, rel: string): Buffer | null {
  const p = docPath(enquete, rel)
  return fs.existsSync(p) ? fs.readFileSync(p) : null
}

export async function deleteDoc(enquete: string, rel: string): Promise<boolean> {
  const p = docPath(enquete, rel)
  return withFileLock('docs:' + enquete, async () => {
    let existed = false
    if (fs.existsSync(p)) { fs.unlinkSync(p); existed = true }
    const index = readJson<DocMeta[]>(docMetaPath(enquete), [])
    writeJson(docMetaPath(enquete), index.filter((d) => d.rel !== rel))
    return existed
  })
}

export function listDocs(enquete: string): DocMeta[] {
  if (!isSafeName(enquete)) throw new Error('Nom invalide')
  return readJson<DocMeta[]>(docMetaPath(enquete), [])
}

// ════════════════════════════════════════════════════════════════════════
// JOURNAUX append-only (audit, événements partagés)
// ════════════════════════════════════════════════════════════════════════

export async function appendLog(file: string, entry: unknown) {
  const p = dataDir(file)
  await withFileLock('log:' + file, async () => {
    ensureDir(path.dirname(p))
    fs.appendFileSync(p, JSON.stringify(entry) + '\n')
  })
}

export function readLog<T>(file: string, opts?: { sinceMs?: number, max?: number }): T[] {
  const p = dataDir(file)
  if (!fs.existsSync(p)) return []
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
  let entries: T[] = []
  for (const line of lines) {
    try { entries.push(JSON.parse(line)) } catch {}
  }
  if (opts?.sinceMs) {
    entries = entries.filter((e) => {
      const t = (e as { timestamp?: number | string }).timestamp
      const ms = typeof t === 'number' ? t : Date.parse(String(t || 0))
      return ms >= opts.sinceMs!
    })
  }
  if (opts?.max && entries.length > opts.max) entries = entries.slice(-opts.max)
  return entries
}
