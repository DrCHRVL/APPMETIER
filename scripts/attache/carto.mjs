/**
 * SIRAL — Attaché de justice · cartographie (analyse de réseau).
 *
 * L'attaché lit la carte commune (coffre `cartographie`, clé globale) et les
 * enquêtes du contentieux pour aider à VOIR LES CONNEXIONS :
 *  - figures centrales, ponts entre affaires (personnes présentes dans
 *    plusieurs dossiers), grappes ;
 *  - liens de renseignement déjà tracés à la main ;
 *  - et il PROPOSE (✓/✗) de nouveaux liens de renseignement détectés en
 *    lisant les pièces (ex. communications récurrentes entre X et Y), pour
 *    enrichir la carte sans les dessiner soi-même.
 *
 * L'identifiant d'un nœud MEC est la clé canonique du moteur de graphe
 * (nom normalisé, mots triés) — reproduite ici à l'identique pour que les
 * liens proposés s'attachent aux BONS nœuds sur la carte.
 */
import { attacheTj, readVault, writeVault } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { loadContentieux, normalizeNom } from './dossier.mjs'

const OVERLAY = 'cartographie'

function author(keys) { return keys?.grantedBy || 'admin' }

/** Nom normalisé (miroir de mindmapGraph.normalizeMecName). */
export function normalizeMecName(name) {
  return String(name).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Clé canonique insensible à l'ordre des mots (miroir de mecSortedKey). */
export function mecCanonId(name) {
  const c = normalizeMecName(name)
  return c ? c.split(' ').sort().join(' ') : ''
}

/** Charge le coffre overlay commun ({ liensRenseignement, mecsExNihilo, … }). */
export function loadOverlay(keys) {
  const env = readVault(attacheTj(), OVERLAY)
  if (!env) return null
  try { return decryptJson(keys.global, env) } catch { return null }
}

function saveOverlay(keys, file) {
  file.updatedAt = new Date().toISOString()
  file.updatedBy = author(keys)
  file.computerName = 'SIRAL'
  const envelope = encryptJson(keys.global, file, { savedAt: file.updatedAt, savedBy: author(keys) })
  return writeVault(attacheTj(), OVERLAY, envelope, author(keys))
}

/** Liens de renseignement déjà tracés (avec noms lisibles quand connus). */
export function listerLiens(keys) {
  const ov = loadOverlay(keys)
  const liens = (ov?.liensRenseignement || []).map((l) => ({
    id: l.id, source: l.source, target: l.target, label: l.label, notes: l.notes,
  }))
  return { total: liens.length, liens: liens.slice(0, 500) }
}

/**
 * Analyse du réseau à partir des enquêtes du contentieux :
 *  - un nœud MEC par identité canonique, avec le nombre de dossiers ;
 *  - co-occurrences (deux MEC dans un même dossier) ;
 *  - « ponts » : MEC présents dans plusieurs dossiers (relient des affaires) ;
 *  - rappel des liens de renseignement déjà tracés.
 * L'agent interprète (centralité, cloisonnements, liens manquants).
 */
export function analyserReseau(keys, { includeArchived = false } = {}) {
  const { data } = loadContentieux(keys)
  const enquetes = (data.enquetes || []).filter((e) => includeArchived || e.statut !== 'archive')

  const mec = new Map() // canon → { nom, dossiers:Set }
  const dossiers = []
  for (const e of enquetes) {
    const noms = (e.misEnCause || []).map((m) => m.nom).filter(Boolean)
    const canons = []
    for (const nom of noms) {
      const id = mecCanonId(nom)
      if (!id) continue
      if (!mec.has(id)) mec.set(id, { nom, dossiers: new Set() })
      mec.get(id).dossiers.add(String(e.numero))
      canons.push(id)
    }
    dossiers.push({ numero: e.numero, statut: e.statut, mecs: [...new Set(canons)] })
  }

  // co-occurrences (paires dans un même dossier)
  const paires = new Map()
  for (const d of dossiers) {
    const ids = d.mecs
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = [ids[i], ids[j]].sort().join('||')
        paires.set(key, (paires.get(key) || 0) + 1)
      }
    }
  }

  const nomDe = (id) => mec.get(id)?.nom || id
  const topMec = [...mec.entries()]
    .map(([id, v]) => ({ id, nom: v.nom, nbDossiers: v.dossiers.size }))
    .sort((a, b) => b.nbDossiers - a.nbDossiers)
    .slice(0, 40)
  const ponts = topMec.filter((m) => m.nbDossiers > 1)
  const coOccurrences = [...paires.entries()]
    .map(([k, n]) => { const [a, b] = k.split('||'); return { a: nomDe(a), b: nomDe(b), dossiersPartages: n } })
    .sort((x, y) => y.dossiersPartages - x.dossiersPartages)
    .slice(0, 100)

  const ov = loadOverlay(keys)
  const liens = (ov?.liensRenseignement || [])
  const liensExistants = new Set(liens.map((l) => [l.source, l.target].sort().join('||')))

  return {
    contentieux: attacheTj(),
    nbDossiers: dossiers.length,
    nbMecDistincts: mec.size,
    figuresCentrales: topMec.slice(0, 15),
    ponts, // relient plusieurs affaires
    coOccurrences,
    liensRenseignementTraces: liens.length,
    note: 'Les co-occurrences sont des personnes qui partagent un dossier (déjà reliées visuellement). Les liens de renseignement (person→person) sont à tracer à part : proposer_lien pour ceux détectés dans les pièces (communications, famille, logistique) et non encore présents.',
    _liensExistantsKeys: [...liensExistants].slice(0, 1000),
  }
}

/** Ajoute un lien de renseignement à la carte (appliqué à la validation ✓). */
export async function appendLien(keys, { sourceNom, targetNom, label, notes }) {
  const source = mecCanonId(sourceNom)
  const target = mecCanonId(targetNom)
  if (!source || !target) throw new Error('Deux noms de personnes valides sont requis')
  if (source === target) throw new Error('Source et cible identiques')
  const ov = loadOverlay(keys) || emptyOverlay()
  ov.liensRenseignement = ov.liensRenseignement || []
  const key = [source, target].sort().join('||')
  if (ov.liensRenseignement.some((l) => [l.source, l.target].sort().join('||') === key)) {
    return { doublon: true, message: 'Un lien existe déjà entre ces deux personnes' }
  }
  const now = Date.now()
  ov.liensRenseignement.push({
    id: 'lien_ia_' + now.toString(36) + Math.floor(now % 1000),
    source, target,
    label: label ? String(label).slice(0, 120) : undefined,
    notes: notes ? String(notes).slice(0, 500) : undefined,
    createdAt: now, updatedAt: now,
  })
  await saveOverlay(keys, ov)
  return { ok: true, source, target }
}

function emptyOverlay() {
  const now = new Date().toISOString()
  return {
    pinnedMecIds: [], mecsExNihilo: [], dossiersExNihilo: [], liensRenseignement: [],
    clusterAnnotations: [], mecScoreBoosts: [], tagZones: [],
    updatedAt: now, updatedBy: 'SIRAL', version: 1,
  }
}
