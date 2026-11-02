/**
 * SIRAL — Attaché de justice · RECHERCHE PLEIN TEXTE dans les pièces.
 *
 * L'outil qui permet à l'IA (Claude web via le connecteur, ou l'attaché) de
 * LOCALISER une information sans relire les pièces une à une — dans UN
 * dossier, ou dans TOUT LE FONDS : enquêtes (archives comprises), dossiers
 * d'instruction et documents versés sur les dossiers manuels de la carte.
 *
 * Zéro jeton : scan linéaire côté service, qui détient les clés. Pas d'index :
 * le texte est déjà là (copies MD/ du téléversement, caches d'extraction,
 * texte des documents de la carte), et une expression régulière insensible
 * aux accents parcourt ~1 Go/s — le fonds entier tient dans un appel ou deux.
 *
 * Syntaxe de la requête :
 *   - mots juxtaposés : TOUS exigés dans la même pièce (ET) ;
 *   - « OU » (en capitales) ou « | » : alternatives — la pièce sort si l'une
 *     d'elles est entièrement présente (« nourrice OU stockage OU "gardait la" ») ;
 *   - "entre guillemets" : expression exacte (mots consécutifs, ponctuation et
 *     retours à la ligne indifférents) ;
 *   - un mot cherche aussi ses dérivés (« stock » trouve stocker, stockage) ;
 *   - casse et accents indifférents.
 */
import { attacheTj, listDocsMeta, docServerKey } from './store.mjs'
import { texteDocumentIntegral, numeroCanonique, normAligne, loadContentieux } from './dossier.mjs'
import { allInstructionDossiers } from './instru.mjs'
import { loadOverlay } from './carto.mjs'

// Extractions FRAÎCHES par appel (pièces jamais lues : PDF à parser, OCR d'un
// scan muet). L'ingestion de fond les fait déjà au fil des versements ; la
// borne garde une réponse rapide sur une pièce qu'elle n'a pas encore vue.
// Rien n'est perdu : chaque pièce non fouillée est NOMMÉE dans la réponse.
const EXTRACTIONS_DOSSIER = 25
const EXTRACTIONS_FONDS = 10
const PIECES_DEFAUT = 20
const PIECES_MAX = 100
const EXTRAITS_DEFAUT = 3
const EXTRAITS_MAX = 10
const OCCURRENCES_MAX = 500 // par terme et par pièce : au-delà, le compte n'apprend plus rien
// Budget d'un appel « tout le fonds » : au-delà, la réponse rend un curseur et
// l'appel suivant reprend exactement là (aucune pièce sautée).
const BUDGET_FONDS_MS = Number(process.env.SIRAL_ATTACHE_RECHERCHE_SECONDES || 40) * 1000

// ── Requête → expressions régulières insensibles aux accents ─────────────

// lettre de base → toutes ses variantes accentuées (latin étendu), deux casses
const VARIANTES = new Map()
for (let cp = 0xc0; cp <= 0x24f; cp++) {
  const c = String.fromCharCode(cp)
  const base = (c.normalize('NFKD')[0] || c).toLowerCase()
  if (!/^[a-z]$/.test(base)) continue
  if (!VARIANTES.has(base)) VARIANTES.set(base, new Set([base]))
  VARIANTES.get(base).add(c.toLowerCase())
  VARIANTES.get(base).add(c.toUpperCase())
}
const LETTRE_OU_CHIFFRE = '0-9a-zA-Z\\u00c0-\\u024f'

function motVersRegex(mot) {
  return [...mot].map((c) => (VARIANTES.has(c) ? `[${[...VARIANTES.get(c)].join('')}]` : c)).join('')
}

/** Mots normalisés (minuscules sans accents, ≥ 2 caractères). */
function mots(s) {
  return normAligne(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2)
}

/**
 * Requête → alternatives (OU) de termes (ET). Un terme = un mot ou une
 * expression exacte, compilé une fois. Rend [] si rien d'exploitable.
 */
export function analyserRequete(requete) {
  const alternatives = []
  for (const brute of String(requete || '').split(/\s+OU\s+|\|/)) {
    const termes = []
    const vus = new Set()
    const ajoute = (libelle, motsTerme) => {
      if (!motsTerme.length || vus.has(libelle)) return
      vus.add(libelle)
      const corps = motsTerme.map(motVersRegex).join(`[^${LETTRE_OU_CHIFFRE}]+`)
      termes.push({ libelle, re: new RegExp(corps, 'gi') })
    }
    const reste = brute.replace(/"([^"]*)"|«\s*([^»]*?)\s*»/g, (_, a, b) => {
      const m = mots(a ?? b)
      ajoute(m.join(' '), m)
      return ' '
    })
    for (const m of mots(reste)) ajoute(m, [m])
    if (termes.length) alternatives.push(termes)
  }
  return alternatives
}

/**
 * Cherche la requête dans un texte. null si aucune alternative n'y est
 * entière ; sinon { occurrences, termes (ceux trouvés), extraits } — extraits
 * pris dans le texte ORIGINAL autour des premières positions.
 */
export function chercherDansTexte(texte, alternatives, maxExtraits = EXTRAITS_DEFAUT) {
  const t = String(texte || '')
  let occurrences = 0
  const termes = []
  const positions = []
  for (const alt of alternatives) {
    const trouves = []
    let complete = true
    for (const { libelle, re } of alt) {
      re.lastIndex = 0
      const pos = []
      let m
      while (pos.length < OCCURRENCES_MAX && (m = re.exec(t))) pos.push(m.index)
      if (!pos.length) { complete = false; break }
      trouves.push({ libelle, pos })
    }
    if (!complete) continue
    for (const { libelle, pos } of trouves) {
      occurrences += pos.length
      if (!termes.includes(libelle)) termes.push(libelle)
      positions.push(...pos)
    }
  }
  if (!termes.length) return null
  positions.sort((a, b) => a - b)
  const extraits = []
  let dernierFin = -1
  for (const pos of positions) {
    if (extraits.length >= maxExtraits) break
    if (pos < dernierFin) continue // déjà couvert par l'extrait précédent
    const debut = Math.max(0, pos - 160)
    const fin = Math.min(t.length, pos + 240)
    dernierFin = fin
    extraits.push('…' + t.slice(debut, fin).replace(/\s+/g, ' ').trim() + '…')
  }
  return { occurrences, termes, extraits }
}

// ── Les sources : dossiers du fonds et dossiers manuels de la carte ──────

/** Dossier manuel de la carte (« ex nihilo ») portant ce libellé, s'il a des documents. */
function dossierCarte(keys, libelle) {
  const lbl = String(libelle || '').trim().toLowerCase()
  if (!lbl) return null
  const d = (loadOverlay(keys)?.dossiersExNihilo || []).find((x) => String(x.label || '').trim().toLowerCase() === lbl)
  return d && (d.documents || []).length ? d : null
}

/** Pièces d'un dossier, une par empreinte (doublons exacts sautés), triées par chemin. */
function piecesDuDossier(docKey, pochette) {
  const metas = listDocsMeta(attacheTj(), docKey).filter((d) => !String(d.rel).startsWith('MD/'))
  const filtre = String(pochette || '').replace(/\/+$/, '')
  const ciblees = filtre ? metas.filter((d) => d.rel === filtre || String(d.rel).startsWith(filtre + '/')) : metas
  const vus = new Set()
  const pieces = []
  let doublons = 0
  for (const d of [...ciblees].sort((a, b) => String(a.rel).localeCompare(String(b.rel)))) {
    const sha = String(d.sha || '')
    if (/^[a-f0-9]{64}$/.test(sha)) {
      if (vus.has(sha)) { doublons++; continue }
      vus.add(sha)
    }
    pieces.push(String(d.rel))
  }
  return { pieces, total: ciblees.length, doublons }
}

/**
 * Le fonds entier, dans un ordre STABLE (celui du curseur) : enquêtes en
 * cours puis archivées, dossiers d'instruction, dossiers manuels de la carte.
 */
function sourcesDuFonds(keys) {
  const sources = []
  const vus = new Set()
  const ajoute = (s) => { if (!vus.has(s.cle)) { vus.add(s.cle); sources.push(s) } }
  const enquetes = loadContentieux(keys).data?.enquetes || []
  const enCours = enquetes.filter((e) => e?.numero && e.statut !== 'archive')
  const archives = enquetes.filter((e) => e?.numero && e.statut === 'archive')
  for (const e of [...enCours, ...archives]) {
    ajoute({ cle: docServerKey(e.numero), dossier: String(e.numero), nature: e.statut === 'archive' ? 'enquête archivée' : 'enquête' })
  }
  let instructions = []
  try { instructions = allInstructionDossiers(keys) } catch { /* module instruction absent */ }
  for (const d of instructions) {
    const numero = d.numeroInstruction || d.numeroParquet
    if (numero) ajoute({ cle: docServerKey(numero), dossier: String(numero), nature: d.archived ? 'instruction archivée' : 'instruction' })
  }
  for (const d of loadOverlay(keys)?.dossiersExNihilo || []) {
    if ((d.documents || []).length) ajoute({ cle: `carte:${d.label}`, dossier: String(d.label), nature: 'carte', carte: d })
  }
  return sources
}

/** Texte d'une pièce : { ok, texte, pagesImagesNonLues } ou { nonExtrait } / { ok:false }. */
async function textePiece(keys, source, rel, extraire) {
  if (source.carte) {
    const doc = (source.carte.documents || []).find((x) => String(x.nom) === rel)
    return doc ? { ok: true, texte: String(doc.texte || '') } : { ok: false }
  }
  const res = await texteDocumentIntegral(keys, source.cle, rel, { extraire }).catch(() => ({ ok: false }))
  return res.ok ? { ok: true, texte: res.texte, pagesImagesNonLues: res.extra?.pagesImagesNonLues } : res
}

function listePieces(source, pochette) {
  if (source.carte) {
    const pieces = (source.carte.documents || []).map((x) => String(x.nom))
    return { pieces, total: pieces.length, doublons: 0 }
  }
  return piecesDuDossier(source.cle, pochette)
}

// ── Recherche ────────────────────────────────────────────────────────────

/**
 * pieces_chercher. `numero` renseigné = UN dossier (n° d'enquête,
 * d'instruction, ou libellé d'un dossier de la carte), résultats classés par
 * nombre d'occurrences et paginés (offset). `numero` vide = TOUT LE FONDS,
 * parcouru dans l'ordre et repris au `curseur`.
 */
export async function chercherDansPieces(keys, numero, opts = {}) {
  const alternatives = analyserRequete(opts.requete)
  if (!alternatives.length) {
    return { ok: false, error: 'Requête vide (mots de 2 caractères minimum ; "expression exacte" ; OU entre alternatives)' }
  }
  const maxExtraits = Math.max(1, Math.min(EXTRAITS_MAX, Number(opts.extraits) || EXTRAITS_DEFAUT))
  const limite = Math.max(1, Math.min(PIECES_MAX, Number(opts.limite) || PIECES_DEFAUT))
  const requete = alternatives.map((alt) => alt.map((t) => (t.libelle.includes(' ') ? `"${t.libelle}"` : t.libelle)).join(' ')).join(' OU ')
  return String(numero || '').trim()
    ? chercherDansUnDossier(keys, String(numero), { ...opts, alternatives, maxExtraits, limite, requete })
    : chercherDansLeFonds(keys, { ...opts, alternatives, maxExtraits, limite, requete })
}

async function chercherDansUnDossier(keys, numero, { pochette, offset, alternatives, maxExtraits, limite, requete }) {
  const canon = numeroCanonique(keys, numero)
  let source = { cle: docServerKey(canon), dossier: canon, nature: 'dossier' }
  if (!listDocsMeta(attacheTj(), source.cle).length) {
    const carte = dossierCarte(keys, numero)
    if (carte) source = { cle: `carte:${carte.label}`, dossier: carte.label, nature: 'carte', carte }
  }
  const { pieces: rels, total, doublons } = listePieces(source, pochette)

  const pieces = []
  const nonFouillees = []
  const aExtraire = []
  const retenir = (rel, res) => {
    const hit = chercherDansTexte(res.texte, alternatives, maxExtraits)
    if (hit) pieces.push({ chemin: rel, ...hit, ...(res.pagesImagesNonLues ? { pagesImagesNonLues: res.pagesImagesNonLues } : {}) })
  }
  // 1er passage : ce qui est DÉJÀ disponible — rapide quel que soit le volume
  for (const rel of rels) {
    const res = await textePiece(keys, source, rel, false)
    if (res.ok) retenir(rel, res)
    else if (res.nonExtrait) aExtraire.push(rel)
  }
  // 2e passage : extraction fraîche, bornée par appel (le cache s'étend)
  let extractions = 0
  for (const rel of aExtraire) {
    if (extractions >= EXTRACTIONS_DOSSIER) { nonFouillees.push(rel); continue }
    extractions++
    const res = await textePiece(keys, source, rel, true)
    if (res.ok) retenir(rel, res)
  }
  pieces.sort((a, b) => b.occurrences - a.occurrences || a.chemin.localeCompare(b.chemin))
  const debut = Math.max(0, Math.floor(Number(offset) || 0))
  const page = pieces.slice(debut, debut + limite)
  const suite = debut + page.length < pieces.length ? debut + page.length : null

  const notes = []
  if (nonFouillees.length) {
    notes.push(`${nonFouillees.length} pièce(s) jamais extraite(s) n'ont pas été fouillées (extraction bornée à ${EXTRACTIONS_DOSSIER} par appel) — RELANCE la même recherche : chaque passage étend le cache, jusqu'à couverture complète.`)
  }
  if (!pieces.length) {
    notes.push('Aucun résultat : les mots juxtaposés sont exigés TOUS ensemble — essaie des alternatives (« a OU b OU c »), moins de mots, une autre orthographe, ou une racine plus courte.')
  }
  return {
    dossier: source.dossier,
    ...(source.carte ? { nature: 'dossier de la carte — lire avec carto_lire_document (document = chemin)' } : {}),
    requete,
    ...(pochette ? { pochette } : {}),
    totalResultats: pieces.length,
    pieces: page,
    ...(suite != null ? { offsetSuivant: suite } : {}),
    couverture: {
      pieces: total,
      fouillees: rels.length - nonFouillees.length,
      doublonsExactsSautes: doublons,
      nonFouillees: nonFouillees.length,
    },
    ...(nonFouillees.length ? { piecesNonFouillees: nonFouillees.slice(0, 50) } : {}),
    ...(notes.length ? { note: notes.join(' ') } : {}),
  }
}

async function chercherDansLeFonds(keys, { pochette, curseur, alternatives, maxExtraits, limite, requete }) {
  const sources = sourcesDuFonds(keys)
  const [di0, pi0] = String(curseur || '0:0').split(':').map((x) => Math.max(0, Math.floor(Number(x) || 0)))
  const echeance = Date.now() + BUDGET_FONDS_MS

  const resultats = []
  const nonFouillees = []
  const parDossier = new Map()
  let extractions = 0
  let piecesFouillees = 0
  let dossiersParcourus = 0
  let suivant = null

  parcours:
  for (let di = di0; di < sources.length; di++) {
    const source = sources[di]
    const { pieces: rels } = listePieces(source, pochette)
    for (let pi = di === di0 ? pi0 : 0; pi < rels.length; pi++) {
      // page pleine ou budget épuisé : on rend la main AVANT cette pièce
      if (resultats.length >= limite || Date.now() > echeance) { suivant = `${di}:${pi}`; break parcours }
      const rel = rels[pi]
      let res = await textePiece(keys, source, rel, false)
      if (!res.ok && res.nonExtrait) {
        if (extractions < EXTRACTIONS_FONDS) { extractions++; res = await textePiece(keys, source, rel, true) }
        else { nonFouillees.push({ dossier: source.dossier, chemin: rel }); continue }
      }
      if (!res.ok) continue
      piecesFouillees++
      const hit = chercherDansTexte(res.texte, alternatives, maxExtraits)
      if (!hit) continue
      resultats.push({
        dossier: source.dossier, nature: source.nature, chemin: rel, ...hit,
        ...(res.pagesImagesNonLues ? { pagesImagesNonLues: res.pagesImagesNonLues } : {}),
      })
      parDossier.set(source.dossier, (parDossier.get(source.dossier) || 0) + 1)
    }
    dossiersParcourus++
  }

  const notes = []
  if (suivant) {
    notes.push(`Fonds PAS ENCORE entièrement parcouru : rappelle avec la même requête et curseur:"${suivant}" pour la suite — le parcours reprend exactement là, rien n'est sauté. Continue jusqu'à "fin": true avant de conclure.`)
  }
  if (nonFouillees.length) {
    notes.push(`${nonFouillees.length} pièce(s) jamais extraite(s) n'ont pas été fouillées sur cette page (listées dans piecesNonFouillees) — fouille ensuite leurs dossiers un par un (numero), ce qui les extrait.`)
  }
  return {
    portee: 'tout le fonds (enquêtes en cours et archivées, instructions, dossiers de la carte)',
    requete,
    ...(pochette ? { pochette } : {}),
    dossiersDuFonds: sources.length,
    pieces: resultats,
    parDossier: Object.fromEntries(parDossier),
    page: {
      depuis: `${di0}:${pi0}`,
      dossiersParcourus,
      piecesFouillees,
      resultats: resultats.length,
    },
    ...(suivant ? { curseurSuivant: suivant } : { fin: true }),
    ...(nonFouillees.length ? { piecesNonFouillees: nonFouillees.slice(0, 100) } : {}),
    ...(notes.length ? { note: notes.join(' ') } : {}),
  }
}
