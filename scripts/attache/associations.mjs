/**
 * SIRAL — Attaché de justice · associations « type d'acte → trame(s) + skill(s) ».
 *
 * Table DURABLE et ÉDITABLE : pour un type d'acte donné (« prolongation de
 * géolocalisation JLD », « réquisition opérateur »…), quelle(s) trame(s) et
 * quelle(s) skill(s) appliquer. L'attaché la consulte AVANT de rédiger (pour
 * appliquer d'office la bonne trame/skill sans reposer la question) et
 * l'enrichit quand le magistrat rattache une trame/skill à un type d'acte. Le
 * magistrat l'édite aussi directement (Paramètres → Attaché IA). Enveloppe
 * chiffrée (clé globale), versionnée à chaque écriture — même modèle que la
 * mémoire.
 */
import crypto from 'node:crypto'
import { readEnvelopeFile, writeEnvelopeFile } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'

const FILE = 'associations.json'

/** Clé de rapprochement d'un type d'acte (tolère casse, accents, ponctuation). */
const norm = (s) => String(s || '')
  .toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim()

/** Normalise une liste de noms (trames/skills) : uniques, bornés. */
const cleanList = (v) => {
  const arr = Array.isArray(v) ? v : (v == null ? [] : [v])
  const out = []
  for (const x of arr) {
    const s = String(x || '').trim().slice(0, 80)
    if (s && !out.includes(s)) out.push(s)
  }
  return out.slice(0, 20)
}

const newId = () => crypto.randomBytes(6).toString('hex')

/** Lit la table (toujours { entries: [...] }). Ne lève jamais. */
export function readAssociations(keys) {
  const env = readEnvelopeFile(FILE)
  if (!env) return { entries: [] }
  try {
    const data = decryptJson(keys.global, env)
    return { entries: Array.isArray(data?.entries) ? data.entries : [] }
  } catch {
    return { entries: [] }
  }
}

/** Réécrit la table complète (nettoyée), version précédente archivée. */
export async function writeAssociations(keys, entries, savedBy) {
  const clean = (Array.isArray(entries) ? entries : []).slice(0, 200).map((e) => ({
    id: /^[a-f0-9]{6,32}$/.test(String(e?.id || '')) ? e.id : newId(),
    acte: String(e?.acte || '').trim().slice(0, 120),
    trames: cleanList(e?.trames),
    skills: cleanList(e?.skills),
    notes: e?.notes ? String(e.notes).slice(0, 500) : undefined,
    updatedAt: e?.updatedAt || new Date().toISOString(),
  })).filter((e) => e.acte)
  const env = encryptJson(keys.global, { entries: clean }, { savedAt: new Date().toISOString(), savedBy })
  await writeEnvelopeFile(FILE, env)
  return { entries: clean }
}

/** Liste des associations (agent + UI). */
export function listAssociations(keys) {
  return readAssociations(keys).entries
}

/** Upsert par type d'acte (clé normalisée). Renvoie l'entrée résultante. */
export async function setAssociation(keys, { acte, trames, skills, notes }, savedBy = 'attache-ia') {
  const label = String(acte || '').trim().slice(0, 120)
  if (!label) throw new Error('Type d\'acte requis')
  const { entries } = readAssociations(keys)
  const key = norm(label)
  const idx = entries.findIndex((e) => norm(e.acte) === key)
  const base = idx >= 0 ? entries[idx] : { id: newId(), acte: label }
  const merged = {
    ...base,
    acte: label,
    trames: cleanList(trames != null ? trames : base.trames),
    skills: cleanList(skills != null ? skills : base.skills),
    notes: notes != null ? String(notes).slice(0, 500) : base.notes,
    updatedAt: new Date().toISOString(),
  }
  if (idx >= 0) entries[idx] = merged
  else entries.push(merged)
  await writeAssociations(keys, entries, savedBy)
  return merged
}

/** Retire l'association d'un type d'acte (par libellé). */
export async function removeAssociation(keys, acte, savedBy = 'attache-ia') {
  const key = norm(acte)
  const { entries } = readAssociations(keys)
  const next = entries.filter((e) => norm(e.acte) !== key)
  await writeAssociations(keys, next, savedBy)
  return { removed: next.length !== entries.length }
}
