/**
 * SIRAL — Attaché de justice · référentiel NATINF côté service.
 *
 * Même source de vérité que l'app web : le référentiel PUBLIÉ dans
 * SIRAL_DATA_DIR/natinf.json (mis à jour par l'administrateur) prime ; à
 * défaut, le référentiel embarqué du dépôt (data/natinf/natinf.json).
 * Lecture paresseuse + cache mémoire (rechargé si le fichier publié change).
 *
 * Sert aux outils natinf_chercher (recherche code/libellé) et
 * ajouter_natinfs (validation des codes avant écriture au dossier).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA_DIR = process.env.SIRAL_DATA_DIR || path.join(process.cwd(), 'srv-data')
const PUBLISHED = path.join(DATA_DIR, 'natinf.json')
const BUNDLED = fileURLToPath(new URL('../../data/natinf/natinf.json', import.meta.url))

let cache = null // { entries: Map<code, entry>, list: entry[], sourceMtime, source }

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
}

function loadEntries() {
  const source = fs.existsSync(PUBLISHED) ? PUBLISHED : (fs.existsSync(BUNDLED) ? BUNDLED : null)
  if (!source) return { entries: new Map(), list: [], source: null, sourceMtime: 0 }
  const mtime = fs.statSync(source).mtimeMs
  if (cache && cache.source === source && cache.sourceMtime === mtime) return cache
  try {
    const raw = JSON.parse(fs.readFileSync(source, 'utf8'))
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries : []
    const entries = new Map()
    for (const e of list) {
      if (e && e.code != null) entries.set(String(e.code), e)
    }
    cache = { entries, list, source, sourceMtime: mtime }
    return cache
  } catch {
    return { entries: new Map(), list: [], source, sourceMtime: mtime }
  }
}

/** L'entrée du référentiel pour un code, ou null. */
export function natinfEntry(code) {
  return loadEntries().entries.get(String(code).trim()) || null
}

/** Libellé court d'un code (pour l'affichage dans les dossiers). */
export function natinfLabel(code) {
  const e = natinfEntry(code)
  return e ? e.libelle : null
}

/**
 * Recherche dans le référentiel : code exact d'abord, sinon tous les mots
 * dans le libellé (insensible casse/accents), les infractions fréquentes en
 * tête. Retourne au plus `limite` entrées compactes.
 */
export function searchNatinf(requete, { limite = 20 } = {}) {
  const { entries, list } = loadEntries()
  const q = String(requete || '').trim()
  if (!q) return []
  if (/^\d{1,6}$/.test(q)) {
    const exact = entries.get(q)
    if (exact) return [compact(exact)]
  }
  const words = normalize(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 2)
  if (!words.length) return []
  const scored = []
  for (const e of list) {
    const lib = normalize(e.libelle)
    let ok = true
    for (const w of words) {
      if (!lib.includes(w)) { ok = false; break }
    }
    if (!ok) continue
    scored.push({ e, score: (e.frequent ? 2 : 0) + (lib.length < 90 ? 1 : 0) })
    if (scored.length > 400) break
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(50, limite))
    .map(({ e }) => compact(e))
}

function compact(e) {
  return {
    code: String(e.code),
    libelle: e.libelle,
    nature: e.natureOfficielle || e.nature,
    articles: e.articlesDefinition || undefined,
    frequent: Boolean(e.frequent),
  }
}

/** Vrai si le référentiel est chargé (fichier présent et lisible). */
export function natinfDisponible() {
  return loadEntries().entries.size > 0
}
