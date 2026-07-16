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

export const PRODUCTION_TYPES = ['requisition', 'reponse_dml', 'prolongation_jld', 'saisine_jld', 'projet_reponse', 'soit_transmis', 'note', 'livrable', 'autre']

function dirFor(numero) { return attacheDir('productions', docServerKey(numero)) }
function fileFor(numero, id) {
  if (!/^[a-f0-9]{6,32}$/.test(id)) throw new Error('Identifiant de production invalide')
  return path.join(dirFor(numero), id + '.json')
}

/** Écrit une enveloppe déjà chiffrée (archive la version précédente). */
export async function writeEnvelope(numero, id, envelope) {
  const p = fileFor(numero, id)
  await withFileLock('prod:' + id, async () => {
    ensureDir(dirFor(numero))
    if (fs.existsSync(p)) {
      const vdir = path.join(dirFor(numero), '.versions', id)
      ensureDir(vdir)
      fs.copyFileSync(p, path.join(vdir, new Date().toISOString().replace(/:/g, '_') + '.json'))
    }
    atomicWrite(p, JSON.stringify(envelope, null, 2))
  })
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
export async function saveProduction(keys, { numero, id, type, titre, contenu, source }) {
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
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: author,
    // un acte VALIDÉ (traité) par le magistrat qui est retouché par l'IA
    // redevient « en attente » : le nouveau contenu appelle une relecture.
    traite: existing?.traite && existing?.contenu === String(contenu) ? existing.traite : false,
    traiteLe: existing?.traite && existing?.contenu === String(contenu) ? existing.traiteLe : undefined,
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
