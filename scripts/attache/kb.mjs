/**
 * SIRAL — Attaché de justice · base de connaissances du magistrat.
 *
 * Le fond documentaire durable du cabinet, converti en markdown AU
 * TÉLÉVERSEMENT (Paramètres → Attaché IA) : jurisprudences, circulaires et
 * conventions, modes opératoires internes, fiches réflexes, contacts de
 * services… Pas d'index vectoriel : recherche agentique sur le corpus
 * (kb_chercher), à la manière d'un wiki markdown — rien à synchroniser,
 * rien qui fuite hors du modèle E2EE.
 *
 * Différences avec les voisines : une SKILL dit comment faire (méthode),
 * une TRAME donne la forme d'un acte (plan-type), une entrée de la BASE
 * apporte le FOND (droit, doctrine interne, références).
 *
 * Stockage : miroir exact des skills — une enveloppe (clé globale) par
 * entrée, versionnée à chaque réécriture, suppression réversible. Le
 * navigateur admin lit et écrit les mêmes enveloppes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { attacheDir, ensureDir, atomicWrite, readJson } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'

// Catégories proposées (calquées sur le classement du cabinet) — le champ
// reste libre : toute autre catégorie est acceptée telle quelle.
export const KB_CATEGORIES = [
  'jurisprudence',
  'textes-circulaires',
  'modes-operatoires',
  'fiches-reflexes',
  'contacts-services',
  'autre',
]

export function safeKbId(titre) {
  const s = String(titre).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  if (!s) throw new Error('Titre d\'entrée invalide')
  return s
}

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
}

export async function saveKbEntry(keys, { titre, categorie, description, contenu, source }) {
  const id = safeKbId(titre)
  if (!String(contenu || '').trim()) throw new Error('Contenu vide')
  const record = {
    id,
    titre: String(titre).slice(0, 160),
    categorie: normalize(categorie).replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'autre',
    description: String(description || '').slice(0, 300),
    contenu: String(contenu).slice(0, 400_000),
    source: source ? String(source).slice(0, 200) : undefined,
    updatedAt: new Date().toISOString(),
  }
  const dir = attacheDir('kb')
  ensureDir(dir)
  const p = path.join(dir, id + '.json')
  if (fs.existsSync(p)) {
    const vdir = path.join(dir, '.versions', id)
    ensureDir(vdir)
    fs.copyFileSync(p, path.join(vdir, new Date().toISOString().replace(/:/g, '_') + '.json'))
  }
  atomicWrite(p, JSON.stringify(encryptJson(keys.global, record, { savedAt: record.updatedAt })))
  return { id, categorie: record.categorie }
}

/** Métadonnées de toutes les entrées (jamais le contenu — divulgation progressive). */
export function listKb(keys) {
  const dir = attacheDir('kb')
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue
    const env = readJson(path.join(dir, f), null)
    if (!env) continue
    try {
      const e = decryptJson(keys.global, env)
      out.push({
        id: e.id || f.slice(0, -5), titre: e.titre, categorie: e.categorie || 'autre',
        description: e.description, source: e.source, updatedAt: e.updatedAt,
        taille: (e.contenu || '').length,
      })
    } catch {}
  }
  return out.sort((a, b) => a.categorie.localeCompare(b.categorie) || a.titre.localeCompare(b.titre))
}

export function readKbEntry(keys, id) {
  const p = attacheDir('kb', safeKbId(id) + '.json')
  const env = readJson(p, null)
  if (!env) return null
  try { return decryptJson(keys.global, env) } catch { return null }
}

/**
 * Recherche plein-texte (insensible à la casse et aux accents) : chaque mot
 * de la requête est cherché dans titre, description et contenu. Retourne les
 * meilleures entrées avec un extrait autour de la première occurrence —
 * l'agent lit ensuite l'entrée complète (kb_lire) si l'extrait confirme.
 */
export function searchKb(keys, { requete, categorie, limite = 8 }) {
  const dir = attacheDir('kb')
  if (!fs.existsSync(dir)) return []
  const words = normalize(requete).split(/[^a-z0-9]+/).filter((w) => w.length >= 2)
  if (!words.length) return []
  const wantedCat = categorie ? normalize(categorie) : null
  const scored = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue
    const env = readJson(path.join(dir, f), null)
    if (!env) continue
    let e
    try { e = decryptJson(keys.global, env) } catch { continue }
    if (wantedCat && normalize(e.categorie) !== wantedCat) continue
    const titre = normalize(e.titre)
    const desc = normalize(e.description)
    const corps = normalize(e.contenu)
    let score = 0
    let firstIdx = -1
    for (const w of words) {
      if (titre.includes(w)) score += 5
      if (desc.includes(w)) score += 3
      const idx = corps.indexOf(w)
      if (idx >= 0) {
        score += 1
        if (firstIdx < 0 || idx < firstIdx) firstIdx = idx
      }
    }
    if (score === 0) continue
    const extrait = firstIdx >= 0
      ? String(e.contenu).slice(Math.max(0, firstIdx - 120), firstIdx + 240).replace(/\s+/g, ' ').trim()
      : String(e.contenu).slice(0, 200).replace(/\s+/g, ' ').trim()
    scored.push({ id: e.id, titre: e.titre, categorie: e.categorie, description: e.description, score, extrait: '…' + extrait + '…' })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, Math.min(20, limite))
}

/**
 * Bloc « base de connaissances » du prompt système : le sommaire seulement
 * (catégories, titres, descriptions) — le contenu se charge à la demande
 * (kb_lire), même divulgation progressive que les skills.
 */
export function kbPromptSection(keys) {
  const entries = listKb(keys)
  if (!entries.length) return ''
  const MAX_LISTED = 80
  const lines = []
  let cat = null
  for (const e of entries.slice(0, MAX_LISTED)) {
    if (e.categorie !== cat) { cat = e.categorie; lines.push(`[${cat}]`) }
    lines.push(`- ${e.id}${e.description ? ` : ${e.description}` : ` — ${e.titre}`}`)
  }
  if (entries.length > MAX_LISTED) lines.push(`… et ${entries.length - MAX_LISTED} autres entrées — utilise kb_chercher.`)
  return [
    '',
    'BASE DE CONNAISSANCES DU MAGISTRAT (son fond documentaire : jurisprudences, circulaires, modes opératoires, fiches, contacts — Paramètres → Attaché IA) :',
    ...lines,
    'Avant une analyse juridique, une rédaction ou une question de procédure : kb_chercher (mots-clés) puis kb_lire sur les entrées pertinentes — cite l\'entrée utilisée. Ce fond fait FOI sur les pratiques du cabinet ; le droit y est daté : vérifie la date de mise à jour avant de t\'y fier aveuglément.',
    'Quand le magistrat te transmet un contenu durable (« ajoute à la base de connaissances… »), range-le avec kb_enregistrer dans la bonne catégorie.',
  ].join('\n')
}
