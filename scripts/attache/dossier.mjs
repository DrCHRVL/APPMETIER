/**
 * SIRAL — Attaché de justice · accès aux dossiers du contentieux confié.
 *
 * Lecture : déchiffre le coffre `ctx-<id>` ({ data: SyncData, metadata }),
 * rend les enquêtes en markdown compact (même esprit que dossierMarkdown.ts)
 * et extrait le texte des documents chiffrés (PDF compris).
 *
 * Écriture : mutations ciblées (acte, prolongation, compte-rendu, todo) qui
 * respectent le contrat de synchronisation de l'app — dateMiseAJour et
 * version bumpées, coffre re-chiffré et archivé avant écrasement — pour que
 * les clients web fusionnent proprement (le plus récent gagne, par enquête).
 */
import crypto from 'node:crypto'
import {
  attacheTj, attacheContentieux, readVault, writeVault,
  listDocsMeta, readDocBlob, docServerKey,
  attacheDir, readJson, atomicWrite,
} from './store.mjs'
import { encryptJson, decryptJson, decryptDocBlob } from './crypto.mjs'
import { natinfEntry, natinfLabel } from './natinf.mjs'
import { extractPdfText } from './ocr.mjs'
import { extractOfficeText, isOfficeExt } from './officeText.mjs'

/**
 * Signature des écritures VISIBLES des autres utilisateurs (CR, metadata de
 * synchro, historique) : le NOM DE L'ADMINISTRATEUR qui a remis les clés —
 * jamais « attache-ia ». L'existence de l'assistant ne doit laisser AUCUNE
 * trace dans les données partagées ; l'attribution réelle vit dans le
 * journal d'audit chiffré, visible du seul administrateur.
 */
function authorOf(keys) {
  return keys?.grantedBy || 'admin'
}

function ctxScope() { return `ctx-${attacheContentieux()}` }

function ctxKey(keys) {
  const k = keys.byScope.get(ctxScope())
  if (!k) throw new Error(`Trousseau sans clé ${ctxScope()} — remise des clés requise`)
  return k
}

/** Charge { data, metadata } du contentieux. Coffre absent = pas encore de données. */
export function loadContentieux(keys) {
  const envelope = readVault(attacheTj(), ctxScope())
  if (!envelope) return { data: { enquetes: [], version: 0 }, metadata: null }
  return decryptJson(ctxKey(keys), envelope)
}

async function saveContentieux(keys, payload) {
  const data = payload.data || {}
  data.version = (Number(data.version) || 0) + 1
  const author = authorOf(keys)
  const metadata = {
    lastModified: new Date().toISOString(),
    modifiedBy: author,
    computerName: 'SIRAL',
    version: data.version,
  }
  const envelope = encryptJson(ctxKey(keys), { data, metadata }, {
    savedAt: metadata.lastModified,
    savedBy: author,
  })
  await writeVault(attacheTj(), ctxScope(), envelope, author)
}

function stripHtml(s) {
  return String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function findEnquete(data, numero) {
  const wanted = String(numero).trim()
  const list = data.enquetes || []
  return list.find((e) => String(e.numero).trim() === wanted)
    || list.find((e) => String(e.numero).replace(/\s+/g, '') === wanted.replace(/\s+/g, ''))
    || null
}

/** Le numéro correspond-il à une enquête du contentieux confié ? */
export function enqueteExiste(keys, numero) {
  const { data } = loadContentieux(keys)
  return Boolean(findEnquete(data, numero))
}

// ── Lecture ──

/**
 * Liste compacte des enquêtes (pour l'orientation de l'agent).
 * Le caractère « dormant » suit le SEUIL CONFIGURÉ dans SIRAL pour l'alerte
 * « dossier sans CR » (alertRules, type cr_delay) — jamais une valeur
 * arbitraire. À défaut de règle activée : 60 jours.
 */
export function listEnquetes(keys, { includeArchived = false } = {}) {
  const { data } = loadContentieux(keys)
  const crRule = (data.alertRules || []).find((r) => r && r.type === 'cr_delay' && r.enabled)
  const seuilSansCR = Number(crRule?.threshold) > 0 ? Number(crRule.threshold) : 60
  const now = Date.now()
  return (data.enquetes || [])
    .filter((e) => includeArchived || e.statut !== 'archive')
    .map((e) => {
      const lastCr = (e.comptesRendus || [])
        .map((c) => Date.parse(c.date))
        .filter(Number.isFinite)
        .sort((x, y) => y - x)[0]
      const joursSansCR = lastCr ? Math.floor((now - lastCr) / 86_400_000) : null
      return {
        numero: e.numero,
        objet: stripHtml(e.description || '').slice(0, 180),
        statut: e.statut,
        services: e.services || [],
        misEnCause: (e.misEnCause || []).length,
        ecoutes: (e.ecoutes || []).length,
        geolocalisations: (e.geolocalisations || []).length,
        autresActes: (e.actes || []).length,
        comptesRendus: (e.comptesRendus || []).length,
        documents: (e.documents || []).length,
        derniereMaj: e.dateMiseAJour,
        joursSansCR,
        seuilSansCR,
        dormant: e.statut === 'en_cours' && (joursSansCR === null || joursSansCR >= seuilSansCR),
      }
    })
}

function acteLine(kind, a) {
  const flags = []
  if (a.statut) flags.push(a.statut)
  if (a.prolongationsHistory?.length) flags.push(`${a.prolongationsHistory.length} prolongation(s)`)
  const label = kind === 'ecoute' ? `Interception ${a.numero}${a.cible ? ` (${a.cible})` : ''}`
    : kind === 'geoloc' ? `Géolocalisation ${a.objet}`
    : `${a.type || 'Acte'} — ${stripHtml(a.description || '').slice(0, 160)}`
  return `- [id ${a.id}] ${label} : ${a.dateDebut || '?'} → ${a.dateFin || '?'} (${flags.join(', ') || 'sans statut'})`
}

// ── Rendu markdown d'une enquête, PAR SECTIONS ──
// Motif : un résultat d'outil trop gros dépasse le plafond de sortie du CLI,
// qui le déverse alors dans un fichier — que l'attaché (sans outil Read, cf.
// DISALLOWED_TOOLS) ne peut PAS rouvrir : le dossier devient illisible et les
// sous-agents bouclent (error_max_turns). Les comptes-rendus intégraux sont la
// seule partie vraiment volumineuse. On rend donc un APERÇU compact par défaut
// (CR en index daté) et on sert le détail à la demande, borné : section « cr »
// paginée, « fiche » ciblée sur une personne/ligne, etc. — jamais de spill.

const CR_SNIPPET = 220        // longueur d'un extrait de CR dans l'index / la fiche
const APERCU_CR_MAX = 40      // CR les plus récents montrés dans l'index de l'aperçu
const CR_PAGE_BUDGET = 28_000 // budget caractères d'une page de CR intégraux

function sortedCrs(e) {
  return [...(e.comptesRendus || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

function enTete(e) {
  const parts = [`# Dossier ${e.numero}`]
  if (e.description) parts.push(`**Objet :** ${stripHtml(e.description)}`)
  if (e.services?.length) parts.push(`**Services :** ${e.services.join(', ')}`)
  if (e.dateOP) parts.push(`**Date d'OP :** ${e.dateOP}`)
  parts.push(`**Statut :** ${e.statut} — dernière mise à jour ${e.dateMiseAJour || '?'}`)
  return parts
}

function blocNatinf(e) {
  const natinfs = e.infractionNatinfCodes || []
  if (!natinfs.length) {
    return ['\n## Infractions (NATINF)\n(aucun code enregistré — avant de rédiger un acte, détermine les qualifications : natinf_chercher puis ajouter_natinfs)']
  }
  const parts = ['\n## Infractions (NATINF) — les qualifications OFFICIELLES du dossier, à reprendre telles quelles dans tout acte']
  for (const code of natinfs) {
    const lib = natinfLabel(code)
    parts.push(`- NATINF ${code}${lib ? ` — ${lib}` : ''}`)
  }
  return parts
}

// Dans l'aperçu, les listes potentiellement longues sont bornées (renvoi vers
// la section dédiée) pour garantir qu'un dossier hors norme ne déborde jamais ;
// les sections dédiées (mec, actes, documents) passent max = Infinity.
function trimList(items, max, renvoi) {
  if (!Number.isFinite(max) || items.length <= max) return items
  return [...items.slice(0, max), `_(+${items.length - max} — ${renvoi})_`]
}

function blocMec(e, max = Infinity) {
  if (!e.misEnCause?.length) return []
  const lignes = e.misEnCause.map((m) => `- ${m.nom}${m.role ? ` — ${m.role}` : ''}${m.statut ? ` (${m.statut})` : ''}`)
  return ['\n## Mis en cause', ...trimList(lignes, max, 'section:"mec" pour la liste complète')]
}

function blocActes(e, max = Infinity) {
  const parts = []
  if (e.ecoutes?.length) { parts.push('\n## Interceptions'); parts.push(...trimList(e.ecoutes.map((a) => acteLine('ecoute', a)), max, 'section:"actes"')) }
  if (e.geolocalisations?.length) { parts.push('\n## Géolocalisations'); parts.push(...trimList(e.geolocalisations.map((a) => acteLine('geoloc', a)), max, 'section:"actes"')) }
  if (e.actes?.length) { parts.push('\n## Autres actes'); parts.push(...trimList(e.actes.map((a) => acteLine('autre', a)), max, 'section:"actes"')) }
  return parts
}

function blocAFaire(e) {
  if (!e.toDos?.length) return []
  const parts = ['\n## À faire']
  for (const t of e.toDos) parts.push(`- [${t.status === 'completed' ? 'x' : ' '}] ${t.text}`)
  return parts
}

function blocDocuments(e, max = Infinity) {
  const docs = e.documents || []
  if (!docs.length) return []
  const lignes = docs.map((d) => `- ${d.cheminRelatif} (${d.type}, ${Math.round((d.taille || 0) / 1024)} Ko, ajouté le ${d.dateAjout?.slice?.(0, 10) || '?'})`)
  return ['\n## Documents déposés', ...trimList(lignes, max, 'dossier_arborescence pour tout, ou section:"documents"')]
}

/** Index daté des CR (le [#i] sert d'offset pour section « cr »). */
function crIndex(crs) {
  const total = crs.length
  const start = Math.max(0, total - APERCU_CR_MAX)
  const parts = ['\n## Comptes-rendus — index chronologique (texte intégral : section:"cr")']
  if (start > 0) parts.push(`_(${start} CR plus anciens masqués — section:"cr" offset:0 pour remonter au début)_`)
  for (let i = start; i < total; i++) {
    const cr = crs[i]
    const snip = stripHtml(cr.description || '').replace(/\s+/g, ' ').slice(0, CR_SNIPPET)
    parts.push(`- [#${i}] ${cr.date}${cr.enqueteur ? ` · ${cr.enqueteur}` : ''} — ${snip}${snip.length >= CR_SNIPPET ? '…' : ''}`)
  }
  return parts
}

/** Page de CR intégraux à partir de `offset`, bornée par nombre et budget caractères. */
function crPage(e, crs, offset, limit) {
  const total = crs.length
  const from = Math.min(Math.max(0, Number.isFinite(offset) ? Math.floor(offset) : 0), Math.max(0, total))
  const maxCount = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : Infinity
  const parts = [`# Dossier ${e.numero} — comptes-rendus (à partir du #${from} sur ${total})`]
  if (!total) { parts.push('\n(aucun compte-rendu)'); return parts }
  let used = 0
  let shown = 0
  let i = from
  for (; i < total && shown < maxCount; i++) {
    const cr = crs[i]
    let block = `\n### [#${i}] CR du ${cr.date}${cr.enqueteur ? ` — ${cr.enqueteur}` : ''}\n${stripHtml(cr.description || '')}`
    if (block.length > CR_PAGE_BUDGET) block = block.slice(0, CR_PAGE_BUDGET) + '\n…(CR tronqué — pièce source via dossier_arborescence puis lire_document)'
    if (shown > 0 && used + block.length > CR_PAGE_BUDGET) break
    parts.push(block)
    used += block.length
    shown++
  }
  parts.push(i < total
    ? `\n---\n_Suite : section:"cr" offset:${i} (il reste ${total - i} CR)._`
    : `\n---\n_Fin des comptes-rendus (${total} au total)._`)
  return parts
}

/** Vue ciblée sur une personne / ligne / cible / id d'acte : MEC, actes et mentions dans les CR. */
function blocFiche(e, cible) {
  const q = String(cible || '').trim().toLowerCase()
  const parts = [...enTete(e).slice(0, 2), `\n# Fiche ciblée : « ${cible || ''} »`]
  if (!q) { parts.push('\n_(précisez une cible : nom, ligne, objet ou id d\'acte)_'); return parts }
  const match = (s) => String(s || '').toLowerCase().includes(q)

  const mec = (e.misEnCause || []).filter((m) => match(m.nom) || match(m.role))
  if (mec.length) { parts.push('\n## Mis en cause correspondants'); for (const m of mec) parts.push(`- ${m.nom}${m.role ? ` — ${m.role}` : ''}${m.statut ? ` (${m.statut})` : ''}`) }

  const actes = []
  for (const a of (e.ecoutes || [])) if (match(a.cible) || match(a.description) || String(a.id) === q) actes.push(['ecoute', a])
  for (const a of (e.geolocalisations || [])) if (match(a.objet) || match(a.description) || String(a.id) === q) actes.push(['geoloc', a])
  for (const a of (e.actes || [])) if (match(a.type) || match(a.description) || String(a.id) === q) actes.push(['autre', a])
  if (actes.length) { parts.push('\n## Actes liés'); for (const [k, a] of actes) parts.push(acteLine(k, a)) }

  const crs = sortedCrs(e)
  const hits = []
  for (let i = 0; i < crs.length; i++) {
    const text = stripHtml(crs[i].description || '')
    const idx = text.toLowerCase().indexOf(q)
    if (idx < 0) continue
    const around = text.slice(Math.max(0, idx - 120), idx + 200).replace(/\s+/g, ' ')
    hits.push(`- [#${i}] ${crs[i].date} — …${around}…`)
  }
  if (hits.length) {
    parts.push(`\n## Mentions dans les comptes-rendus (${hits.length})`)
    parts.push(...hits.slice(0, 40))
    if (hits.length > 40) parts.push(`_(+${hits.length - 40} autres mentions — affinez la cible, ou section:"cr" pour le texte entier)_`)
  }
  if (mec.length + actes.length + hits.length === 0) {
    parts.push('\n_Aucune correspondance directe. Vérifiez l\'orthographe, ou consultez l\'aperçu (lire_dossier sans section)._')
  }
  return parts
}

/**
 * Markdown d'une enquête. `opts.section` :
 *   - « apercu » (défaut) : compact — entête, NATINF, MEC, actes, à-faire,
 *     documents, INDEX des CR + rappel des sections. Ne déborde jamais.
 *   - « cr » : CR intégraux paginés (opts.offset = index du 1er CR, opts.limit
 *     = nombre max ; page bornée aussi par un budget caractères).
 *   - « fiche » : tout ce qui concerne opts.cible (MEC, actes, mentions CR).
 *   - « mec » | « actes » | « documents » : la section seule.
 *   - « complet » : tout, CR intégraux inclus (échappatoire — évite sur un gros
 *     dossier, préfère la pagination « cr »).
 * @returns {string|null} null si le numéro n'est pas une enquête du contentieux.
 */
export function dossierMarkdown(keys, numero, opts = {}) {
  const { data } = loadContentieux(keys)
  const e = findEnquete(data, numero)
  if (!e) return null
  const section = String(opts.section || 'apercu').toLowerCase()
  const crs = sortedCrs(e)
  let parts

  switch (section) {
    case 'cr':
    case 'comptes-rendus':
      parts = crPage(e, crs, Number(opts.offset), Number(opts.limit))
      break
    case 'fiche':
      parts = blocFiche(e, opts.cible)
      break
    case 'mec':
    case 'personnes':
      parts = [...enTete(e), ...blocMec(e)]
      break
    case 'actes':
      parts = [...enTete(e), ...blocActes(e)]
      break
    case 'documents':
    case 'pieces':
      parts = [...enTete(e), ...blocDocuments(e)]
      break
    case 'complet': {
      parts = [...enTete(e), ...blocNatinf(e), ...blocMec(e), ...blocActes(e), ...blocAFaire(e), ...blocDocuments(e)]
      if (crs.length) {
        parts.push('\n## Comptes-rendus (chronologique)')
        for (let i = 0; i < crs.length; i++) {
          parts.push(`\n### [#${i}] CR du ${crs[i].date}${crs[i].enqueteur ? ` — ${crs[i].enqueteur}` : ''}`)
          parts.push(stripHtml(crs[i].description || ''))
        }
      }
      break
    }
    case 'apercu':
    default:
      parts = [
        ...enTete(e), ...blocNatinf(e), ...blocMec(e, 60), ...blocActes(e, 60), ...blocAFaire(e), ...blocDocuments(e, 80),
        ...(crs.length ? crIndex(crs) : ['\n## Comptes-rendus\n(aucun)']),
        '\n---',
        'Aperçu compact. Pour le détail de CE dossier, sans tout relire :',
        '- un compte-rendu entier / les suivants : `lire_dossier` section:"cr" offset:0 limit:5',
        '- tout sur une personne, une ligne ou une cible : `lire_dossier` section:"fiche" cible:"<nom>"',
        '- une pièce déposée (PDF, PV…) : `dossier_arborescence` puis `lire_document`',
      ]
      break
  }
  return parts.join('\n').slice(0, 380_000)
}

// ── Cache markdown des documents ──
// Les PDF déposés au dossier sont des ORIGINAUX (souvent signés
// numériquement) : ils ne sont JAMAIS modifiés ni remplacés. Pour épargner
// une ré-extraction à chaque lecture (CPU + tokens), le texte extrait est
// mis en cache dans attache/doccache/ — une enveloppe chiffrée (clé globale)
// par document, indexée par le hash du blob : si le PDF change, le cache
// est régénéré ; le répertoire des documents, synchronisé avec le commun,
// n'est pas touché.

function docCachePath(enqueteKey, cheminRelatif) {
  const h = crypto.createHash('sha256').update(enqueteKey + '\n' + cheminRelatif).digest('hex').slice(0, 32)
  return attacheDir('doccache', h + '.json')
}

function readDocCache(keys, enqueteKey, cheminRelatif, blobHash) {
  const env = readJson(docCachePath(enqueteKey, cheminRelatif), null)
  if (!env) return null
  try {
    const c = decryptJson(keys.global, env)
    return c.blobHash === blobHash ? c : null
  } catch { return null }
}

function writeDocCache(keys, enqueteKey, cheminRelatif, blobHash, texte) {
  const record = { chemin: cheminRelatif, blobHash, texte, extraitLe: new Date().toISOString() }
  atomicWrite(docCachePath(enqueteKey, cheminRelatif), JSON.stringify(encryptJson(keys.global, record)))
}

/** Nettoyage du texte extrait d'un PDF : dé-hyphénation, lignes vides en rafale. */
function tidyPdfText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/([a-zà-ÿ])-\n([a-zà-ÿ])/g, '$1$2')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Texte d'un document chiffré du dossier (PDF → texte, txt/html bruts).
 * L'extraction PDF n'a lieu qu'UNE fois : le résultat est mis en cache
 * (voir ci-dessus) — l'original PDF reste intact sur le serveur.
 */
export async function readDocumentText(keys, numero, cheminRelatif) {
  const key = docServerKey(numero)
  // Copie markdown déposée AU TÉLÉVERSEMENT (MD/<chemin>.md) : servie en
  // priorité pour les formats non textuels — zéro extraction, texte fidèle
  // (conversion navigateur), tokens et CPU économisés.
  if (!/\.(txt|html?|md|csv|json|eml)$/i.test(cheminRelatif) && !cheminRelatif.startsWith('MD/')) {
    const mdRel = 'MD/' + cheminRelatif.replace(/\.[^./]+$/, '') + '.md'
    const mdBlob = readDocBlob(attacheTj(), key, mdRel)
    if (mdBlob) {
      const plain = decryptDocBlob(keys.global, mdBlob)
      if (plain) return { ok: true, texte: plain.toString('utf8').slice(0, 200_000), source: 'copie markdown du téléversement' }
    }
  }
  const blob = readDocBlob(attacheTj(), key, cheminRelatif)
  if (!blob) {
    const known = listDocsMeta(attacheTj(), key).map((d) => d.rel)
    return { ok: false, error: 'Document introuvable', disponibles: known.filter((r) => !r.startsWith('MD/')).slice(0, 60) }
  }
  const lower = cheminRelatif.toLowerCase()
  if (lower.endsWith('.pdf')) {
    const blobHash = crypto.createHash('sha256').update(blob).digest('hex')
    const cached = readDocCache(keys, key, cheminRelatif, blobHash)
    if (cached) return { ok: true, texte: cached.texte, cache: true }
    const plain = decryptDocBlob(keys.global, blob)
    if (!plain) return { ok: false, error: 'Déchiffrement impossible (format inattendu)' }
    // Couche texte native, avec OCR de secours si la pièce est un scan image.
    const res = await extractPdfText(plain)
    if (!res.ok) return { ok: false, error: res.error, scanned: res.scanned }
    const texte = tidyPdfText(res.texte).slice(0, 200_000)
    try { writeDocCache(keys, key, cheminRelatif, blobHash, texte) } catch { /* cache facultatif */ }
    return { ok: true, texte, source: res.source }
  }
  const plain = decryptDocBlob(keys.global, blob)
  if (!plain) return { ok: false, error: 'Déchiffrement impossible (format inattendu)' }
  if (/\.(txt|html?|md|csv|json|eml)$/.test(lower)) {
    return { ok: true, texte: stripHtml(plain.toString('utf8')).slice(0, 200_000) }
  }
  if (isOfficeExt(lower)) {
    // ODT/DOCX/RTF versés par mail (pas de copie markdown MD/ du navigateur).
    // Extrait une fois, mis en cache par hash — comme le PDF.
    const blobHash = crypto.createHash('sha256').update(blob).digest('hex')
    const cached = readDocCache(keys, key, cheminRelatif, blobHash)
    if (cached) return { ok: true, texte: cached.texte, cache: true }
    const res = extractOfficeText(plain, lower)
    if (!res.ok) return { ok: false, error: res.error }
    const texte = res.texte.slice(0, 200_000)
    try { writeDocCache(keys, key, cheminRelatif, blobHash, texte) } catch { /* cache facultatif */ }
    return { ok: true, texte, source: res.source }
  }
  return { ok: false, error: `Type non textuel (${cheminRelatif.split('.').pop()}) — ${plain.length} octets` }
}

/**
 * Contrôle de complétude d'un dossier : points d'attention factuels que
 * l'agent commente ensuite (il a le contexte, pas cette fonction).
 */
export function verifierCompletude(keys, numero) {
  const { data } = loadContentieux(keys)
  const e = findEnquete(data, numero)
  if (!e) return null
  const now = Date.now()
  const soon = 7 * 24 * 3600 * 1000
  const findings = []
  const checkActe = (kind, a) => {
    const label = kind === 'ecoute' ? `interception ${a.numero}` : kind === 'geoloc' ? `géolocalisation ${a.objet}` : (a.type || 'acte')
    if (a.dateFin) {
      const end = Date.parse(a.dateFin)
      if (Number.isFinite(end)) {
        if (end < now && a.statut === 'en_cours') findings.push(`⚠️ ${label} [id ${a.id}] : date de fin dépassée (${a.dateFin}) mais statut "en_cours"`)
        else if (end >= now && end - now < soon && a.statut === 'en_cours') findings.push(`⏳ ${label} [id ${a.id}] : expire sous 7 jours (${a.dateFin}) — prolongation à anticiper`)
      }
    }
    if (a.statut === 'prolongation_pending') findings.push(`🕐 ${label} [id ${a.id}] : prolongation en attente JLD${a.prolongationRequestedAt ? ` depuis le ${a.prolongationRequestedAt.slice(0, 10)}` : ''}`)
    if (a.statut === 'autorisation_pending') findings.push(`🕐 ${label} [id ${a.id}] : autorisation initiale en attente JLD`)
  }
  for (const a of e.ecoutes || []) checkActe('ecoute', a)
  for (const a of e.geolocalisations || []) checkActe('geoloc', a)
  for (const a of e.actes || []) checkActe('autre', a)

  const crs = e.comptesRendus || []
  const lastCr = crs.map((c) => Date.parse(c.date)).filter(Number.isFinite).sort((x, y) => y - x)[0]
  if (!crs.length) findings.push('📋 Aucun compte-rendu au dossier')
  else if (lastCr && now - lastCr > 45 * 24 * 3600 * 1000) findings.push(`📋 Dernier CR ancien (${new Date(lastCr).toISOString().slice(0, 10)}) — point d'étape à demander ?`)

  const docsServeur = listDocsMeta(attacheTj(), docServerKey(e.numero)).filter((d) => !String(d.rel).startsWith('MD/'))
  const nbActesJld = (e.ecoutes || []).length + (e.geolocalisations || []).length
  if (nbActesJld > 0 && !docsServeur.length) findings.push(`📎 ${nbActesJld} acte(s) JLD mais aucun document déposé — autorisations manquantes au dossier ?`)

  const todos = (e.toDos || []).filter((t) => t.status === 'active')
  for (const t of todos) findings.push(`☐ À faire ouvert : ${t.text}`)

  return { numero: e.numero, findings, documentsDisponibles: docsServeur.length }
}

/**
 * Diagnostic objectif d'un dossier — matière première pour l'aide au
 * contrôle et à la maîtrise (l'agent interprète ensuite). Mesure :
 *  - délais : ancienneté du dossier, durée cumulée de chaque acte
 *    (initiale + prolongations) et ancienneté des attentes JLD ;
 *  - cohérence : actes expirés encore « en_cours », demandes JLD qui
 *    traînent, actes sans document justificatif ;
 *  - éparpillement : nombre de cibles/lignes/objets distincts rapporté au
 *    nombre de mis en cause et à la durée — signal de dispersion ;
 *  - cadence des comptes-rendus (rythme de compte-rendu des enquêteurs).
 * `cadre` distingue préliminaire (délais TSE serrés) et instruction.
 */
export function diagnostiquerDossier(keys, numero) {
  const { data } = loadContentieux(keys)
  const e = findEnquete(data, numero)
  if (!e) return null
  const now = Date.now()
  const jours = (ms) => Math.floor((now - ms) / 86_400_000)

  const debut = Date.parse(e.dateOP || e.dateCreation || '') || null
  const ageJours = debut ? jours(debut) : null

  const dureeCumuleeJours = (a) => {
    const unitJ = (v, u) => (u === 'mois' ? Number(v) * 30 : Number(v)) || 0
    let total = unitJ(a.duree, a.dureeUnit)
    for (const p of a.prolongationsHistory || []) total += unitJ(p.dureeAjoutee, p.dureeUnit)
    return total
  }

  const actes = []
  const collect = (kind, list, labelOf) => {
    for (const a of list || []) {
      const dureeCumul = dureeCumuleeJours(a)
      const fin = Date.parse(a.dateFin || '') || null
      actes.push({
        kind, id: a.id, label: labelOf(a), statut: a.statut,
        dureeCumuleeJours: dureeCumul,
        nbProlongations: (a.prolongationsHistory || []).length,
        dateDebut: a.dateDebut || null, dateFin: a.dateFin || null,
        expire: fin ? jours(fin) : null, // >0 = dépassé de N jours ; <0 = dans N jours
        attenteJldJours: a.prolongationRequestedAt ? jours(Date.parse(a.prolongationRequestedAt))
          : a.autorisationRequestedAt ? jours(Date.parse(a.autorisationRequestedAt)) : null,
      })
    }
  }
  collect('interception', e.ecoutes, (a) => `${a.numero}${a.cible ? ` (${a.cible})` : ''}`)
  collect('geolocalisation', e.geolocalisations, (a) => a.objet)
  collect('autre', e.actes, (a) => a.type || 'acte')

  // incohérences objectives
  const incoherences = []
  for (const a of actes) {
    if (a.expire != null && a.expire > 0 && a.statut === 'en_cours') {
      incoherences.push(`${a.kind} « ${a.label} » : échéance dépassée de ${a.expire} j mais toujours « en cours »`)
    }
    if (a.attenteJldJours != null && a.attenteJldJours > 15) {
      incoherences.push(`${a.kind} « ${a.label} » : en attente JLD depuis ${a.attenteJldJours} j`)
    }
  }

  // éparpillement : diversité des cibles rapportée aux MEC
  const ciblesDistinctes = new Set(actes.map((a) => normalizeNom(a.label))).size
  const nbMec = (e.misEnCause || []).length
  const crs = (e.comptesRendus || []).map((c) => Date.parse(c.date)).filter(Number.isFinite).sort((x, y) => x - y)
  const dernierCr = crs.length ? jours(crs[crs.length - 1]) : null
  let intervalleMoyenCr = null
  if (crs.length >= 2) {
    let s = 0
    for (let i = 1; i < crs.length; i++) s += (crs[i] - crs[i - 1]) / 86_400_000
    intervalleMoyenCr = Math.round(s / (crs.length - 1))
  }

  return {
    numero: e.numero,
    cadre: e.statut === 'instruction' ? 'instruction' : 'préliminaire',
    ageJours,
    misEnCause: nbMec,
    delais: {
      actes: actes.map(({ kind, label, statut, dureeCumuleeJours, nbProlongations, expire, attenteJldJours }) =>
        ({ kind, label, statut, dureeCumuleeJours, nbProlongations, joursAvantEcheance: expire == null ? null : -expire, attenteJldJours })),
    },
    coherence: {
      actesTotal: actes.length,
      incoherences,
    },
    eparpillement: {
      ciblesDistinctes,
      misEnCause: nbMec,
      ratioCiblesParMec: nbMec ? Math.round((ciblesDistinctes / nbMec) * 10) / 10 : null,
      commentaireBrut: ciblesDistinctes > Math.max(4, nbMec * 2)
        ? 'Diversité de cibles élevée au regard du nombre de mis en cause — dispersion possible'
        : 'Cohérent',
    },
    comptesRendus: {
      total: crs.length,
      dernierIlYaJours: dernierCr,
      intervalleMoyenJours: intervalleMoyenCr,
    },
  }
}

// ── Écritures (réversibles : coffre archivé avant chaque écrasement) ──

async function mutate(keys, numero, fn) {
  const payload = loadContentieux(keys)
  const e = findEnquete(payload.data, numero)
  if (!e) throw new Error(`Dossier ${numero} introuvable`)
  const result = fn(e, payload.data)
  e.dateMiseAJour = new Date().toISOString()
  await saveContentieux(keys, payload)
  return result
}

/** Enregistre un nouvel acte. kind : ecoute | geolocalisation | autre. */
export async function enregistrerActe(keys, { numero, kind, dateDebut, duree, dureeUnit, cible, objet, type, description, statut }) {
  return mutate(keys, numero, (e) => {
    const id = Date.now()
    const unit = dureeUnit === 'mois' ? 'mois' : 'jours'
    const debut = dateDebut || new Date().toISOString().slice(0, 10)
    let dateFin = ''
    const d = Number(duree)
    if (Number.isFinite(d) && d > 0 && debut) {
      const end = new Date(debut + 'T00:00:00')
      if (unit === 'mois') end.setMonth(end.getMonth() + d)
      else end.setDate(end.getDate() + d)
      dateFin = end.toISOString().slice(0, 10)
    }
    const base = {
      id, dateDebut: statut === 'autorisation_pending' ? '' : debut, dateFin,
      duree: String(duree ?? ''), dureeUnit: unit,
      statut: statut || 'en_cours',
      ...(statut === 'autorisation_pending' ? { autorisationRequestedAt: new Date().toISOString() } : {}),
    }
    if (kind === 'ecoute') {
      e.ecoutes = e.ecoutes || []
      e.ecoutes.push({ ...base, numero: String(cible || objet || 'ligne à préciser'), cible: cible ? String(cible) : undefined, description: description ? String(description) : undefined })
    } else if (kind === 'geolocalisation') {
      e.geolocalisations = e.geolocalisations || []
      e.geolocalisations.push({ ...base, objet: String(objet || cible || 'objet à préciser'), description: description ? String(description) : undefined })
    } else {
      e.actes = e.actes || []
      e.actes.push({ ...base, type: String(type || 'Acte'), description: String(description || '') })
    }
    return { id, dateFin }
  })
}

function collectionOf(e, acteId) {
  for (const [name, coll] of [['ecoutes', e.ecoutes], ['geolocalisations', e.geolocalisations], ['actes', e.actes]]) {
    const a = (coll || []).find((x) => Number(x.id) === Number(acteId))
    if (a) return { name, acte: a }
  }
  return null
}

/**
 * Prolongation d'un acte.
 * mode "demande"  : marque prolongation_pending (en attente JLD).
 * mode "validee"  : applique la prolongation (historique + nouvelle dateFin).
 */
export async function acterProlongation(keys, { numero, acteId, mode, duree, dureeUnit }) {
  return mutate(keys, numero, (e) => {
    const found = collectionOf(e, acteId)
    if (!found) throw new Error(`Acte ${acteId} introuvable dans ${numero}`)
    const a = found.acte
    const unit = dureeUnit === 'mois' ? 'mois' : 'jours'
    if (mode === 'demande') {
      a.statut = 'prolongation_pending'
      a.prolongationRequestedAt = new Date().toISOString()
      a.prolongationData = { dateDebut: a.dateFin || '', duree: String(duree ?? '') }
      return { statut: a.statut }
    }
    // validée : étendre la date de fin et historiser
    const d = Number(duree)
    if (!Number.isFinite(d) || d <= 0) throw new Error('Durée de prolongation invalide')
    const from = a.dateFin ? new Date(a.dateFin + 'T00:00:00') : new Date()
    if (unit === 'mois') from.setMonth(from.getMonth() + d)
    else from.setDate(from.getDate() + d)
    a.prolongationsHistory = a.prolongationsHistory || []
    a.prolongationsHistory.push({
      date: new Date().toISOString().slice(0, 10),
      dureeAjoutee: String(d),
      dureeInitiale: String(a.duree || ''),
      dureeUnit: unit,
      dureeInitialeUnit: a.dureeUnit || 'jours',
    })
    a.prolongationDate = new Date().toISOString().slice(0, 10)
    a.dateFin = from.toISOString().slice(0, 10)
    a.statut = 'en_cours'
    delete a.prolongationData
    return { statut: a.statut, nouvelleDateFin: a.dateFin }
  })
}

/**
 * Classe une note/synthèse comme compte-rendu. Signature = le magistrat
 * administrateur (dissimulation : aucune trace « IA » dans les données
 * partagées ; l'attribution réelle est dans l'audit chiffré).
 */
export async function classerNote(keys, { numero, titre, contenu, date, enqueteur }) {
  const author = enqueteur || authorOf(keys)
  return mutate(keys, numero, (e) => {
    e.comptesRendus = e.comptesRendus || []
    const id = Date.now()
    const html = (titre ? `<b>${escapeHtml(titre)}</b><br>` : '') +
      escapeHtml(String(contenu || '')).replace(/\n/g, '<br>')
    e.comptesRendus.push({
      id,
      date: (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : new Date().toISOString().slice(0, 10),
      enqueteur: author,
      description: html,
      createdBy: author,
    })
    return { id }
  })
}

/** Normalisation d'un nom pour le dédoublonnage (accents, casse, espaces). */
export function normalizeNom(nom) {
  return String(nom).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')
}

/** Noms des mis en cause existants d'un dossier (pour le dédoublonnage). */
export function getMecNoms(keys, numero) {
  const { data } = loadContentieux(keys)
  const e = findEnquete(data, numero)
  return (e?.misEnCause || []).map((m) => m.nom)
}

/** Ajoute un mis en cause — REFUSE tout doublon (nom normalisé identique). */
export async function ajouterMec(keys, { numero, nom, role, statut }) {
  const cleanNom = String(nom || '').trim()
  if (!cleanNom) throw new Error('Nom requis')
  return mutate(keys, numero, (e) => {
    e.misEnCause = e.misEnCause || []
    const norm = normalizeNom(cleanNom)
    const doublon = e.misEnCause.find((m) => normalizeNom(m.nom) === norm)
    if (doublon) throw new Error(`Doublon : « ${doublon.nom} » figure déjà aux mis en cause`)
    const id = Date.now()
    e.misEnCause.push({ id, nom: cleanNom, role: role ? String(role).slice(0, 120) : undefined, statut: String(statut || 'mis en cause').slice(0, 60) })
    return { id }
  })
}

/**
 * Ajoute des codes NATINF au dossier — écriture AUTONOME de l'attaché
 * (pas de proposition ✓/✗ : le magistrat l'a voulue ainsi), mais tracée :
 *  - les codes inconnus du référentiel sont REFUSÉS (natinf_chercher d'abord) ;
 *  - dédoublonnage avec l'existant ;
 *  - une entrée « modifications » (ajouts récents) signée du nom de
 *    l'administrateur rend l'ajout visible dans la fiche du dossier —
 *    l'attribution réelle vit dans le journal d'audit chiffré.
 */
export async function ajouterNatinfs(keys, { numero, codes, source }) {
  const wanted = (Array.isArray(codes) ? codes : [codes])
    .map((c) => String(c ?? '').trim()).filter(Boolean)
  if (!wanted.length) throw new Error('Aucun code NATINF fourni')
  const inconnus = wanted.filter((c) => !natinfEntry(c))
  const valides = wanted.filter((c) => natinfEntry(c))
  const author = authorOf(keys)
  return mutate(keys, numero, (e) => {
    e.infractionNatinfCodes = e.infractionNatinfCodes || []
    const dejaPresents = valides.filter((c) => e.infractionNatinfCodes.includes(c))
    const ajoutes = valides.filter((c) => !e.infractionNatinfCodes.includes(c))
    if (ajoutes.length) {
      e.infractionNatinfCodes.push(...ajoutes)
      e.modifications = e.modifications || []
      e.modifications.push({
        id: `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        type: 'general_info_updated',
        label: `Infractions NATINF ajoutées : ${ajoutes.map((c) => `${c}${natinfLabel(c) ? ` (${String(natinfLabel(c)).slice(0, 60)})` : ''}`).join(', ')}${source ? ` — source : ${String(source).slice(0, 80)}` : ''}`,
        user: { username: author, displayName: author },
        timestamp: new Date().toISOString(),
      })
    }
    return {
      ajoutes,
      dejaPresents,
      inconnus: inconnus.length ? inconnus : undefined,
      note: inconnus.length ? 'Codes inconnus du référentiel REFUSÉS — vérifie avec natinf_chercher' : undefined,
      natinfsDuDossier: e.infractionNatinfCodes,
    }
  })
}

/**
 * DML archivées d'un dossier : la zone « DML » de la section documents
 * (fichiers déposés sous DML/…, synchronisés depuis le commun Windows).
 * Base de travail pour actualiser une DML : lire la plus récente avec
 * lire_document, reprendre sa structure, mettre à jour avec les actes
 * intervenus depuis.
 */
/**
 * Table des matières de TOUTES les pièces déposées sous un numéro : zones
 * (Geoloc/Ecoutes/Actes/PV/DML) et « Dossier complet » versé (Dossier/…,
 * sous-pochettes = organisation du dossier). Chemins exacts pour
 * lire_document. Plafonnée — le tri par chemin rend l'arborescence lisible.
 */
export function arborescenceDocuments(numero) {
  const metas = listDocsMeta(attacheTj(), docServerKey(numero))
  const pieces = metas
    // MD/ = copies markdown des originaux : lire_document les sert déjà de
    // lui-même quand on demande l'original — les lister doublerait tout.
    .filter((d) => !String(d.rel).startsWith('MD/'))
    .map((d) => ({ chemin: d.rel, taille: d.size, deposeLe: d.savedAt, nomOriginal: d.originalName }))
    .sort((a, b) => a.chemin.localeCompare(b.chemin))
  return { total: pieces.length, pieces: pieces.slice(0, 2000) }
}

export function listerDml(keys, numero) {
  const docs = listDocsMeta(attacheTj(), docServerKey(numero))
  return docs
    .filter((d) => d.rel.startsWith('DML/') || String(d.category || '').toUpperCase() === 'DML')
    .map((d) => ({ chemin: d.rel, nomOriginal: d.originalName, taille: d.size, deposeLe: d.savedAt }))
    .sort((a, b) => String(b.deposeLe).localeCompare(String(a.deposeLe)))
}

/**
 * Actualise la description (l'« objet ») du dossier pour refléter l'état à
 * l'instant T — derniers CR et documents intégrés. RIEN n'est perdu : la
 * description précédente est archivée dans e.descriptionHistory (en plus du
 * versionnage du coffre). Champ additif, invisible pour l'app existante.
 */
export async function actualiserDescription(keys, { numero, description }) {
  const texte = String(description || '').trim()
  if (!texte) throw new Error('Description vide')
  return mutate(keys, numero, (e) => {
    const ancienne = String(e.description || '')
    if (ancienne.trim()) {
      e.descriptionHistory = e.descriptionHistory || []
      e.descriptionHistory.push({ date: new Date().toISOString(), description: ancienne, remplacePar: authorOf(keys) })
      // garde-fou : capé aux 20 dernières versions (le coffre versionné garde tout le reste)
      if (e.descriptionHistory.length > 20) e.descriptionHistory = e.descriptionHistory.slice(-20)
    }
    // Texte BRUT (sauts de ligne réels) : la fiche d'enquête l'affiche en
    // « whitespace-pre-wrap » et le module instruction via renderFormattedText
    // — les deux rendent le texte plat proprement. Surtout PAS d'HTML ni de
    // <br> ici : ils s'affichaient littéralement dans la fiche préliminaire.
    e.description = texte
    return { versionsConservees: (e.descriptionHistory || []).length }
  })
}

/** Vrai si un dossier de ce numéro existe déjà dans le contentieux. */
export function dossierExiste(keys, numero) {
  const { data } = loadContentieux(keys)
  return Boolean(findEnquete(data, numero))
}

/**
 * Crée un NOUVEAU dossier (enquête) dans le contentieux — appliqué à la
 * validation ✓ d'une proposition. Reproduit la forme de useEnquetesStore.
 * addEnquete pour que le client web l'affiche à l'identique : id incrémental,
 * statut « en_cours », dates de création/màj, entrée de modification
 * « enquete_created » signée du nom de l'administrateur. Les mis en cause
 * sont dédoublonnés entre eux (nom normalisé). REFUSE un numéro déjà pris.
 */
export async function creerDossier(keys, { numero, dateDebut, services, description, misEnCause }) {
  const num = String(numero || '').trim()
  if (!num) throw new Error('Numéro (nom) du dossier requis')
  const payload = loadContentieux(keys)
  payload.data.enquetes = payload.data.enquetes || []
  if (findEnquete(payload.data, num)) throw new Error(`Un dossier « ${num} » existe déjà`)

  const author = authorOf(keys)
  const now = new Date().toISOString()
  const today = now.slice(0, 10)
  const maxId = payload.data.enquetes.reduce((m, e) => Math.max(m, Number(e.id) || 0), 0)

  // Mis en cause : dédoublonnage interne (nom normalisé), ids numériques.
  const mecs = []
  const vus = new Set()
  for (const m of Array.isArray(misEnCause) ? misEnCause : []) {
    const nom = String((typeof m === 'string' ? m : m?.nom) || '').trim()
    if (!nom) continue
    const norm = normalizeNom(nom)
    if (vus.has(norm)) continue
    vus.add(norm)
    mecs.push({
      id: Date.now() + mecs.length,
      nom,
      role: (typeof m === 'object' && m?.role) ? String(m.role).slice(0, 120) : undefined,
      statut: String((typeof m === 'object' && m?.statut) || 'mis en cause').slice(0, 60),
    })
  }

  const svc = Array.isArray(services) ? services.filter(Boolean).map(String)
    : services ? [String(services)] : []
  const desc = String(description || '').trim()

  const enquete = {
    id: maxId + 1,
    numero: num,
    dateDebut: /^\d{4}-\d{2}-\d{2}/.test(String(dateDebut || '')) ? String(dateDebut).slice(0, 10) : today,
    services: svc,
    description: desc, // texte brut (voir actualiserDescription) — jamais d'HTML
    misEnCause: mecs,
    geolocalisations: [],
    ecoutes: [],
    actes: [],
    comptesRendus: [],
    documents: [],
    toDos: [],
    notes: '',
    tags: [],
    statut: 'en_cours',
    dateCreation: now,
    dateMiseAJour: now,
    modifications: [{
      id: `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      type: 'enquete_created',
      label: `Création de l'enquête ${num}`,
      user: { username: author, displayName: author },
      timestamp: now,
    }],
  }
  payload.data.enquetes.push(enquete)
  await saveContentieux(keys, payload)
  return { numero: num, id: enquete.id, misEnCause: mecs.length }
}

export async function ajouterTodo(keys, { numero, texte }) {
  return mutate(keys, numero, (e) => {
    e.toDos = e.toDos || []
    const id = Date.now()
    e.toDos.push({ id, text: String(texte).slice(0, 500), status: 'active', dateCreation: new Date().toISOString() })
    return { id }
  })
}
