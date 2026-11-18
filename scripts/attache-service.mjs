#!/usr/bin/env node
/**
 * SIRAL — Attaché de justice · service (sidecar).
 *
 * SEUL processus détenteur de la clé-maître : l'app web ne voit jamais une
 * clé de l'attaché. Il assure :
 *  - la relève périodique de la boîte dédiée (IMAP) ;
 *  - les runs PROACTIFS : chaque mail transféré déclenche l'agent, qui
 *    qualifie, rapproche du dossier, agit dans SIRAL, prépare les projets
 *    et alimente le fil « pendant votre absence » ;
 *  - une API HTTP INTERNE (réseau docker uniquement, jamais publiée) pour
 *    l'app Next : chat streaming, remise/révocation du trousseau, statut.
 *
 * Authentification interne : en-tête X-Attache-Secret (SIRAL_ATTACHE_BRIDGE_SECRET,
 * à défaut dérivé de SIRAL_SECRET).
 */
import http from 'node:http'
import crypto from 'node:crypto'
import { loadMasterKey } from './attache/crypto.mjs'
import { loadKeyring, grantKeyring, revokeKeyring, keyringStatus, allowedScopes } from './attache/keyring.mjs'
import { handleConnectorMessage } from './attache-mcp.mjs'
import { attacheTj, docServerKey, attacheContentieux, readState, writeState, fixSharedPermissions, writeCollectionEnvelopeRaw, deleteCollectionEnvelopeRaw, writeSingleEnvelopeRaw, setStatusMapEntryRaw } from './attache/store.mjs'
import { audit, publishFeed } from './attache/journal.mjs'
import { inNightWindow, feuRecoupements, RECOUP_JOUR } from './attache/ordonnancement.mjs'
import { writeClaudeToken, clearClaudeToken, clearAuthFailure } from './attache/claudeAuth.mjs'
import { runAgent, checkClaudeCli, testClaudeAuth, agentConfig, sanitizeModel, sanitizeEffort, sanitizePlan, sanitizeCap, sanitizeSignature } from './attache/agent.mjs'
import { usageSummary } from './attache/usage.mjs'
import { saveArchitecture, buildChronologie } from './attache/cotes.mjs'
import { entretenirFichiersGlobaux } from './attache/global.mjs'
import { loadContentieux, numeroCanonique } from './attache/dossier.mjs'
import { donneesDescription, couverturePieces, estimerTotalMs, estimerRedactionMs, observerRedaction, avancement } from './attache/description.mjs'
import { ingestPass } from './attache/ingest.mjs'
import { passeRecoupements, dernierResultat } from './attache/recoupements.mjs'
import { registreFichesStep } from './attache/registre.mjs'
import { versementsStep } from './attache/versement.mjs'
import { interrogationsStep } from './attache/interrogation.mjs'
import { entretenirRapports } from './attache/rapport.mjs'
import { enfiler as fluxEnfiler, balayer as fluxBalayer, pomper as fluxPomper, fileAttente as fluxFileAttente, FLUX_QUIET_MS } from './attache/flux.mjs'
import { listPropositions, decideProposition } from './attache/propositions.mjs'
import { lirePieceEntraide, sauverLecture, lireLectures } from './attache/entraideAnalyse.mjs'
import { classerTrames, classerKb, classerSkills } from './attache/classer.mjs'
import { runSubagents } from './attache/subagents.mjs'
import { consumptionGovernor } from './attache/budget.mjs'
import { prompt as promptConsigne, catalogueAvecSocles, SOCLES } from './attache/consignes.mjs'

const PORT = Number(process.env.SIRAL_ATTACHE_PORT || 8787)
const POLL_MINUTES = Math.max(1, Number(process.env.SIRAL_ATTACHE_POLL_MIN || 5))

// ── Suivi d'activité (le « gestionnaire des tâches » côté service) ──
// Chaque travail de fond consigne ici son état : en cours / dernière durée /
// dernier bilan. Exposé par GET /activite ; sans clé ni contenu d'enquête —
// seulement des noms de travaux, des durées et des compteurs.
const activites = {}
const SERVICE_DEMARRE_A = new Date().toISOString()

async function traque(nom, libelle, fn) {
  const a = activites[nom] || (activites[nom] = { nom, libelle })
  if (a.enCours) { await fn(); return } // déjà suivi par l'appel en cours
  a.enCours = true
  a.debutAt = new Date().toISOString()
  a.erreur = null
  try {
    await fn()
  } catch (e) {
    a.erreur = String(e?.message || e)
    throw e
  } finally {
    a.enCours = false
    a.finAt = new Date().toISOString()
    a.dureeMs = Date.parse(a.finAt) - Date.parse(a.debutAt)
  }
}

// Retard de l'event loop : la mesure de santé du service — un retard élevé
// signifie que quelque chose (extraction, hash, gros JSON) le bloque.
import { monitorEventLoopDelay } from 'node:perf_hooks'
const bouclePerf = monitorEventLoopDelay({ resolution: 20 })
bouclePerf.enable()

function bridgeSecret() {
  if (process.env.SIRAL_ATTACHE_BRIDGE_SECRET) return process.env.SIRAL_ATTACHE_BRIDGE_SECRET
  if (process.env.SIRAL_SECRET) {
    return crypto.createHash('sha256').update('attache-bridge:' + process.env.SIRAL_SECRET).digest('hex')
  }
  return null
}

function authorized(req) {
  const secret = bridgeSecret()
  if (!secret) return false
  const given = req.headers['x-attache-secret']
  if (typeof given !== 'string' || !given) return false
  const a = crypto.createHash('sha256').update(given).digest()
  const b = crypto.createHash('sha256').update(secret).digest()
  return crypto.timingSafeEqual(a, b)
}

function json(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(data))
}

async function readBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > maxBytes) { reject(new Error('Corps trop volumineux')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) }
      catch { reject(new Error('JSON invalide')) }
    })
    req.on('error', reject)
  })
}

// ── Actualisation « à la demande » de la description (« l'objet ») d'un dossier ──
// Icône « Actualiser » à côté du titre Description : le moteur JOINT tout le
// dossier (tous les CR, actes, sommaire du registre de toutes les pièces
// serveur — attache/description.mjs) et un run sur le modèle principal rédige
// la description complète, en deux parties (SYNTHÈSE + MIS EN CAUSE et
// charges), en prise de notes. L'écriture est VÉRIFIÉE après le run. Le FIL DE
// L'EAU, lui, passe par le FLUX TENDU (attache/flux.mjs).

// Le TEXTE du prompt vit dans attache/consignes.mjs (socle « description ») :
// le magistrat le lit, le complète ou le remplace depuis Paramètres → Attaché IA.
function descriptionPrompt(keys, numero) {
  return promptConsigne(keys, 'description', {
    entete: `ACTUALISATION DE LA DESCRIPTION du dossier « ${numero} » — demandée par le magistrat, silencieuse.`,
    vars: { dossier: numero },
    // TOUT le dossier joint (CR intégraux, actes, sommaire de toutes les pièces
    // serveur) : le run n'a plus à aller le chercher — ni à s'arrêter à mi-chemin.
    donnees: donneesDescription(keys, numero),
  })
}

// ── Actualisation « à la demande » des MIS EN CAUSE ──
// Icône « Actualiser » à côté du + de la section Mis en cause : l'attaché relit
// les CR, actes et documents du dossier et PROPOSE (✓/✗) les personnes mises en
// cause qui n'y figurent pas encore. Aucune écriture directe : le magistrat
// valide. Le dédoublonnage (nom déjà présent, nom voisin, nom identique connu
// d'une autre enquête) est fait au dépôt de la proposition.
// Texte du prompt : socle « mec » d'attache/consignes.mjs (réglable par le magistrat).
function mecPrompt(keys, numero) {
  return promptConsigne(keys, 'mec', {
    entete: `ACTUALISATION DES MIS EN CAUSE du dossier « ${numero} » — demandée par le magistrat, silencieuse.`,
    vars: { dossier: numero },
    donnees: donneesDescription(keys, numero),
  })
}

// Lots de mini-fiches tentés avant la description (pièces tout juste versées).
const DESC_LOTS_FICHES = 3

// ── Avancement de l'actualisation en cours ──
// Une seule actualisation à la fois ; son état (phase, étapes, estimation de
// fin, résultat) est lu par le navigateur toutes les quelques secondes
// (GET /actualiser-description) : pourcentage, « X min restantes », toasts à
// chaque étape. Le dernier état terminé reste lisible un moment.
let descEtat = null

function descEtape(phase, texte, patch = {}) {
  if (!descEtat) return
  descEtat.phase = phase
  descEtat.detail = texte
  descEtat.etapes.push({ at: new Date().toISOString(), phase, texte })
  Object.assign(descEtat, patch)
}

// Outils du run → étape lisible par le magistrat (et compteur d'écritures :
// le navigateur resynchronise dès qu'une écriture tombe).
const DESC_OUTILS = [
  [/actualiser_description/, 'ecriture', 'Description écrite', true],
  [/modifier_mec/, 'mec', 'Rôle d\'un mis en cause mis à jour', true],
  [/proposer_mec/, 'mec', 'Mis en cause proposé (à valider)', true],
  [/recouper_personnes/, 'mec', 'Recoupement des personnes avec les autres dossiers', false],
  [/proposer_lien/, 'liens', 'Lien proposé pour la cartographie (à valider)', true],
  [/memoire_dossier_noter/, 'memoire', 'Acquis notés dans la mémoire du dossier', false],
  [/lire_document/, 'lecture', 'Lecture d\'une pièce', false],
]

function descSurOutil(nom) {
  for (const [re, phase, texte, ecriture] of DESC_OUTILS) {
    if (re.test(String(nom))) {
      descEtape(phase, texte)
      if (ecriture) descEtat.ecritures = (descEtat.ecritures || 0) + 1
      return
    }
  }
}

/** Démarre l'actualisation EN FOND et rend aussitôt l'état initial. */
function demarrerActualiserDescription(numero, trigger = 'manuel') {
  const num = String(numero || '').trim()
  if (!num) return { ok: false, error: 'numéro requis' }
  // Un seul run de description à la fois (les écritures visent le MÊME coffre) —
  // évite qu'un run n'écrase la description d'un dossier voisin (read-modify-write).
  if (descEtat && !descEtat.fini) {
    return { ok: false, running: true, memeDossier: descEtat.numero === num, etat: avancement(descEtat) }
  }
  const keys = loadKeyring()
  if (!keys) return { ok: false, error: 'trousseau non remis' }
  descEtat = {
    numero: num, trigger, debut: Date.now(), phase: 'debut', detail: '', etapes: [], ecritures: 0,
    finEstimeeAt: Date.now() + estimerTotalMs({ lotsFiches: 1, chars: 60_000 }),
  }
  runActualiserDescription(keys, num, trigger)
    .catch((e) => ({ ok: false, error: String(e?.message || e) }))
    .then((resultat) => {
      if (!descEtat || descEtat.numero !== num) return
      descEtat.fini = true
      descEtat.resultat = resultat
      descEtape('fin', resultat.ok ? 'Terminé' : 'Échec')
    })
  return { ok: true, demarre: true, etat: avancement(descEtat) }
}

async function runActualiserDescription(keys, num, trigger) {
  // 1. Pièces nouvelles : ingestion (zéro jeton) puis quelques lots de
  //    mini-fiches, pour que le sommaire joint couvre les derniers versements.
  descEtape('ingestion', 'Recensement des pièces du serveur')
  const docKey = docServerKey(numeroCanonique(keys, num))
  try { await ingestPass(keys, { docKeys: [docKey], maxDossiers: 1, maxExtractions: 40, maxShas: 400, maxProbes: 600 }) } catch { /* jamais bloquant */ }
  let cov = couverturePieces(keys, num)
  const lots = Math.min(DESC_LOTS_FICHES, Math.ceil(cov.sansFiche.length / 8))
  descEtat.finEstimeeAt = Date.now() + estimerTotalMs({ lotsFiches: lots, chars: donneesDescription(keys, num).join('\n').length }) - 10_000
  descEtape('fiches', cov.sansFiche.length
    ? `${cov.total} pièce(s) — ${cov.sansFiche.length} à résumer avant lecture`
    : `${cov.total} pièce(s), toutes déjà résumées`, { pieces: cov.total, sansFiche: cov.sansFiche.length })
  for (let i = 0; i < lots; i++) {
    let r = null
    try { r = await registreFichesStep(keys, { docKey }) } catch { r = null }
    if (r) descEtape('fiches', `Résumé des pièces nouvelles — lot ${i + 1}/${lots} (${r.faites || 0} fiche(s) faite(s), ${r.restantes || 0} restante(s))`)
    if (!r || !r.restantes) break
  }
  cov = couverturePieces(keys, num)

  // 2. Le run : tout le dossier joint ; il écrit la description, tient les
  //    rôles des mis en cause, propose suspects et liens, note les acquis.
  const prompt = descriptionPrompt(keys, num)
  const redactionEstimee = estimerRedactionMs(prompt.length)
  const t0 = Date.now()
  descEtat.finEstimeeAt = t0 + redactionEstimee
  descEtape('redaction', `Lecture de tout le dossier par l'attaché (${(enqueteDe(keys, num)?.comptesRendus || []).length} CR, ${cov.fichees.length}/${cov.total} pièces résumées)`)
  console.log(`[attache] actualisation description « ${num} » (${trigger}) — ${cov.fichees.length}/${cov.total} pièce(s) fichée(s)`)
  const avantMec = countPropositions(keys, num, 'mec')
  const avantLiens = countPropositions(keys, num, 'lien')
  const avantDesc = descriptionDe(keys, num)
  const avantRoles = rolesDe(keys, num)
  const result = await runAgent({
    keys,
    prompt,
    runLabel: 'description',
    title: `Description ${num} ${new Date().toISOString().slice(0, 10)}`,
    // Demandée par le magistrat, qui veut un travail de QUALITÉ : le modèle
    // principal (pas l'économe). La matière est jointe ; les tours servent aux
    // écritures (rôles, propositions, liens, mémoire).
    model: agentConfig().model || undefined,
    effort: 'medium',
    maxTurns: 30,
    timeoutMs: 10 * 60 * 1000,
    onEvent: (ev) => { if (ev?.type === 'tool') descSurOutil(ev.name) },
  })
  observerRedaction(Date.now() - t0, redactionEstimee)

  // 4. Bilan DÉTERMINISTE (comptages avant/après, coût nul) : ce que le
  //    magistrat retrouvera dans la fiche. Sans la vérification d'écriture, un
  //    run terminé sans appeler actualiser_description passait pour un succès.
  const ecrite = descriptionDe(keys, num) !== avantDesc
  const apresRoles = rolesDe(keys, num)
  const bilan = {
    descriptionEcrite: ecrite,
    proposees: Math.max(0, countPropositions(keys, num, 'mec') - avantMec),
    liens: Math.max(0, countPropositions(keys, num, 'lien') - avantLiens),
    roles: [...apresRoles].filter(([id, role]) => avantRoles.has(id) && avantRoles.get(id) !== role).length,
    pieces: cov.total,
    fichees: cov.fichees.length,
  }
  const error = result.ok && !ecrite
    ? 'L\'attaché a terminé sans écrire de description — réessayez ; si cela persiste, voyez son prompt dans Paramètres → Attaché IA.'
    : result.error
  await audit(keys, 'description_actualisee', { numero: num, trigger, ok: result.ok && ecrite, ...bilan, convId: result.convId, erreur: error })
  return { ok: result.ok && ecrite, ...bilan, convId: result.convId, error }
}

// ── Analyse cartographique « en un clic » (Enrichir une fiche, Détecter les camps) ──
// Lancée depuis la carte, SANS chat : run en fond, une à la fois, qui ne fait
// que PROPOSER (✓/✗ dans le panneau de revue de la carte). Le navigateur suit
// l'état par GET /analyse-carto.
const CARTO_KINDS = ['lien', 'dossier_carto', 'mec_carto', 'mec_note', 'camp_carto']
let cartoEtat = null

function countPropositionsCarto(keys) {
  try { return listPropositions(keys, { enAttente: true }).filter((p) => CARTO_KINDS.includes(p.type)).length } catch { return 0 }
}

function demarrerAnalyseCarto(consigne, libelle) {
  if (cartoEtat && !cartoEtat.fini) return { ok: false, running: true, libelle: cartoEtat.libelle }
  const keys = loadKeyring()
  if (!keys) return { ok: false, error: 'trousseau non remis' }
  const avant = countPropositionsCarto(keys)
  cartoEtat = { libelle, debut: Date.now(), fini: false }
  const prompt = promptConsigne(keys, 'carto_chat', {
    entete: 'CONTEXTE : demande lancée depuis le module CARTOGRAPHIE (vue réseau des personnes et affaires du contentieux). Personne ne lit ta réponse : seules comptent les PROPOSITIONS que tu déposes.',
    donnees: ['', `Demande du magistrat : ${consigne}`],
  })
  audit(keys, 'analyse_carto', { libelle, apercu: consigne.slice(0, 200) }).catch(() => {})
  runAgent({
    keys,
    prompt,
    title: `Cartographie — ${libelle}`,
    runLabel: 'chat-carto', // même régime qu'une demande directe (sous-agents non bridés)
    model: agentConfig().model || undefined,
    timeoutMs: CARTO_TIMEOUT_MS,
    mcpToolTimeoutMs: CARTO_TIMEOUT_MS - 120_000,
  })
    .catch((e) => ({ ok: false, error: String(e?.message || e) }))
    .then((r) => {
      cartoEtat = { ...cartoEtat, fini: true, ok: Boolean(r.ok), error: r.error, proposees: Math.max(0, countPropositionsCarto(keys) - avant) }
    })
  return { ok: true, demarre: true }
}

/** Propositions EN ATTENTE d'un type sur un dossier (comptage déterministe). */
function countPropositions(keys, numero, type) {
  try {
    return listPropositions(keys, { numero, enAttente: true }).filter((p) => p.type === type).length
  } catch { return 0 }
}

function enqueteDe(keys, numero) {
  try {
    const { data } = loadContentieux(keys)
    const canon = numeroCanonique(keys, numero)
    return (data.enquetes || []).find((x) => String(x.numero).trim() === canon.trim()) || null
  } catch { return null }
}

/** Rôles des mis en cause enregistrés (id → rôle). */
function rolesDe(keys, numero) {
  return new Map((enqueteDe(keys, numero)?.misEnCause || []).map((m) => [m.id, String(m.role || '')]))
}

/** Description actuelle d'un dossier (lecture du coffre, coût nul). */
function descriptionDe(keys, numero) {
  return String(enqueteDe(keys, numero)?.description || '')
}

let mecRunning = false
/**
 * Run COURT de détection des mis en cause manquants d'un dossier. Rend le NOMBRE
 * de propositions déposées (comptage avant/après, coût nul) pour que le
 * navigateur dise au magistrat ce qui l'attend — ou qu'il n'y avait rien.
 */
async function runActualiserMec(numero, trigger = 'manuel') {
  const num = String(numero || '').trim()
  if (!num) return { ok: false, error: 'numéro requis' }
  // Un seul run de détection à la fois : deux runs concurrents reliraient les
  // mêmes pièces et déposeraient deux fois le même nom (le dédoublonnage ne
  // joue qu'entre propositions DÉJÀ enregistrées).
  if (mecRunning) return { ok: false, running: true, error: 'détection déjà en cours' }
  const keys = loadKeyring()
  if (!keys) return { ok: false, error: 'trousseau non remis' }
  mecRunning = true
  try {
    console.log(`[attache] actualisation mis en cause « ${num} » (${trigger})`)
    const avant = countPropositionsMec(keys, num)
    // Pièces nouvelles : ingestion (zéro jeton) puis quelques lots de mini-fiches,
    // pour que le sommaire joint (personnes par pièce) couvre les derniers versements.
    const docKey = docServerKey(numeroCanonique(keys, num))
    // Échéance : le navigateur attend ce run (9 min au plus, run de 7 min
    // compris) — un gros scan tout juste versé finira d'être océrisé en fond.
    const echeance = Date.now() + 90_000
    try { await ingestPass(keys, { docKeys: [docKey], maxDossiers: 1, maxExtractions: 40, maxShas: 400, maxProbes: 600, echeance }) } catch { /* jamais bloquant */ }
    const lots = Math.min(DESC_LOTS_FICHES, Math.ceil(couverturePieces(keys, num).sansFiche.length / 8))
    for (let i = 0; i < lots; i++) {
      let r = null
      try { r = await registreFichesStep(keys, { docKey, echeance }) } catch { r = null }
      if (!r || !r.restantes) break
    }
    const result = await runAgent({
      keys,
      // Tout le dossier joint (tous les CR en intégral, actes, sommaire de toutes
      // les pièces) : le run n'a plus qu'à repérer les noms manquants.
      prompt: mecPrompt(keys, num),
      runLabel: 'mec',
      title: `Mis en cause ${num} ${new Date().toISOString().slice(0, 10)}`,
      // La matière est jointe ; les tours servent aux lectures ciblées, au
      // recoupement et aux propositions.
      model: agentConfig().model || undefined,
      effort: 'medium',
      maxTurns: 20,
      timeoutMs: 7 * 60 * 1000,
    })
    const proposees = Math.max(0, countPropositionsMec(keys, num) - avant)
    await audit(keys, 'mec_actualises', { numero: num, trigger, ok: result.ok, proposees, convId: result.convId, erreur: result.error })
    return { ok: result.ok, proposees, convId: result.convId, error: result.error }
  } finally {
    mecRunning = false
  }
}

/** Propositions de mis en cause EN ATTENTE sur un dossier (comptage déterministe). */
function countPropositionsMec(keys, numero) {
  try {
    return listPropositions(keys, { numero, enAttente: true }).filter((p) => p.type === 'mec').length
  } catch { return 0 }
}

// ── Ingestion des pièces (extraction + empreinte, fil de l'eau) ──
// CPU local uniquement, zéro jeton : hors gouverneur (ni nuit ni cap 5 h).
// Garde anti-chevauchement : un passage OCR peut dépasser un tick.
let ingestRunning = false
async function maybeIngest() {
  if (ingestRunning) return
  ingestRunning = true
  try {
    const keys = loadKeyring()
    if (!keys) return
    const b = await ingestPass(keys)
    if (activites.ingestion) activites.ingestion.dernierBilan = b
    if (b.empreintes || b.extraites || b.entites || b.echecs) {
      console.log(`[attache] ingestion : ${b.dossiers} dossier(s) — ${b.empreintes} empreinte(s), ${b.extraites} texte(s) extraits, ${b.entites} entrée(s) de registre, ${b.echecs} échec(s) mémorisé(s)${b.enAttente ? `, ${b.enAttente} pièce(s) au prochain tick` : ''}`)
    }
  } finally {
    ingestRunning = false
  }
}

// ── Mini-fiches du registre (fil de l'eau, modèle économe) ──
// ── Fichiers globaux (cache du corps des pièces, fil de l'eau) ──
// Le flux tendu recompile le dossier qu'il vient de traiter ; cette passe de
// fond rattrape les autres (stock ancien, pièces encore non extraites,
// dossiers touchés hors flux), quelques dossiers par tick. CPU local, zéro jeton.
let globauxRunning = false
async function maybeGlobaux() {
  if (globauxRunning) return
  const keys = loadKeyring()
  if (!keys) return
  globauxRunning = true
  try {
    const b = await entretenirFichiersGlobaux(keys)
    if (activites.global) activites.global.dernierBilan = b
    if (b.recompiles || b.erreurs) {
      console.log(`[attache] fichiers globaux : ${b.recompiles} dossier(s) recompilé(s) sur ${b.examines} examiné(s)${b.restants ? `, ${b.restants} au prochain tick` : ''}${b.erreurs ? `, ${b.erreurs} erreur(s)` : ''}`)
    }
  } finally {
    globauxRunning = false
  }
}

// Un lot court par tick, APRÈS l'ingestion (texte + entités déjà là).
// Consomme des jetons → même gouvernance de forfait que les descriptions.
let registreRunning = false
async function maybeRegistreFiches() {
  if (registreRunning) return
  registreRunning = true
  try {
    const keys = loadKeyring()
    if (!keys) return
    if (await autonomousOnHold(keys, 'mini-fiches du registre')) return
    const b = await registreFichesStep(keys)
    if (b) {
      console.log(`[attache] registre : « ${b.dossier} » — ${b.faites} mini-fiche(s), ${b.copies} copie(s) héritée(s), ${b.echecs} échec(s), ${b.restantes} restante(s)${b.erreur ? ` — ${b.erreur}` : ''}`)
    }
  } finally {
    registreRunning = false
  }
}

// ── Analyse complète des versements massifs (attache/versement.mjs) ──
// Programmés par le flux tendu ; registre poussé la nuit, puis synthèse
// complète classée au dossier — de nuit, ou d'office au-delà de 24 h.
let versementsRunning = false
async function maybeVersements() {
  if (versementsRunning) return
  versementsRunning = true
  try {
    const keys = loadKeyring()
    if (!keys) return
    const b = await versementsStep(keys, { nuit: inNightWindow(), onHold: (quoi) => autonomousOnHold(keys, quoi) })
    if (b) console.log(`[attache] versement « ${b.numero} » : ${b.etape}${b.total ? ` (${b.pretes}/${b.total} pièces fichées)` : ''}${b.erreur ? ` — ${b.erreur}` : ''}`)
  } finally {
    versementsRunning = false
  }
}

// ── Interrogation du fonds (attache/interrogation.mjs) ──
// Déposée par le connecteur (Claude web) ou l'attaché : lecture de toutes
// les pièces du périmètre pilotée par la question, par lots, dès que le
// forfait l'autorise ; puis contrôle d'élusion, synthèse, livrable.
let interrogationsRunning = false
async function maybeInterrogations() {
  if (interrogationsRunning) return
  interrogationsRunning = true
  try {
    const keys = loadKeyring()
    if (!keys) return
    const b = await interrogationsStep(keys, { onHold: (quoi) => autonomousOnHold(keys, quoi) })
    if (b) console.log(`[attache] interrogation ${b.id} : ${b.etape}${b.total ? ` (${b.lues}/${b.total} pièces lues, ${b.pertinentes} retenue(s), ${b.nonLues} non lue(s))` : ''}${b.erreur ? ` — ${b.erreur}` : ''}`)
  } finally {
    interrogationsRunning = false
  }
}

// ── Rapports de dossier (attache/rapport.mjs) ──
// Travail de FOND réservé à la nuit : réécrit les rapports des dossiers dont
// le registre est complet et a bougé, quelques-uns par passage. Une
// interrogation « rapports » les demande elle-même, à toute heure.
let rapportsRunning = false
async function maybeRapports() {
  if (rapportsRunning || !inNightWindow()) return
  rapportsRunning = true
  try {
    const keys = loadKeyring()
    if (!keys) return
    const b = await entretenirRapports(keys, { onHold: (quoi) => autonomousOnHold(keys, quoi) })
    if (activites.rapports) activites.rapports.dernierBilan = b
    if (b.ecrits || b.erreurs) console.log(`[attache] rapports de dossier : ${b.ecrits} écrit(s) sur ${b.examines} examiné(s)${b.attendentFiches ? `, ${b.attendentFiches} attendent leurs fiches` : ''}${b.restants ? `, ${b.restants} au prochain passage` : ''}${b.erreurs ? `, ${b.erreurs} erreur(s)` : ''}`)
  } finally {
    rapportsRunning = false
  }
}

// ── Flux tendu : file d'attente + pipeline par dossier (attache/flux.mjs) ──
// Deux entrées : le RÉVEIL (POST /reveil, dès qu'un dossier bouge dans l'app)
// et la RELÈVE (signature déterministe à chaque tick — rattrape tout réveil
// manqué). Un dossier à la fois, après une courte période de calme. Les
// étages qui consomment des jetons passent par le gouverneur de forfait.
let fluxTimer = null
function fluxPlanifier() {
  if (fluxTimer) return
  fluxTimer = setTimeout(() => {
    fluxTimer = null
    traque('flux', 'flux tendu (file d\'attente)', () => fluxPomperMaintenant())
      .catch((e) => console.error('[attache] flux :', e))
  }, FLUX_QUIET_MS + 1_000)
}
async function fluxPomperMaintenant() {
  const keys = loadKeyring()
  if (!keys) return
  const out = await fluxPomper(keys, { onHold: (quoi) => autonomousOnHold(keys, quoi) })
  for (const b of out.traites || []) {
    if (b.ignore) continue
    console.log(`[attache] flux « ${b.numero} » : ${b.differe ? 'différé (forfait)' : b.massif ? `versement massif (${b.pieces} pièces) — indexé, pas d'analyse rapide` : `${b.pieces} pièce(s), ${b.crs} CR, ${b.actes} acte(s) — ${b.run ? `${b.crEcrit} CR écrit, ${b.mecProposes} MEC proposé(s), ${b.actesProposes} acte(s) proposé(s)` : 'rien de neuf'}`}${b.enAttente ? ` — ${b.enAttente} pièce(s) à suivre` : ''}${b.erreur ? ` — ${b.erreur}` : ''}`)
  }
  if (activites.flux && out.traites?.length) activites.flux.dernierBilan = out.traites[out.traites.length - 1]
  // du travail reste (suite, différé) : on repassera après le calme
  if (fluxFileAttente().enAttente.length) fluxPlanifier()
}
async function fluxTick() {
  const keys = loadKeyring()
  if (!keys) return
  const { enfiles } = fluxBalayer(keys)
  if (enfiles.length) console.log(`[attache] flux : ${enfiles.length} dossier(s) mis en file par la relève (${enfiles.join(', ')})`)
  await fluxPomperMaintenant()
}


// Analyse cartographique (« Détecter les camps », « Enrichir ») : elle peut
// déléguer à des sous-agents (un par dossier) et dépasser largement 20 min —
// plafond propre, ajustable par env. Simple garde-fou : une analyse brève
// finit en quelques secondes.
const CARTO_TIMEOUT_MIN = Number(process.env.SIRAL_ATTACHE_CARTO_TIMEOUT_MIN || 90)
const CARTO_TIMEOUT_MS = Math.max(20, CARTO_TIMEOUT_MIN) * 60 * 1000

// ── Classement des trames de la bibliothèque (description par trame) ──
// « Ranger / classer » est une passe de DESCRIPTION rapide (classer.mjs) : un
// appel modèle par lot de ~20 trames, sans outil ni sous-agent. Auparavant, ce
// bouton déléguait UNE analyse juridique approfondie à N sous-agents rassemblés
// par un run principal qui ré-ingérait tout — lent, souvent tué avant de rendre
// quoi que ce soit, et ruineux en jetons. L'analyse en profondeur d'UNE trame
// reste possible à la demande, depuis Claude web (connecteur).
let trameAnalyseRunning = false
async function runTrameAnalyse(noms) {
  const keys = loadKeyring()
  if (!keys) return { ok: false, error: 'trousseau non remis' }
  trameAnalyseRunning = true
  try {
    console.log(`[attache] classement de ${noms.length} trame(s)`)
    const result = await classerTrames(keys, noms)
    await audit(keys, 'trames_classees', { nb: noms.length, noms: noms.join(', ').slice(0, 500), classees: result.classees, ok: result.ok, erreur: result.error })
    if (result.ok) {
      const doublons = result.doublons?.length ? ` Doublons manifestes repérés : ${result.doublons.join(', ')}.` : ''
      await publishFeed(keys, {
        type: 'note',
        titre: 'Bibliothèque de trames : classement',
        resume: `${result.classees} trame(s) classée(s) (description mise à jour).${result.echecs?.length ? ` ${result.echecs.length} non classée(s).` : ''}${doublons}`,
      })
    } else {
      await publishFeed(keys, {
        type: 'alerte',
        titre: 'Classement des trames interrompu',
        resume: `Le classement des trames (${noms.slice(0, 5).join(', ')}${noms.length > 5 ? '…' : ''}) a échoué (${result.error || 'erreur inconnue'}). Relancez-le depuis Paramètres → Attaché IA.`,
      })
    }
    return { ok: result.ok, classees: result.classees, error: result.error }
  } finally {
    trameAnalyseRunning = false
  }
}

// ── Classement des entrées de la base de connaissances (description + rangement) ──
// Même principe que les trames : une passe de description rapide (classer.mjs),
// un appel modèle par lot, sans sous-agent. Le contenu n'est jamais touché.
let kbAnalyseRunning = false
async function runKbAnalyse(ids) {
  const keys = loadKeyring()
  if (!keys) return { ok: false, error: 'trousseau non remis' }
  kbAnalyseRunning = true
  try {
    console.log(`[attache] classement de ${ids.length} entrée(s) de la base de connaissances`)
    const result = await classerKb(keys, ids)
    await audit(keys, 'kb_classee', { nb: ids.length, ids: ids.join(', ').slice(0, 500), classees: result.classees, ok: result.ok, erreur: result.error })
    if (result.ok) {
      const signalements = [
        result.doublons?.length ? `Doublons : ${result.doublons.join(', ')}.` : '',
        result.perimes?.length ? `Peut-être périmé(s) : ${result.perimes.join(', ')}.` : '',
      ].filter(Boolean).join(' ')
      await publishFeed(keys, {
        type: 'note',
        titre: 'Base de connaissances : classement',
        resume: `${result.classees} entrée(s) classée(s) (description, catégorie, rangement).${result.echecs?.length ? ` ${result.echecs.length} non classée(s).` : ''}${signalements ? ' ' + signalements : ''}`,
      })
    } else {
      await publishFeed(keys, {
        type: 'alerte',
        titre: 'Classement de la base de connaissances interrompu',
        resume: `Le classement des entrées versées (${ids.slice(0, 5).join(', ')}${ids.length > 5 ? '…' : ''}) a échoué (${result.error || 'erreur inconnue'}). Relancez-le depuis Paramètres → Attaché IA.`,
      })
    }
    return { ok: result.ok, classees: result.classees, error: result.error }
  } finally {
    kbAnalyseRunning = false
  }
}

// ── Classement des skills (description quand elle manque) ──
// Même passe rapide (un appel modèle par lot, sans sous-agent) : ne remplit que
// les descriptions MANQUANTES — le front-matter des .skill n'est jamais écrasé.
let skillAnalyseRunning = false
async function runSkillAnalyse(noms) {
  const keys = loadKeyring()
  if (!keys) return { ok: false, error: 'trousseau non remis' }
  skillAnalyseRunning = true
  try {
    console.log(`[attache] classement de ${noms.length} skill(s)`)
    const result = await classerSkills(keys, noms)
    await audit(keys, 'skills_classees', { nb: noms.length, classees: result.classees, ignorees: result.ignorees, ok: result.ok, erreur: result.error })
    if (result.ok && (result.classees || result.total)) {
      await publishFeed(keys, {
        type: 'note',
        titre: 'Skills : classement',
        resume: `${result.classees} skill(s) décrite(s)${result.ignorees ? ` — ${result.ignorees} déjà décrite(s), laissée(s) intacte(s)` : ''}${result.echecs?.length ? ` — ${result.echecs.length} non décrite(s)` : ''}.`,
      })
    } else if (!result.ok) {
      await publishFeed(keys, {
        type: 'alerte',
        titre: 'Classement des skills interrompu',
        resume: `Le classement des skills a échoué (${result.error || 'erreur inconnue'}). Relancez-le depuis Paramètres → Attaché IA.`,
      })
    }
    return { ok: result.ok, classees: result.classees, ignorees: result.ignorees, error: result.error }
  } finally {
    skillAnalyseRunning = false
  }
}

// ── Gouverneur de consommation : mettre en PAUSE les runs de fond quand le
// forfait sature ─────────────────────────────────────────────────────────────
// Les runs AUTONOMES (ingestion, registre, versements, interrogations,
// rapports) sont la première source de sous-agents en parallèle — le poste
// qui fait exploser la fenêtre glissante de 5 h. Quand elle est pleine (config.cap5h),
// on les DIFFÈRE : rien n'est perdu, ils repartiront tout seuls au prochain tick
// une fois la fenêtre redescendue. On NE met JAMAIS en pause une demande
// directe du magistrat (actualisation, analyse de la carte) — elle est
// seulement resserrée par le gouverneur des sous-agents. Sans plafond configuré, le
// gouverneur est inerte (aucun run n'est différé).
// Fenêtre de NUIT réservée aux travaux de FOND lourds. Hors de la journée de
// travail, ils ne disputent jamais le forfait aux demandes directes du
// magistrat. Repli 22 h → 7 h, HEURE DU
// MAGISTRAT (fuseau déclaré, pas celle du conteneur), réglable et
// désactivable. La fenêtre vit dans ordonnancement.mjs : règle pure, sans
// état, testable.

/** Carte de mise en pause — CONCISE par exigence du magistrat : ce qui est
 * différé, les jauges, la reprise. Rien d'autre (la pédagogie vit dans la
 * documentation des Paramètres, pas dans le fil). */
function deferNoteResume(gov, quoi) {
  const par7j = gov.cause === '7j'
  const jauges = [
    gov.cap5h ? `fenêtre 5 h : ${Math.round(gov.pct5h * 100)} %` : null,
    gov.capHebdo ? `7 jours : ${Math.round(gov.pct7d * 100)} %` : null,
  ].filter(Boolean).join(' · ')
  return [
    `Différé : ${quoi || 'travaux de fond'} — et tout autre travail de fond tant que le forfait est plein.`,
    `${jauges}. ${par7j ? 'Reprise automatique (plafond 7 jours : comptez plusieurs jours).' : 'Reprise automatique dès que la fenêtre redescend.'}`,
    'Conversations et mails : jamais mis en pause.',
  ].join('\n')
}

// Anti-rafale : au plus UNE carte de mise en pause par période de 12 h, même
// si plusieurs épisodes se succèdent (saturé → redescend → re-saturé) — une
// journée chargée en produisait cinq identiques.
const DEFER_CARD_COOLDOWN_MS = 12 * 3600 * 1000

// Une SEULE carte par épisode de mise en pause — et non une par heure. Le
// gouverneur reste « stop » tant que la consommation ne redescend pas : avec un
// plafond HEBDOMADAIRE saturé, cela dure des jours, et l'ancienne cadence
// horaire déposait des CENTAINES de cartes identiques au fil, chassant le vrai
// travail hors des 200 entrées que le fil expose. Le repère est PERSISTÉ
// (autoDeferNotedAt) : un redémarrage du service ne relance pas une carte.
let deferEpisodeNoted = false
async function autonomousOnHold(keys, quoi) {
  const gov = consumptionGovernor(agentConfig())
  if (gov.level !== 'stop') {
    // Sortie de pause : on referme l'épisode, pour que la PROCHAINE saturation
    // se signale à nouveau (une fois).
    deferEpisodeNoted = false
    if (readState().autoDeferredAt) {
      await writeState({ autoDeferredAt: null, autoDeferReason: null, autoDeferNotedAt: null })
        .catch(() => {})
    }
    return false
  }
  console.log(`[attache] ${quoi} différé — forfait saturé (${gov.raison})`)
  const nowIso = new Date().toISOString()
  const st = readState()
  // readState() est SYNCHRONE : le test et l'affectation du repère mémoire
  // n'encadrent aucun await — plusieurs runs de fond gated dans le même tick ne
  // peuvent donc pas publier deux cartes.
  const lastCardMs = Date.parse(st.autoDeferLastCardAt || 0) || 0
  const cooldownOk = Date.now() - lastCardMs > DEFER_CARD_COOLDOWN_MS
  const shouldNote = Boolean(keys) && !deferEpisodeNoted && !st.autoDeferNotedAt && cooldownOk
  if (shouldNote) deferEpisodeNoted = true
  try {
    await writeState({
      autoDeferredAt: st.autoDeferredAt || nowIso,
      autoDeferReason: gov.raison || null,
      ...(shouldNote ? { autoDeferNotedAt: nowIso, autoDeferLastCardAt: nowIso } : {}),
    })
    if (shouldNote) {
      await publishFeed(keys, {
        type: 'note',
        titre: 'Travaux de fond en pause — forfait saturé',
        resume: deferNoteResume(gov, quoi),
      })
    }
  } catch { /* la mise en pause ne doit jamais gêner le service */ }
  return true
}

// ── Chantier de recoupements ──
//
// Calcul PUR (aucune IA, aucun jeton) : il ne passe donc ni par le gouverneur
// du forfait, ni par la file des runs Claude. Une fois par semaine dans la nuit
// du samedi au dimanche, et à la demande du magistrat à toute heure.
let recoupementsEnCours = false
let recoupementsEtape = null

function recoupementsEtat(keys) {
  const state = readState()
  return {
    enCours: recoupementsEnCours,
    etape: recoupementsEtape,
    dernierAt: state.recoupementsAt || null,
    dernierErreur: state.recoupementsErreur || null,
    jour: RECOUP_JOUR,
    dernier: keys ? dernierResultat(keys) : null,
  }
}

async function lancerRecoupements(origine = 'planifié') {
  if (recoupementsEnCours) return { ok: false, error: 'chantier déjà en cours' }
  const keys = loadKeyring()
  if (!keys) return { ok: false, error: 'trousseau non remis' }
  recoupementsEnCours = true
  recoupementsEtape = { etape: 'démarrage' }
  try {
    const resultat = await passeRecoupements(keys, {
      progression: (p) => { recoupementsEtape = p },
    })
    await writeState({ recoupementsAt: resultat.calculeAt, recoupementsErreur: null })
    console.log(`[attache] recoupements (${origine}) : ${resultat.perimetre.dossiers} dossiers, `
      + `${resultat.perimetre.piecesLues}/${resultat.perimetre.pieces} pièces lues, `
      + `${resultat.signaux.length} signal(aux) en ${Math.round(resultat.dureeMs / 1000)} s`)
    return { ok: true, resultat: { ...resultat, signaux: resultat.signaux.length } }
  } catch (e) {
    const message = String(e?.message || e)
    await writeState({ recoupementsErreur: message }).catch(() => {})
    console.error('[attache] recoupements :', message)
    return { ok: false, error: message }
  } finally {
    recoupementsEnCours = false
    recoupementsEtape = null
  }
}

async function maybeRecoupements() {
  if (recoupementsEnCours) return
  if (!loadKeyring()) return
  const feu = feuRecoupements({ dernierAt: readState().recoupementsAt || null })
  if (!feu.ok) return
  await lancerRecoupements('nuit hebdomadaire')
}

// ── Boucle de relève ──
const server = http.createServer(async (req, res) => {
  if (!authorized(req)) return json(res, 401, { error: 'Non autorisé' })
  const url = new URL(req.url, 'http://internal')
  const route = `${req.method} ${url.pathname}`

  try {
    if (route === 'GET /status') {
      const master = loadMasterKey()
      // Sonde de présence de l'app (`?bref=1`) : répondre TOUT DE SUITE, sans
      // lancer `claude --version` ni lire la boîte. C'est cette réponse qui
      // décide de l'affichage du module côté navigateur — elle ne doit jamais
      // dépendre d'un binaire à réveiller pendant qu'un run occupe la machine.
      if (url.searchParams.get('bref') === '1') {
        return json(res, 200, {
          enabled: true,
          bref: true,
          tj: attacheTj(),
          contentieux: attacheContentieux(),
          masterKey: Boolean(master),
        })
      }
      const keys = master ? loadKeyring() : null
      const cli = await checkClaudeCli()
      return json(res, 200, {
        enabled: true,
        tj: attacheTj(),
        contentieux: attacheContentieux(),
        masterKey: Boolean(master),
        keyring: keyringStatus(),
        scopesAttendus: allowedScopes(),
        claude: cli,
        state: readState(),
        config: agentConfig(),
        governor: consumptionGovernor(agentConfig()),
        // CAPACITÉS de CE binaire — l'app web les vérifie avant d'envoyer une
        // consigne qui suppose un outil (ex. « Détecter les camps ») : un
        // service pas encore redémarré sur la nouvelle version ne reçoit
        // ainsi jamais une mission qu'il ne peut pas exécuter.
        capacitesCarto: [
          'proposer_camp_carto',
          'proposer_note_mec',
          'carto_lire_fiches',
          'carto_lire_document',
          'carto_verser_document',
          'carto_histoire',
        ],
      })
    }

    if (route === 'GET /recoupements') {
      const master = loadMasterKey()
      return json(res, 200, recoupementsEtat(master ? loadKeyring() : null))
    }

    if (route === 'POST /recoupements') {
      // Déclenchement manuel : à toute heure, la nuit n'a pas à être attendue
      // quand c'est le magistrat lui-même qui demande.
      const out = await lancerRecoupements('demande du magistrat')
      return json(res, out.ok ? 200 : 409, out)
    }

    if (route === 'GET /config') {
      return json(res, 200, { config: agentConfig() })
    }

    if (route === 'GET /activite') {
      // Le « gestionnaire des tâches » du service : travaux de fond (état,
      // durées, bilans chiffrés), santé de l'event loop et mémoire. Aucune clé,
      // aucun contenu d'enquête.
      const mem = process.memoryUsage()
      const eventLoop = {
        moyenMs: Math.round(bouclePerf.mean / 1e6),
        maxMs: Math.round(bouclePerf.max / 1e6),
        p99Ms: Math.round(bouclePerf.percentile(99) / 1e6),
      }
      bouclePerf.reset() // fenêtre glissante : chaque lecture repart à neuf
      return json(res, 200, {
        demarreA: SERVICE_DEMARRE_A,
        activites: Object.values(activites),
        flux: (() => { try { return fluxFileAttente() } catch { return null } })(),
        eventLoop,
        memoire: { rssMB: Math.round(mem.rss / (1024 * 1024)), heapMB: Math.round(mem.heapUsed / (1024 * 1024)) },
      })
    }

    if (route === 'POST /mcp') {
      // Connecteur Claude web : l'app (seule à connaître le secret de pont)
      // relaie ici les messages JSON-RPC MCP d'un magistrat authentifié par
      // OAuth. Mêmes outils que le chat de l'attaché (moins sous_agents et
      // poser_question), trousseau rechargé à chaque message, écritures
      // auditées sous le contexte « connecteur ».
      const message = await readBody(req, 16 * 1024 * 1024)
      const out = await handleConnectorMessage(message)
      if (out === null) { res.writeHead(202); return res.end() }
      return json(res, 200, out)
    }

    if (route === 'GET /usage') {
      // Bilan de consommation (jetons) — nombres et horodatages seulement,
      // aucune donnée d'enquête : lisible même trousseau non remis. On joint
      // l'état du gouverneur (ok / serrer / stop) et la date du dernier report
      // de run autonome, pour que le panneau montre le bridage en cours.
      const cfg = agentConfig()
      const st = readState()
      return json(res, 200, {
        usage: usageSummary(),
        config: cfg,
        governor: consumptionGovernor(cfg),
        autoDeferredAt: st.autoDeferredAt || null,
        autoDeferReason: st.autoDeferReason || null,
      })
    }

    if (route === 'PUT /config') {
      const body = await readBody(req)
      const current = agentConfig()
      const config = {
        model: 'model' in body ? sanitizeModel(body.model) : current.model,
        effort: 'effort' in body ? sanitizeEffort(body.effort) : current.effort,
        webAccess: 'webAccess' in body ? body.webAccess === true : current.webAccess,
        subModel: 'subModel' in body ? sanitizeModel(body.subModel) : current.subModel,
        econome: 'econome' in body ? body.econome === true : current.econome,
        plan: 'plan' in body ? sanitizePlan(body.plan) : current.plan,
        cap5h: 'cap5h' in body ? sanitizeCap(body.cap5h) : current.cap5h,
        capHebdo: 'capHebdo' in body ? sanitizeCap(body.capHebdo) : current.capHebdo,
        signatureCR: 'signatureCR' in body ? sanitizeSignature(body.signatureCR) : current.signatureCR,
      }
      await writeState({ config })
      const keys = loadKeyring()
      if (keys) await audit(keys, 'config_modifiee', { ...config, par: String(body.par || 'admin') })
      return json(res, 200, { ok: true, config })
    }

    if (route === 'POST /keyring') {
      const body = await readBody(req)
      const out = grantKeyring(body.keys, String(body.grantedBy || 'admin'))
      const keys = loadKeyring()
      if (keys) await audit(keys, 'trousseau_remis', { par: String(body.grantedBy || 'admin'), scopes: out.scopes })
      return json(res, 200, { ok: true, ...out })
    }

    if (route === 'DELETE /keyring') {
      const keys = loadKeyring()
      if (keys) await audit(keys, 'trousseau_revoque', {})
      const removed = revokeKeyring()
      return json(res, 200, { ok: true, removed })
    }

    if (route === 'PUT /claude-token') {
      // Connexion du CLI à l'abonnement, SANS docker exec : le magistrat colle
      // ici le jeton rendu par « claude setup-token » (machine de confiance).
      // Chiffré au repos par la clé-maître, il est injecté dans l'environnement
      // de chaque run — la session du volume claude-auth n'est plus un point
      // de panne muet.
      const body = await readBody(req)
      try {
        writeClaudeToken(String(body.token || ''), String(body.par || 'admin'))
      } catch (e) {
        return json(res, 400, { ok: false, error: String(e?.message || e) })
      }
      // Un jeton neuf périme le refus mémorisé : sans cela l'état serait resté
      // « non connecté » jusqu'au premier échange réussi.
      await clearAuthFailure()
      const keys = loadKeyring()
      if (keys) await audit(keys, 'claude_token_enregistre', { par: String(body.par || 'admin') })
      return json(res, 200, { ok: true, claude: await checkClaudeCli() })
    }

    if (route === 'DELETE /claude-token') {
      const removed = clearClaudeToken()
      const keys = loadKeyring()
      if (keys) await audit(keys, 'claude_token_efface', { removed })
      return json(res, 200, { ok: true, removed, claude: await checkClaudeCli() })
    }

    if (route === 'POST /claude-test') {
      // Diagnostic : un tour minuscule chez Claude (« ping »), sans outils.
      // Dit si la connexion à l'abonnement tient VRAIMENT.
      const out = await testClaudeAuth()
      const keys = loadKeyring()
      if (keys) await audit(keys, 'claude_test', { ok: out.ok, erreur: out.error || null })
      return json(res, 200, out)
    }

    if (route === 'POST /reveil') {
      // RÉVEIL du flux tendu : l'app prévient qu'un dossier a bougé (pièce
      // versée côté serveur, CR/acte sauvegardé côté navigateur — par
      // n'importe quel utilisateur). Ne porte aucune donnée : l'attaché relit
      // ses coffres. Réponse immédiate ; le traitement part après le calme.
      const body = await readBody(req)
      const keys = loadKeyring()
      if (!keys) return json(res, 200, { ok: true, ignore: 'trousseau non remis' })
      const numeros = Array.isArray(body.numeros) ? body.numeros : (body.numero ? [body.numero] : [])
      const raison = String(body.raison || 'dossier').slice(0, 40)
      const par = body.par ? String(body.par).slice(0, 60) : undefined
      const mis = []
      for (const numero of numeros.slice(0, 50)) {
        const r = fluxEnfiler(keys, { numero, raison, par })
        if (r) mis.push(r)
      }
      if (body.docKey) {
        const r = fluxEnfiler(keys, { docKey: String(body.docKey), raison, par })
        if (r) mis.push(r)
      }
      if (mis.length) fluxPlanifier()
      return json(res, 200, { ok: true, enFile: mis })
    }

    if (route === 'GET /flux') {
      return json(res, 200, fluxFileAttente())
    }

    if (route === 'POST /actualiser-description') {
      // Actualisation À LA DEMANDE (icône « Actualiser » du dossier) : lancée
      // EN FOND, réponse immédiate ; le navigateur suit l'avancement par
      // GET /actualiser-description et resynchronise à chaque écriture.
      // Une seule à la fois (voir descEtat).
      const body = await readBody(req)
      const numero = String(body.numero || '').trim()
      if (!numero) return json(res, 400, { ok: false, error: 'Numéro requis' })
      if (!loadKeyring()) return json(res, 409, { ok: false, error: 'Trousseau non remis' })
      const out = demarrerActualiserDescription(numero, 'manuel')
      if (out.running) return json(res, 202, out)
      return json(res, out.ok ? 200 : 502, out)
    }

    if (route === 'GET /actualiser-description') {
      // Avancement de l'actualisation en cours (ou de la dernière terminée).
      return json(res, 200, { etat: avancement(descEtat) })
    }

    if (route === 'POST /analyse-carto') {
      const body = await readBody(req)
      const consigne = String(body.consigne || '').slice(0, 20_000)
      if (!consigne.trim()) return json(res, 400, { ok: false, error: 'Consigne vide' })
      if (!loadKeyring()) return json(res, 409, { ok: false, error: 'Trousseau non remis' })
      const out = demarrerAnalyseCarto(consigne, String(body.libelle || 'Analyse').slice(0, 120))
      if (out.running) return json(res, 202, out)
      return json(res, out.ok ? 200 : 502, out)
    }

    if (route === 'GET /analyse-carto') {
      return json(res, 200, { etat: cartoEtat })
    }

    if (route === 'POST /actualiser-mec') {
      // Détection À LA DEMANDE des mis en cause manquants (icône « Actualiser »
      // de la section Mis en cause) : run court, AWAITÉ ici pour que le
      // navigateur affiche les propositions déposées tout de suite.
      const body = await readBody(req)
      const numero = String(body.numero || '').trim()
      if (!numero) return json(res, 400, { ok: false, error: 'Numéro requis' })
      if (!loadKeyring()) return json(res, 409, { ok: false, error: 'Trousseau non remis' })
      const out = await runActualiserMec(numero, 'manuel')
      if (out.running) return json(res, 202, { ok: true, running: true })
      return json(res, out.ok ? 200 : 502, out)
    }

    if (route === 'GET /propositions') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      const numero = url.searchParams.get('numero') || undefined
      return json(res, 200, { propositions: listPropositions(keys, { numero }) })
    }

    if (route === 'POST /propositions/decide') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      const body = await readBody(req)
      try {
        const out = await decideProposition(keys, { id: String(body.id || ''), action: String(body.action || ''), par: String(body.par || ''), motif: body.motif ? String(body.motif) : '' })
        return json(res, 200, out)
      } catch (e) {
        return json(res, 400, { ok: false, error: String(e?.message || e) })
      }
    }

    if (route === 'POST /entraide-analyse') {
      const body = await readBody(req, 30 * 1024 * 1024)
      const keys = loadKeyring()
      if (body.action === 'sauver') {
        if (!keys) return json(res, 409, { ok: false, error: 'Trousseau non remis' })
        const lectures = await sauverLecture(keys, String(body.demandeId || ''), body.analyse)
        return json(res, 200, { ok: true, lectures })
      }
      const nom = String(body.nom || 'piece.pdf').slice(0, 200)
      const b64 = typeof body.b64 === 'string' ? body.b64 : ''
      if (!b64) return json(res, 400, { ok: false, error: 'Aucune pièce fournie' })
      try {
        const out = await lirePieceEntraide({ nom, octets: Buffer.from(b64, 'base64') })
        if (!out.ok) return json(res, 502, out)
        let lectures
        if (keys && body.demandeId) lectures = await sauverLecture(keys, String(body.demandeId), out.analyse)
        if (keys) await audit(keys, 'entraide_lecture', { piece: nom, demande: body.demandeId || null })
        return json(res, 200, { ...out, ...(lectures ? { lectures } : {}) })
      } catch (e) {
        return json(res, 500, { ok: false, error: String(e?.message || e).slice(0, 400) })
      }
    }

    if (route === 'GET /entraide-analyse') {
      const keys = loadKeyring()
      if (!keys) return json(res, 200, { lectures: [] })
      return json(res, 200, { lectures: lireLectures(keys, url.searchParams.get('id') || '') })
    }

    if (route === 'POST /trames/analyse') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { ok: false, error: 'Trousseau non remis' })
      if (trameAnalyseRunning) return json(res, 409, { ok: false, error: 'Analyse déjà en cours' })
      const body = await readBody(req)
      const noms = (Array.isArray(body.noms) ? body.noms : [])
        .map((n) => String(n).slice(0, 80)).filter(Boolean).slice(0, 100)
      if (!noms.length) return json(res, 400, { ok: false, error: 'Aucune trame à analyser' })
      // lancée en fond : la réponse ne bloque pas sur le run complet
      runTrameAnalyse(noms).catch((e) => console.error('[attache] analyse trames :', e))
      return json(res, 202, { ok: true, started: true })
    }

    if (route === 'POST /kb/analyse') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { ok: false, error: 'Trousseau non remis' })
      if (kbAnalyseRunning) return json(res, 409, { ok: false, error: 'Classement déjà en cours' })
      const body = await readBody(req)
      const ids = (Array.isArray(body.ids) ? body.ids : [])
        .map((n) => String(n).slice(0, 80)).filter(Boolean).slice(0, 200)
      if (!ids.length) return json(res, 400, { ok: false, error: 'Aucune entrée à analyser' })
      // lancé en fond : la réponse ne bloque pas sur le run complet
      runKbAnalyse(ids).catch((e) => console.error('[attache] classement kb :', e))
      return json(res, 202, { ok: true, started: true })
    }

    if (route === 'POST /skills/analyse') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { ok: false, error: 'Trousseau non remis' })
      if (skillAnalyseRunning) return json(res, 409, { ok: false, error: 'Classement déjà en cours' })
      const body = await readBody(req)
      const noms = (Array.isArray(body.noms) ? body.noms : [])
        .map((n) => String(n).slice(0, 80)).filter(Boolean).slice(0, 100)
      if (!noms.length) return json(res, 400, { ok: false, error: 'Aucune skill à classer' })
      runSkillAnalyse(noms).catch((e) => console.error('[attache] classement skills :', e))
      return json(res, 202, { ok: true, started: true })
    }

    if (route === 'GET /chronologie') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      const numero = url.searchParams.get('numero') || ''
      const chrono = buildChronologie(keys, numero)
      return chrono ? json(res, 200, chrono) : json(res, 404, { error: 'Dossier introuvable' })
    }

    if (route === 'POST /cotes') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      const body = await readBody(req, 8 * 1024 * 1024)
      const out = await saveArchitecture(keys, String(body.numero || ''), String(body.texte || ''))
      if (out.ok) await audit(keys, 'cotes_importees', { numero: body.numero, nbCotes: out.nbCotes, par: String(body.par || 'admin') })
      return json(res, out.ok ? 200 : 400, out)
    }

    if (route === 'GET /consignes-catalogue') {
      return json(res, 200, { catalogue: catalogueAvecSocles() })
    }

    if (route === 'POST /consignes-ameliorer') {
      // Ligne de chat « améliorer ce prompt » (Paramètres → Attaché IA) : le
      // magistrat dit ce qu'il veut changer, un run en lecture seule rend le
      // prompt RÉÉCRIT — rien n'est enregistré ici : le navigateur le montre,
      // le magistrat l'adopte ou non, puis l'enregistre (chiffré) lui-même.
      const body = await readBody(req)
      const id = String(body.id || '')
      const actuel = String(body.texte || '').slice(0, 40_000)
      const demande = String(body.demande || '').trim().slice(0, 4_000)
      if (!SOCLES[id]) return json(res, 400, { ok: false, error: 'Prompt inconnu' })
      if (!demande) return json(res, 400, { ok: false, error: 'Demande vide' })
      const entree = catalogueAvecSocles().find((c) => c.id === id)
      const consigne = [
        `Tu révises le PROMPT d'une tâche automatique de l'attaché de justice : « ${entree?.label || id} ».`,
        entree?.quand ? `Contexte d'usage : ${entree.quand}` : '',
        (entree?.variables || []).length ? `Variables à CONSERVER telles quelles : ${entree.variables.join(', ')}.` : '',
        'Conserve les noms d\'outils (actualiser_description, proposer_mec…), le format imposé et les règles de sûreté, sauf si la demande les vise expressément.',
        'Applique la DEMANDE DU MAGISTRAT ci-dessous, sans rien changer d\'autre que ce qu\'elle implique.',
        'TA RÉPONSE EST LE PROMPT COMPLET RÉVISÉ, EN TEXTE BRUT, ET RIEN D\'AUTRE : aucun préambule, aucun commentaire, aucune balise.',
        '',
        '───── PROMPT ACTUEL ─────',
        actuel || SOCLES[id],
        '',
        '───── DEMANDE DU MAGISTRAT ─────',
        demande,
      ].filter((l) => l !== '').join('\n')
      const [r] = await runSubagents({
        taches: [{ titre: `Révision du prompt ${id}`, consigne }],
        modele: agentConfig().model || undefined,
      })
      const texte = String(r?.resultat || '').replace(/^```[a-z]*\n?|```\s*$/g, '').trim()
      if (!r?.ok || !texte) return json(res, 502, { ok: false, error: r?.erreur || 'Révision impossible pour le moment' })
      const kAudit = loadKeyring()
      if (kAudit) await audit(kAudit, 'consigne_revision_proposee', { id, demande: demande.slice(0, 200) }).catch(() => {})
      return json(res, 200, { ok: true, texte })
    }

    // Vider la boîte : les messages traités (défaut) ou tout (mode=tous).
    if (route === 'PUT /collection') {
      const body = await readBody(req, 4 * 1024 * 1024)
      const env = body.envelope
      if (!env || env.encrypted !== true || typeof env.iv !== 'string' || typeof env.ct !== 'string') {
        return json(res, 400, { error: 'Enveloppe chiffrée requise' })
      }
      try {
        await writeCollectionEnvelopeRaw(String(body.collection || ''), String(body.id || ''), env)
        return json(res, 200, { ok: true })
      } catch (e) {
        return json(res, 400, { error: String(e?.message || e) })
      }
    }

    if (route === 'DELETE /collection') {
      try {
        const removed = await deleteCollectionEnvelopeRaw(
          url.searchParams.get('collection') || '',
          url.searchParams.get('id') || '',
        )
        return json(res, 200, { ok: removed })
      } catch (e) {
        return json(res, 400, { error: String(e?.message || e) })
      }
    }

    // Mêmes relais pour la mémoire / les consignes (enveloppe unique)…
    if (route === 'PUT /envelope-file') {
      const body = await readBody(req, 4 * 1024 * 1024)
      const env = body.envelope
      if (!env || env.encrypted !== true || typeof env.iv !== 'string' || typeof env.ct !== 'string') {
        return json(res, 400, { error: 'Enveloppe chiffrée requise' })
      }
      try {
        await writeSingleEnvelopeRaw(String(body.name || ''), env)
        return json(res, 200, { ok: true })
      } catch (e) {
        return json(res, 400, { error: String(e?.message || e) })
      }
    }

    // …et pour les cartes de statut en clair (questions / journal).
    if (route === 'PUT /status-map') {
      const body = await readBody(req)
      try {
        await setStatusMapEntryRaw(String(body.file || ''), String(body.id || ''), {
          status: String(body.status || '').slice(0, 20),
          at: new Date().toISOString(),
          by: String(body.by || 'admin').slice(0, 80),
        })
        return json(res, 200, { ok: true })
      } catch (e) {
        return json(res, 400, { error: String(e?.message || e) })
      }
    }

    return json(res, 404, { error: 'Route inconnue' })
  } catch (e) {
    console.error('[attache]', e)
    if (!res.headersSent) return json(res, 500, { error: String(e?.message || e) })
    try { res.end() } catch {}
  }
})

// ── Démarrage ──
// Tout ce que le service crée sur le volume partagé doit rester inscriptible
// par l'app web (utilisateur non-root de son conteneur) : umask nul pour les
// nouvelles écritures, remise à niveau du stock existant au démarrage.
process.umask(0)
try { fixSharedPermissions() } catch (e) { console.error('[attache] permissions partagées :', e) }

const master = loadMasterKey()
if (!master) {
  console.error('[attache] SIRAL_ATTACHE_MASTER_KEY absente ou invalide (64 hex attendus) — service inactif.')
  console.error('[attache] Générez-la : openssl rand -hex 32')
  process.exit(1)
}
if (!bridgeSecret()) {
  console.error('[attache] SIRAL_ATTACHE_BRIDGE_SECRET ou SIRAL_SECRET requis pour l\'API interne.')
  process.exit(1)
}

server.listen(PORT, () => {
  console.log(`[attache] service prêt sur :${PORT} — TJ ${attacheTj()}, contentieux ${attacheContentieux()}`)
})

// Les travaux du tick sont ÉTALÉS dans la fenêtre (au lieu de partir tous en
// rafale à la même seconde) : l'ingestion, le registre et les descriptions
// se partageaient le même event loop au même instant — et le
// volume partagé avec l'app en payait le prix toutes les 5 minutes.
const decale = (ms, nom, libelle, fn) => {
  setTimeout(() => {
    traque(nom, libelle, fn).catch((e) => console.error(`[attache] ${libelle} :`, e))
  }, ms)
}
setInterval(() => {
  decale(20_000, 'flux', 'flux tendu (file d\'attente)', () => fluxTick())
  decale(30_000, 'ingestion', 'ingestion des pièces', () => maybeIngest())
  decale(90_000, 'registre', 'mini-fiches du registre', () => maybeRegistreFiches())
  decale(105_000, 'versements', 'analyse des versements massifs', () => maybeVersements())
  decale(110_000, 'interrogations', 'interrogation du fonds', () => maybeInterrogations())
  decale(115_000, 'rapports', 'rapports de dossier', () => maybeRapports())
  decale(120_000, 'recoupements', 'recoupements entre dossiers', () => maybeRecoupements())
  decale(150_000, 'global', 'fichiers globaux', () => maybeGlobaux())
}, POLL_MINUTES * 60 * 1000)
writeState({ startedAt: new Date().toISOString() }).catch(() => {})
