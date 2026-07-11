/**
 * SIRAL — Attaché de justice · routines.
 *
 * Le pendant des routines de Claude Code / Cowork, côté SIRAL : des
 * consignes récurrentes définies par le magistrat, exécutées par l'agent
 * sans lui. Deux cadences :
 *  - quotidienne à HH:MM (« chaque matin à 7h30, vérifie… »)
 *  - toutes les N heures.
 * Le brief du majordome reste câblé en dur ; les routines s'y AJOUTENT
 * (préparation d'audience de la veille, point hebdo, surveillance d'un
 * dossier chaud…). Stockage chiffré (clé globale), exécutions auditées,
 * résultats déposés dans le fil et/ou envoyés au magistrat selon la
 * consigne elle-même.
 */
import crypto from 'node:crypto'
import { attacheDir, atomicWrite, ensureDir, readJson, withFileLock } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'

const FILE = () => attacheDir('routines.json')

function load(keys) {
  const env = readJson(FILE(), null)
  if (!env) return []
  try {
    const { routines } = decryptJson(keys.global, env)
    return Array.isArray(routines) ? routines : []
  } catch {
    return []
  }
}

async function save(keys, routines) {
  await withFileLock('attache-routines', async () => {
    ensureDir(attacheDir())
    atomicWrite(FILE(), JSON.stringify(encryptJson(keys.global, { routines }, { savedAt: new Date().toISOString() })))
  })
}

export function listRoutines(keys) {
  return load(keys)
}

/** Crée ou met à jour (si id fourni). heure 'HH:MM' OU intervalleHeures. */
export async function upsertRoutine(keys, { id, nom, prompt, heure, intervalleHeures, actif = true }) {
  const routines = load(keys)
  if (!String(nom || '').trim() || !String(prompt || '').trim()) throw new Error('Nom et consigne requis')
  if (heure && !/^\d{1,2}:\d{2}$/.test(heure)) throw new Error('Heure attendue au format HH:MM')
  const ivl = intervalleHeures ? Math.max(1, Math.min(168, Number(intervalleHeures))) : undefined
  if (!heure && !ivl) throw new Error('Choisir une heure quotidienne OU un intervalle en heures')
  const existing = id ? routines.find((r) => r.id === id) : null
  const routine = {
    id: existing?.id || crypto.randomBytes(5).toString('hex'),
    nom: String(nom).slice(0, 80),
    prompt: String(prompt).slice(0, 20_000),
    heure: heure || undefined,
    intervalleHeures: heure ? undefined : ivl,
    actif: Boolean(actif),
    creeLe: existing?.creeLe || new Date().toISOString(),
    lastRunAt: existing?.lastRunAt,
    lastRunOk: existing?.lastRunOk,
  }
  const next = existing ? routines.map((r) => (r.id === routine.id ? routine : r)) : [...routines, routine]
  if (next.length > 40) throw new Error('Trop de routines (40 max)')
  await save(keys, next)
  return { id: routine.id }
}

export async function deleteRoutine(keys, id) {
  const routines = load(keys)
  const next = routines.filter((r) => r.id !== id)
  await save(keys, next)
  return { removed: next.length !== routines.length }
}

export async function markRun(keys, id, ok) {
  const routines = load(keys)
  const r = routines.find((x) => x.id === id)
  if (!r) return
  r.lastRunAt = new Date().toISOString()
  r.lastRunOk = ok
  await save(keys, routines)
}

/** Routines dont l'exécution est due maintenant. */
export function dueRoutines(keys, now = new Date()) {
  const out = []
  for (const r of load(keys)) {
    if (!r.actif) continue
    if (r.heure) {
      const [h, m] = r.heure.split(':').map(Number)
      const today = now.toISOString().slice(0, 10)
      const alreadyToday = (r.lastRunAt || '').slice(0, 10) === today
      const passed = now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m)
      if (passed && !alreadyToday) out.push(r)
    } else if (r.intervalleHeures) {
      const last = r.lastRunAt ? Date.parse(r.lastRunAt) : 0
      if (now.getTime() - last >= r.intervalleHeures * 3600_000) out.push(r)
    }
  }
  return out
}
