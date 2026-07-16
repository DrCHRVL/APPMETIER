/**
 * SIRAL — Attaché de justice · dispatch (tâches confiées à distance).
 *
 * Le pendant du « Dispatch » de Claude, côté SIRAL : depuis son téléphone
 * (ou son poste), le magistrat CONFIE une tâche à l'attaché qui l'exécute
 * EN TÂCHE DE FOND sur le serveur — même s'il referme l'application — et il
 * en suit l'avancement (reçu → en cours → terminé) dans une conversation
 * unique, reprenable depuis n'importe quel appareil.
 *
 * Une tâche confiée n'est rien d'autre qu'une conversation amorcée par une
 * consigne : son convId est celui du transcript chiffré ; l'enregistrement
 * ci-dessous (chiffré clé globale, comme les routines) n'en garde que l'état
 * de suivi — titre, statut, résumé du livrable, horodatage.
 */
import crypto from 'node:crypto'
import { attacheDir, atomicWrite, ensureDir, readJson, withFileLock } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'

const FILE = () => attacheDir('dispatch.json')
const MAX_KEPT = 100

function load(keys) {
  const env = readJson(FILE(), null)
  if (!env) return []
  try {
    const { dispatches } = decryptJson(keys.global, env)
    return Array.isArray(dispatches) ? dispatches : []
  } catch {
    return []
  }
}

async function save(keys, dispatches) {
  await withFileLock('attache-dispatch', async () => {
    ensureDir(attacheDir())
    atomicWrite(FILE(), JSON.stringify(encryptJson(keys.global, { dispatches }, { savedAt: new Date().toISOString() })))
  })
}

/** Titre lisible dérivé de la consigne (première ligne, tronquée). */
function deriveTitre(consigne) {
  const first = String(consigne).split('\n').map((l) => l.trim()).find(Boolean) || 'Tâche confiée'
  return first.replace(/\s+/g, ' ').slice(0, 80)
}

export function listDispatches(keys) {
  // plus récentes d'abord
  return load(keys).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

/**
 * Crée une tâche confiée (statut « en cours ») et lui réserve un convId : le
 * client peut la suivre immédiatement, avant même que le run n'ait écrit son
 * transcript. Retourne { id, convId } — le service lance ensuite le run.
 */
export async function createDispatch(keys, { consigne, par }) {
  const texte = String(consigne || '').trim()
  if (!texte) throw new Error('Consigne requise')
  const now = new Date().toISOString()
  const dispatch = {
    id: crypto.randomBytes(5).toString('hex'),
    convId: now.slice(0, 10) + '-' + crypto.randomBytes(4).toString('hex'),
    titre: deriveTitre(texte),
    consigne: texte.slice(0, 20_000),
    statut: 'en_cours',
    resume: '',
    createdAt: now,
    updatedAt: now,
    createdBy: String(par || 'admin').slice(0, 80),
  }
  const all = load(keys)
  // on borne l'historique : on retire les plus anciennes tâches terminées
  const kept = [dispatch, ...all]
  if (kept.length > MAX_KEPT) {
    const excès = kept.length - MAX_KEPT
    let removed = 0
    for (let i = kept.length - 1; i >= 0 && removed < excès; i--) {
      if (kept[i].statut !== 'en_cours') { kept.splice(i, 1); removed++ }
    }
  }
  await save(keys, kept)
  return { id: dispatch.id, convId: dispatch.convId }
}

/** Met à jour l'état de suivi d'une tâche (fin de run : statut + résumé). */
export async function markDispatch(keys, id, patch) {
  const all = load(keys)
  const d = all.find((x) => x.id === id)
  if (!d) return
  if (patch.statut) d.statut = patch.statut
  if (typeof patch.resume === 'string') d.resume = patch.resume.slice(0, 600)
  if (patch.convId) d.convId = patch.convId
  d.updatedAt = new Date().toISOString()
  await save(keys, all)
}

export async function deleteDispatch(keys, id) {
  const all = load(keys)
  const next = all.filter((x) => x.id !== id)
  await save(keys, next)
  return { removed: next.length !== all.length }
}
