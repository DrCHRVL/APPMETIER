/**
 * SIRAL — Attaché de justice · stockage du service (sidecar).
 *
 * Reprend les conventions de lib/server/store.ts (répertoire SIRAL_DATA_DIR,
 * écritures atomiques, versionnage avant écrasement) pour le sous-arbre
 * `attache/` du TJ confié, ainsi que la lecture/écriture des coffres `ctx-*`
 * avec le MÊME archivage `.versions/` que le serveur web : les écritures de
 * l'attaché sont réversibles et historisées comme celles d'un utilisateur.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const DATA_DIR = process.env.SIRAL_DATA_DIR || path.join(process.cwd(), 'srv-data')
const DEFAULT_TJ_ID = 'default'

export function attacheTj() {
  return process.env.SIRAL_ATTACHE_TJ || DEFAULT_TJ_ID
}

export function attacheContentieux() {
  return process.env.SIRAL_ATTACHE_CONTENTIEUX || 'crimorg'
}

export function tjDataDir(tj, ...segments) {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(tj) || tj.includes('..')) throw new Error('TJ invalide')
  return tj === DEFAULT_TJ_ID
    ? path.join(DATA_DIR, ...segments)
    : path.join(DATA_DIR, 'tj', tj, ...segments)
}

export function attacheDir(...segments) {
  return tjDataDir(attacheTj(), 'attache', ...segments)
}

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

/**
 * Aligne les permissions du sous-arbre partagé avec l'app web.
 *
 * Le service tourne root dans son conteneur, l'app web sous un utilisateur
 * non-root (`siral`) : tout répertoire créé par le service en 755 devenait
 * INSCRIPTIBLE PAR LE SEUL ROOT — les téléversements et suppressions de
 * trames/skills/base de connaissances côté app échouaient alors en silence
 * (EACCES). Le volume est privé aux deux conteneurs et ne contient que des
 * enveloppes chiffrées : ouvrir les droits ne dévoile rien.
 */
export function fixSharedPermissions() {
  // Une seule remise à niveau complète par volume : une fois faite (et avec
  // umask(0) au démarrage, tout ce qui se crée ensuite naît déjà ouvert),
  // re-balayer docs/ et vaults/ à chaque redémarrage serait de l'E/S pure perte.
  const marker = readState().permissionsPartageesV
  if (marker === 1) return
  const roots = [attacheDir(), tjDataDir(attacheTj(), 'docs'), tjDataDir(attacheTj(), 'vaults')]
  const walk = (p) => {
    let st
    try { st = fs.statSync(p) } catch { return }
    const wanted = st.isDirectory() ? 0o777 : 0o666
    if ((st.mode & 0o777) !== wanted) {
      try { fs.chmodSync(p, wanted) } catch { /* volume en lecture seule : tant pis */ }
    }
    if (!st.isDirectory()) return
    let entries = []
    try { entries = fs.readdirSync(p) } catch { return }
    for (const e of entries) walk(path.join(p, e))
  }
  for (const r of roots) walk(r)
  writeState({ permissionsPartageesV: 1 }).catch(() => {})
}

// ── Collections d'enveloppes (trames, skills, kb) — miroir de lib/server/attache.ts ──
// Le service peut TOUJOURS écrire (root) : l'app web lui relaie l'écriture ou
// la suppression quand son propre accès disque est refusé (volumes hérités
// d'anciennes versions, propriétés croisées).

const COLLECTION_RE = /^(trames|skills|kb)$/
const COLLECTION_ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/

export async function writeCollectionEnvelopeRaw(collection, id, envelope) {
  if (!COLLECTION_RE.test(collection)) throw new Error('Collection inconnue')
  if (!COLLECTION_ID_RE.test(id)) throw new Error('Identifiant invalide')
  const p = attacheDir(collection, id + '.json')
  await withFileLock(`coll:${collection}:${id}`, async () => {
    if (fs.existsSync(p)) {
      const vdir = attacheDir(collection, '.versions', id)
      ensureDir(vdir)
      fs.copyFileSync(p, path.join(vdir, new Date().toISOString().replace(/:/g, '_') + '.json'))
    }
    atomicWrite(p, JSON.stringify(envelope, null, 2))
  })
}

// Fichiers-enveloppes uniques (mémoire, consignes) et cartes de statut en
// clair (majordome-status, questions-status) : mêmes relais que les
// collections — l'app web délègue quand son accès disque est refusé.

const SINGLE_ENVELOPE_RE = /^(memory|instructions)$/
const STATUS_MAP_RE = /^(majordome-status|questions-status)$/

export async function writeSingleEnvelopeRaw(name, envelope) {
  if (!SINGLE_ENVELOPE_RE.test(name)) throw new Error('Fichier inconnu')
  await writeEnvelopeFile(name + '.json', envelope)
}

export async function setStatusMapEntryRaw(file, id, entry) {
  if (!STATUS_MAP_RE.test(file)) throw new Error('Fichier de statut inconnu')
  if (!/^[a-f0-9]{6,32}$/.test(String(id || ''))) throw new Error('Identifiant invalide')
  const p = attacheDir(file + '.json')
  await withFileLock('status:' + file, async () => {
    const all = readJson(p, {})
    all[id] = entry
    atomicWrite(p, JSON.stringify(all, null, 2))
  })
}

export async function deleteCollectionEnvelopeRaw(collection, id) {
  if (!COLLECTION_RE.test(collection)) throw new Error('Collection inconnue')
  if (!COLLECTION_ID_RE.test(id)) throw new Error('Identifiant invalide')
  const p = attacheDir(collection, id + '.json')
  return withFileLock(`coll:${collection}:${id}`, async () => {
    if (!fs.existsSync(p)) return false
    const vdir = attacheDir(collection, '.versions', id)
    ensureDir(vdir)
    fs.copyFileSync(p, path.join(vdir, new Date().toISOString().replace(/:/g, '_') + '~suppression.json'))
    fs.unlinkSync(p)
    return true
  })
}

export function atomicWrite(filePath, content) {
  ensureDir(path.dirname(filePath))
  const tmp = filePath + '.tmp-' + crypto.randomBytes(4).toString('hex')
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, filePath)
}

export function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    const raw = fs.readFileSync(filePath, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function writeJson(filePath, value) {
  atomicWrite(filePath, JSON.stringify(value, null, 2))
}

// ── Sérialisation des écritures (un seul process, mais runs concurrents) ──
const locks = new Map()
export async function withFileLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve()
  let release
  const gate = new Promise((r) => { release = r })
  locks.set(key, gate)
  await prev.catch(() => {})
  try {
    return await fn()
  } finally {
    release()
    if (locks.get(key) === gate) locks.delete(key)
  }
}

// ── Coffres ctx-* : lecture + écriture versionnée (miroir de writeVault) ──
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._@-]{0,120}$/

function vaultPath(tj, name) { return tjDataDir(tj, 'vaults', name + '.json') }
function versionsDir(tj, name) { return tjDataDir(tj, 'vaults', '.versions', name) }

export function readVault(tj, name) {
  if (!NAME_RE.test(name) || name.includes('..')) throw new Error('Nom de coffre invalide')
  return readJson(vaultPath(tj, name), null)
}

/** Archive la version courante puis écrit — identique au serveur web. */
export async function writeVault(tj, name, envelope, savedBy) {
  if (!NAME_RE.test(name) || name.includes('..')) throw new Error('Nom de coffre invalide')
  return withFileLock(`vault:${tj}:${name}`, async () => {
    const current = readVault(tj, name)
    const stamp = new Date().toISOString().replace(/:/g, '_')
    if (current) {
      const vdir = versionsDir(tj, name)
      ensureDir(vdir)
      const archName = `${stamp}~${(current.savedBy || 'inconnu').replace(/[^a-zA-Z0-9._-]/g, '_')}.json`
      atomicWrite(path.join(vdir, archName), JSON.stringify(current))
    }
    writeJson(vaultPath(tj, name), { ...envelope, receivedAt: new Date().toISOString(), savedBy })
    return { version: stamp }
  })
}

// ── Documents chiffrés d'une enquête ──
export function listDocsMeta(tj, enqueteKey) {
  return readJson(tjDataDir(tj, 'docs', enqueteKey, '.index.json'), [])
}

export function readDocBlob(tj, enqueteKey, rel) {
  if (rel.includes('..') || rel.includes('\\') || path.isAbsolute(rel)) throw new Error('Chemin invalide')
  const p = tjDataDir(tj, 'docs', enqueteKey, rel + '.enc')
  return fs.existsSync(p) ? fs.readFileSync(p) : null
}

function safeRel(rel) {
  const r = String(rel || '')
  if (!r || r.includes('..') || r.includes('\\') || path.isAbsolute(r) || r.startsWith('.')) throw new Error('Chemin invalide')
  return r
}

/**
 * Dépose un blob document DÉJÀ chiffré (format SIR1 du client) et tient
 * l'index `.index.json` — même contrat que saveDoc côté app : le scanner de
 * la section documents ramasse l'entrée au prochain passage.
 */
export function writeDocBlob(tj, enqueteKey, rel, blob, meta = {}) {
  safeRel(rel)
  const dir = tjDataDir(tj, 'docs', enqueteKey)
  const p = path.join(dir, rel + '.enc')
  ensureDir(path.dirname(p))
  atomicWrite(p, blob)
  const indexPath = path.join(dir, '.index.json')
  const index = readJson(indexPath, []).filter((d) => d.rel !== rel)
  const entry = { rel, size: blob.length, savedAt: new Date().toISOString(), ...meta }
  atomicWrite(indexPath, JSON.stringify(index.concat(entry), null, 2))
  return entry
}

/** Retire un blob document et son entrée d'index. */
export function deleteDocBlob(tj, enqueteKey, rel) {
  safeRel(rel)
  const dir = tjDataDir(tj, 'docs', enqueteKey)
  const p = path.join(dir, rel + '.enc')
  let existed = false
  if (fs.existsSync(p)) { fs.unlinkSync(p); existed = true }
  const indexPath = path.join(dir, '.index.json')
  const index = readJson(indexPath, [])
  atomicWrite(indexPath, JSON.stringify(index.filter((d) => d.rel !== rel), null, 2))
  return existed
}

/**
 * Clé serveur d'une enquête — même normalisation que le client web
 * (bridge.ts/serverKey) pour retrouver le dossier de documents.
 */
export function docServerKey(numero) {
  const cleaned = String(numero)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._@-]/g, '_')
  const safe = /^[a-zA-Z0-9]/.test(cleaned) ? cleaned : 'e_' + cleaned
  return safe.slice(0, 121)
}

// ── Journaux chiffrés de l'attaché (audit, feed, outbox) ──
// Chaque ligne : { ts, iv, ct } — ct chiffré avec la clé « global » du
// trousseau : le navigateur de l'administrateur les déchiffre, le disque
// et le serveur web ne voient rien en clair.

export async function appendEncryptedLine(file, entry) {
  const p = attacheDir(file)
  await withFileLock('log:' + file, async () => {
    ensureDir(path.dirname(p))
    fs.appendFileSync(p, JSON.stringify(entry) + '\n')
  })
}

export function readEncryptedLines(file, max = 500) {
  const p = attacheDir(file)
  if (!fs.existsSync(p)) return []
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
  const out = []
  for (const line of lines) {
    try { out.push(JSON.parse(line)) } catch {}
  }
  return out.slice(-max)
}

// ── État non sensible du service (relève mail, santé) ──
export function readState() {
  return readJson(attacheDir('state.json'), {})
}

export async function writeState(patch) {
  await withFileLock('attache-state', async () => {
    writeJson(attacheDir('state.json'), { ...readState(), ...patch })
  })
}

// ── Fichiers-enveloppes versionnés (mémoire, conversations) ──

export function readEnvelopeFile(relPath) {
  return readJson(attacheDir(relPath), null)
}

/** Écrit une enveloppe en archivant la version précédente (jamais d'écrasement sec). */
export async function writeEnvelopeFile(relPath, envelope) {
  const p = attacheDir(relPath)
  await withFileLock('env:' + relPath, async () => {
    if (fs.existsSync(p)) {
      const vdir = path.join(path.dirname(p), '.versions', path.basename(relPath, '.json'))
      ensureDir(vdir)
      const stamp = new Date().toISOString().replace(/:/g, '_')
      fs.copyFileSync(p, path.join(vdir, stamp + '.json'))
    }
    writeJson(p, envelope)
  })
}

export function listFiles(relDir, suffix = '.json') {
  const dir = attacheDir(relDir)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(suffix) && !f.startsWith('.'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f))
      return { name: f, mtime: st.mtime.toISOString(), size: st.size }
    })
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
}
