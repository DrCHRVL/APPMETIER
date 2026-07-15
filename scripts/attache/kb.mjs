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
import { attacheDir, readJson, writeCollectionEnvelopeRaw } from './store.mjs'
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

/** Chemin d'arborescence (« Jurisprudence/Cassation/arret.md ») — nettoyé. */
function cleanChemin(chemin) {
  const c = String(chemin || '').replace(/\\/g, '/').split('/')
    .map((seg) => seg.trim().replace(/\.\.+/g, '.')).filter(Boolean).join('/')
  return c.slice(0, 300) || undefined
}

// Écriture versionnée par writeCollectionEnvelopeRaw : MÊME verrou et même
// archivage que les dépôts relayés depuis le navigateur — les deux chemins
// d'écriture vers un même fichier suivent une seule règle de concurrence.
async function writeKbRecord(keys, id, record) {
  await writeCollectionEnvelopeRaw('kb', id, encryptJson(keys.global, record, { savedAt: record.updatedAt }))
}

export async function saveKbEntry(keys, { titre, categorie, chemin, description, contenu, source }) {
  const id = safeKbId(titre)
  if (!String(contenu || '').trim()) throw new Error('Contenu vide')
  const record = {
    id,
    titre: String(titre).slice(0, 160),
    categorie: normalize(categorie).replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'autre',
    chemin: cleanChemin(chemin),
    description: String(description || '').slice(0, 300),
    contenu: String(contenu).slice(0, 400_000),
    source: source ? String(source).slice(0, 200) : undefined,
    updatedAt: new Date().toISOString(),
  }
  await writeKbRecord(keys, id, record)
  return { id, categorie: record.categorie }
}

/**
 * Met à jour les MÉTADONNÉES d'une entrée (description, catégorie, chemin de
 * rangement) sans jamais toucher au contenu — c'est l'outil de classement
 * autonome de l'attaché (kb_decrire). L'id est celui du fichier existant.
 */
export async function setKbMeta(keys, id, { description, categorie, chemin }) {
  const clean = String(id || '').toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(clean)) throw new Error('Identifiant invalide')
  const existing = readKbEntry(keys, clean)
  if (!existing) throw new Error('Entrée inconnue — voir kb_lister')
  const record = {
    ...existing,
    description: description !== undefined ? String(description).slice(0, 300) : existing.description,
    categorie: categorie !== undefined
      ? (normalize(categorie).replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || existing.categorie)
      : existing.categorie,
    chemin: chemin !== undefined ? cleanChemin(chemin) : existing.chemin,
    updatedAt: new Date().toISOString(),
  }
  await writeKbRecord(keys, clean, record)
  return { id: clean, categorie: record.categorie, chemin: record.chemin }
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
        chemin: e.chemin, description: e.description, source: e.source, updatedAt: e.updatedAt,
        taille: (e.contenu || '').length,
      })
    } catch {}
  }
  return out.sort((a, b) => String(a.chemin || a.categorie + '/' + a.titre).localeCompare(String(b.chemin || b.categorie + '/' + b.titre)))
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
  const MAX_LISTED = 100
  const lines = []
  let dossier = null
  for (const e of entries.slice(0, MAX_LISTED)) {
    // regroupement par pochette (chemin d'arborescence), à défaut par catégorie
    const d = e.chemin ? e.chemin.split('/').slice(0, -1).join('/') || '(racine)' : `[${e.categorie}]`
    if (d !== dossier) { dossier = d; lines.push(`${d} :`) }
    lines.push(`- ${e.id}${e.description ? ` : ${e.description}` : ` — ${e.titre}`}`)
  }
  if (entries.length > MAX_LISTED) lines.push(`… et ${entries.length - MAX_LISTED} autres entrées — utilise kb_chercher.`)
  return [
    '',
    'BASE DE CONNAISSANCES DU MAGISTRAT — SON CERVEAU DOCUMENTAIRE (jurisprudences, circulaires, modes opératoires, fiches, contacts — arborescence de pochettes, tout en markdown — Paramètres → Attaché IA) :',
    ...lines,
    'Avant une analyse juridique, une rédaction ou une question de procédure : kb_chercher (mots-clés) puis kb_lire sur les entrées pertinentes — cite l\'entrée utilisée. Ce fond fait FOI sur les pratiques du cabinet ; le droit y est daté : vérifie la date de mise à jour avant de t\'y fier aveuglément.',
    'Quand le magistrat te transmet un contenu durable (« ajoute à la base de connaissances… »), range-le avec kb_enregistrer dans la bonne catégorie et la bonne pochette (chemin).',
    'Tu es le BIBLIOTHÉCAIRE de cette base : une entrée sans description, mal classée ou mal rangée → kb_decrire (description, catégorie, chemin de pochette) — le contenu, lui, ne se modifie que par kb_enregistrer sur consigne.',
  ].join('\n')
}
