/**
 * SIRAL — Attaché de justice · INTERROGATION DU FONDS (question large,
 * lecture exhaustive pilotée par la question).
 *
 * Le registre répond vite mais sur des fiches écrites UNE fois, sans
 * connaître la question qu'on leur posera. La recherche plein texte ne
 * connaît que des mots. Ici, c'est la QUESTION qui pilote la lecture : chaque
 * pièce du périmètre (un dossier, ou le fonds entier) est soumise au modèle
 * avec la question, et rend un VERDICT — pertinente ou non, score,
 * justification, extraits verbatim. Puis une synthèse d'ensemble est rédigée
 * depuis les verdicts, chaque affirmation citant sa pièce. C'est le patron des
 * revues exhaustives d'eDiscovery (un verdict motivé par document), avec leur
 * CONTRÔLE D'ÉLUSION : un échantillon des pièces écartées est relu pour
 * estimer ce que la passe a pu manquer — on annonce un rappel estimé, jamais
 * « j'ai tout lu ».
 *
 * Deux niveaux :
 *   - « pieces » (défaut) : le texte intégral de chaque pièce, en tranches
 *     pour les longues (fusion des verdicts) ; contrôle d'élusion à la fin ;
 *   - « fiches » : les mini-fiches et entités du registre, par lots larges —
 *     rapide, pour cibler ; les pièces sans fiche sont nommées non lues.
 *
 * Travail de fond : déposé par le connecteur (Claude web) ou l'attaché, il
 * avance par lots à chaque tick du service, dès que le gouverneur de forfait
 * l'autorise, et reprend là où il s'est arrêté (curseur persistant). Le
 * résultat est remis en LIVRABLE (fil « pendant votre absence », actes
 * rédigés du dossier ou hors dossier) et reste lisible par interrogation_lire.
 *
 * Stockage : une enveloppe CHIFFRÉE (clé globale) par interrogation —
 * attache/interrogations/<id>.json : la question et les verdicts portent des
 * noms, rien n'est en clair sur le disque.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { attacheDir, attacheContentieux, ensureDir, readJson, atomicWrite } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { sourcesDuFonds, sourceDuDossier, listePieces, textePiece } from './recherche.mjs'
import { readRegistre } from './registre.mjs'
import { lireRapport, assurerRapport } from './rapport.mjs'
import { bloc as blocConsigne } from './consignes.mjs'
import { economicalModel } from './subagents.mjs'
import { extractUsage, recordUsage } from './usage.mjs'
import { saveProduction } from './productions.mjs'
import { audit, publishFeed } from './journal.mjs'
import { runUnTour } from './unTour.mjs'

const RUN_TIMEOUT_MS = Number(process.env.SIRAL_ATTACHE_INTERROGATION_TIMEOUT_MIN || 6) * 60 * 1000
// Synthèse finale : un cran au-dessus des verdicts (elle engage la réponse).
const SYNTHESE_MODEL = process.env.SIRAL_ATTACHE_INTERROGATION_MODEL || 'sonnet'
// Même rangement « hors dossier » que les livrables du connecteur (attache-mcp.mjs).
const HORS_DOSSIER = '_hors-dossier'

// Mêmes bornes de lot que le registre : le prompt part en UN argument (-p),
// plafonné à 128 Kio sous Linux. Une pièce n'est JAMAIS tronquée : une pièce
// longue est lue en tranches (légèrement chevauchantes), réparties sur autant
// de lots qu'il faut ; son verdict se fusionne tranche après tranche.
const LOT_PIECES = 8
const TRANCHE = 9_000
const RECOUVREMENT = 300
const CHARS_TOTAL = 80_000
const FICHES_PAR_LOT = 40
const RAPPORTS_PAR_LOT = 6
const RAPPORTS_REDIGES_PAR_PASSAGE = 3 // rapports de dossier (ré)écrits par passage, niveau « rapports »
const LOTS_PAR_PASSAGE = 6
const ECHECS_MAX = 3 // échecs CONSÉCUTIFS de lot : l'interrogation est mise en échec
const ELUSION_MAX = 20 // pièces écartées relues au contrôle
const EXTRAITS_MAX = 5
const JUSTIFICATION_MAX = 400
const EXTRAIT_MAX = 400
const SYNTHESE_DONNEES_MAX = 90_000
const LIVRABLE_PIECES_MAX = 300
const QUESTION_MIN = 10

// Dépendances remplaçables (tests) : la brique qui parle au modèle.
const deps = { runModele }
export function configurerInterrogation(overrides = {}) { Object.assign(deps, overrides) }

// ── Stockage ─────────────────────────────────────────────────────────────

const DIR = () => attacheDir('interrogations')
const cheminDe = (id) => `${DIR()}/${String(id).replace(/[^a-z0-9-]/g, '')}.json`

export function lireInterrogation(keys, id) {
  const env = readJson(cheminDe(id), null)
  if (!env) return null
  try { return decryptJson(keys.global, env) } catch { return null }
}

function ecrire(keys, it) {
  ensureDir(DIR())
  it.majLe = new Date().toISOString()
  atomicWrite(cheminDe(it.id), JSON.stringify(encryptJson(keys.global, it)))
}

/** Toutes les interrogations, la plus récente d'abord. */
export function listerInterrogations(keys) {
  if (!fs.existsSync(DIR())) return []
  return fs.readdirSync(DIR())
    .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
    .map((f) => lireInterrogation(keys, f.slice(0, -5)))
    .filter(Boolean)
    .sort((a, b) => String(b.creeLe).localeCompare(String(a.creeLe)))
}

// ── Création : le plan est figé au dépôt (aucune extraction, aucun jeton) ──

/**
 * Dépose une interrogation. `numero` vide = tout le fonds (enquêtes en cours
 * et archivées, instructions, dossiers de la carte) ; `pochette` restreint
 * chaque dossier à une pochette ; `dossiers` (liste de libellés) restreint
 * le fonds à ces dossiers — c'est ainsi qu'une interrogation « rapports »
 * lance son approfondissement « pieces » (`suiteDe`). Niveau « rapports » :
 * `approfondir` (défaut oui) enchaîne la lecture pièce par pièce des
 * dossiers retenus. Rend l'interrogation avec son devis.
 */
export function creerInterrogation(keys, { question, numero, niveau, pochette, dossiers, approfondir, suiteDe } = {}) {
  const q = String(question || '').trim()
  if (q.length < QUESTION_MIN) throw new Error(`Question trop courte (${QUESTION_MIN} caractères minimum) : formule ce que la lecture doit chercher, avec ses variantes.`)
  const niv = ['fiches', 'rapports'].includes(niveau) ? niveau : 'pieces'
  let sources
  if (String(numero || '').trim()) sources = [sourceDuDossier(keys, String(numero))]
  else if (Array.isArray(dossiers) && dossiers.length) {
    const voulus = new Set(dossiers.map(String))
    sources = sourcesDuFonds(keys).filter((s) => voulus.has(s.dossier))
    if (sources.length === 1) numero = sources[0].dossier
  } else sources = sourcesDuFonds(keys)
  const plan = []
  let doublons = 0
  for (const s of sources) {
    const l = listePieces(s, pochette)
    doublons += l.doublons
    if (l.pieces.length) plan.push({ dossier: s.dossier, cle: s.cle, nature: s.nature, rels: l.pieces })
  }
  const total = plan.reduce((n, p) => n + p.rels.length, 0)
  if (!total) throw new Error(numero ? `Dossier « ${numero} » sans pièce versée (ou pochette vide).` : 'Aucune pièce versée dans le fonds.')
  const it = {
    v: 1,
    id: `q-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
    question: q.slice(0, 4_000),
    niveau: niv,
    numero: numero ? plan[0].dossier : null,
    ...(pochette ? { pochette: String(pochette) } : {}),
    ...(niv === 'rapports' ? { approfondir: approfondir !== false } : {}),
    ...(suiteDe ? { suiteDe: String(suiteDe) } : {}),
    creeLe: new Date().toISOString(),
    etat: 'attente',
    plan,
    curseur: { source: 0, piece: 0 },
    enCours: null,
    pertinentes: [],
    ecartees: [],
    nonLues: [],
    lots: 0,
    echecs: 0,
    total,
    doublonsExactsSautes: doublons,
  }
  ecrire(keys, it)
  return it
}

export function arreterInterrogation(keys, id) {
  const it = lireInterrogation(keys, id)
  if (!it) return null
  if (it.etat === 'fait') return it
  it.etat = 'arretee'
  it.arreteeLe = new Date().toISOString()
  ecrire(keys, it)
  return it
}

// ── Le modèle : un tour, aucun outil, réponse JSON ou texte ──────────────

function systemPrompt() {
  return [
    `Tu es un analyste juridique, attaché d'un magistrat du parquet (contentieux ${attacheContentieux()}). Tu relis des pièces de procédure pour répondre à UNE question posée par le magistrat.`,
    'Tu ne disposes d\'aucun outil : tu lis le texte joint et tu réponds, point.',
  ].join('\n')
}

function runModele({ prompt, model, json, label }) {
  return runUnTour({ prompt, systeme: systemPrompt(), model, json, label: label || 'interrogation', timeoutMs: RUN_TIMEOUT_MS })
}

// ── Verdicts ─────────────────────────────────────────────────────────────

function promptVerdicts(keys, it, lot) {
  const donnees = lot.map(({ id, texte }) => `\n\n═══ PIÈCE ${id} ═══\n${texte}`).join('')
  const parties = lot.some((x) => x.parties > 1)
  const unite = it.niveau === 'fiches' ? 'fiches' : it.niveau === 'rapports' ? 'rapports de dossier' : 'pièces'
  return [
    `INTERROGATION DU FONDS — ${lot.length} ${unite} à juger au regard de la QUESTION.`,
    '',
    `───── QUESTION DU MAGISTRAT ─────`,
    it.question,
    '',
    blocConsigne(keys, 'interrogation_verdict', { question: it.question }),
    ...(it.niveau === 'rapports' ? [
      '',
      'RAPPORTS DE DOSSIER : chaque élément est le rapport de synthèse d\'un DOSSIER ENTIER (écrit depuis le sommaire de toutes ses pièces). Il est PERTINENT si le dossier paraît contenir des pièces qui répondent à la question ; les extraits sont des passages du rapport, cotes comprises quand il en cite. Le dossier retenu sera ensuite relu pièce par pièce : en cas de doute, retiens.',
    ] : []),
    ...(parties ? [
      '',
      'PIÈCES LONGUES : une pièce longue arrive par PARTIES (« [partie k/n] » dans son entête). Juge chaque partie comme une pièce à part : "chemin" = l\'entête EXACT, mention de partie comprise (les verdicts des parties sont fusionnés ensuite).',
    ] : []),
    '',
    `───── ${unite.toUpperCase()} ─────`,
    donnees,
  ].join('\n')
}

const RAPPORT_CHEMIN = '§ rapport du dossier'

function nettoieVerdict(v) {
  if (!v || typeof v !== 'object') return null
  const score = Math.max(0, Math.min(1, Number(v.score) || 0))
  const pertinent = v.pertinent === true || v.pertinent === 'true' || (v.pertinent == null && score >= 0.5)
  return {
    pertinent,
    score: pertinent ? Math.max(score, 0.5) : Math.min(score, 0.49),
    justification: String(v.justification || '').replace(/\s+/g, ' ').trim().slice(0, JUSTIFICATION_MAX),
    extraits: (Array.isArray(v.extraits) ? v.extraits : []).map((x) => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, EXTRAITS_MAX).map((x) => x.slice(0, EXTRAIT_MAX)),
  }
}

/** Fusion des verdicts des tranches d'une même pièce : pertinente si UNE tranche l'est. */
function fusionner(cumul, v) {
  if (!cumul) return { ...v }
  const meilleur = v.score > cumul.score
  return {
    pertinent: cumul.pertinent || v.pertinent,
    score: Math.max(cumul.score, v.score),
    justification: meilleur && v.justification ? v.justification : cumul.justification || v.justification,
    extraits: [...cumul.extraits, ...v.extraits].slice(0, EXTRAITS_MAX),
  }
}

/** Texte compact d'une entrée de registre (niveau « fiches »). */
function texteFiche(entree) {
  const f = entree.fiche || {}
  const ent = entree.entites || {}
  return [
    `Type : ${f.type || '?'}${f.datePiece ? ` · Date : ${f.datePiece}` : ''}`,
    (f.personnes || []).length ? `Personnes : ${f.personnes.map((p) => `${p.nom}${p.alias ? ` dit ${p.alias}` : ''}${p.role ? ` (${p.role})` : ''}`).join(' ; ')}` : null,
    (f.vehicules || []).length ? `Véhicules : ${f.vehicules.map((x) => [x.plaque, x.description, x.utilisateur].filter(Boolean).join(' / ')).join(' ; ')}` : null,
    (f.lignes || []).length ? `Lignes : ${f.lignes.map((x) => [x.numero, x.utilisateur].filter(Boolean).join(' / ')).join(' ; ')}` : null,
    (ent.tel || []).length ? `Téléphones relevés : ${ent.tel.join(', ')}` : null,
    (ent.plaque || []).length ? `Plaques relevées : ${ent.plaque.join(', ')}` : null,
    (ent.adresse || []).length ? `Adresses relevées : ${ent.adresse.join(' ; ')}` : null,
    (ent.iban || []).length ? `IBAN relevés : ${ent.iban.join(', ')}` : null,
    `Résumé : ${f.resume || ''}`,
  ].filter(Boolean).join('\n')
}

const idPiece = (dossier, chemin) => `${dossier} :: ${chemin}`

/** Source d'un pas du plan — un dossier de la carte se recharge (ses documents vivent dans l'overlay). */
function sourceDe(keys, pas, cache) {
  if (!pas.cle.startsWith('carte:')) return { cle: pas.cle, dossier: pas.dossier, nature: pas.nature }
  if (!cache.fonds) cache.fonds = sourcesDuFonds(keys)
  return cache.fonds.find((s) => s.cle === pas.cle) || { cle: pas.cle, dossier: pas.dossier, nature: pas.nature, carte: { documents: [] } }
}

/**
 * Le prochain lot à juger, le curseur avancé en conséquence. Chaque élément :
 * { dossier, chemin, id, texte, partie, parties }. Une pièce longue entamée
 * reste « en cours » (it.enCours) jusqu'à sa dernière tranche. Pièces sans
 * texte : nommées non lues, sautées.
 */
async function prochainLot(keys, it, cache, { rels: liste = null } = {}) {
  const lot = []
  let total = 0
  const plein = () => (it.niveau === 'fiches' ? lot.length >= FICHES_PAR_LOT
    : it.niveau === 'rapports' ? lot.length >= RAPPORTS_PAR_LOT || total >= CHARS_TOTAL
      : lot.length >= LOT_PIECES || total >= CHARS_TOTAL)
  const pousserTranches = (dossier, chemin, texte, depuis) => {
    const parties = Math.max(1, Math.ceil(texte.length / TRANCHE))
    let k = depuis
    for (; k < parties && !plein(); k++) {
      const t = texte.slice(Math.max(0, k * TRANCHE - RECOUVREMENT), (k + 1) * TRANCHE)
      total += t.length
      lot.push({ dossier, chemin, partie: k, parties, texte: t, id: parties > 1 ? `${idPiece(dossier, chemin)} [partie ${k + 1}/${parties}]` : idPiece(dossier, chemin) })
    }
    return { parties, faites: k }
  }

  // pièce longue entamée au lot précédent : on la finit d'abord
  if (it.enCours && it.niveau === 'pieces') {
    const pas = it.plan.find((p) => p.dossier === it.enCours.dossier)
    const src = pas ? sourceDe(keys, pas, cache) : null
    const res = src ? await textePiece(keys, src, it.enCours.chemin, true) : { ok: false }
    if (res.ok) {
      const { parties, faites } = pousserTranches(it.enCours.dossier, it.enCours.chemin, String(res.texte), it.enCours.faites)
      it.enCours.parties = parties
      it.enCours.faitesLot = faites
    } else {
      it.nonLues.push({ dossier: it.enCours.dossier, chemin: it.enCours.chemin, raison: 'texte devenu indisponible' })
      it.enCours = null
    }
    if (plein()) return lot
  }

  // liste explicite (contrôle d'élusion) ou parcours du plan au curseur
  const suivant = () => {
    if (liste) return liste.length ? liste.shift() : null
    if (it.niveau === 'rapports') {
      // un élément par DOSSIER : son rapport
      if (it.curseur.source >= it.plan.length) return null
      const pas = it.plan[it.curseur.source++]
      it.curseur.piece = 0
      return { dossier: pas.dossier, chemin: RAPPORT_CHEMIN, pieces: pas.rels.length }
    }
    while (it.curseur.source < it.plan.length) {
      const pas = it.plan[it.curseur.source]
      if (it.curseur.piece < pas.rels.length) {
        const chemin = pas.rels[it.curseur.piece++]
        return { dossier: pas.dossier, chemin }
      }
      it.curseur.source++
      it.curseur.piece = 0
    }
    return null
  }

  while (!plein()) {
    const p = suivant()
    if (!p) break
    const pas = it.plan.find((x) => x.dossier === p.dossier)
    const src = sourceDe(keys, pas, cache)
    if (it.niveau === 'rapports') {
      if (src.carte) { it.nonLues.push({ ...p, raison: 'dossier de la carte : pas de rapport (documents à lire avec carto_lire_document)' }); continue }
      const r = lireRapport(keys, pas.cle)
      if (!r?.texte) { it.nonLues.push({ ...p, raison: 'rapport non rédigé' }); continue }
      lot.push({ dossier: p.dossier, chemin: RAPPORT_CHEMIN, id: idPiece(p.dossier, RAPPORT_CHEMIN), texte: r.texte, partie: 0, parties: 1 })
      total += r.texte.length
      continue
    }
    if (it.niveau === 'fiches') {
      if (src.carte) {
        const doc = (src.carte.documents || []).find((x) => String(x.nom) === p.chemin)
        if (doc) { lot.push({ ...p, id: idPiece(p.dossier, p.chemin), texte: String(doc.texte || '').slice(0, 3_000), partie: 0, parties: 1 }); continue }
        it.nonLues.push({ ...p, raison: 'document absent' })
        continue
      }
      if (!cache.registres.has(src.cle)) cache.registres.set(src.cle, readRegistre(keys, src.cle))
      const entree = cache.registres.get(src.cle).pieces[p.chemin]
      if (!entree?.fiche) { it.nonLues.push({ ...p, raison: 'sans fiche au registre' }); continue }
      lot.push({ ...p, id: idPiece(p.dossier, p.chemin), texte: texteFiche(entree), partie: 0, parties: 1 })
      continue
    }
    const res = await textePiece(keys, src, p.chemin, true)
    if (!res.ok || !String(res.texte || '').trim()) { it.nonLues.push({ ...p, raison: res.nonExtrait ? 'texte non extractible' : 'pièce vide ou illisible' }); continue }
    const texte = String(res.texte)
    const { parties, faites } = pousserTranches(p.dossier, p.chemin, texte, 0)
    if (faites < parties) it.enCours = { dossier: p.dossier, chemin: p.chemin, parties, faites: 0, faitesLot: faites, verdict: null }
  }
  return lot
}

/** Applique les verdicts d'un lot ; rend le nombre de pièces soldées. */
function appliquerVerdicts(it, lot, data, { controle = false } = {}) {
  // Verdicts par entête exact ; en secours, par chemin sans le préfixe
  // « dossier :: » (un modèle qui l'omet ne fait pas perdre la pièce).
  const parId = new Map()
  const sansDossier = (id) => id.replace(/^.*? :: /, '')
  for (const v of data) {
    const id = String(v?.chemin || v?.id || '').trim()
    if (!id) continue
    parId.set(id, v)
    if (!parId.has(sansDossier(id))) parId.set(sansDossier(id), v)
  }
  const verdictDe = (id) => parId.get(id) || parId.get(sansDossier(id))
  const parPiece = new Map()
  for (const x of lot) {
    const cle = idPiece(x.dossier, x.chemin)
    if (!parPiece.has(cle)) parPiece.set(cle, { dossier: x.dossier, chemin: x.chemin, tranches: [] })
    parPiece.get(cle).tranches.push(x)
  }
  let soldees = 0
  for (const [cle, p] of parPiece) {
    let cumul = null
    let manquant = false
    for (const t of p.tranches) {
      const v = nettoieVerdict(verdictDe(t.id) || (p.tranches.length === 1 ? verdictDe(cle) : undefined))
      if (!v) { manquant = true; break }
      cumul = fusionner(cumul, v)
    }
    const longue = it.enCours && it.enCours.dossier === p.dossier && it.enCours.chemin === p.chemin
    if (manquant) {
      if (longue) it.enCours = null
      it.nonLues.push({ dossier: p.dossier, chemin: p.chemin, raison: 'sans verdict dans la réponse du modèle' })
      continue
    }
    if (longue) {
      it.enCours.verdict = fusionner(it.enCours.verdict, cumul)
      it.enCours.faites = it.enCours.faitesLot
      if (it.enCours.faites < it.enCours.parties) continue // la suite au lot suivant
      cumul = it.enCours.verdict
      it.enCours = null
    }
    soldees++
    if (cumul.pertinent) {
      it.pertinentes.push({ dossier: p.dossier, chemin: p.chemin, ...cumul, ...(controle ? { controle: true } : {}) })
      if (controle) it.ecartees = it.ecartees.filter((x) => !(x.dossier === p.dossier && x.chemin === p.chemin))
    } else if (!controle) {
      it.ecartees.push({ dossier: p.dossier, chemin: p.chemin })
    }
  }
  return soldees
}

/**
 * Construit et juge le prochain lot. Le curseur avance en construisant le
 * lot : en cas d'échec du modèle, tout est REMIS en place (curseur, pièce en
 * cours, non lues, liste de contrôle) — aucune pièce n'est sautée, le lot
 * sera repris au passage suivant. Rend { ok, vide }.
 */
async function jugerProchainLot(keys, it, cache, { rels = null, controle = false } = {}) {
  const avant = { curseur: { ...it.curseur }, enCours: it.enCours ? JSON.parse(JSON.stringify(it.enCours)) : null, nonLues: it.nonLues.length, rels: rels ? [...rels] : null }
  const lot = await prochainLot(keys, it, cache, { rels })
  if (!lot.length) return { ok: true, vide: true }
  const model = economicalModel()
  const run = await deps.runModele({ prompt: promptVerdicts(keys, it, lot), model, json: true, label: 'interrogation' })
  if (!run.ok) {
    it.curseur = avant.curseur
    it.enCours = avant.enCours
    it.nonLues.length = avant.nonLues
    if (rels) rels.splice(0, rels.length, ...avant.rels)
    it.echecs = (it.echecs || 0) + 1
    it.erreur = run.error
    return { ok: false, vide: false }
  }
  it.echecs = 0
  delete it.erreur
  it.lots++
  appliquerVerdicts(it, lot, run.data, { controle })
  await recordUsage({ run: 'interrogation', model, usage: extractUsage(run.envelope) })
  return { ok: true, vide: false }
}

// ── Niveau « rapports » : chaque dossier du plan a besoin d'un rapport à jour ──

/**
 * Assure les rapports des dossiers du plan, dans l'ordre, bornés par passage
 * (rédactions). Rend { pret:true } quand tous sont là ; sinon { pret:false,
 * differe? } — le passage suivant reprend. Un rapport impossible (modèle en
 * échec) compte comme un échec de l'interrogation ; un registre incomplet
 * attend simplement que les fiches avancent.
 */
async function preparerRapports(keys, it, onHold) {
  it.rapportsPrets = it.rapportsPrets || {}
  let redactions = 0
  for (const pas of it.plan) {
    if (it.rapportsPrets[pas.dossier]) continue
    if (pas.cle.startsWith('carte:')) { it.rapportsPrets[pas.dossier] = 'carte'; continue }
    const avant = lireRapport(keys, pas.cle)
    const r = await assurerRapport(keys, pas.dossier, { onHold })
    if (!r.pret) {
      it.rapportsAttente = { dossier: pas.dossier, raison: r.raison, fichees: r.fichees, pieces: r.pieces }
      if (String(r.raison).startsWith('différé')) return { pret: false, differe: true }
      if (r.raison !== 'registre incomplet') { it.echecs = (it.echecs || 0) + 1; it.erreur = `rapport « ${pas.dossier} » : ${r.raison}` }
      return { pret: false }
    }
    it.rapportsPrets[pas.dossier] = true
    it.echecs = 0
    delete it.erreur
    if (!avant || avant.majLe !== r.rapport.majLe) redactions++
    if (redactions >= RAPPORTS_REDIGES_PAR_PASSAGE) { delete it.rapportsAttente; return { pret: false } }
  }
  delete it.rapportsAttente
  return { pret: true }
}

// ── Contrôle d'élusion et synthèse ───────────────────────────────────────

function echantillonElusion(it) {
  const pool = [...it.ecartees]
  const out = []
  // tirage aléatoire sans remise, borné
  while (pool.length && out.length < ELUSION_MAX) {
    const i = crypto.randomInt(pool.length)
    out.push(pool.splice(i, 1)[0])
  }
  return out
}

function promptSynthese(keys, it) {
  const lignes = []
  let taille = 0
  let omises = 0
  const tri = [...it.pertinentes].sort((a, b) => b.score - a.score || a.dossier.localeCompare(b.dossier) || a.chemin.localeCompare(b.chemin))
  for (const p of tri) {
    const l = [
      `- [${p.dossier}] ${p.chemin} · score ${p.score.toFixed(2)}${p.controle ? ' · trouvée au contrôle d\'élusion' : ''}`,
      p.justification ? `  Justification : ${p.justification}` : null,
      ...p.extraits.map((x) => `  « ${x} »`),
    ].filter(Boolean).join('\n')
    if (taille + l.length > SYNTHESE_DONNEES_MAX) { omises++; continue }
    taille += l.length + 1
    lignes.push(l)
  }
  const lues = it.total - it.nonLues.length
  const el = it.elusion
  return [
    `SYNTHÈSE D'UNE INTERROGATION DU FONDS — ${it.numero ? `dossier « ${it.numero} »` : 'tout le fonds'}, niveau « ${it.niveau} ».`,
    '',
    '───── QUESTION DU MAGISTRAT ─────',
    it.question,
    '',
    blocConsigne(keys, 'interrogation_synthese', { question: it.question }),
    '',
    '───── COUVERTURE ─────',
    `${it.plan.length} dossier(s), ${it.total} pièce(s) au plan ; ${lues} lue(s) ; ${it.nonLues.length} non lue(s)${it.nonLues.length ? ` (${[...new Set(it.nonLues.map((x) => x.raison))].join(', ')})` : ''} ; ${it.pertinentes.length} retenue(s), ${it.ecartees.length} écartée(s).`,
    el ? `Contrôle d'élusion : ${el.echantillon} pièce(s) écartée(s) relue(s), ${el.trouvees} pertinente(s) retrouvée(s) — taux d'élusion ${(el.taux * 100).toFixed(0)} %, ${el.manqueesEstimees} pièce(s) pertinente(s) manquée(s) estimée(s), rappel estimé ${(el.rappelEstime * 100).toFixed(0)} %.` : 'Pas de contrôle d\'élusion (niveau fiches, ou aucune pièce écartée).',
    '',
    `───── PIÈCES RETENUES (${it.pertinentes.length}${omises ? `, ${omises} non jointes faute de place — les mieux notées sont là` : ''}) ─────`,
    ...lignes,
  ].join('\n')
}

function titreDe(it) {
  const q = it.question.replace(/\s+/g, ' ').trim()
  return `Interrogation du fonds — ${q.length > 90 ? q.slice(0, 87) + '…' : q}`
}

function corpsLivrable(it) {
  const tri = [...it.pertinentes].sort((a, b) => b.score - a.score || a.dossier.localeCompare(b.dossier) || a.chemin.localeCompare(b.chemin))
  const el = it.elusion
  return [
    `Question : ${it.question}`,
    `Périmètre : ${it.numero ? `dossier « ${it.numero} »` : 'tout le fonds'}${it.pochette ? `, pochette « ${it.pochette} »` : ''} · niveau « ${it.niveau} » · ${it.plan.length} dossier(s), ${it.total} pièce(s).`,
    '',
    it.synthese,
    '',
    `───── PIÈCES RETENUES (${it.pertinentes.length}) ─────`,
    ...tri.slice(0, LIVRABLE_PIECES_MAX).map((p) => `- [${p.dossier}] ${p.chemin} · ${p.score.toFixed(2)}${p.controle ? ' · contrôle' : ''}${p.justification ? ` — ${p.justification}` : ''}`),
    ...(tri.length > LIVRABLE_PIECES_MAX ? [`(+${tri.length - LIVRABLE_PIECES_MAX} — interrogation_lire id:"${it.id}")`] : []),
    '',
    '───── COUVERTURE ─────',
    `Lues : ${it.total - it.nonLues.length} / ${it.total} · écartées : ${it.ecartees.length} · non lues : ${it.nonLues.length}${it.doublonsExactsSautes ? ` · copies exactes sautées : ${it.doublonsExactsSautes}` : ''}`,
    el ? `Contrôle d'élusion : ${el.echantillon} relue(s), ${el.trouvees} retrouvée(s) · taux d'élusion ${(el.taux * 100).toFixed(0)} % · manquées estimées ${el.manqueesEstimees} · rappel estimé ${(el.rappelEstime * 100).toFixed(0)} %` : 'Contrôle d\'élusion : sans objet',
    ...(it.suiteId ? ['', `Approfondissement lancé : les ${it.suiteDossiers} dossier(s) retenu(s) sont relus pièce par pièce — interrogation ${it.suiteId} (interrogation_lire), résultat à venir en livrable.`] : []),
    ...(it.suiteDe ? ['', `Approfondissement de l'interrogation ${it.suiteDe} (niveau rapports).`] : []),
    ...(it.nonLues.length ? ['', `───── NON LUES (${it.nonLues.length}) ─────`, ...it.nonLues.slice(0, 100).map((x) => `- [${x.dossier}] ${x.chemin} — ${x.raison}`)] : []),
  ].join('\n')
}

async function terminer(keys, it) {
  // Contrôle d'élusion : relecture d'un échantillon des pièces écartées.
  if (it.niveau === 'pieces' && !it.elusion && it.ecartees.length) {
    const echantillon = echantillonElusion(it)
    const avant = it.pertinentes.length
    const cache = { registres: new Map() }
    const liste = [...echantillon]
    while (liste.length || it.enCours) {
      const r = await jugerProchainLot(keys, it, cache, { rels: liste, controle: true })
      if (!r.ok) { it.enCours = null; return { fini: false } } // l'échantillon sera retiré à nouveau
      if (r.vide) break
    }
    const trouvees = it.pertinentes.length - avant
    const taux = echantillon.length ? trouvees / echantillon.length : 0
    const manqueesEstimees = Math.round(taux * it.ecartees.length)
    it.elusion = { echantillon: echantillon.length, trouvees, taux, manqueesEstimees, rappelEstime: it.pertinentes.length / Math.max(1, it.pertinentes.length + manqueesEstimees) }
    ecrire(keys, it)
  }
  const run = await deps.runModele({ prompt: promptSynthese(keys, it), model: SYNTHESE_MODEL, json: false, label: 'interrogation_synthese' })
  const texte = String(run?.texte || '').trim()
  if (!run?.ok || texte.length < 100) {
    it.echecs = (it.echecs || 0) + 1
    it.erreur = run?.error || 'synthèse vide'
    return { fini: false }
  }
  await recordUsage({ run: 'interrogation', model: SYNTHESE_MODEL, usage: extractUsage(run.envelope) })
  it.synthese = texte
  // Niveau « rapports » : les dossiers retenus sont relus PIÈCE PAR PIÈCE,
  // par une interrogation enchaînée (même question, périmètre réduit).
  if (it.niveau === 'rapports' && it.approfondir && it.pertinentes.length && !it.suiteId) {
    const dossiers = [...new Set(it.pertinentes.map((p) => p.dossier))]
    try {
      const suite = creerInterrogation(keys, { question: it.question, niveau: 'pieces', dossiers, suiteDe: it.id })
      it.suiteId = suite.id
      it.suiteDossiers = dossiers.length
    } catch (e) { it.suiteErreur = String(e?.message || e) }
  }
  const { id: prodId, numero } = await saveProduction(keys, { numero: it.numero || HORS_DOSSIER, type: 'livrable', titre: titreDe(it), contenu: corpsLivrable(it), source: 'interrogation' })
  it.prodId = prodId
  it.etat = 'fait'
  it.faitLe = new Date().toISOString()
  it.echecs = 0
  delete it.erreur
  await publishFeed(keys, { type: 'livrable', titre: titreDe(it), resume: texte.slice(0, 2000), ...(it.numero ? { numero } : {}), prodId }).catch(() => {})
  await audit(keys, 'interrogation_fait', { id: it.id, numero: it.numero, pieces: it.total, pertinentes: it.pertinentes.length, lots: it.lots })
  return { fini: true }
}

// ── Un pas, à chaque tick ────────────────────────────────────────────────

/**
 * Fait avancer la plus ancienne interrogation en attente : jusqu'à `maxLots`
 * lots de verdicts, puis — quand le plan est épuisé — le contrôle d'élusion
 * et la synthèse. Rend null si rien à faire, sinon un bilan.
 */
export async function interrogationsStep(keys, { onHold = async () => false, maxLots = LOTS_PAR_PASSAGE } = {}) {
  const it = listerInterrogations(keys).filter((x) => x.etat === 'attente' || x.etat === 'en_cours').sort((a, b) => String(a.creeLe).localeCompare(String(b.creeLe)))[0]
  if (!it) return null
  if (await onHold('interrogation du fonds')) return { id: it.id, etape: 'differe' }
  it.etat = 'en_cours'
  const cache = { registres: new Map() }
  const bilan = () => ({ id: it.id, lues: lues(it), total: it.total, pertinentes: it.pertinentes.length, nonLues: it.nonLues.length })
  if (it.niveau === 'rapports' && restantes(it) > 0) {
    const p = await preparerRapports(keys, it, onHold)
    if (it.echecs >= ECHECS_MAX) it.etat = 'echec'
    ecrire(keys, it)
    if (!p.pret) return { ...bilan(), etape: p.differe ? 'differe' : it.etat === 'echec' ? 'echec' : 'rapports', ...(it.rapportsAttente ? { attente: it.rapportsAttente } : {}), ...(it.erreur ? { erreur: it.erreur } : {}) }
  }
  for (let i = 0; i < maxLots; i++) {
    const r = await jugerProchainLot(keys, it, cache)
    ecrire(keys, it)
    if (r.vide) break
    if (!r.ok) {
      if (it.echecs >= ECHECS_MAX) { it.etat = 'echec'; ecrire(keys, it) }
      return { ...bilan(), etape: it.etat === 'echec' ? 'echec' : 'lot_echoue', erreur: it.erreur }
    }
    if (i + 1 < maxLots && await onHold('interrogation du fonds')) return { ...bilan(), etape: 'differe' }
  }
  if (restantes(it) > 0 || it.enCours) return { ...bilan(), etape: 'lots' }
  const fin = await terminer(keys, it)
  if (!fin.fini && it.echecs >= ECHECS_MAX) it.etat = 'echec'
  ecrire(keys, it)
  return { ...bilan(), etape: fin.fini ? 'fait' : it.etat === 'echec' ? 'echec' : 'synthese_echouee', ...(it.erreur ? { erreur: it.erreur } : {}), ...(it.prodId ? { prodId: it.prodId } : {}) }
}

/** Pièces du plan pas encore atteintes par le curseur. */
function restantes(it) {
  let n = 0
  for (let s = it.curseur.source; s < it.plan.length; s++) {
    n += it.plan[s].rels.length - (s === it.curseur.source ? it.curseur.piece : 0)
  }
  return n
}
/** Pièces couvertes par les non-lues (au niveau rapports, une non-lue vaut tout un dossier). */
const piecesNonLues = (it) => it.nonLues.reduce((n, x) => n + (x.pieces || 1), 0)
const lues = (it) => Math.max(0, it.total - restantes(it) - piecesNonLues(it))

// ── Lecture (outils) ─────────────────────────────────────────────────────

const resume = (it) => ({
  id: it.id,
  question: it.question,
  niveau: it.niveau,
  perimetre: it.numero ? `dossier « ${it.numero} »` : 'tout le fonds',
  ...(it.pochette ? { pochette: it.pochette } : {}),
  etat: it.etat,
  creeLe: it.creeLe,
  ...(it.faitLe ? { faitLe: it.faitLe } : {}),
  avancement: { dossiers: it.plan.length, pieces: it.total, lues: lues(it), restantes: restantes(it), nonLues: it.nonLues.length, lots: it.lots, ...(it.niveau === 'rapports' ? { rapportsPrets: Object.keys(it.rapportsPrets || {}).length } : {}) },
  pertinentes: it.pertinentes.length,
  ...(it.elusion ? { elusion: it.elusion } : {}),
  ...(it.rapportsAttente ? { attente: it.rapportsAttente } : {}),
  ...(it.suiteId ? { suiteId: it.suiteId, suiteDossiers: it.suiteDossiers } : {}),
  ...(it.suiteDe ? { suiteDe: it.suiteDe } : {}),
  ...(it.prodId ? { prodId: it.prodId } : {}),
  ...(it.erreur ? { erreur: it.erreur } : {}),
})

export function sommaireInterrogations(keys) {
  return listerInterrogations(keys).map(resume)
}

export function detailInterrogation(keys, id, { offset = 0, limite = 50 } = {}) {
  const it = lireInterrogation(keys, id)
  if (!it) return null
  const tri = [...it.pertinentes].sort((a, b) => b.score - a.score || a.dossier.localeCompare(b.dossier) || a.chemin.localeCompare(b.chemin))
  const debut = Math.max(0, Math.floor(Number(offset) || 0))
  const lim = Math.max(1, Math.min(200, Number(limite) || 50))
  const page = tri.slice(debut, debut + lim)
  return {
    ...resume(it),
    ...(it.synthese ? { synthese: it.synthese } : {}),
    piecesRetenues: page,
    ...(debut + page.length < tri.length ? { offsetSuivant: debut + page.length } : {}),
    ...(it.nonLues.length ? { piecesNonLues: it.nonLues.slice(0, 100) } : {}),
    note: it.etat === 'fait'
      ? `Les verdicts sont des SIGNALEMENTS motivés : lire la pièce (lire_document) avant d'en faire état. Le rappel estimé vient du contrôle d'élusion ; les pièces non lues sont nommées.${it.suiteId ? ` Approfondissement pièce par pièce en cours : interrogation_lire id:"${it.suiteId}".` : ''}`
      : it.etat === 'arretee' ? 'Interrogation arrêtée : résultats partiels.'
        : it.etat === 'echec' ? 'Interrogation en échec (voir erreur) : résultats partiels ; redéposer avec fonds_interroger si besoin.'
          : it.niveau === 'rapports' && restantes(it) > 0 ? 'Interrogation en cours : les rapports de dossier du périmètre sont d\'abord mis à jour (mini-fiches puis rédaction, selon le forfait), puis interrogés. Le résultat sera remis en livrable ; rappeler interrogation_lire pour suivre.'
            : 'Interrogation en cours : le service la fait avancer par lots, selon le forfait. Le résultat sera remis en livrable ; rappeler interrogation_lire pour suivre.',
  }
}
