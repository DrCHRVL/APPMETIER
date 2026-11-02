/**
 * SIRAL — Attaché de justice · PIÈCES PEUT-ÊTRE MAL CLASSÉES.
 *
 * Une interception versée dans le mauvais dossier fabrique de FAUX
 * recoupements : la ligne et les noms d'une affaire apparaissent dans une
 * autre, et la veille signale un pont qui n'existe pas. Ce module repère ces
 * pièces, sans un jeton : une pièce dont les MARQUES (lignes, plaques, IBAN,
 * personnes nommées) renvoient massivement à un AUTRE dossier, et presque pas
 * au sien, est signalée — avec le dossier où elle semble devoir aller.
 *
 * Les marques d'une pièce viennent du REGISTRE (entités extraites du texte
 * intégral, personnes des mini-fiches — enquêteurs, magistrats, avocats
 * écartés). Celles d'un dossier, de deux sources :
 *   - DÉCLARÉES (poids 3) : mis en cause / mis en examen / suspects, lignes
 *     interceptées, objets géolocalisés, numéros cités dans les actes ;
 *   - LUES dans ses autres pièces (poids 1) — sauf celles du MÊME versement
 *     (même pochette, déposées à quelques heures près) : un lot entier versé
 *     au mauvais endroit ne doit pas se donner raison à lui-même.
 * Une marque présente dans trop de dossiers (un OPJ, un service, une banque)
 * ne dit rien : elle est ignorée.
 *
 * Le module ne déplace rien : il SIGNALE. C'est le magistrat qui juge.
 */
import { attacheTj, listDocsMeta, docServerKey } from './store.mjs'
import { loadContentieux } from './dossier.mjs'
import { allInstructionDossiers } from './instru.mjs'
import { readRegistre, extraireEntites } from './registre.mjs'
import { mecCanonId } from './carto.mjs'

const POIDS_DECLARE = 3
const POIDS_PIECE = 1
const DOSSIERS_MAX_PAR_MARQUE = 4 // au-delà, la marque est commune : elle ne situe rien
const MEME_VERSEMENT_MS = 6 * 3600 * 1000
const SEUIL_AUTRE = 3              // poids minimal du dossier probable
const RE_ROLE_NEUTRE = /enqu[eê]teur|policier|gendarme|\bOPJ\b|\bAPJ\b|magistrat|procureur|juge|avocat|greffier|expert|interpr[eè]te|traducteur/i
const NATURES_PIECE = ['tel', 'plaque', 'iban']

const marque = (nature, valeur) => `${nature}:${valeur}`
const libelleMarque = (m) => {
  const [nature, ...v] = m.split(':')
  const valeur = v.join(':')
  return { nature: nature === 'tel' ? 'ligne' : nature, valeur }
}

/** Marques DÉCLARÉES d'un texte libre de champ structuré (ligne, plaque, IBAN). */
function marquesTexte(texte, out) {
  const ent = extraireEntites(texte)
  for (const n of NATURES_PIECE) for (const v of ent[n] || []) out.add(marque(n, v))
}
function marqueNom(nom, out) {
  const c = mecCanonId(nom)
  if (c && c.length >= 5) out.add(marque('personne', c))
}

/**
 * Les dossiers du fonds, avec leurs marques déclarées. `enquetes` et
 * `instructions` sont injectables (la veille les passe pour tous les
 * contentieux confiés) ; à défaut, le contentieux du connecteur.
 */
function dossiersDuFonds(keys, { enquetes, instructions } = {}) {
  const liste = []
  const enq = enquetes || loadContentieux(keys).data?.enquetes || []
  for (const e of enq) {
    if (!e?.numero) continue
    const declare = new Set()
    for (const m of e.misEnCause || []) { marqueNom(m.nom, declare); marquesTexte(m.role || '', declare) }
    for (const x of e.ecoutes || []) { marquesTexte(`${x.numero || ''} ${x.description || ''}`, declare); marqueNom(x.cible, declare) }
    for (const g of e.geolocalisations || []) marquesTexte(`${g.objet || ''} ${g.description || ''}`, declare)
    for (const a of e.actes || []) marquesTexte(a.description || '', declare)
    liste.push({ numero: String(e.numero), nature: 'enquête', docKey: docServerKey(e.numero), declare, famille: new Set() })
  }
  let instr = instructions
  if (!instr) { try { instr = allInstructionDossiers(keys) } catch { instr = [] } }
  for (const d of instr || []) {
    const numero = d.numeroInstruction || d.numeroParquet
    if (!numero) continue
    const declare = new Set()
    for (const m of d.misEnExamen || []) marqueNom(m.nom, declare)
    for (const s of d.suspects || []) { marqueNom(s.nom, declare); marquesTexte(s.role || '', declare) }
    // L'enquête préliminaire d'origine EST le même dossier : jamais l'un
    // « appartient » à l'autre.
    const famille = new Set(d.enquetePreliminaireNumero ? [docServerKey(d.enquetePreliminaireNumero)] : [])
    liste.push({ numero: String(numero), nature: 'instruction', docKey: docServerKey(numero), declare, famille })
  }
  // la parenté vaut dans les deux sens ; un même docKey n'est compté qu'une fois
  const parCle = new Map()
  for (const d of liste) if (!parCle.has(d.docKey)) parCle.set(d.docKey, d)
  for (const d of parCle.values()) for (const k of d.famille) parCle.get(k)?.famille.add(d.docKey)
  return [...parCle.values()]
}

/** Marques d'une pièce, depuis son entrée de registre. */
function marquesPiece(entree) {
  const out = new Set()
  for (const n of NATURES_PIECE) for (const v of entree.entites?.[n] || []) out.add(marque(n, v))
  for (const p of entree.fiche?.personnes || []) {
    if (RE_ROLE_NEUTRE.test(String(p.role || ''))) continue
    marqueNom(p.nom, out)
    if (p.alias) marqueNom(p.alias, out)
  }
  return out
}

/**
 * Détecte les pièces peut-être mal classées. `numero` : ne garder que celles
 * qui touchent ce dossier (comme dossier actuel ou probable).
 * Rend [{ dossier, nature, piece, dossierProbable, natureProbable, certitude,
 *         poidsActuel, poidsProbable, marques: [{ nature, valeur, dansProbable, dansActuel }] }].
 */
export function detecterPiecesMalClassees(keys, { numero, enquetes, instructions } = {}) {
  const dossiers = dossiersDuFonds(keys, { enquetes, instructions })

  // marques lues dans les pièces, dossier par dossier : marque → [{ rel, dir, at }]
  const lues = new Map() // docKey → Map(marque → pièces)
  const pieces = new Map() // docKey → [{ rel, dir, at, marques }]
  for (const d of dossiers) {
    const reg = readRegistre(keys, d.docKey)
    const metas = new Map(listDocsMeta(attacheTj(), d.docKey).map((m) => [String(m.rel), m]))
    const parMarque = new Map()
    const liste = []
    for (const [rel, e] of Object.entries(reg.pieces || {})) {
      if (!metas.has(rel) || e.fiche?.copieDe) continue // une copie exacte suit son porteur
      const m = marquesPiece(e)
      if (!m.size) continue
      const i = rel.lastIndexOf('/')
      const p = { rel, dir: i > 0 ? rel.slice(0, i) : '', at: Date.parse(metas.get(rel).savedAt || 0) || 0, marques: m }
      liste.push(p)
      for (const x of m) {
        if (!parMarque.has(x)) parMarque.set(x, [])
        parMarque.get(x).push(p)
      }
    }
    lues.set(d.docKey, parMarque)
    pieces.set(d.docKey, liste)
  }

  // dossiers où chaque marque apparaît (déclarée ou lue)
  const dossiersDeMarque = new Map()
  const noter = (x, k) => { if (!dossiersDeMarque.has(x)) dossiersDeMarque.set(x, new Set()); dossiersDeMarque.get(x).add(k) }
  for (const d of dossiers) {
    for (const x of d.declare) noter(x, d.docKey)
    for (const x of lues.get(d.docKey).keys()) noter(x, d.docKey)
  }
  const parCle = new Map(dossiers.map((d) => [d.docKey, d]))

  const memeVersement = (p, q) => p.dir === q.dir && Math.abs(p.at - q.at) < MEME_VERSEMENT_MS
  const poidsDans = (x, d, p) => {
    if (d.declare.has(x)) return POIDS_DECLARE
    const autres = (lues.get(d.docKey).get(x) || []).filter((q) => q !== p && !(p && memeVersement(p, q)))
    return autres.length ? POIDS_PIECE : 0
  }

  const suspects = []
  for (const d of dossiers) {
    for (const p of pieces.get(d.docKey)) {
      const marques = [...p.marques].filter((x) => (dossiersDeMarque.get(x)?.size || 0) <= DOSSIERS_MAX_PAR_MARQUE)
      if (!marques.length) continue
      const poidsActuel = marques.reduce((s, x) => s + poidsDans(x, d, p), 0)
      const candidats = new Map()
      for (const x of marques) {
        for (const k of dossiersDeMarque.get(x) || []) {
          if (k === d.docKey || d.famille.has(k)) continue
          candidats.set(k, (candidats.get(k) || 0) + poidsDans(x, parCle.get(k), null))
        }
      }
      let meilleur = null
      for (const [k, poids] of candidats) if (!meilleur || poids > meilleur.poids) meilleur = { k, poids }
      if (!meilleur || meilleur.poids < SEUIL_AUTRE || meilleur.poids < 2 * poidsActuel + 2) continue
      const b = parCle.get(meilleur.k)
      suspects.push({
        dossier: d.numero,
        nature: d.nature,
        piece: p.rel,
        dossierProbable: b.numero,
        natureProbable: b.nature,
        // forte : rien ne la rattache à son dossier, ou l'autre l'emporte de loin
        certitude: poidsActuel === 0 || meilleur.poids >= 4 * poidsActuel + 3 ? 'forte' : 'moyenne',
        poidsActuel,
        poidsProbable: meilleur.poids,
        marques: marques
          .map((x) => ({ ...libelleMarque(x), dansProbable: b.declare.has(x) ? 'déclarée' : (poidsDans(x, b, null) ? 'pièces' : null), dansActuel: poidsDans(x, d, p) > 0 }))
          .filter((m) => m.dansProbable || m.dansActuel),
      })
    }
  }
  const q = String(numero || '').trim().toLowerCase()
  return suspects
    .filter((s) => !q || s.dossier.toLowerCase().includes(q) || s.dossierProbable.toLowerCase().includes(q))
    .sort((a, b) => (b.poidsProbable - b.poidsActuel) - (a.poidsProbable - a.poidsActuel) || a.dossier.localeCompare(b.dossier) || a.piece.localeCompare(b.piece))
}
