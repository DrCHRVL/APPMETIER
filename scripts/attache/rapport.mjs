/**
 * SIRAL — Attaché de justice · RAPPORTS DE DOSSIER (résumés hiérarchiques,
 * écrits une fois, interrogés souvent).
 *
 * Le registre fiche chaque PIÈCE. Il manquait l'étage au-dessus : UN rapport
 * par DOSSIER — ce dont il s'agit, les personnes et leurs rôles, le modus
 * operandi et la logistique, les lieux, véhicules, lignes et comptes, la
 * chronologie, ce qui reste obscur — rédigé depuis le registre AGRÉGÉ du
 * dossier (toutes les fiches, toutes les entités), cotes à l'appui. Un
 * dossier volumineux à plusieurs pochettes est traité en deux étages : un
 * rapport par pochette, puis le rapport du dossier depuis ceux-ci. C'est le
 * patron des « community reports » de GraphRAG, appliqué à l'unité naturelle
 * du parquet : le dossier.
 *
 * À quoi ils servent : l'INTERROGATION DU FONDS au niveau « rapports » pose
 * une question large à tous les rapports (une lecture par dossier, pas par
 * pièce — une fraction du coût), retient les dossiers qui répondent, puis
 * approfondit AU NIVEAU PIÈCES dans ces seuls dossiers. Et Claude web peut
 * lire le rapport d'un dossier d'un seul appel (rapport_lire).
 *
 * Fraîcheur : chaque rapport porte la SIGNATURE du registre dont il est issu
 * (pièces, empreintes, fiches). Un rapport n'est réécrit que si elle a bougé,
 * et seulement quand toutes les pièces sont fichées (ou abandonnées) — un
 * rapport sur un registre à moitié vide dirait n'importe quoi. Entretien de
 * nuit (service) et à la demande (interrogation). Stockage chiffré (clé
 * globale) : attache/rapports/<docKey>.json.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { attacheDir, attacheTj, attacheContentieux, tjDataDir, ensureDir, readJson, atomicWrite, listDocsMeta, docServerKey } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { numeroCanonique } from './dossier.mjs'
import { readRegistre, registreFichesStep, numeroDepuisDocKey } from './registre.mjs'
import { donneesVersement } from './versement.mjs'
import { prompt as promptConsigne } from './consignes.mjs'
import { runUnTour } from './unTour.mjs'
import { extractUsage, recordUsage } from './usage.mjs'

// Le rapport est le capital : un cran au-dessus des verdicts et des fiches.
const RAPPORT_MODEL = process.env.SIRAL_ATTACHE_RAPPORT_MODEL || 'sonnet'
const RUN_TIMEOUT_MS = Number(process.env.SIRAL_ATTACHE_RAPPORT_TIMEOUT_MIN || 8) * 60 * 1000
// Au-delà de ce nombre de pièces, avec au moins deux pochettes : un rapport
// par pochette d'abord (le registre agrégé d'un gros dossier ne tient pas
// dans un prompt sans rogner la chronologie).
const POCHETTE_SEUIL = Number(process.env.SIRAL_ATTACHE_RAPPORT_POCHETTE_SEUIL || 150)
const POCHETTES_DONNEES_MAX = 90_000
const LOTS_FICHES = 4 // lots de mini-fiches poussés par appel quand des fiches manquent
const ENTRETIEN_DOSSIERS_MAX = 2
const ECHECS_FICHE_MAX = 2 // comme le registre : au-delà, la pièce est abandonnée

const deps = { runUnTour, registreFichesStep }
export function configurerRapport(overrides = {}) { Object.assign(deps, overrides) }

// ── Stockage ─────────────────────────────────────────────────────────────

const cheminDe = (docKey) => attacheDir('rapports', String(docKey).replace(/[^a-zA-Z0-9._@-]/g, '_') + '.json')

export function lireRapport(keys, docKey) {
  const env = readJson(cheminDe(docKey), null)
  if (!env) return null
  try { return decryptJson(keys.global, env) } catch { return null }
}

function ecrire(keys, docKey, r) {
  ensureDir(attacheDir('rapports'))
  r.majLe = new Date().toISOString()
  atomicWrite(cheminDe(docKey), JSON.stringify(encryptJson(keys.global, r)))
}

// ── Signature et couverture ──────────────────────────────────────────────

const piecesDe = (docKey) => listDocsMeta(attacheTj(), docKey).filter((d) => !String(d.rel).startsWith('MD/')).map((d) => String(d.rel)).sort()
const pochetteDe = (rel) => (rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '(racine)')
const fichee = (e) => Boolean(e && ((e.fiche && e.fiche.integrale) || (e.ficheEchecs || 0) >= ECHECS_FICHE_MAX))

/** Signature du registre d'un sous-ensemble de pièces : bouge à chaque dépôt, retrait, fiche (re)faite. */
function signature(reg, rels) {
  const h = crypto.createHash('sha1')
  for (const rel of rels) {
    const e = reg.pieces[rel]
    h.update(rel).update('|').update(String(e?.sha || '')).update('|').update(String(e?.fiche?.majLe || '')).update('\n')
  }
  return `${rels.length}|${h.digest('hex').slice(0, 16)}`
}

/** État d'un dossier : pièces, fichées, signature, pochettes. */
export function etatRapport(keys, docKey) {
  const rels = piecesDe(docKey)
  const reg = readRegistre(keys, docKey)
  const fichees = rels.filter((rel) => fichee(reg.pieces[rel])).length
  const parPochette = new Map()
  for (const rel of rels) {
    const p = pochetteDe(rel)
    if (!parPochette.has(p)) parPochette.set(p, [])
    parPochette.get(p).push(rel)
  }
  const hierarchique = rels.length > POCHETTE_SEUIL && parPochette.size >= 2
  const rapport = lireRapport(keys, docKey)
  const sig = signature(reg, rels)
  return { rels, reg, fichees, sig, parPochette, hierarchique, rapport, aJour: Boolean(rapport && rapport.sig === sig), pret: fichees === rels.length }
}

// ── Rédaction ────────────────────────────────────────────────────────────

function systemPrompt() {
  return [
    `Tu es un analyste juridique, attaché d'un magistrat du parquet (contentieux ${attacheContentieux()}). Tu rédiges le RAPPORT DE SYNTHÈSE d'un dossier d'enquête depuis le sommaire de ses pièces.`,
    'Tu ne disposes d\'aucun outil : tu lis les données jointes et tu réponds en texte, point.',
  ].join('\n')
}

async function rediger(keys, { numero, entete, donnees }) {
  const run = await deps.runUnTour({
    prompt: promptConsigne(keys, 'rapport_dossier', { entete, vars: { dossier: numero }, donnees }),
    systeme: systemPrompt(),
    model: RAPPORT_MODEL,
    json: false,
    label: 'rapport',
    timeoutMs: RUN_TIMEOUT_MS,
  })
  const texte = String(run?.texte || '').trim()
  if (!run?.ok || texte.length < 200) return { ok: false, error: run?.error || 'rapport vide' }
  await recordUsage({ run: 'rapport', model: RAPPORT_MODEL, usage: extractUsage(run.envelope) })
  // Conservé EN ENTIER : une coupe perdait la fin du rapport (lacunes, pièces clés).
  return { ok: true, texte }
}

/**
 * (Ré)écrit le rapport d'un dossier dont le registre est complet. Rend
 * { ok, rapport } ou { ok:false, error }. Un dossier hiérarchique ne réécrit
 * que les pochettes dont la signature a bougé.
 */
export async function construireRapport(keys, numero) {
  const canon = numeroCanonique(keys, numero)
  const docKey = docServerKey(canon)
  const etat = etatRapport(keys, docKey)
  if (!etat.rels.length) return { ok: false, error: 'dossier sans pièce' }
  if (!etat.pret) return { ok: false, error: `registre incomplet (${etat.fichees}/${etat.rels.length} pièces fichées)` }
  if (etat.aJour) return { ok: true, rapport: etat.rapport, inchange: true }

  const ancien = etat.rapport || {}
  const r = { v: 1, dossier: canon, sig: etat.sig, pieces: etat.rels.length, fichees: etat.fichees, pochettes: {} }
  const faux = (rels) => ({ numero: canon, rels, enregistreLe: new Date().toISOString() })

  if (!etat.hierarchique) {
    const res = await rediger(keys, { numero: canon, entete: `RAPPORT DU DOSSIER « ${canon} » — ${etat.rels.length} pièces au registre.`, donnees: donneesVersement(keys, faux(etat.rels), etat.reg, { titre: `REGISTRE DU DOSSIER : ${etat.rels.length} pièces` }) })
    if (!res.ok) return res
    r.texte = res.texte
    ecrire(keys, docKey, r)
    return { ok: true, rapport: r }
  }

  // Deux étages : pochettes (celles qui ont bougé), puis le dossier.
  for (const [nom, rels] of etat.parPochette) {
    const sig = signature(etat.reg, rels)
    const prec = ancien.pochettes?.[nom]
    if (prec && prec.sig === sig) { r.pochettes[nom] = prec; continue }
    const res = await rediger(keys, { numero: canon, entete: `RAPPORT DE LA POCHETTE « ${nom} » du dossier « ${canon} » — ${rels.length} pièces au registre.`, donnees: donneesVersement(keys, faux(rels), etat.reg, { titre: `REGISTRE DE LA POCHETTE « ${nom} » : ${rels.length} pièces` }) })
    if (!res.ok) {
      // on garde ce qui est fait : les pochettes réécrites ne le seront pas deux fois
      ecrire(keys, docKey, { ...ancien, dossier: canon, pochettes: { ...(ancien.pochettes || {}), ...r.pochettes }, sig: ancien.sig || null })
      return { ok: false, error: `pochette « ${nom} » : ${res.error}` }
    }
    r.pochettes[nom] = { sig, pieces: rels.length, texte: res.texte, majLe: new Date().toISOString() }
  }
  const lignes = []
  let taille = 0
  for (const [nom, p] of Object.entries(r.pochettes)) {
    const bloc = `\n═══ POCHETTE « ${nom} » (${p.pieces} pièces) ═══\n${p.texte}`
    if (taille + bloc.length > POCHETTES_DONNEES_MAX) { lignes.push(`\n═══ POCHETTE « ${nom} » (${p.pieces} pièces) ═══\n(rapport non joint faute de place — rapport_lire le donne)`); continue }
    taille += bloc.length
    lignes.push(bloc)
  }
  const res = await rediger(keys, { numero: canon, entete: `RAPPORT DU DOSSIER « ${canon} » — ${etat.rels.length} pièces en ${etat.parPochette.size} pochettes ; les RAPPORTS DE POCHETTE sont joints : rédige le rapport d'ensemble depuis eux (cotes conservées).`, donnees: lignes })
  if (!res.ok) { ecrire(keys, docKey, { ...ancien, dossier: canon, pochettes: r.pochettes, sig: ancien.sig || null }); return res }
  r.texte = res.texte
  ecrire(keys, docKey, r)
  return { ok: true, rapport: r }
}

/**
 * Assure un rapport À JOUR pour un dossier : pousse les mini-fiches qui
 * manquent (lots bornés), puis rédige si la signature a bougé. Rend
 * { pret:true, rapport } ou { pret:false, raison, fichees, pieces }.
 */
export async function assurerRapport(keys, numero, { onHold = async () => false, lotsFiches = LOTS_FICHES } = {}) {
  const canon = numeroCanonique(keys, numero)
  const docKey = docServerKey(canon)
  let etat = etatRapport(keys, docKey)
  if (!etat.rels.length) return { pret: false, raison: 'dossier sans pièce', fichees: 0, pieces: 0 }
  if (etat.aJour) return { pret: true, rapport: etat.rapport }
  if (!etat.pret) {
    if (await onHold('rapport de dossier (mini-fiches)')) return { pret: false, raison: 'différé (forfait)', fichees: etat.fichees, pieces: etat.rels.length }
    for (let i = 0; i < lotsFiches; i++) {
      let b = null
      try { b = await deps.registreFichesStep(keys, { docKey }) } catch { b = null }
      if (!b || !b.restantes) break
    }
    etat = etatRapport(keys, docKey)
    if (!etat.pret) return { pret: false, raison: 'registre incomplet', fichees: etat.fichees, pieces: etat.rels.length }
    if (etat.aJour) return { pret: true, rapport: etat.rapport }
  }
  if (await onHold('rapport de dossier')) return { pret: false, raison: 'différé (forfait)', fichees: etat.fichees, pieces: etat.rels.length }
  const res = await construireRapport(keys, canon)
  if (!res.ok) return { pret: false, raison: res.error, fichees: etat.fichees, pieces: etat.rels.length }
  return { pret: true, rapport: res.rapport }
}

/** Lecture (outil rapport_lire) : le rapport du dossier, ses pochettes, sa fraîcheur. */
export function detailRapport(keys, numero) {
  const canon = numeroCanonique(keys, numero)
  const docKey = docServerKey(canon)
  const etat = etatRapport(keys, docKey)
  if (!etat.rels.length) return { dossier: canon, erreur: 'Dossier sans pièce versée : pas de rapport possible.' }
  const r = etat.rapport
  const couverture = { pieces: etat.rels.length, fichees: etat.fichees, sansFiche: etat.rels.length - etat.fichees }
  if (!r?.texte) {
    return { dossier: canon, couverture, note: etat.pret ? 'Pas encore de rapport : il sera rédigé à l\'entretien de nuit, ou dès qu\'une interrogation au niveau « rapports » le demande.' : `Pas encore de rapport : ${couverture.sansFiche} pièce(s) attendent leur mini-fiche (le registre avance au fil de l'eau).` }
  }
  return {
    dossier: canon,
    majLe: r.majLe,
    aJour: etat.aJour,
    ...(etat.aJour ? {} : { note: 'Le registre a bougé depuis ce rapport (pièces ou fiches nouvelles) : il sera réécrit à l\'entretien de nuit ou à la prochaine interrogation « rapports ».' }),
    couverture,
    texte: r.texte,
    ...(Object.keys(r.pochettes || {}).length ? { pochettes: Object.entries(r.pochettes).map(([nom, p]) => ({ nom, pieces: p.pieces, majLe: p.majLe, texte: p.texte })) } : {}),
  }
}

/**
 * Entretien de fond (nuit) : réécrit les rapports dont la signature a bougé,
 * parmi les dossiers au registre complet — bornés par passage.
 */
export async function entretenirRapports(keys, { maxDossiers = ENTRETIEN_DOSSIERS_MAX, onHold = async () => false } = {}) {
  const docsRoot = tjDataDir(attacheTj(), 'docs')
  const bilan = { examines: 0, ecrits: 0, restants: 0, attendentFiches: 0, erreurs: 0 }
  if (!fs.existsSync(docsRoot)) return bilan
  let budget = maxDossiers
  for (const docKey of fs.readdirSync(docsRoot).sort()) {
    if (docKey.startsWith('.')) continue
    let etat
    try { etat = etatRapport(keys, docKey) } catch { continue }
    if (!etat.rels.length) continue
    bilan.examines++
    if (etat.aJour) continue
    if (!etat.pret) { bilan.attendentFiches++; continue }
    if (budget <= 0) { bilan.restants++; continue }
    if (await onHold('rapports de dossier')) { bilan.restants++; continue }
    budget--
    const numero = numeroDepuisDocKey(keys, docKey) || docKey
    try {
      const res = await construireRapport(keys, numero)
      if (res.ok) bilan.ecrits++
      else bilan.erreurs++
    } catch { bilan.erreurs++ }
  }
  return bilan
}
