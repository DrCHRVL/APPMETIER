/**
 * SIRAL — Attaché de justice · CHANTIERS d'analyse profonde.
 *
 * Un chantier dépouille un dossier ENTIER (des milliers de pièces versées en
 * arborescence) en runs COURTS et BORNÉS, jamais en marathon : chaque run
 * traite UN LOT (~12 pièces d'une même pochette), produit UNE FICHE
 * FACTUELLE (chronologie, personnes, verbatims cotés, contradictions) rangée
 * dans les productions du dossier (type « fiche »), puis avance le curseur.
 *
 * Principe économique : LIRE UNE FOIS, CAPITALISER. Les fiches sont le
 * capital ; la synthèse finale et les DEUX AUTRES TYPES de chantiers lisent
 * les FICHES, jamais les pièces. Interruption gratuite : l'état = fiches
 * déjà produites + curseur — reprise exacte au tick suivant.
 *
 * Trois types :
 *  - « dossier » : dépouille les PIÈCES d'un dossier en fiches, puis synthèse ;
 *  - « liens »   : croise les FICHES de plusieurs dossiers — tables de
 *    signalements par lot, puis RAPPORT DE RECOUPEMENTS coté des deux côtés ;
 *  - « carto »   : depuis les FICHES, dépose des PROPOSITIONS carto
 *    (proposer_mec_carto / proposer_lien — le magistrat valide), puis bilan.
 * Un dossier sans fiches ne peut pas nourrir « liens »/« carto » : le devis
 * l'écarte et renvoie vers un chantier « dossier » préalable.
 *
 * DÉBIT : un pas traite une VAGUE de lots menés de front (défaut 3) — les
 * lots n'ont aucune dépendance entre eux et un run passe l'essentiel de son
 * temps à attendre le modèle. Chaque lot est réservé (« en_vol ») avant de
 * partir et rendu à faire s'il n'aboutit pas : une vague interrompue ne coûte
 * jamais plus que les lots en vol, et un arrêt brutal se rattrape au pas
 * suivant sans compter d'échec.
 *
 * L'ordonnancement (nuit, forfait) est fourni PAR LE SERVICE via un rappel
 * `autorise(chantier)` : ce module ne connaît ni le gouverneur ni l'heure —
 * il exécute, journalise, persiste (état chiffré, clé globale). Le magistrat
 * garde le dernier mot : « forcer » pose une dérogation horodatée qui lève la
 * nuit et les plafonds le temps d'une fenêtre courte.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { attacheDir, ensureDir, atomicWrite, readJson, listFiles, listDocsMeta, docServerKey, attacheTj } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { audit, publishFeed } from './journal.mjs'
import { numeroCanonique, ensureDocShas } from './dossier.mjs'
import { appendDossierMemory } from './dossierMemory.mjs'
import { saveProduction, readProduction, listProductions } from './productions.mjs'
import { runAgent, agentConfig } from './agent.mjs'
import { prompt as promptConsigne } from './consignes.mjs'

const LOT_PIECES = 12          // pièces par run — tient largement dans un contexte
const LOT_FICHES = 8           // fiches par run (chantiers « liens » et « carto »)
const LOT_INJECT_BUDGET = 240_000 // texte de fiches injecté dans un run liens/carto
const MAX_LOT_ECHECS = 3       // au 3e échec, le lot est marqué en échec et on passe
const LOT_TIMEOUT_MS = 20 * 60_000
const SYNTHESE_BUDGET_CHARS = 300_000 // fiches concaténées servies à la synthèse

// ── DÉBIT : plusieurs lots de front ──────────────────────────────────────────
// Un lot = un run Claude qui passe l'essentiel de son temps à ATTENDRE le
// modèle. Les traiter un par un laissait la machine inoccupée : un dossier de
// 1074 pièces (97 lots) demandait ~5 h de nuit pour un travail qui n'a AUCUNE
// dépendance entre lots — chaque fiche est autonome, rangée dans sa propre
// production. On en lance donc plusieurs de front, borné, et on retombe à un
// seul quand le forfait chauffe. Chaque lot persiste son résultat dès qu'il
// tombe : une vague interrompue ne coûte jamais plus que les lots en vol.
const CHANTIER_CONCURRENCE = Math.max(1, Math.min(6,
  Number(process.env.SIRAL_ATTACHE_CHANTIER_CONCURRENCE || 0) || 3))

// Durée observée d'un pas, pour le DEVIS : le magistrat doit pouvoir arbitrer
// sur un ordre de grandeur en HEURES, pas seulement en jetons et en nuits.
const MINUTES_PAR_LOT = 3      // un lot de pièces (lecture + fiche)
const MINUTES_PAR_LOT_FICHES = 1.5 // un lot de fiches déjà écrites (liens/carto)
const HEURES_PAR_NUIT = 9      // la fenêtre de nuit du service

// Dérogation « Forcer maintenant » : le magistrat lève la nuit et le forfait
// pour une fenêtre courte, puis le régime normal reprend tout seul — on ne
// laisse jamais une dérogation courir indéfiniment.
const FORCE_MS = 2 * 3600_000

/** Heures de travail estimées (arrondi au demi) pour un nombre de lots. */
function heuresEstimees(nbLots, minutesParLot, front = CHANTIER_CONCURRENCE) {
  return Math.max(0.5, Math.round((nbLots * minutesParLot / 60 / Math.max(1, front)) * 2) / 2)
}

/** La dérogation du magistrat court-elle encore ? */
export function forceActive(ch, now = Date.now()) {
  const t = Date.parse(ch?.forceJusqu || '')
  return Number.isFinite(t) && t > now
}

/**
 * Un run a-t-il échoué sur une LIMITE DE FORFAIT (et non sur son travail) ?
 * La distinction est décisive : trois refus de quota d'affilée condamnaient un
 * lot à l'état « échec » — des pièces déclarées non dépouillées alors que
 * personne ne les avait seulement ouvertes. Une limite se réessaie, elle ne
 * se compte pas comme une tentative perdue.
 */
export function estLimiteForfait(message) {
  return /rate.?limit|usage limit|quota|too many requests|overloaded|limite d.usage|\b429\b|\b529\b/i.test(String(message || ''))
}

// ── Stockage (une enveloppe chiffrée par chantier) ──
function chantierPath(id) {
  if (!/^[a-f0-9]{8,32}$/.test(String(id))) throw new Error('Identifiant de chantier invalide')
  return attacheDir('chantiers', id + '.json')
}

export function readChantier(keys, id) {
  const env = readJson(chantierPath(id), null)
  if (!env) return null
  try { return decryptJson(keys.global, env) } catch { return null }
}

// Chantiers supprimés pendant qu'une vague tournait : leurs lots en vol vont
// encore écrire en fin de course et RESSUSCITERAIENT le fichier effacé.
const supprimes = new Set()

// Le chantier dont une vague tourne EN CE MOMENT : ses écritures viennent de
// lots en vol, jamais du magistrat — c'est pour elles seules que l'état du
// disque fait foi (voir ci-dessous).
let vagueEnCours = null

function writeChantier(keys, ch) {
  if (supprimes.has(ch.id)) return
  // Le magistrat peut mettre en PAUSE pendant qu'une vague tourne : les lots
  // en vol finissent leur course (rien n'est perdu), mais leur persistance ne
  // doit pas rouvrir le chantier qu'il vient de fermer. Seules les écritures
  // de la vague sont concernées : une relance délibérée, elle, doit passer.
  if (vagueEnCours === ch.id && ['en_cours', 'synthese'].includes(ch.etat)) {
    const env = readJson(chantierPath(ch.id), null)
    let disque = null
    try { disque = env && decryptJson(keys.global, env) } catch { /* enveloppe illisible : on écrit */ }
    if (disque?.etat === 'pause') { ch.etat = 'pause'; ch.pas = []; ch.enCours = null }
  }
  ch.majLe = new Date().toISOString()
  ensureDir(attacheDir('chantiers'))
  atomicWrite(chantierPath(ch.id), JSON.stringify(encryptJson(keys.global, ch)))
}

function journal(ch, evenement) {
  ch.journal = ch.journal || []
  ch.journal.push({ date: new Date().toISOString(), evenement: String(evenement).slice(0, 300) })
  if (ch.journal.length > 200) ch.journal = ch.journal.slice(-200)
}

/** Résumés pour l'écran Chantiers (jamais le plan complet : trop lourd). */
export function listChantiers(keys) {
  const out = []
  for (const f of listFiles('chantiers')) {
    const env = readJson(attacheDir('chantiers', f.name), null)
    if (!env) continue
    let ch = null
    try { ch = decryptJson(keys.global, env) } catch { continue }
    if (!ch) continue
    out.push(resumeChantier(ch))
  }
  return out.sort((a, b) => String(b.creeLe).localeCompare(String(a.creeLe)))
}

function totalLots(ch) { return (ch.plan || []).reduce((n, p) => n + p.lots.length, 0) }
function lotsFaits(ch) { return (ch.plan || []).reduce((n, p) => n + p.lots.filter((l) => l.etat === 'fait' || l.etat === 'echec').length, 0) }
function piecesFaites(ch) { return (ch.plan || []).reduce((n, p) => n + p.lots.filter((l) => l.etat === 'fait').reduce((m, l) => m + l.pieces.length, 0), 0) }

function resumeChantier(ch) {
  return {
    id: ch.id, type: ch.type, numero: ch.numero, consigne: ch.consigne,
    numeros: ch.numeros || null, sansFiches: ch.sansFiches || [],
    etat: ch.etat, attente: ch.attente || null, nuitSeulement: Boolean(ch.nuitSeulement),
    attenteDepuis: ch.attenteDepuis || null, attenteDetail: ch.attenteDetail || null,
    forceJusqu: forceActive(ch) ? ch.forceJusqu : null,
    origine: ch.origine || 'magistrat',
    creeLe: ch.creeLe, majLe: ch.majLe,
    totalPieces: ch.totalPieces, totalLots: totalLots(ch), lotsFaits: lotsFaits(ch), piecesFaites: piecesFaites(ch),
    // dédoublonnage strict au devis : pièces déposées vs pièces à lire
    piecesDeposees: ch.piecesDeposees || ch.totalPieces,
    doublonsExclus: (ch.doublons || []).length,
    pochettes: (ch.plan || []).map((p) => ({
      nom: p.nom, pieces: p.lots.reduce((n, l) => n + l.pieces.length, 0),
      lots: p.lots.length, faits: p.lots.filter((l) => l.etat === 'fait' || l.etat === 'echec').length,
      echecs: p.lots.filter((l) => l.etat === 'echec').length,
    })),
    fiches: (ch.fiches || []).map((f) => ({ prodId: f.prodId, titre: f.titre, pochette: f.pochette })),
    syntheseProdId: ch.syntheseProdId || null,
    estimation: ch.estimation,
    // Les pas EN VOL : plusieurs lots tournent de front, le magistrat les voit tous.
    pas: pasEnCours(ch),
    enCours: pasEnCours(ch)[0] || null,
    front: CHANTIER_CONCURRENCE,
    journal: (ch.journal || []).slice(-12),
  }
}

/**
 * Les pas EN TRAIN de tourner (lots dépouillés de front, synthèse en cours) —
 * pour que le magistrat voie l'attaché travailler, pas seulement un compteur
 * figé. Les marqueurs sont posés avant chaque run et retirés après ; ceux qui
 * survivent à un redémarrage du service sont PÉRIMÉS (aucun run ne peut durer
 * plus qu'un timeout de lot) et on ne les sert pas — mieux vaut rien qu'un
 * faux « en cours ».
 */
function pasEnCours(ch) {
  if (!['en_cours', 'synthese'].includes(ch.etat)) return []
  const liste = Array.isArray(ch.pas) ? ch.pas : ch.enCours ? [ch.enCours] : []
  return liste.filter((p) => {
    const depuis = Date.parse(p?.depuis || '')
    return Number.isFinite(depuis) && Date.now() - depuis <= LOT_TIMEOUT_MS + 5 * 60_000
  })
}

/** Pose / retire le marqueur d'un pas en vol (état partagé par la vague). */
function marquerPas(keys, ch, pas) {
  ch.pas = [...(Array.isArray(ch.pas) ? ch.pas : []), pas]
  ch.enCours = ch.pas[0]
  writeChantier(keys, ch)
}
function retirerPas(keys, ch, pas) {
  ch.pas = (Array.isArray(ch.pas) ? ch.pas : []).filter((p) => p !== pas)
  ch.enCours = ch.pas[0] || null
  writeChantier(keys, ch)
}

/**
 * Création : fige le PLAN et calcule le DEVIS. Le chantier attend la
 * validation du magistrat (état « devis ») — rien ne se lance sans lui.
 * Type « dossier » : plan depuis l'index des PIÈCES (pochettes → lots).
 * Types « liens »/« carto » : plan depuis les FICHES des dossiers visés.
 */
export async function createChantier(keys, { type = 'dossier', numero, numeros, consigne, nuitSeulement = true, origine = 'magistrat' }) {
  if (!['dossier', 'liens', 'carto'].includes(type)) throw new Error(`Type de chantier inconnu : ${type}`)
  if (type !== 'dossier') {
    const liste = (Array.isArray(numeros) && numeros.length ? numeros : [numero]).filter(Boolean)
    return createChantierFiches(keys, { type, numeros: liste, consigne, nuitSeulement, origine })
  }
  const canon = numeroCanonique(keys, numero)
  if (!canon) throw new Error(`Dossier « ${numero} » introuvable`)
  const dossierKey = docServerKey(canon)
  // Empreintes sha256 du clair : complétées ICI pour tout le stock (une fois
  // par pièce, déchiffrement + hash en local, zéro jeton — quelques secondes
  // sur un très gros dossier, au moment du devis uniquement). C'est ce qui
  // permet le dédoublonnage STRICT ci-dessous.
  try { ensureDocShas(keys, dossierKey) } catch { /* sans empreintes : pas de dédoublonnage, jamais bloquant */ }
  const metas = listDocsMeta(attacheTj(), dossierKey).filter((d) => !String(d.rel).startsWith('MD/'))
  if (!metas.length) throw new Error('Aucune pièce déposée sous ce dossier — versez le dossier avant de lancer un chantier')

  // Doublons EXACTS (même empreinte — typique d'une jonction de procédures :
  // la même pièce versée dans plusieurs pochettes) : chaque contenu n'est LU
  // qu'une fois — la première pièce par ordre de chemin porte la lecture, les
  // copies sont écartées des lots et NOMMÉES (devis, synthèse). Strictement
  // identiques seulement : deux versions voisines restent deux pièces à lire.
  const porteurParSha = new Map()
  const doublons = []
  const uniques = []
  for (const d of [...metas].sort((a, b) => String(a.rel).localeCompare(String(b.rel)))) {
    const sha = String(d.sha || '')
    if (/^[a-f0-9]{64}$/.test(sha)) {
      const porteur = porteurParSha.get(sha)
      if (porteur) { doublons.push({ chemin: String(d.rel), copieDe: porteur }); continue }
      porteurParSha.set(sha, String(d.rel))
    }
    uniques.push(d)
  }

  // pochette = zone/premier-niveau (même règle que l'arborescence servie à l'IA)
  const parPochette = new Map()
  for (const d of uniques) {
    const segs = String(d.rel).split('/')
    const nom = segs.length > 2 ? segs[0] + '/' + segs[1] : segs[0]
    if (!parPochette.has(nom)) parPochette.set(nom, [])
    parPochette.get(nom).push(d.rel)
  }
  const plan = [...parPochette.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([nom, rels]) => ({
      nom,
      lots: chunk(rels.sort(), LOT_PIECES).map((pieces, i) => ({ n: i + 1, pieces, etat: 'a_faire', echecs: 0 })),
    }))

  const totalPieces = uniques.length
  const nbLots = plan.reduce((n, p) => n + p.lots.length, 0)
  const ch = {
    id: crypto.randomBytes(8).toString('hex'),
    type: 'dossier',
    numero: canon,
    consigne: String(consigne || '').slice(0, 2000),
    nuitSeulement: Boolean(nuitSeulement),
    origine: origine === 'attache' ? 'attache' : 'magistrat',
    etat: 'devis',
    creeLe: new Date().toISOString(),
    plan,
    curseur: { pochette: 0, lot: 0 },
    fiches: [],
    totalPieces,
    piecesDeposees: metas.length,
    // bornée : la liste sert au devis et à la synthèse, pas d'inventaire infini
    doublons: doublons.slice(0, 1000),
    estimation: {
      pieces: totalPieces,
      ...(doublons.length ? { doublonsExclus: doublons.length } : {}),
      lots: nbLots,
      // fourchette grossière : ~30-60 k jetons lus/écrits par lot
      jetonsMin: nbLots * 30_000,
      jetonsMax: nbLots * 60_000,
      // ~3 min par lot, nuit de ~9 h ≈ 180 lots par nuit au mieux
      heures: heuresEstimees(nbLots, MINUTES_PAR_LOT),
      nuits: Math.max(1, Math.ceil(heuresEstimees(nbLots, MINUTES_PAR_LOT) / HEURES_PAR_NUIT)),
    },
    journal: [],
  }
  journal(ch, `Chantier ${ch.origine === 'attache' ? 'proposé par l\'attaché (conversation)' : 'créé'} — ${metas.length} pièces déposées${doublons.length ? `, dont ${doublons.length} copie(s) exacte(s) écartée(s) de la lecture (empreinte identique — chaque contenu lu une fois)` : ''} : ${totalPieces} pièces à lire, ${plan.length} pochettes, ${nbLots} lots. En attente de validation du devis.`)
  writeChantier(keys, ch)
  await audit(keys, 'chantier_cree', { id: ch.id, numero: canon, pieces: totalPieces, lots: nbLots })
  return resumeChantier(ch)
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Chantiers « liens » (≥ 2 dossiers) et « carto » (≥ 1) : le plan se bâtit
 * sur les FICHES produites par les chantiers « dossier » — le capital de
 * lecture. Une « pochette » du plan = un dossier ; un lot = ~8 fiches (leurs
 * identifiants de production). Les dossiers SANS fiches sont écartés du plan
 * et nommés dans le devis : il faut d'abord les dépouiller.
 */
async function createChantierFiches(keys, { type, numeros, consigne, nuitSeulement, origine = 'magistrat' }) {
  const min = type === 'liens' ? 2 : 1
  const canons = []
  for (const n of numeros) {
    const canon = numeroCanonique(keys, n)
    if (!canon) throw new Error(`Dossier « ${n} » introuvable`)
    if (!canons.includes(canon)) canons.push(canon)
  }
  if (canons.length < min) {
    throw new Error(type === 'liens'
      ? 'Un chantier « liens » croise AU MOINS DEUX dossiers — indiquez-les tous'
      : 'Indiquez au moins un dossier')
  }

  const plan = []
  const sansFiches = []
  let totalFiches = 0
  for (const canon of canons) {
    // seules les fiches de dépouillement comptent (les productions des
    // chantiers liens/carto sont des « note » : jamais réingérées ici)
    const fiches = listProductions(keys, canon)
      .filter((p) => p.type === 'fiche')
      .sort((a, b) => String(a.titre).localeCompare(String(b.titre)))
    if (!fiches.length) { sansFiches.push(canon); continue }
    totalFiches += fiches.length
    plan.push({
      nom: canon,
      lots: chunk(fiches.map((f) => f.id), LOT_FICHES).map((pieces, i) => ({ n: i + 1, pieces, etat: 'a_faire', echecs: 0 })),
    })
  }
  if (plan.length < min) {
    throw new Error(
      `Aucune fiche d'analyse pour ${sansFiches.map((n) => `« ${n} »`).join(', ')} — les chantiers « ${type} » lisent les FICHES, jamais les pièces : lancez d'abord un chantier « dossier en détail » sur chaque dossier concerné.`
    )
  }

  const nbLots = plan.reduce((n, p) => n + p.lots.length, 0)
  const ch = {
    id: crypto.randomBytes(8).toString('hex'),
    type,
    // dossier « porteur » : les productions du chantier sont rangées dans ses
    // « Actes rédigés » (le rapport final y renvoie pour les autres dossiers)
    numero: plan[0].nom,
    numeros: plan.map((p) => p.nom),
    sansFiches,
    consigne: String(consigne || '').slice(0, 2000),
    nuitSeulement: Boolean(nuitSeulement),
    origine: origine === 'attache' ? 'attache' : 'magistrat',
    etat: 'devis',
    creeLe: new Date().toISOString(),
    plan,
    curseur: { pochette: 0, lot: 0 },
    fiches: [],
    totalPieces: totalFiches,
    estimation: {
      pieces: totalFiches,
      lots: nbLots,
      // lecture de fiches injectées (aucune pièce relue) : runs bien plus courts
      jetonsMin: (nbLots + 1) * 15_000,
      jetonsMax: (nbLots + 1) * 35_000,
      heures: heuresEstimees(nbLots + 1, MINUTES_PAR_LOT_FICHES),
      nuits: Math.max(1, Math.ceil(heuresEstimees(nbLots + 1, MINUTES_PAR_LOT_FICHES) / HEURES_PAR_NUIT)),
    },
    journal: [],
  }
  journal(ch, `Chantier « ${type === 'liens' ? 'liens entre dossiers' : 'cartographie'} » ${ch.origine === 'attache' ? 'proposé par l\'attaché (conversation)' : 'créé'} — ${plan.length} dossier(s), ${totalFiches} fiches, ${nbLots} lots. En attente de validation du devis.`)
  if (sansFiches.length) {
    journal(ch, `Écartés faute de fiches : ${sansFiches.join(' · ')} — dépouillez-les (chantier « dossier en détail ») puis recréez ce chantier pour les inclure.`)
  }
  writeChantier(keys, ch)
  await audit(keys, 'chantier_cree', { id: ch.id, type, numeros: ch.numeros, fiches: totalFiches, lots: nbLots })
  return resumeChantier(ch)
}

export async function actionChantier(keys, { id, action }) {
  const ch = readChantier(keys, id)
  if (!ch) throw new Error('Chantier introuvable')
  if (action === 'supprimer') {
    supprimes.add(String(id))
    try { fs.unlinkSync(chantierPath(id)) } catch {}
    await audit(keys, 'chantier_supprime', { id, numero: ch.numero, etat: ch.etat })
    return { ok: true, supprime: true }
  }
  if (action === 'lancer') {
    if (!['devis', 'pause'].includes(ch.etat)) throw new Error(`Ce chantier est « ${ch.etat} » — rien à lancer`)
    ch.etat = lotsRestants(ch) ? 'en_cours' : 'synthese'
    ch.attente = null
    ch.attenteDepuis = null
    ch.attenteDetail = null
    journal(ch, ch.etat === 'en_cours' ? 'Devis validé — dépouillement lancé.' : 'Relancé — plus que la synthèse.')
    writeChantier(keys, ch)
    await audit(keys, 'chantier_lance', { id, numero: ch.numero })
    return resumeChantier(ch)
  }
  // « Forcer maintenant » — le geste qui manquait. Un chantier validé pouvait
  // rester des nuits entières à « en attente » sans que le magistrat ait le
  // moindre moyen de passer outre : ni la fenêtre de nuit, ni un plafond de
  // forfait ESTIMÉ ne se laissaient contredire. La dérogation lève les deux,
  // pour une fenêtre courte et journalisée — après quoi le régime normal
  // reprend seul. Elle vaut aussi validation du devis : un seul clic suffit.
  if (action === 'forcer') {
    if (ch.etat === 'termine') throw new Error('Ce chantier est terminé')
    if (['devis', 'pause'].includes(ch.etat)) ch.etat = lotsRestants(ch) ? 'en_cours' : 'synthese'
    ch.forceJusqu = new Date(Date.now() + FORCE_MS).toISOString()
    ch.attente = null
    ch.attenteDepuis = null
    ch.attenteDetail = null
    journal(ch, `Forcé par le magistrat — nuit et plafonds levés pendant ${Math.round(FORCE_MS / 3600_000)} h, le dépouillement démarre immédiatement.`)
    writeChantier(keys, ch)
    await audit(keys, 'chantier_force', { id, numero: ch.numero, jusqu: ch.forceJusqu })
    return resumeChantier(ch)
  }
  if (action === 'pause') {
    if (!['en_cours', 'synthese'].includes(ch.etat)) throw new Error(`Ce chantier est « ${ch.etat} » — rien à mettre en pause`)
    ch.etat = 'pause'
    ch.attente = null
    ch.attenteDepuis = null
    ch.attenteDetail = null
    ch.forceJusqu = null
    ch.enCours = null
    ch.pas = []
    journal(ch, 'Mis en pause par le magistrat (reprise sans perte : re-cliquer « Reprendre »).')
    writeChantier(keys, ch)
    return resumeChantier(ch)
  }
  throw new Error(`Action inconnue : ${action}`)
}

function lotsRestants(ch) {
  // « en_vol » = réservé par une vague en cours : du travail restant, pas du
  // travail fait. L'oublier enverrait le chantier en synthèse alors que des
  // pièces sont encore en train d'être lues.
  return (ch.plan || []).some((p) => p.lots.some((l) => l.etat === 'a_faire' || l.etat === 'en_vol'))
}

/** Les `n` prochains lots à faire, dans l'ordre du plan (pochette par pochette). */
function prochainsLots(ch, n = 1) {
  const out = []
  for (let pi = 0; pi < ch.plan.length && out.length < n; pi++) {
    const p = ch.plan[pi]
    for (let li = 0; li < p.lots.length && out.length < n; li++) {
      if (p.lots[li].etat === 'a_faire') out.push({ pi, li, pochette: p, lot: p.lots[li] })
    }
  }
  return out
}

// ── Prompts ──
// Le format de fiche est LE contrat : factuel, sourcé, sans opinion. La
// sortie finale du run EST la fiche — le moteur l'enregistre lui-même
// (aucune porte de qualité d'acte : une fiche n'est pas un acte).
// Le TEXTE des instructions vit dans consignes.mjs (socles « chantier_* ») :
// le magistrat le lit, le complète ou le remplace depuis Paramètres → Attaché
// IA. Ici on ne bâtit plus que l'ENTÊTE (dossier, pochette, lot, angle) et les
// DONNÉES jointes (pièces, corpus de fiches) — jamais réglables, sous peine de
// couper le contexte du run.
function promptLot(keys, ch, pochette, lot) {
  return promptConsigne(keys, 'chantier_fiche', {
    entete: [
      `CHANTIER D'ANALYSE PROFONDE — dossier « ${ch.numero} », pochette « ${pochette.nom} », lot ${lot.n} (${lot.pieces.length} pièces).`,
      ch.consigne ? `ANGLE DEMANDÉ PAR LE MAGISTRAT (à garder en tête, sans exclure le reste) : ${ch.consigne}` : '',
    ].filter(Boolean),
    vars: { dossier: ch.numero, pochette: pochette.nom, lot: lot.n },
    donnees: ['', '───── PIÈCES DU LOT ─────', lot.pieces.map((r) => `- ${r}`).join('\n')],
  })
}

function promptSynthese(keys, ch, fichesTexte) {
  const doublons = ch.doublons || []
  return promptConsigne(keys, 'chantier_synthese', {
    entete: [
      `SYNTHÈSE D'ANALYSE PROFONDE — dossier « ${ch.numero} ». Le dépouillement est terminé : ${ch.fiches.length} fiches factuelles couvrant ${piecesFaites(ch)} pièces, jointes ci-dessous.`,
      doublons.length ? `${doublons.length} pièce(s) au contenu STRICTEMENT identique à une pièce lue (empreinte sha256 égale) n'ont pas été relues — leur liste est jointe : mentionne-les en fin de synthèse (« copies exactes ») pour que la couverture soit claire.` : '',
      ch.consigne ? `ANGLE DEMANDÉ PAR LE MAGISTRAT : ${ch.consigne}` : '',
    ].filter(Boolean),
    vars: { dossier: ch.numero },
    donnees: [
      '',
      ...(doublons.length ? [
        '───── COPIES EXACTES NON RELUES ─────',
        doublons.slice(0, 200).map((d) => `- ${d.chemin} = copie exacte de ${d.copieDe}`).join('\n'),
        ...(doublons.length > 200 ? [`… et ${doublons.length - 200} autre(s) copie(s)`] : []),
        '',
      ] : []),
      '───── FICHES ─────', fichesTexte,
    ],
  })
}

/**
 * Corpus d'un lot de fiches (liens/carto) : les productions lues et bornées,
 * équitablement par fiche. Les runs reçoivent le TEXTE — zéro outil de
 * lecture, zéro pièce relue.
 */
function corpusFiches(keys, dossier, prodIds, budget = LOT_INJECT_BUDGET) {
  const parts = []
  let absentes = 0
  for (const id of prodIds) {
    const p = readProduction(keys, dossier, id)
    if (p?.contenu) parts.push({ titre: p.titre || id, texte: String(p.contenu) })
    else absentes++
  }
  const parFiche = Math.max(3_000, Math.floor(budget / Math.max(1, parts.length)))
  const corpus = parts.map((p) => `\n\n═══ ${p.titre} ═══\n${p.texte.slice(0, parFiche)}`).join('')
  return { corpus, nb: parts.length, absentes }
}

// Lot « liens » : depuis les fiches d'UN dossier, une table de signalements
// normalisée — la matière première du rapport de recoupements final.
function promptLotLiens(keys, ch, dossier, lot, corpus) {
  return promptConsigne(keys, 'chantier_liens_lot', {
    entete: [
      `CHANTIER « LIENS ENTRE DOSSIERS » — croisement de ${ch.numeros.length} dossiers : ${ch.numeros.join(' · ')}.`,
      `Ce run traite le lot ${lot.n} du dossier « ${dossier} » : ses fiches d'analyse sont jointes ci-dessous.`,
      ch.consigne ? `ANGLE DEMANDÉ PAR LE MAGISTRAT : ${ch.consigne}` : '',
    ].filter(Boolean),
    vars: { dossier, lot: lot.n },
    donnees: [
      '',
      `TITRE EXACT DE TA TABLE (première ligne de ta réponse) : « ## Signalements — ${dossier} — lot ${lot.n} ».`,
      '',
      '───── FICHES DU LOT ─────',
      corpus,
    ],
  })
}

// Lot « carto » : depuis les fiches, des PROPOSITIONS (jamais d'écriture
// directe) — le magistrat valide une à une depuis l'app.
function promptLotCarto(keys, ch, dossier, lot, corpus) {
  return promptConsigne(keys, 'chantier_carto_lot', {
    entete: [
      `CHANTIER « CARTOGRAPHIE » — alimenter la cartographie du contentieux depuis les fiches d'analyse du dossier « ${dossier} » (lot ${lot.n}).`,
      ch.consigne ? `ANGLE DEMANDÉ PAR LE MAGISTRAT : ${ch.consigne}` : '',
    ].filter(Boolean),
    vars: { dossier, lot: lot.n },
    donnees: [
      '',
      `TITRE EXACT DE TON COMPTE RENDU (première ligne de ta réponse) : « ## Carto — ${dossier} — lot ${lot.n} ».`,
      '',
      '───── FICHES DU LOT ─────',
      corpus,
    ],
  })
}

function promptSyntheseLiens(keys, ch, corpus) {
  return promptConsigne(keys, 'chantier_liens_rapport', {
    entete: [
      `RAPPORT DE RECOUPEMENTS — croisement des dossiers ${ch.numeros.join(' · ')}. Les tables de signalements dressées lot par lot depuis les fiches de chaque dossier sont jointes ci-dessous.`,
      ch.consigne ? `ANGLE DEMANDÉ PAR LE MAGISTRAT : ${ch.consigne}` : '',
    ].filter(Boolean),
    donnees: ['', '───── TABLES DE SIGNALEMENTS ─────', corpus],
  })
}

function promptSyntheseCarto(keys, ch, corpus) {
  return promptConsigne(keys, 'chantier_carto_bilan', {
    entete: [
      `BILAN DE CARTOGRAPHIE — dossier(s) ${ch.numeros.join(' · ')}. Les comptes rendus des lots (propositions déposées) sont joints ci-dessous.`,
      ch.consigne ? `ANGLE DEMANDÉ PAR LE MAGISTRAT : ${ch.consigne}` : '',
    ].filter(Boolean),
    donnees: ['', '───── COMPTES RENDUS DES LOTS ─────', corpus],
  })
}

// ── Exécution ──
let running = false

/**
 * Un pas de chantier par appel : le prochain lot du premier chantier actif,
 * ou sa synthèse. Le SERVICE l'appelle en boucle tant que `autorise` le
 * permet — chaque pas persiste tout avant de rendre la main.
 * @param {(ch) => {ok: boolean, attente?: 'nuit'|'forfait'}} autorise
 * @returns {Promise<'travail'|'rien'|'bloque'>}
 */
export async function chantierStep(keys, autorise) {
  if (running) return 'rien'
  running = true
  try {
    const actifs = listFiles('chantiers')
      .map((f) => { try { return decryptJson(keys.global, readJson(attacheDir('chantiers', f.name), null)) } catch { return null } })
      .filter((ch) => ch && ['en_cours', 'synthese'].includes(ch.etat))
      .sort((a, b) => String(a.creeLe).localeCompare(String(b.creeLe)))
    if (!actifs.length) return 'rien'

    // Un chantier bloqué ne bloque plus les AUTRES. L'ancien code ne regardait
    // que le plus ancien : un chantier « nuit seulement » gelait en plein jour
    // tous les chantiers de jour derrière lui. On note l'attente de chacun et
    // on travaille sur le premier qui a le feu vert.
    let ch = null
    let feu = null
    for (const cand of actifs) {
      const verdict = autorise(cand) || { ok: false }
      if (verdict.ok) { ch = cand; feu = verdict; break }
      noterAttente(keys, cand, verdict)
    }
    if (!ch) return 'bloque'

    if (ch.attente || ch.attenteDetail) {
      ch.attente = null
      ch.attenteDepuis = null
      ch.attenteDetail = null
      writeChantier(keys, ch)
    }

    if (ch.etat === 'en_cours') {
      // Reprise après un arrêt brutal : aucune vague ne tourne à cet instant
      // (verrou `running`), donc tout lot resté « en_vol » est un orphelin de
      // redémarrage — il repart à faire, sans compter d'échec.
      let orphelins = 0
      for (const p of ch.plan) for (const l of p.lots) if (l.etat === 'en_vol') { l.etat = 'a_faire'; orphelins++ }
      if (orphelins) {
        journal(ch, `Reprise après arrêt : ${orphelins} lot(s) interrompu(s) remis à faire (aucune tentative comptée).`)
        ch.pas = []
        ch.enCours = null
        writeChantier(keys, ch)
      }

      const front = Math.max(1, Math.min(CHANTIER_CONCURRENCE, Number(feu?.front) || CHANTIER_CONCURRENCE))
      const vague = prochainsLots(ch, front)
      if (!vague.length) {
        ch.etat = 'synthese'
        journal(ch, 'Dépouillement terminé — synthèse en préparation.')
        writeChantier(keys, ch)
        return 'travail'
      }
      // Les lots sont réservés AVANT la vague : deux lots ne peuvent pas partir
      // sur les mêmes pièces, et un arrêt en cours de vague se rattrape seul.
      for (const v of vague) v.lot.etat = 'en_vol'
      if (vague.length > 1) journal(ch, `Vague de ${vague.length} lots lancés de front.`)
      writeChantier(keys, ch)

      vagueEnCours = ch.id
      try {
        await Promise.all(vague.map(async (next) => {
        // Marqueur du pas en cours : posé AVANT le run (le panneau le lit tout
        // de suite), retiré quoi qu'il arrive — succès, échec ou timeout.
        const pas = {
          etape: 'lot',
          pochette: next.pochette.nom,
          lot: next.lot.n,
          pieces: next.lot.pieces.length,
          tentative: (next.lot.echecs || 0) + 1,
          depuis: new Date().toISOString(),
        }
        marquerPas(keys, ch, pas)
        try {
          await runLot(keys, ch, next)
        } catch (e) {
          // Un lot qui explose ne doit jamais emporter la vague ni rester réservé.
          if (next.lot.etat === 'en_vol') next.lot.etat = 'a_faire'
          journal(ch, `Lot ${next.lot.n} de « ${next.pochette.nom} » : ${String(e?.message || e).slice(0, 120)} — repris au prochain pas.`)
        } finally {
          retirerPas(keys, ch, pas)
        }
        }))
      } finally {
        vagueEnCours = null
      }
      return 'travail'
    }
    if (ch.etat === 'synthese') {
      const pas = { etape: 'synthese', fiches: (ch.fiches || []).length, depuis: new Date().toISOString() }
      marquerPas(keys, ch, pas)
      vagueEnCours = ch.id
      try {
        await runSynthese(keys, ch)
      } finally {
        vagueEnCours = null
        retirerPas(keys, ch, pas)
      }
      return 'travail'
    }
    return 'rien'
  } finally {
    running = false
  }
}

/**
 * Journalise POURQUOI un chantier n'avance pas — et ne le réécrit que quand
 * la raison change. Le magistrat lisait « en attente : forfait saturé » sans
 * jamais savoir de quel plafond il s'agissait ni quand cela reprendrait ;
 * le détail (jauges, prochaine fenêtre) est désormais servi à l'écran.
 */
function noterAttente(keys, ch, verdict) {
  const attente = verdict.attente || 'forfait'
  const detail = verdict.detail || null
  if (ch.attente === attente && ch.attenteDetail === detail) return
  // « Depuis » compte l'attente POUR CE MOTIF : passer de la nuit au forfait
  // ouvre une nouvelle attente, pas la suite de la précédente.
  const memeMotif = ch.attente === attente
  ch.attente = attente
  ch.attenteDetail = detail
  ch.attenteDepuis = memeMotif && ch.attenteDepuis ? ch.attenteDepuis : new Date().toISOString()
  journal(ch, attente === 'nuit'
    ? `En attente de la fenêtre de nuit${detail ? ` — ${detail}` : ''}.`
    : `En attente : forfait saturé${detail ? ` — ${detail}` : ''} — reprise automatique.`)
  writeChantier(keys, ch)
}

/**
 * Un run refusé par une LIMITE DE FORFAIT n'est pas un lot raté : rien n'a été
 * lu, rien n'a été jugé. On rend le lot à faire SANS compter de tentative et
 * on met le chantier en attente — sinon trois refus de quota d'affilée
 * marquaient douze pièces « non dépouillées » que personne n'avait ouvertes.
 * @returns {boolean} true si l'échec était une limite (le lot est réarmé).
 */
function echecDeForfait(keys, ch, lot, ou, erreur) {
  if (!estLimiteForfait(erreur)) return false
  lot.etat = 'a_faire'
  const motif = `Lot ${lot.n} de « ${ou} » : refusé par une limite du forfait — remis à faire, aucune tentative comptée.`
  const dernier = (ch.journal || [])[ch.journal.length - 1]
  if (!dernier || dernier.evenement !== motif) journal(ch, motif)
  ch.attente = 'forfait'
  ch.attenteDepuis = ch.attenteDepuis || new Date().toISOString()
  writeChantier(keys, ch)
  return true
}

async function runLot(keys, ch, { pochette, lot }) {
  if (ch.type === 'liens' || ch.type === 'carto') return runLotFiches(keys, ch, { pochette, lot })
  const cfg = agentConfig()
  const titre = `Fiche — ${pochette.nom} — lot ${lot.n} (${lot.pieces.length} pièces)`
  const res = await runAgent({
    keys,
    prompt: promptLot(keys, ch, pochette, lot),
    runLabel: 'chantier',
    title: `Chantier ${ch.numero} · ${titre}`,
    // fiches = extraction : le modèle des sous-agents (souvent plus économe) s'il est réglé
    model: cfg.subModel || undefined,
    effort: 'high',
    maxTurns: Math.max(30, lot.pieces.length * 3 + 6),
    timeoutMs: LOT_TIMEOUT_MS,
    mcpToolTimeoutMs: LOT_TIMEOUT_MS - 120_000,
  }).catch((e) => ({ ok: false, error: String(e?.message || e), text: '' }))

  const fiche = String(res?.text || '').trim()
  if (!res?.ok || fiche.length < 200 || !/##/.test(fiche)) {
    if (echecDeForfait(keys, ch, lot, pochette.nom, res?.error)) return
    lot.echecs = (lot.echecs || 0) + 1
    lot.etat = 'a_faire'
    if (lot.echecs >= MAX_LOT_ECHECS) {
      lot.etat = 'echec'
      journal(ch, `Lot ${lot.n} de « ${pochette.nom} » en ÉCHEC après ${lot.echecs} tentatives (${res?.error || 'fiche invalide'}) — pièces non dépouillées, signalées dans la synthèse.`)
    } else {
      journal(ch, `Lot ${lot.n} de « ${pochette.nom} » : tentative ${lot.echecs} échouée (${res?.error || 'fiche invalide'}) — nouvel essai au prochain pas.`)
    }
    writeChantier(keys, ch)
    return
  }

  const prod = await saveProduction(keys, {
    numero: ch.numero, type: 'fiche', titre,
    contenu: fiche, source: `chantier:${ch.id}`,
  })
  lot.etat = 'fait'
  ch.fiches.push({ pochette: pochette.nom, lot: lot.n, prodId: prod.id, titre })
  journal(ch, `${titre} — produite.`)

  // pochette terminée : un jalon au fil + la mémoire du dossier (une ligne)
  if (pochette.lots.every((l) => l.etat === 'fait' || l.etat === 'echec')) {
    const nbPieces = pochette.lots.reduce((n, l) => n + l.pieces.length, 0)
    const nbEchecs = pochette.lots.filter((l) => l.etat === 'echec').length
    const resume = `Chantier ${ch.numero} : pochette « ${pochette.nom} » dépouillée — ${nbPieces} pièces, ${pochette.lots.length} fiche(s)${nbEchecs ? `, ${nbEchecs} lot(s) en échec` : ''}.`
    await publishFeed(keys, { type: 'note', titre: `Chantier — pochette « ${pochette.nom} » terminée`, resume }).catch(() => {})
    await appendDossierMemory(keys, ch.numero, `[chantier] ${resume} Fiches dans « Actes rédigés » (type Fiche).`).catch(() => {})
  }
  writeChantier(keys, ch)
}

/**
 * Un lot « liens »/« carto » : les fiches du lot sont LUES ICI et injectées
 * dans le prompt — le run ne relit rien. « liens » rend une table de
 * signalements (aucun outil) ; « carto » dépose des propositions
 * (proposer_mec_carto / proposer_lien) et rend son compte rendu. Les deux
 * sont rangés en production type « note » (le type « fiche » reste réservé
 * au capital de dépouillement) sous le dossier porteur du chantier.
 */
async function runLotFiches(keys, ch, { pochette, lot }) {
  const cfg = agentConfig()
  const dossier = pochette.nom
  const { corpus, nb, absentes } = corpusFiches(keys, dossier, lot.pieces)
  if (!nb) {
    lot.etat = 'echec'
    journal(ch, `Lot ${lot.n} de « ${dossier} » : fiches introuvables (supprimées entre-temps ?) — lot abandonné.`)
    writeChantier(keys, ch)
    return
  }
  if (absentes) journal(ch, `Lot ${lot.n} de « ${dossier} » : ${absentes} fiche(s) introuvable(s), lot traité sans elles.`)

  const titre = ch.type === 'liens'
    ? `Signalements — ${dossier} — lot ${lot.n}`
    : `Carto — ${dossier} — lot ${lot.n}`
  const res = await runAgent({
    keys,
    prompt: ch.type === 'liens' ? promptLotLiens(keys, ch, dossier, lot, corpus) : promptLotCarto(keys, ch, dossier, lot, corpus),
    runLabel: 'chantier',
    title: `Chantier ${ch.type} · ${titre}`,
    model: cfg.subModel || undefined,
    effort: 'high',
    // liens : zéro outil ; carto : quelques recoupements + dépôts de propositions
    maxTurns: ch.type === 'carto' ? 40 : 6,
    timeoutMs: LOT_TIMEOUT_MS,
    mcpToolTimeoutMs: LOT_TIMEOUT_MS - 120_000,
  }).catch((e) => ({ ok: false, error: String(e?.message || e), text: '' }))

  const texte = String(res?.text || '').trim()
  if (!res?.ok || texte.length < 80 || !/##/.test(texte)) {
    if (echecDeForfait(keys, ch, lot, dossier, res?.error)) return
    lot.echecs = (lot.echecs || 0) + 1
    lot.etat = 'a_faire'
    if (lot.echecs >= MAX_LOT_ECHECS) {
      lot.etat = 'echec'
      journal(ch, `Lot ${lot.n} de « ${dossier} » en ÉCHEC après ${lot.echecs} tentatives (${res?.error || 'rendu invalide'}) — signalé dans le rapport final.`)
    } else {
      journal(ch, `Lot ${lot.n} de « ${dossier} » : tentative ${lot.echecs} échouée (${res?.error || 'rendu invalide'}) — nouvel essai au prochain pas.`)
    }
    writeChantier(keys, ch)
    return
  }

  const prod = await saveProduction(keys, {
    numero: ch.numero, type: 'note', titre,
    contenu: texte, source: `chantier:${ch.id}`,
  })
  lot.etat = 'fait'
  ch.fiches.push({ pochette: dossier, lot: lot.n, prodId: prod.id, titre })
  journal(ch, `${titre} — produit.`)
  writeChantier(keys, ch)
}

async function runSynthese(keys, ch) {
  if (ch.type === 'liens' || ch.type === 'carto') return runSyntheseFiches(keys, ch)
  // les fiches, bornées : si trop volumineuses, on tronque équitablement par fiche
  const textes = []
  for (const f of ch.fiches) {
    const p = readProduction(keys, ch.numero, f.prodId)
    if (p?.contenu) textes.push(`\n\n═══ ${f.titre} ═══\n${p.contenu}`)
  }
  const parFiche = Math.max(4_000, Math.floor(SYNTHESE_BUDGET_CHARS / Math.max(1, textes.length)))
  const corpus = textes.map((t) => t.slice(0, parFiche)).join('')

  const res = await runAgent({
    keys,
    prompt: promptSynthese(keys, ch, corpus),
    runLabel: 'chantier',
    title: `Chantier ${ch.numero} · synthèse`,
    effort: 'high', // modèle principal (réglage du panneau) : c'est ici que la qualité paie
    maxTurns: 8,
    timeoutMs: LOT_TIMEOUT_MS,
    mcpToolTimeoutMs: LOT_TIMEOUT_MS - 120_000,
  }).catch((e) => ({ ok: false, error: String(e?.message || e), text: '' }))

  const note = String(res?.text || '').trim()
  if (!res?.ok || note.length < 400) {
    ch.syntheseEchecs = (ch.syntheseEchecs || 0) + 1
    journal(ch, `Synthèse : tentative ${ch.syntheseEchecs} échouée (${res?.error || 'note trop courte'}).`)
    if (ch.syntheseEchecs >= MAX_LOT_ECHECS) {
      ch.etat = 'termine'
      journal(ch, 'Synthèse abandonnée après 3 échecs — les fiches restent exploitables ; relancez une synthèse en supprimant/relançant le chantier ou via le chat du dossier.')
    }
    writeChantier(keys, ch)
    return
  }

  const prod = await saveProduction(keys, {
    numero: ch.numero, type: 'note',
    titre: `Synthèse d'analyse profonde — ${ch.numero}`,
    contenu: note, source: `chantier:${ch.id}`,
  })
  ch.syntheseProdId = prod.id
  ch.etat = 'termine'
  journal(ch, 'Synthèse produite — chantier terminé.')
  writeChantier(keys, ch)
  const nbEchecs = (ch.plan || []).reduce((n, p) => n + p.lots.filter((l) => l.etat === 'echec').length, 0)
  await publishFeed(keys, {
    type: 'note',
    titre: `Chantier terminé — ${ch.numero}`,
    resume: `${piecesFaites(ch)} pièces dépouillées, ${ch.fiches.length} fiches, synthèse déposée dans « Actes rédigés »${nbEchecs ? ` · ${nbEchecs} lot(s) en échec (voir journal du chantier)` : ''}.`,
  }).catch(() => {})
  await appendDossierMemory(keys, ch.numero, `[chantier] Dépouillement complet terminé (${ch.fiches.length} fiches + synthèse « Synthèse d'analyse profonde »). S'appuyer sur les fiches, jamais relire les pièces en masse.`).catch(() => {})
  await audit(keys, 'chantier_termine', { id: ch.id, numero: ch.numero, fiches: ch.fiches.length, echecs: nbEchecs })
}

/**
 * Synthèse des chantiers « liens » (rapport de recoupements coté des deux
 * côtés) et « carto » (bilan des propositions déposées). Lit les productions
 * des lots, jamais les fiches d'origine ni les pièces. Le résultat vit dans
 * les « Actes rédigés » du dossier porteur ; chaque dossier croisé reçoit la
 * ligne de mémoire qui y renvoie.
 */
async function runSyntheseFiches(keys, ch) {
  const textes = []
  for (const f of ch.fiches) {
    const p = readProduction(keys, ch.numero, f.prodId)
    if (p?.contenu) textes.push(`\n\n═══ ${f.titre} ═══\n${p.contenu}`)
  }
  const parLot = Math.max(4_000, Math.floor(SYNTHESE_BUDGET_CHARS / Math.max(1, textes.length)))
  const corpus = textes.map((t) => t.slice(0, parLot)).join('')

  const res = await runAgent({
    keys,
    prompt: ch.type === 'liens' ? promptSyntheseLiens(keys, ch, corpus) : promptSyntheseCarto(keys, ch, corpus),
    runLabel: 'chantier',
    title: `Chantier ${ch.type} · ${ch.type === 'liens' ? 'rapport de recoupements' : 'bilan carto'}`,
    effort: 'high', // modèle principal : c'est ici que la qualité paie
    maxTurns: 8,
    timeoutMs: LOT_TIMEOUT_MS,
    mcpToolTimeoutMs: LOT_TIMEOUT_MS - 120_000,
  }).catch((e) => ({ ok: false, error: String(e?.message || e), text: '' }))

  const note = String(res?.text || '').trim()
  if (!res?.ok || note.length < 300) {
    ch.syntheseEchecs = (ch.syntheseEchecs || 0) + 1
    journal(ch, `${ch.type === 'liens' ? 'Rapport' : 'Bilan'} : tentative ${ch.syntheseEchecs} échouée (${res?.error || 'rendu trop court'}).`)
    if (ch.syntheseEchecs >= MAX_LOT_ECHECS) {
      ch.etat = 'termine'
      journal(ch, `${ch.type === 'liens' ? 'Rapport' : 'Bilan'} abandonné après 3 échecs — les productions des lots restent exploitables dans « Actes rédigés ».`)
    }
    writeChantier(keys, ch)
    return
  }

  const titre = ch.type === 'liens'
    ? `Rapport de recoupements — ${ch.numeros.join(' × ')}`
    : `Bilan cartographie — ${ch.numeros.join(' × ')}`
  const prod = await saveProduction(keys, {
    numero: ch.numero, type: 'note', titre,
    contenu: note, source: `chantier:${ch.id}`,
  })
  ch.syntheseProdId = prod.id
  ch.etat = 'termine'
  journal(ch, `${ch.type === 'liens' ? 'Rapport de recoupements produit' : 'Bilan de cartographie produit'} — chantier terminé.`)
  writeChantier(keys, ch)

  const nbEchecs = (ch.plan || []).reduce((n, p) => n + p.lots.filter((l) => l.etat === 'echec').length, 0)
  await publishFeed(keys, {
    type: 'note',
    titre: `Chantier terminé — ${ch.type === 'liens' ? 'recoupements' : 'cartographie'}`,
    resume: `${ch.numeros.join(' × ')} : ${ch.fiches.length} lot(s) traités, ${ch.type === 'liens' ? 'rapport de recoupements' : 'bilan'} déposé dans « Actes rédigés » de ${ch.numero}${ch.type === 'carto' ? ' — propositions à valider (Proposition à valider / Cartographie)' : ''}${nbEchecs ? ` · ${nbEchecs} lot(s) en échec (voir journal du chantier)` : ''}.`,
  }).catch(() => {})
  for (const n of ch.numeros) {
    await appendDossierMemory(keys, n, `[chantier] Chantier « ${ch.type} » terminé (${ch.numeros.join(' · ')}) — « ${titre} » dans les Actes rédigés de ${ch.numero}.`).catch(() => {})
  }
  await audit(keys, 'chantier_termine', { id: ch.id, type: ch.type, numeros: ch.numeros, lots: ch.fiches.length, echecs: nbEchecs })
}

/** Un chantier actif existe-t-il ? (pour la boucle du service — comptage gratuit) */
export function chantierActif(keys) {
  return listFiles('chantiers').some((f) => {
    try {
      const ch = decryptJson(keys.global, readJson(attacheDir('chantiers', f.name), null))
      return ch && ['en_cours', 'synthese'].includes(ch.etat)
    } catch { return false }
  })
}
