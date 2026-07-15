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
import crypto from 'node:crypto'
import { attacheTj, readVault, writeVault, listDocsMeta, docServerKey } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { loadContentieux, normalizeNom } from './dossier.mjs'
import { instructionCorpus } from './instru.mjs'

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

// ── Rapprochements inter-dossiers ────────────────────────────────────────
// Détecte les ENTITÉS partagées entre dossiers qui ne sont pas déjà reliés :
// même téléphone, même plaque, même IBAN, même adresse. Chaque entité
// commune est un pont potentiel entre deux affaires → base des propositions
// de liens de renseignement.

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

/** Texte agrégé d'une enquête (objet, CR, actes) pour l'extraction d'entités. */
function texteEnquete(e) {
  const parts = [stripHtml(e.description)]
  for (const cr of e.comptesRendus || []) parts.push(stripHtml(cr.description))
  for (const a of e.ecoutes || []) parts.push(`${a.numero || ''} ${a.cible || ''} ${stripHtml(a.description)}`)
  for (const a of e.geolocalisations || []) parts.push(`${a.objet || ''} ${stripHtml(a.description)}`)
  for (const a of e.actes || []) parts.push(`${a.type || ''} ${stripHtml(a.description)}`)
  return parts.join('\n')
}

const RE = {
  // tél. FR : 0X XX XX XX XX ou +33X… (mobiles et fixes)
  tel: /(?:\+33|0033|0)\s?[1-9](?:[\s.-]?\d{2}){4}/g,
  // plaque SIV : AA-123-BC
  plaque: /\b[A-Z]{2}-?\d{3}-?[A-Z]{2}\b/g,
  // IBAN FR
  iban: /\bFR\d{2}(?:[\s]?[0-9A-Z]{4}){5,7}\b/gi,
  // adresse : « 12 rue de la Paix », « 950 route de Lyon »…
  adresse: /\b\d{1,4}\s+(?:rue|avenue|av\.?|bd|boulevard|allée|allee|impasse|chemin|place|route|cité|cite|quai|passage)\s+[A-Za-zÀ-ÿ'’ \-]{3,40}/gi,
}

function normEntite(type, raw) {
  const s = String(raw).trim()
  if (type === 'tel') {
    let d = s.replace(/\D/g, '')
    if (d.startsWith('0033')) d = d.slice(4)
    else if (d.startsWith('33') && d.length >= 11) d = d.slice(2)
    if (d.length === 9) d = '0' + d
    return d.length === 10 ? d : null
  }
  if (type === 'plaque') return s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (type === 'iban') return s.toUpperCase().replace(/\s/g, '')
  if (type === 'adresse') return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').replace(/av\./g, 'avenue').trim()
  return s
}

/**
 * Rapprochements : entités partagées entre dossiers NON déjà reliés
 * (ni MEC commun, ni lien de renseignement existant). Retourne, par entité,
 * les dossiers concernés et leurs MEC — matière pour proposer_lien.
 */
export function rapprochementsInterDossiers(keys, { includeArchived = false } = {}) {
  const { data } = loadContentieux(keys)
  const enquetes = (data.enquetes || []).filter((e) => includeArchived || e.statut !== 'archive')

  // entité → Map(dossier → {numero, mecs})
  const index = new Map()
  const mecsParDossier = new Map()
  for (const e of enquetes) {
    const num = String(e.numero)
    const mecs = (e.misEnCause || []).map((m) => m.nom).filter(Boolean)
    mecsParDossier.set(num, new Set((mecs).map(mecCanonId)))
    const txt = texteEnquete(e)
    for (const [type, re] of Object.entries(RE)) {
      re.lastIndex = 0
      const found = new Set()
      let m
      while ((m = re.exec(txt)) !== null) {
        const norm = normEntite(type, m[0])
        if (norm && norm.length >= (type === 'adresse' ? 8 : 4)) found.add(`${type}:${norm}`)
      }
      for (const ent of found) {
        if (!index.has(ent)) index.set(ent, new Map())
        index.get(ent).set(num, { numero: e.numero, mecs })
      }
    }
  }

  const ov = loadOverlay(keys)
  const liensExistants = new Set((ov?.liensRenseignement || []).map((l) => [l.source, l.target].sort().join('||')))

  const partages = []
  for (const [ent, parDossier] of index) {
    if (parDossier.size < 2) continue // pas partagé
    const dossiers = [...parDossier.values()]
    const nums = dossiers.map((d) => String(d.numero))
    const partageMec = (i, j) => {
      const a = mecsParDossier.get(nums[i]) || new Set()
      const b = mecsParDossier.get(nums[j]) || new Set()
      for (const x of a) if (b.has(x)) return true
      return false
    }
    // on garde l'entité s'il existe AU MOINS UNE paire de dossiers non reliée
    // par un MEC commun (= un pont inédit) — les paires déjà reliées sont
    // simplement redondantes avec les liens visibles.
    let pontInedit = false
    for (let i = 0; i < nums.length && !pontInedit; i++) {
      for (let j = i + 1; j < nums.length && !pontInedit; j++) {
        if (!partageMec(i, j)) pontInedit = true
      }
    }
    if (!pontInedit) continue
    const [type, valeur] = ent.split(/:(.+)/)
    partages.push({
      type, valeur,
      dossiers: dossiers.map((d) => ({ numero: d.numero, mecs: d.mecs })),
    })
  }

  const libelle = { tel: 'téléphone', plaque: 'plaque', iban: 'compte (IBAN)', adresse: 'adresse' }
  partages.sort((a, b) => b.dossiers.length - a.dossiers.length)
  return {
    contentieux: attacheTj(),
    nbRapprochements: partages.length,
    note: 'Chaque entrée est une entité (téléphone, plaque, IBAN, adresse) présente dans PLUSIEURS dossiers qui ne partagent aucun mis en cause — donc un pont potentiel entre affaires. Vérifier la pertinence puis proposer_lien entre un MEC de chaque dossier, avec l\'entité en source.',
    rapprochements: partages.slice(0, 120).map((p) => ({ ...p, type: libelle[p.type] || p.type })),
  }
}

// ── Corpus complet pour l'analyse transversale de renseignement ──────────
// Toutes les enquêtes (archivées comprises) ET tous les dossiers
// d'instruction, avec leurs mis en cause déclarés et le nombre de pièces —
// la carte de ce qu'il reste à DÉPOUILLER (les signaux faibles sont dans les
// pièces, pas dans la liste des MEC). Base de l'analyse déléguée aux
// sous-agents (un par dossier), qui lisent les documents et remontent les
// personnes, surnoms, adresses, plaques et téléphones.

export function cartoCorpus(keys, { includeArchived = true } = {}) {
  const { data } = loadContentieux(keys)
  const enquetes = (data.enquetes || [])
    .filter((e) => includeArchived || e.statut !== 'archive')
    .map((e) => {
      const metas = listDocsMeta(attacheTj(), docServerKey(e.numero)).filter((m) => !String(m.rel).startsWith('MD/'))
      return {
        numero: e.numero, kind: 'enquete', statut: e.statut,
        objet: stripHtml(e.description || '').slice(0, 200),
        misEnCause: (e.misEnCause || []).map((m) => m.nom).filter(Boolean),
        nbDocuments: metas.length,
      }
    })
  let instruction = []
  try { instruction = instructionCorpus(keys) } catch { /* module instruction absent : on continue */ }
  const ov = loadOverlay(keys)
  return {
    contentieux: attacheTj(),
    nbEnquetes: enquetes.length,
    nbInstruction: instruction.length,
    dossiers: [...enquetes, ...instruction],
    mecsExNihiloExistants: (ov?.mecsExNihilo || []).map((m) => m.displayName || m.id).slice(0, 300),
    dossiersExNihiloExistants: (ov?.dossiersExNihilo || []).map((d) => d.label).slice(0, 200),
    liensRenseignementTraces: (ov?.liensRenseignement || []).length,
    note: 'Corpus COMPLET pour une analyse transversale de renseignement : toutes les enquêtes (archivées comprises) et tous les dossiers d\'instruction, avec leurs mis en cause DÉCLARÉS et le nombre de pièces. Les signaux faibles (surnoms, personnes au 2nd plan jamais mises en cause, adresses, plaques, téléphones, comptes) sont dans les PIÈCES — pas dans la liste des mis en cause. MÉTHODE : pour chaque dossier, dossier_arborescence(numero) puis lire_document sur les PV et pièces ; DÉLÈGUE à des sous_agents (un par dossier ou petit groupe, consigne autonome : « relève toute personne — nom, surnom, alias —, adresse, plaque, téléphone, compte, et ce qui la relie à une autre ; format : liste »). Recoupe (recouper_personnes) puis PROPOSE (jamais tracé d\'office) : proposer_lien entre personnes reliées, proposer_mec_carto pour un suspect/surnom absent des dossiers, proposer_dossier_carto pour une architecture cachée (grappe autour d\'une même figure — ex. un détenu qui pilote plusieurs affaires).',
  }
}

// ── Mis en cause EX NIHILO autonome (suspect / surnom isolé) ─────────────
// Un nœud « personne » sur la carte qui n'apparaît dans AUCUN dossier réel :
// un suspect au second plan, un surnom entendu dans des PV, une figure de
// renseignement. Distinct de appendDossierExNihilo (qui crée un dossier +
// ses personnes) : ici on crée UNE personne seule, avec ses alias.

/** Vrai si la personne existe déjà (MEC réel OU nœud ex nihilo). */
export function mecExNihiloExiste(keys, nom) {
  const key = mecCanonId(nom)
  if (!key) return false
  const ov = loadOverlay(keys)
  if ((ov?.mecsExNihilo || []).some((m) => mecCanonId(m.displayName || m.id) === key)) return true
  const { data } = loadContentieux(keys)
  for (const e of data.enquetes || []) {
    for (const m of e.misEnCause || []) if (mecCanonId(m.nom) === key) return true
  }
  return false
}

/** Crée un MEC ex nihilo autonome (appliqué à la validation ✓). */
export async function appendMecExNihilo(keys, { nom, alias, notes }) {
  const clean = String(nom || '').trim()
  if (!clean) throw new Error('Nom de la personne requis')
  const key = mecCanonId(clean)
  if (!key) throw new Error('Nom invalide')
  const ov = loadOverlay(keys) || emptyOverlay()
  ov.mecsExNihilo = ov.mecsExNihilo || []
  if (ov.mecsExNihilo.some((m) => mecCanonId(m.displayName || m.id) === key)) {
    return { doublon: true, message: `« ${clean} » figure déjà sur la carte` }
  }
  const now = Date.now()
  const id = normalizeMecName(clean)
  ov.mecsExNihilo.push({
    id, displayName: clean,
    alias: Array.isArray(alias) ? alias.map((a) => String(a).trim()).filter(Boolean).slice(0, 12) : [],
    notes: notes ? String(notes).slice(0, 500) : undefined,
    createdAt: now, updatedAt: now,
  })
  await saveOverlay(keys, ov)
  return { ok: true, id }
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

// ── Recoupement des personnes (aide à la création de dossier) ────────────
// Pour une liste de noms détectés dans une pièce, dit lesquels sont DÉJÀ
// connus — soit comme mis en cause d'un dossier réel, soit comme MEC ex
// nihilo de la carte — et lesquels sont nouveaux. Le rapprochement est
// insensible à l'ordre des mots (clé triée, miroir du moteur de graphe).

/**
 * @param {string[]|{nom:string}[]} noms
 * @returns {{contentieux, recoupements: Array<{nom, connu, source, ou, nomConnu?}>}}
 *  source : 'dossier' (MEC d'un dossier réel) | 'carto' (MEC ex nihilo) | null (nouveau)
 *  ou     : numéros de dossiers concernés (source 'dossier')
 */
export function recoupementMecs(keys, noms) {
  const { data } = loadContentieux(keys)
  const reels = new Map() // cléTriée → { nom, dossiers:Set }
  for (const e of data.enquetes || []) {
    for (const m of e.misEnCause || []) {
      if (!m.nom) continue
      const key = mecCanonId(m.nom)
      if (!key) continue
      if (!reels.has(key)) reels.set(key, { nom: m.nom, dossiers: new Set() })
      reels.get(key).dossiers.add(String(e.numero))
    }
  }
  const ov = loadOverlay(keys)
  const exn = new Map()
  for (const m of ov?.mecsExNihilo || []) {
    const key = mecCanonId(m.displayName || m.id)
    if (key) exn.set(key, m.displayName || m.id)
  }
  const list = (Array.isArray(noms) ? noms : []).map((raw) => {
    const nom = String((typeof raw === 'string' ? raw : raw?.nom) || '').trim()
    const key = mecCanonId(nom)
    if (key && reels.has(key)) {
      const info = reels.get(key)
      return { nom, connu: true, source: 'dossier', ou: [...info.dossiers], nomConnu: info.nom }
    }
    if (key && exn.has(key)) return { nom, connu: true, source: 'carto', ou: [], nomConnu: exn.get(key) }
    return { nom, connu: false, source: null, ou: [] }
  })
  return {
    contentieux: attacheTj(),
    note: 'Les personnes « connu:true » existent déjà (source : dossier réel ou carte). À la création, elles seront RATTACHÉES (pas recréées). Les « connu:false » seront créées ex nihilo sur la carte.',
    recoupements: list,
  }
}

/** Vrai si un dossier ex nihilo de ce libellé existe déjà sur la carte. */
export function dossierExNihiloExiste(keys, label) {
  const norm = String(label || '').trim().toLowerCase()
  if (!norm) return false
  const ov = loadOverlay(keys)
  return (ov?.dossiersExNihilo || []).some((d) => String(d.label || '').trim().toLowerCase() === norm)
}

/**
 * Crée un dossier EX NIHILO sur la carte (nœud d'annotation, distinct des
 * vrais dossiers) — appliqué à la validation ✓. Les mis en cause déjà connus
 * (dossier réel ou carte) sont RATTACHÉS par leur identité canonique ; les
 * inconnus sont créés comme MEC ex nihilo (« mis en cause lié ex nihilo »).
 * L'id d'un MEC est le nom normalisé (miroir de useCartographieOverlayStore.
 * addMec) pour se fondre avec un éventuel nœud réel homonyme.
 */
export async function appendDossierExNihilo(keys, { label, dateApprox, misEnCause, natinfCodes, notes }) {
  const lbl = String(label || '').trim()
  if (!lbl) throw new Error('Libellé du dossier requis')
  const ov = loadOverlay(keys) || emptyOverlay()
  ov.dossiersExNihilo = ov.dossiersExNihilo || []
  ov.mecsExNihilo = ov.mecsExNihilo || []
  if (ov.dossiersExNihilo.some((d) => String(d.label || '').trim().toLowerCase() === lbl.toLowerCase())) {
    return { doublon: true, message: `Un dossier ex nihilo « ${lbl} » existe déjà` }
  }

  // Index des personnes connues (par clé triée) → id canonique à rattacher.
  const { data } = loadContentieux(keys)
  const connus = new Map()
  for (const e of data.enquetes || []) {
    for (const m of e.misEnCause || []) {
      const key = mecCanonId(m.nom)
      if (key && !connus.has(key)) connus.set(key, normalizeMecName(m.nom))
    }
  }
  for (const m of ov.mecsExNihilo) {
    const key = mecCanonId(m.displayName || m.id)
    if (key && !connus.has(key)) connus.set(key, m.id)
  }

  const mecIds = []
  const crees = []
  const lies = []
  const pushId = (id) => { if (id && !mecIds.includes(id)) mecIds.push(id) }
  for (const raw of Array.isArray(misEnCause) ? misEnCause : []) {
    const nom = String((typeof raw === 'string' ? raw : raw?.nom) || '').trim()
    if (!nom) continue
    const key = mecCanonId(nom)
    if (!key) continue
    if (connus.has(key)) { pushId(connus.get(key)); lies.push(nom); continue }
    const id = normalizeMecName(nom)
    if (!id) continue
    const now = Date.now()
    ov.mecsExNihilo.push({ id, displayName: nom, alias: [], createdAt: now, updatedAt: now })
    connus.set(key, id)
    pushId(id)
    crees.push(nom)
  }

  const now = Date.now()
  ov.dossiersExNihilo.push({
    id: 'dexn_' + now.toString(36) + '_' + crypto.randomBytes(3).toString('hex'),
    label: lbl,
    dateApprox: dateApprox ? String(dateApprox).slice(0, 40) : undefined,
    mecIds,
    natinfCodes: (Array.isArray(natinfCodes) && natinfCodes.length) ? natinfCodes.map(String) : undefined,
    notes: notes ? String(notes).slice(0, 1000) : undefined,
    createdAt: now,
    updatedAt: now,
  })
  await saveOverlay(keys, ov)
  return { ok: true, mecsCrees: crees, mecsLies: lies }
}

function emptyOverlay() {
  const now = new Date().toISOString()
  return {
    pinnedMecIds: [], mecsExNihilo: [], dossiersExNihilo: [], liensRenseignement: [],
    clusterAnnotations: [], mecScoreBoosts: [], tagZones: [],
    updatedAt: now, updatedBy: 'SIRAL', version: 1,
  }
}
