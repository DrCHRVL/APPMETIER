/**
 * SIRAL — Attaché de justice · bibliothèque de trames.
 *
 * Les trames et consignes de rédaction du magistrat (celles qu'il utilisait
 * dans Claude web : plan-type de DML, de réquisition, de TSE…). Il les colle
 * dans le panneau (« enregistre cette trame sous "reponse-dml" »), l'attaché
 * les range ici et les relit avant chaque rédaction du même type. Chiffrées
 * (clé globale), versionnées à chaque réécriture.
 */
import fs from 'node:fs'
import path from 'node:path'
import { attacheDir, readJson, writeCollectionEnvelopeRaw } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'

function safeName(nom) {
  const s = String(nom).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  if (!s) throw new Error('Nom de trame invalide')
  return s
}
export const safeTrameName = safeName

/**
 * Préfixe de PROPRIÉTÉ de l'attaché : les trames « modele-* » sont les
 * gabarits qu'il extrait des actes validés (étude du corpus) — les seules
 * qu'il peut créer et réécrire de sa propre initiative. Toute autre trame
 * appartient au magistrat : l'attaché PROPOSE (proposer_trame, ✓/✗), il
 * n'écrit jamais d'office.
 */
export const MODELE_PREFIX = 'modele-'

export async function saveTrame(keys, { nom, contenu, description }) {
  const name = safeName(nom)
  const record = {
    nom: name,
    description: description ? String(description).slice(0, 300) : undefined,
    contenu: String(contenu).slice(0, 200_000),
    updatedAt: new Date().toISOString(),
  }
  // même verrou + même archivage .versions que les dépôts relayés du navigateur
  await writeCollectionEnvelopeRaw('trames', name, encryptJson(keys.global, record, { savedAt: record.updatedAt }))
  return { nom: name }
}

export function listTrames(keys) {
  const dir = attacheDir('trames')
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue
    const env = readJson(path.join(dir, f), null)
    if (!env) continue
    try {
      const t = decryptJson(keys.global, env)
      out.push({ nom: t.nom, description: t.description, updatedAt: t.updatedAt, taille: (t.contenu || '').length })
    } catch {}
  }
  return out.sort((a, b) => a.nom.localeCompare(b.nom))
}

/**
 * Met à jour la SEULE description d'une trame (classification par l'attaché
 * après téléversement en masse) — le contenu n'est jamais touché.
 */
export async function setTrameDescription(keys, nom, description) {
  const existing = readTrame(keys, nom)
  if (!existing) throw new Error('Trame inconnue — voir trames_lister')
  return saveTrame(keys, { ...existing, description: String(description || '').slice(0, 300) })
}

export function readTrame(keys, nom) {
  const p = attacheDir('trames', safeName(nom) + '.json')
  const env = readJson(p, null)
  if (!env) return null
  try { return decryptJson(keys.global, env) } catch { return null }
}
