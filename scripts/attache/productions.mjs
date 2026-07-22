/**
 * SIRAL — Attaché de justice · productions rédactionnelles.
 *
 * Les actes que l'attaché rédige à partir des trames (réquisition, demande
 * de prolongation au JLD, saisine, projet de réponse…). Chaque production est
 * conservée par dossier, chiffrée (clé globale), versionnée. Le magistrat les
 * visionne dans « Actes rédigés », les fait retoucher par l'IA (chat), les
 * édite légèrement à la main, les exporte en PDF/Word officiel, puis les
 * VALIDE (traite) — l'acte quitte alors la liste courante.
 *
 * Chaque production = un fichier-enveloppe. L'attaché l'écrit chiffré côté
 * serveur ; le navigateur de l'administrateur la déchiffre pour l'afficher,
 * et renvoie une enveloppe qu'il a lui-même chiffrée lors d'une édition
 * manuelle — l'app ne voit jamais le texte en clair.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { attacheDir, ensureDir, atomicWrite, readJson, docServerKey, withFileLock } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { diffTexte } from './diff.mjs'

export const PRODUCTION_TYPES = ['requisition', 'reponse_dml', 'prolongation_jld', 'saisine_jld', 'projet_reponse', 'soit_transmis', 'note', 'livrable', 'autre']

function dirFor(numero) { return attacheDir('productions', docServerKey(numero)) }
function fileFor(numero, id) {
  if (!/^[a-f0-9]{6,32}$/.test(id)) throw new Error('Identifiant de production invalide')
  return path.join(dirFor(numero), id + '.json')
}
function versionsDirFor(numero, id) {
  if (!/^[a-f0-9]{6,32}$/.test(id)) throw new Error('Identifiant de production invalide')
  return path.join(dirFor(numero), '.versions', id)
}
/** Jeton d'archive (nom de fichier) ↔ horodatage ISO (`:` remplacé par `_`). */
function tokenToIso(token) { return String(token).replace(/T(\d\d)_(\d\d)_(\d\d)/, 'T$1:$2:$3') }

/**
 * Écrit une enveloppe déjà chiffrée (archive la version précédente).
 * Rend { archivedAt } : le jeton de l'archive créée (l'état AVANT cette
 * écriture), ou null si l'acte n'existait pas encore — sert de pointeur
 * durable pour comparer plus tard le jet de l'attaché à la correction du
 * magistrat (production_diff).
 */
export async function writeEnvelope(numero, id, envelope) {
  const p = fileFor(numero, id)
  let archivedAt = null
  await withFileLock('prod:' + id, async () => {
    ensureDir(dirFor(numero))
    if (fs.existsSync(p)) {
      const vdir = versionsDirFor(numero, id)
      ensureDir(vdir)
      const token = new Date().toISOString().replace(/:/g, '_')
      fs.copyFileSync(p, path.join(vdir, token + '.json'))
      archivedAt = token
    }
    atomicWrite(p, JSON.stringify(envelope, null, 2))
  })
  return { archivedAt }
}

/**
 * Versions archivées d'un acte, plus ANCIENNE d'abord. Chaque entrée =
 * l'état de l'acte AVANT l'écriture nommée par ce jeton. Les jetons ISO à
 * largeur fixe se trient chronologiquement par ordre lexicographique.
 */
export function listProductionVersions(numero, id) {
  if (!/^[a-f0-9]{6,32}$/.test(id)) return []
  const vdir = versionsDirFor(numero, id)
  if (!fs.existsSync(vdir)) return []
  return fs.readdirSync(vdir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('deleted-') && !f.startsWith('.'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort()
    .map((token) => ({ token, at: tokenToIso(token) }))
}

/** Déchiffre une version archivée précise (jeton = nom de fichier). */
export function readProductionVersion(keys, numero, id, token) {
  if (!/^[a-f0-9]{6,32}$/.test(id)) return null
  const safe = String(token || '').replace(/[^0-9A-Za-z._-]/g, '')
  if (!safe) return null
  const env = readJson(path.join(versionsDirFor(numero, id), safe + '.json'), null)
  if (!env) return null
  try { return decryptJson(keys.global, env) } catch { return null }
}

/**
 * Diff « avant → après » d'un acte : ce que le magistrat a changé de sa main.
 * Sans `versionAt`, compare les deux dernières versions (dernier changement).
 * Avec `versionAt` (jeton ou ISO, tel que porté par le signal acte_edite_main),
 * cible précisément cette correction : « avant » = la version archivée à ce
 * jeton (le jet de l'attaché), « après » = la version installée juste ensuite
 * (l'archive suivante, ou l'état courant si aucune) — robuste aux retouches
 * ultérieures.
 */
export function diffProduction(keys, numero, id, versionAt) {
  const current = readProduction(keys, numero, id)
  if (!current) return { ok: false, erreur: 'Acte introuvable' }
  const versions = listProductionVersions(numero, id)
  if (versions.length === 0) {
    return { ok: false, erreur: 'Aucune version antérieure archivée : cet acte n\'a jamais été réécrit — rien à comparer.' }
  }
  let beforeIdx = versions.length - 1
  if (versionAt) {
    const wanted = String(versionAt)
    const key19 = tokenToIso(wanted).slice(0, 19)
    const found = versions.findIndex((v) => v.token === wanted || v.at === wanted || v.at.slice(0, 19) === key19)
    if (found >= 0) beforeIdx = found
  }
  const beforeToken = versions[beforeIdx].token
  const before = readProductionVersion(keys, numero, id, beforeToken)
  if (!before) return { ok: false, erreur: 'Version antérieure illisible (clé différente ?)' }
  const nextArchive = versions[beforeIdx + 1]
  const after = nextArchive ? readProductionVersion(keys, numero, id, nextArchive.token) : current
  const d = diffTexte(before?.contenu, after?.contenu)
  return {
    ok: true,
    numero,
    id,
    titre: current.titre,
    type: current.type,
    source: current.source || null,
    avantLe: versions[beforeIdx].at,
    apresLe: nextArchive ? nextArchive.at : current.updatedAt,
    identique: d.identique,
    ajouts: d.ajouts,
    retraits: d.retraits,
    tronque: d.tronque,
    diff: d.diff,
  }
}

export function listEnvelopes(numero) {
  const dir = dirFor(numero)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
    .map((f) => ({ id: f.replace(/\.json$/, ''), envelope: readJson(path.join(dir, f), null) }))
    .filter((e) => e.envelope)
}

export function readEnvelope(numero, id) {
  return readJson(fileFor(numero, id), null)
}

export async function deleteProduction(numero, id) {
  const p = fileFor(numero, id)
  if (!fs.existsSync(p)) return false
  await withFileLock('prod:' + id, async () => {
    const vdir = path.join(dirFor(numero), '.versions', id)
    ensureDir(vdir)
    fs.copyFileSync(p, path.join(vdir, 'deleted-' + new Date().toISOString().replace(/:/g, '_') + '.json'))
    fs.unlinkSync(p)
  })
  return true
}

// ── Côté attaché (chiffre lui-même avec la clé globale) ──

/** Crée ou met à jour une production. id absent = nouvelle. Signée du nom admin. */
export async function saveProduction(keys, { numero, id, type, titre, contenu, source, objet }) {
  if (!String(numero || '').trim()) throw new Error('Numéro de dossier requis')
  if (!String(contenu || '').trim()) throw new Error('Contenu requis')
  const author = keys?.grantedBy || 'admin'
  const existing = id ? readProduction(keys, numero, id) : null
  const rec = {
    id: existing?.id || (id && /^[a-f0-9]{6,32}$/.test(id) ? id : crypto.randomBytes(6).toString('hex')),
    numero: String(numero),
    type: PRODUCTION_TYPES.includes(type) ? type : (existing?.type || 'autre'),
    titre: String(titre || existing?.titre || 'Acte').slice(0, 200),
    contenu: String(contenu).slice(0, 400_000),
    source: source ? String(source).slice(0, 120) : existing?.source,
    // Objet de l'acte (n° de ligne interceptée, objet géolocalisé…) : dernier
    // segment du nom de fichier à l'export. Conservé s'il n'est pas re-fourni.
    objet: objet != null ? String(objet).slice(0, 120) : existing?.objet,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: author,
    // un acte VALIDÉ (traité) par le magistrat qui est retouché par l'IA
    // redevient « en attente » : le nouveau contenu appelle une relecture.
    traite: existing?.traite && existing?.contenu === String(contenu) ? existing.traite : false,
    traiteLe: existing?.traite && existing?.contenu === String(contenu) ? existing.traiteLe : undefined,
    // idem pour un acte REFUSÉ : dès que l'attaché le RECOMMENCE (nouveau
    // contenu), le refus est levé et l'acte repart « en attente » d'une
    // décision. Le contenu inchangé conserve l'état de refus et son motif.
    refuse: existing?.refuse && existing?.contenu === String(contenu) ? existing.refuse : false,
    refuseLe: existing?.refuse && existing?.contenu === String(contenu) ? existing.refuseLe : undefined,
    refuseMotif: existing?.refuse && existing?.contenu === String(contenu) ? existing.refuseMotif : undefined,
  }
  await writeEnvelope(numero, rec.id, encryptJson(keys.global, rec, { savedAt: rec.updatedAt, savedBy: author }))
  return { id: rec.id, titre: rec.titre }
}

export function readProduction(keys, numero, id) {
  const env = readEnvelope(numero, id)
  if (!env) return null
  try { return decryptJson(keys.global, env) } catch { return null }
}

export function listProductions(keys, numero) {
  return listEnvelopes(numero)
    .map(({ envelope }) => { try { return decryptJson(keys.global, envelope) } catch { return null } })
    .filter(Boolean)
    .map(({ contenu, ...meta }) => ({ ...meta, taille: (contenu || '').length }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}
