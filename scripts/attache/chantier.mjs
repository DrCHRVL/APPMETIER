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
 * L'ordonnancement (nuit, forfait) est fourni PAR LE SERVICE via un rappel
 * `autorise(chantier)` : ce module ne connaît ni le gouverneur ni l'heure —
 * il exécute, journalise, persiste (état chiffré, clé globale).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { attacheDir, ensureDir, atomicWrite, readJson, listFiles, listDocsMeta, docServerKey, attacheTj } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { audit, publishFeed } from './journal.mjs'
import { numeroCanonique } from './dossier.mjs'
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

function writeChantier(keys, ch) {
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
    creeLe: ch.creeLe, majLe: ch.majLe,
    totalPieces: ch.totalPieces, totalLots: totalLots(ch), lotsFaits: lotsFaits(ch), piecesFaites: piecesFaites(ch),
    pochettes: (ch.plan || []).map((p) => ({
      nom: p.nom, pieces: p.lots.reduce((n, l) => n + l.pieces.length, 0),
      lots: p.lots.length, faits: p.lots.filter((l) => l.etat === 'fait' || l.etat === 'echec').length,
      echecs: p.lots.filter((l) => l.etat === 'echec').length,
    })),
    fiches: (ch.fiches || []).map((f) => ({ prodId: f.prodId, titre: f.titre, pochette: f.pochette })),
    syntheseProdId: ch.syntheseProdId || null,
    estimation: ch.estimation,
    journal: (ch.journal || []).slice(-12),
  }
}

/**
 * Création : fige le PLAN et calcule le DEVIS. Le chantier attend la
 * validation du magistrat (état « devis ») — rien ne se lance sans lui.
 * Type « dossier » : plan depuis l'index des PIÈCES (pochettes → lots).
 * Types « liens »/« carto » : plan depuis les FICHES des dossiers visés.
 */
export async function createChantier(keys, { type = 'dossier', numero, numeros, consigne, nuitSeulement = true }) {
  if (!['dossier', 'liens', 'carto'].includes(type)) throw new Error(`Type de chantier inconnu : ${type}`)
  if (type !== 'dossier') {
    const liste = (Array.isArray(numeros) && numeros.length ? numeros : [numero]).filter(Boolean)
    return createChantierFiches(keys, { type, numeros: liste, consigne, nuitSeulement })
  }
  const canon = numeroCanonique(keys, numero)
  if (!canon) throw new Error(`Dossier « ${numero} » introuvable`)
  const metas = listDocsMeta(attacheTj(), docServerKey(canon)).filter((d) => !String(d.rel).startsWith('MD/'))
  if (!metas.length) throw new Error('Aucune pièce déposée sous ce dossier — versez le dossier avant de lancer un chantier')

  // pochette = zone/premier-niveau (même règle que l'arborescence servie à l'IA)
  const parPochette = new Map()
  for (const d of metas) {
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

  const totalPieces = metas.length
  const nbLots = plan.reduce((n, p) => n + p.lots.length, 0)
  const ch = {
    id: crypto.randomBytes(8).toString('hex'),
    type: 'dossier',
    numero: canon,
    consigne: String(consigne || '').slice(0, 2000),
    nuitSeulement: Boolean(nuitSeulement),
    etat: 'devis',
    creeLe: new Date().toISOString(),
    plan,
    curseur: { pochette: 0, lot: 0 },
    fiches: [],
    totalPieces,
    estimation: {
      pieces: totalPieces,
      lots: nbLots,
      // fourchette grossière : ~30-60 k jetons lus/écrits par lot
      jetonsMin: nbLots * 30_000,
      jetonsMax: nbLots * 60_000,
      // ~3 min par lot, nuit de ~9 h ≈ 150 lots par nuit au mieux
      nuits: Math.max(1, Math.ceil(nbLots / 120)),
    },
    journal: [],
  }
  journal(ch, `Chantier créé — ${totalPieces} pièces, ${plan.length} pochettes, ${nbLots} lots. En attente de validation du devis.`)
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
async function createChantierFiches(keys, { type, numeros, consigne, nuitSeulement }) {
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
      nuits: Math.max(1, Math.ceil((nbLots + 1) / 120)),
    },
    journal: [],
  }
  journal(ch, `Chantier « ${type === 'liens' ? 'liens entre dossiers' : 'cartographie'} » créé — ${plan.length} dossier(s), ${totalFiches} fiches, ${nbLots} lots. En attente de validation du devis.`)
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
    try { fs.unlinkSync(chantierPath(id)) } catch {}
    await audit(keys, 'chantier_supprime', { id, numero: ch.numero, etat: ch.etat })
    return { ok: true, supprime: true }
  }
  if (action === 'lancer') {
    if (!['devis', 'pause'].includes(ch.etat)) throw new Error(`Ce chantier est « ${ch.etat} » — rien à lancer`)
    ch.etat = lotsRestants(ch) ? 'en_cours' : 'synthese'
    ch.attente = null
    journal(ch, ch.etat === 'en_cours' ? 'Devis validé — dépouillement lancé.' : 'Relancé — plus que la synthèse.')
    writeChantier(keys, ch)
    await audit(keys, 'chantier_lance', { id, numero: ch.numero })
    return resumeChantier(ch)
  }
  if (action === 'pause') {
    if (!['en_cours', 'synthese'].includes(ch.etat)) throw new Error(`Ce chantier est « ${ch.etat} » — rien à mettre en pause`)
    ch.etat = 'pause'
    ch.attente = null
    journal(ch, 'Mis en pause par le magistrat (reprise sans perte : re-cliquer « Reprendre »).')
    writeChantier(keys, ch)
    return resumeChantier(ch)
  }
  throw new Error(`Action inconnue : ${action}`)
}

function lotsRestants(ch) {
  return (ch.plan || []).some((p) => p.lots.some((l) => l.etat === 'a_faire'))
}

function prochainLot(ch) {
  for (let pi = 0; pi < ch.plan.length; pi++) {
    const p = ch.plan[pi]
    for (let li = 0; li < p.lots.length; li++) {
      if (p.lots[li].etat === 'a_faire') return { pi, li, pochette: p, lot: p.lots[li] }
    }
  }
  return null
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
  return promptConsigne(keys, 'chantier_synthese', {
    entete: [
      `SYNTHÈSE D'ANALYSE PROFONDE — dossier « ${ch.numero} ». Le dépouillement est terminé : ${ch.fiches.length} fiches factuelles couvrant ${piecesFaites(ch)} pièces, jointes ci-dessous.`,
      ch.consigne ? `ANGLE DEMANDÉ PAR LE MAGISTRAT : ${ch.consigne}` : '',
    ].filter(Boolean),
    vars: { dossier: ch.numero },
    donnees: ['', '───── FICHES ─────', fichesTexte],
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
    const ch = actifs[0]
    if (!ch) return 'rien'

    const feu = autorise(ch)
    if (!feu.ok) {
      if (ch.attente !== feu.attente) {
        ch.attente = feu.attente || 'forfait'
        journal(ch, ch.attente === 'nuit' ? 'En attente de la fenêtre de nuit.' : 'En attente : forfait saturé — reprise automatique.')
        writeChantier(keys, ch)
      }
      return 'bloque'
    }
    if (ch.attente) { ch.attente = null; writeChantier(keys, ch) }

    if (ch.etat === 'en_cours') {
      const next = prochainLot(ch)
      if (!next) {
        ch.etat = 'synthese'
        journal(ch, 'Dépouillement terminé — synthèse en préparation.')
        writeChantier(keys, ch)
        return 'travail'
      }
      await runLot(keys, ch, next)
      return 'travail'
    }
    if (ch.etat === 'synthese') {
      await runSynthese(keys, ch)
      return 'travail'
    }
    return 'rien'
  } finally {
    running = false
  }
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
    lot.echecs = (lot.echecs || 0) + 1
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
    lot.echecs = (lot.echecs || 0) + 1
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
