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
import { loadMasterKey, decryptJson } from './attache/crypto.mjs'
import { loadKeyring, grantKeyring, revokeKeyring, keyringStatus, allowedScopes } from './attache/keyring.mjs'
import { handleConnectorMessage } from './attache-mcp.mjs'
import { attacheTj, attacheContentieux, readState, writeState, fixSharedPermissions, writeCollectionEnvelopeRaw, deleteCollectionEnvelopeRaw, writeSingleEnvelopeRaw, setStatusMapEntryRaw } from './attache/store.mjs'
import { audit, publishFeed } from './attache/journal.mjs'
import { fetchInbox, listInbox, mailConfig, inboxStats, markInboxStatus, readInboxMessage, describeMailConfig, testImapConnection, writeMailOverride, clearMailOverride, purgeInbox } from './attache/mail.mjs'
import { listChantiers, createChantier, actionChantier, chantierStep, chantierActif } from './attache/chantier.mjs'
import { writeClaudeToken, clearClaudeToken, clearAuthFailure } from './attache/claudeAuth.mjs'
import { runAgent, checkClaudeCli, testClaudeAuth, listConversations, readConversationEnvelope, deleteConversation, agentConfig, sanitizeModel, sanitizeEffort, sanitizePlan, sanitizeCap, sanitizeSignature } from './attache/agent.mjs'
import { usageSummary } from './attache/usage.mjs'
import { saveArchitecture, buildChronologie } from './attache/cotes.mjs'
import { genererGraphique } from './attache/statsGraphiques.mjs'
import { dossierSyntheseSignals } from './attache/dossier.mjs'
import { ingestPass } from './attache/ingest.mjs'
import { registreFichesStep } from './attache/registre.mjs'
import { listRoutines, upsertRoutine, deleteRoutine, markRun, dueRoutines } from './attache/routines.mjs'
import { listPropositions, decideProposition } from './attache/propositions.mjs'
import { analyseDocuments } from './attache/analyse.mjs'
import { classerTrames, classerKb, classerSkills, suggererAssociations } from './attache/classer.mjs'
import { readDossierMemory } from './attache/dossierMemory.mjs'
import { listEnvelopesDossier, writeEnvelope, deleteProduction, readProduction } from './attache/productions.mjs'
import { recordLearningSignal, consolidationDue, consolidationPrompt, learningStatus, learningState, latestSignalTs } from './attache/apprentissage.mjs'
import { corpusActesValides, etudeDue, etudePrompt, etudeState, etudeStatus } from './attache/etude.mjs'
import { MEMORY_BUDGET } from './attache/memory.mjs'
import { economicalModel } from './attache/subagents.mjs'
import { consumptionGovernor } from './attache/budget.mjs'
import { prompt as promptConsigne, catalogueAvecSocles } from './attache/consignes.mjs'

const PORT = Number(process.env.SIRAL_ATTACHE_PORT || 8787)
const POLL_MINUTES = Math.max(1, Number(process.env.SIRAL_ATTACHE_POLL_MIN || 5))

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

// ── Runs proactifs : un mail = un run — POOL BORNÉ (plusieurs de front) ──
// Le magistrat peut transférer 3 mails d'affilée : les traiter l'un après
// l'autre faisait attendre le dernier ~1 h sur de gros dossiers. Les écritures
// sont déjà sérialisées fichier par fichier (withFileLock) et le dédoublonnage
// des propositions est vérifié au dépôt ET à l'application : une concurrence
// bornée est sûre. Défaut 2 (mémoire du serveur oblige) ; 1 = retour à
// l'ancien comportement strictement séquentiel.
const PROACTIVE_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.SIRAL_ATTACHE_PROACTIVE_CONCURRENCY || 2)))
// Reprises d'un mail en échec : jusqu'à MAX_ATTEMPTS tentatives au total,
// espacées d'un délai croissant — puis ABANDON EXPLICITE (carte au fil).
// L'ancien mécanisme (`recentlyQueued`, jamais purgé) s'arrêtait en silence
// après ~2 essais alors que le widget affichait « sera retenté ».
const PROACTIVE_MAX_ATTEMPTS = Math.max(1, Math.min(6, Number(process.env.SIRAL_ATTACHE_MAIL_MAX_ATTEMPTS || 3)))
const PROACTIVE_RETRY_BASE_MS = Math.max(60_000, Number(process.env.SIRAL_ATTACHE_MAIL_RETRY_MIN || 10) * 60 * 1000)
const proactiveQueue = []
const proactiveQueued = new Set() // mails en file ou en cours — jamais deux fois
const proactiveAttempts = new Map() // mailId → { count, nextRetryAt, abandoned }
let proactiveWorkers = 0
let running = 0

function queueProactiveRun(keys, mailId) {
  if (proactiveQueued.has(mailId)) return
  proactiveQueued.add(mailId)
  proactiveQueue.push({ keys, mailId })
  pumpProactive()
}

function pumpProactive() {
  while (proactiveWorkers < PROACTIVE_CONCURRENCY && proactiveQueue.length) {
    const { keys, mailId } = proactiveQueue.shift()
    proactiveWorkers++
    processProactiveRun(keys, mailId)
      .catch((e) => console.error('[attache] run proactif :', e))
      .finally(() => {
        proactiveWorkers--
        proactiveQueued.delete(mailId)
        pumpProactive()
      })
  }
}

/** Comptabilise une tentative ; à l'échec, programme la reprise ou ABANDONNE avec une carte. */
async function noteProactiveFailure(keys, mailId, erreur) {
  const st = proactiveAttempts.get(mailId) || { count: 0 }
  if (st.count >= PROACTIVE_MAX_ATTEMPTS) {
    if (!st.abandoned) {
      st.abandoned = true
      proactiveAttempts.set(mailId, st)
      await publishFeed(keys, {
        type: 'alerte',
        titre: 'Mail non traité — reprises épuisées',
        resume: `Le mail ${mailId} a échoué ${st.count} fois (dernière erreur : ${String(erreur || 'inconnue').slice(0, 300)}). Il ne sera PLUS retenté automatiquement : relancez la relève depuis le panneau, ou re-transférez le message (éventuellement scindé si le dossier est volumineux).`,
      }).catch(() => {})
      await markInboxStatus(keys, mailId, 'erreur').catch(() => {})
    }
    return
  }
  // reprise programmée, à délai croissant (10 min, 20 min, 40 min…)
  st.nextRetryAt = Date.now() + PROACTIVE_RETRY_BASE_MS * Math.pow(2, Math.max(0, st.count - 1))
  proactiveAttempts.set(mailId, st)
}

async function processProactiveRun(keys, mailId) {
  running++
  const st = proactiveAttempts.get(mailId) || { count: 0 }
  st.count++
  proactiveAttempts.set(mailId, st)
  try {
    // statut visible dans le widget BAL : reçu → EN COURS → traité
    await markInboxStatus(keys, mailId, 'en_cours').catch(() => {})
    const prompt = [
      `Un nouveau message vient d'arriver dans la boîte dédiée (id : ${mailId}).`,
      'Traite-le ENTIÈREMENT selon ta méthode : boite_lire pour prendre connaissance de la consigne et des pièces jointes,',
      'qualification, rapprochement RIGOUREUX avec le dossier SIRAL concerné, actions dans SIRAL si elles s\'imposent,',
      'préparation des synthèses/projets — remis DANS SIRAL (remettre_livrable, signaler, produire_document) :',
      'aucun mail sortant n\'existe plus.',
      'PLUSIEURS ACTES : un même mail peut réclamer PLUSIEURS actes (« une prolongation de la ligne X ET une géoloc',
      'du véhicule Y ») — commence par LISTER tous les actes demandés, traite-les UN PAR UN (une production par acte,',
      'chacune avec son acteMeta), et VÉRIFIE avant de clore que chaque acte de ta liste a bien sa production.',
      'COHÉRENCE : compare le numéro de procédure porté par la pièce jointe au dossier que tu as retenu — s\'ils',
      'divergent, tranche par les mis en cause et les faits, et SIGNALE la divergence (elle peut révéler une erreur',
      'de transfert). De même, ajoute les NATINF cités par la pièce et absents du dossier (ajouter_natinfs).',
      'DESTINATION DÉSIGNÉE : si la consigne du transfert dit OÙ verser la production (« verse dans le dossier Y »,',
      '« range hors dossier »), ce rangement-là PRIME et s\'exécute tel quel, même s\'il te paraît incohérent avec le',
      'contenu — pas de question, pas de rectification : au plus une phrase de récapitulatif (RANGEMENT SUR CONSIGNE).',
      'SI AUCUN dossier en cours ne correspond : (a) la consigne du transfert dit « créer procédure » (ou équivalent',
      'sans ambiguïté) → crée le dossier (creer_dossier, tout renseigné depuis la pièce : directeur d\'enquête, service,',
      'mis en cause recoupés, NATINF), puis traite-y la demande ;',
      '(b) la consigne dit seulement de traiter → rédige l\'acte demandé sous le pseudo-dossier "_hors-dossier"',
      '(produire_document) : il apparaîtra dans « Actes rédigés — hors dossier » du tableau de bord.',
      'Termine par boite_marquer_traite — le résumé ÉNUMÈRE ce qui a été fait (ex. « 2 actes rédigés : prolongation',
      'ligne X, géoloc Y — CR proposé ») — puis signaler.',
      'Si le message est hors sujet (spam, notification technique), marque-le traité avec un résumé d\'un mot et ne signale rien.',
    ].join('\n')
    const result = await runAgent({ keys, prompt, runLabel: 'proactif', title: `Mail ${mailId}` })
    await audit(keys, 'run_proactif', { mailId, tentative: st.count, ok: result.ok, convId: result.convId, erreur: result.error })
    if (!result.ok) {
      await publishFeed(keys, {
        type: 'alerte',
        titre: 'Traitement automatique interrompu',
        resume: `Le mail ${mailId} n'a pas pu être traité (tentative ${st.count}/${PROACTIVE_MAX_ATTEMPTS} — ${result.error || 'erreur inconnue'}). Il reste dans la boîte, non marqué traité.`,
      })
    }
    // si l'agent n'a pas marqué traité (erreur, oubli), le statut redevient « reçu »
    const rec = readInboxMessage(keys, mailId)
    if (rec && !rec.traite) {
      await markInboxStatus(keys, mailId, result.ok ? 'recu' : 'erreur').catch(() => {})
      if (!result.ok) await noteProactiveFailure(keys, mailId, result.error)
    } else if (result.ok) {
      proactiveAttempts.delete(mailId) // traité : plus rien à suivre
    }
  } catch (e) {
    console.error('[attache] run proactif :', e)
    try {
      const rec = readInboxMessage(keys, mailId)
      if (rec && !rec.traite) {
        await markInboxStatus(keys, mailId, 'erreur')
        // Même visibilité qu'un échec « propre » : sans cette carte, une
        // exception laissait le magistrat sans aucune explication au fil.
        await publishFeed(keys, {
          type: 'alerte',
          titre: 'Traitement automatique interrompu',
          resume: `Le mail ${mailId} n'a pas pu être traité (tentative ${st.count}/${PROACTIVE_MAX_ATTEMPTS} — ${String(e?.message || e).slice(0, 300)}). Il reste dans la boîte, non marqué traité.`,
        }).catch(() => {})
        await noteProactiveFailure(keys, mailId, e?.message || e)
      }
    } catch { /* statut best-effort */ }
  } finally {
    running--
  }
}

// ── Routines du magistrat : exécutées à leur cadence, sérialisées ──

// Une routine n'est PAS un run de chat : elle balaye, délègue à des sous-agents
// (~8 min chacun) et n'a personne devant l'écran. Elle héritait pourtant du
// plafond de 20 min d'un run de chat, ce qui la faisait tuer (« délai dépassé
// (20 min) ») avant qu'elle n'ait déposé son travail. On lui accorde un plafond
// propre, et le plafond CARTO à celles qui balayent la cartographie : l'analyse
// transversale lance un sous-agent par dossier — le chat carto a déjà 90 min
// pour cette raison exacte, une routine qui fait la même chose n'avait que 20.
const ROUTINE_TIMEOUT_MIN = Number(process.env.SIRAL_ATTACHE_ROUTINE_TIMEOUT_MIN || 60)
const ROUTINE_TIMEOUT_MS = Math.max(20, ROUTINE_TIMEOUT_MIN) * 60 * 1000
/** La routine balaye-t-elle la cartographie (analyse transversale) ? */
const CARTO_ROUTINE_RE = /cartograph|carto\b|transversal|liens? cach|recoupe|rapprochement|renseignement/i
function routineTimeoutMs(routine) {
  const texte = `${routine.nom || ''}\n${routine.prompt || ''}`
  return CARTO_ROUTINE_RE.test(texte)
    ? Math.max(ROUTINE_TIMEOUT_MS, CARTO_CHAT_TIMEOUT_MS)
    : ROUTINE_TIMEOUT_MS
}

/** Propositions en attente de validation (✓/✗) — sert à dire au magistrat, quand
 * un run casse, si du travail exploitable a MALGRÉ TOUT été déposé et où le
 * trancher. Un run tué à mi-course laissait sinon croire que tout était perdu. */
function propositionsEnAttente(keys) {
  try { return listPropositions(keys, { enAttente: true }).length } catch { return 0 }
}

let routineRunning = false
async function runRoutine(routine, trigger = 'planifiée') {
  const keys = loadKeyring()
  if (!keys) return { ok: false, error: 'trousseau non remis' }
  console.log(`[attache] routine « ${routine.nom} » (${trigger})`)
  const avant = propositionsEnAttente(keys)
  // réserver l'exécution AVANT le run (évite un doublon si le run est long)
  await markRun(keys, routine.id, null)
  const prompt = [
    `ROUTINE « ${routine.nom} » — consigne récurrente définie par le magistrat, exécutée automatiquement :`,
    '',
    routine.prompt,
    '',
    'OÙ REMETTRE TON TRAVAIL — tout apparaît sur la page « Assistant de justice » (visible du seul magistrat) :',
    '- Si la routine SURVEILLE les dossiers (échéances qui approchent, actes qui expirent, incohérences, attentes',
    '  JLD qui traînent, dossiers dormants à relancer) : signaler, UNE carte par point, dans le fil « pendant',
    '  votre absence ». Dis QUOI préparer et POUR QUAND, et rattache la carte à son dossier (numero).',
    '  Sois SÉLECTIF : un objet = une seule carte, jamais deux cartes pour la même mesure ou le même acte, et',
    '  jamais un doublon de ce que tu as déjà signalé à l\'exécution précédente.',
    '  N\'annonce PAS les actes qui expirent, les poses non confirmées ni les attentes JLD ordinaires : le tableau',
    '  de bord les affiche déjà tout seul (widgets dédiés + notifications). Seulement ce qu\'il ne voit pas.',
    '- Si la consigne demande une remise (« envoie-moi », « prépare-moi », une synthèse, un projet) :',
    '  remettre_livrable (ou produire_document pour un acte à signer) — le livrable s\'affiche dans SIRAL.',
    '- Si tu détectes une écriture à faire (lien de renseignement, personne ou dossier ex nihilo, mis en cause,',
    '  acte, CR), PROPOSE-la (proposer_lien, proposer_mec_carto, proposer_dossier_carto, ajouter_mec…) : le',
    '  magistrat tranche ✓/✗ dans le panneau Attaché et sur la Cartographie. Une proposition déposée SURVIT même',
    '  si le run est ensuite interrompu — dépose au fil de l\'eau, ne garde jamais tes trouvailles pour la fin.',
    '- Termine par signaler : un résumé d\'1-2 phrases de ce que tu as fait. Si rien de notable : ne publie rien.',
    'Aucun mail ne part jamais.',
  ].join('\n')
  const timeoutMs = routineTimeoutMs(routine)
  const result = await runAgent({
    keys,
    prompt,
    runLabel: `routine:${routine.nom}`,
    title: `Routine ${routine.nom} ${new Date().toISOString().slice(0, 10)}`,
    timeoutMs,
    mcpToolTimeoutMs: timeoutMs - 120_000,
  })
  await markRun(keys, routine.id, result.ok)
  await audit(keys, 'routine_executee', { routine: routine.nom, trigger, ok: result.ok, convId: result.convId, erreur: result.error })
  if (!result.ok) {
    // Une routine en échec ne re-tentera pas avant sa prochaine échéance : le
    // magistrat doit le voir au fil (le signaler final de l'agent n'a jamais
    // été émis si le run est mort avant). On DIT AUSSI ce qui a survécu : un run
    // tué à mi-course a souvent déjà déposé des propositions validables — sans
    // cette phrase, le magistrat lisait « interrompue » et croyait tout perdu.
    const deposees = Math.max(0, propositionsEnAttente(keys) - avant)
    const suite = deposees > 0
      ? `\n\nCE QUI A ÉTÉ DÉPOSÉ MALGRÉ TOUT : ${deposees} proposition${deposees > 1 ? 's' : ''} `
        + `en attente de votre validation. Vous les tranchez ✓/✗ dans le bloc `
        + `« Proposition à valider », en haut de cette même page « Assistant de justice » — `
        + `également dans le panneau de l'attaché et en bas à gauche de la Cartographie. `
        + `Rien n'est perdu : ce qui est déposé reste là.`
      : "\n\nAucune proposition n'avait encore été déposée quand le run a été interrompu :"
        + ' il n\'y a rien à valider pour cette exécution.'
    await publishFeed(keys, {
      type: 'alerte',
      titre: `Routine « ${routine.nom} » interrompue`,
      resume: `L'exécution (${trigger}) a échoué : ${String(result.error || 'erreur inconnue').slice(0, 300)}. `
        + `Prochaine tentative à la prochaine échéance — ou « Exécuter maintenant » depuis Paramètres → Attaché IA.`
        + suite,
    }).catch(() => {})
  }
  return { ok: result.ok, convId: result.convId, error: result.error }
}

async function maybeDueRoutines() {
  if (routineRunning) return
  const keys = loadKeyring()
  if (!keys) return
  const due = dueRoutines(keys)
  if (!due.length) return
  if (await autonomousOnHold(keys, 'routines')) return
  routineRunning = true
  try {
    for (const r of due) {
      await runRoutine(r).catch((e) => console.error('[attache] routine :', e))
    }
  } finally {
    routineRunning = false
  }
}

// ── Apprentissage : consolidation périodique de la mémoire ──
// Les signaux d'expérience (propositions ✓/✗, actes révisés/corrigés à la
// main, leçons notées) sont captés au fil de l'eau SANS le modèle — la
// consolidation est le seul moment payé en jetons : un run COURT, sur le
// modèle économe des sous-agents, qui distille signaux + mémoire en un
// document sous budget. Déclenchée par accumulation, dépassement du budget
// mémoire ou cadence de fond (consolidationDue), et à la demande depuis
// Paramètres → Attaché IA → Apprentissage.
let apprentissageRunning = false
async function runApprentissage(trigger = 'auto') {
  if (apprentissageRunning) return { ok: false, error: 'consolidation déjà en cours' }
  const keys = loadKeyring()
  if (!keys) return { ok: false, error: 'trousseau non remis' }
  apprentissageRunning = true
  try {
    console.log(`[attache] consolidation d'apprentissage (${trigger})`)
    // borne haute des signaux couverts par CE run, figée AVANT (ceux qui
    // arrivent pendant le run resteront pour la consolidation suivante) ;
    // la tentative est réservée tout de suite (garde anti-rafale de 12 h).
    const borne = latestSignalTs()
    await writeState({ apprentissage: { ...learningState(), lastAttemptAt: new Date().toISOString() } })
    const result = await runAgent({
      keys,
      prompt: consolidationPrompt({ budget: MEMORY_BUDGET, trigger }),
      runLabel: 'apprentissage',
      title: `Apprentissage ${new Date().toISOString().slice(0, 10)}`,
      model: economicalModel(agentConfig()),
      effort: 'medium',
      maxTurns: 18,
      timeoutMs: 15 * 60 * 1000,
    })
    await writeState({
      apprentissage: {
        ...learningState(),
        lastRunAt: new Date().toISOString(),
        lastRunOk: result.ok,
        lastTrigger: trigger,
        // le point de consolidation n'avance QUE si le run a abouti — sinon
        // les signaux restent en attente pour la prochaine tentative
        ...(result.ok ? { consolidatedTs: borne } : {}),
      },
    })
    await audit(keys, 'apprentissage_consolide', { trigger, ok: result.ok, convId: result.convId, erreur: result.error })
    return { ok: result.ok, convId: result.convId, error: result.error }
  } finally {
    apprentissageRunning = false
  }
}

/** Consolide quand l'échéancier le justifie (vérifié à chaque tick de relève — comptage gratuit). */
async function maybeScheduledApprentissage() {
  if (apprentissageRunning) return
  // Travail de FOND : réservé à la nuit (la consolidation à la demande reste
  // possible à tout moment depuis Paramètres → Attaché IA).
  if (!inNightWindow()) return
  const keys = loadKeyring()
  if (!keys) return
  const raison = consolidationDue(keys)
  if (!raison) return
  if (await autonomousOnHold(keys, 'consolidation')) return
  runApprentissage(`auto — ${raison}`).catch((e) => console.error('[attache] apprentissage :', e))
}

// ── Étude du corpus d'actes validés : extraction de modèles (trames modele-*) ──
// Les pièces des zones Actes/DML sont des versions VALIDÉES (actes signés du
// magistrat, ordonnances JLD) : un run périodique les dépouille (sous-agents,
// copies markdown) et en extrait des GABARITS par type d'acte, plus les
// exigences de motivation des juges (paires requête ↔ ordonnance). Déclenché
// par l'arrivée de nouveaux actes validés ou par cadence — comptage
// déterministe à chaque tick, aucun jeton hors du run lui-même.
let etudeRunning = false
async function runEtude(trigger = 'auto') {
  if (etudeRunning) return { ok: false, error: 'étude déjà en cours' }
  const keys = loadKeyring()
  if (!keys) return { ok: false, error: 'trousseau non remis' }
  etudeRunning = true
  try {
    console.log(`[attache] étude du corpus d'actes validés (${trigger})`)
    // le niveau du corpus couvert par CETTE étude est figé AVANT le run ;
    // la tentative est réservée tout de suite (garde anti-rafale de 24 h)
    const corpus = corpusActesValides()
    await writeState({ etude: { ...etudeState(), lastAttemptAt: new Date().toISOString() } })
    // dépouillement délégué aux sous-agents (un lot par dossier) : le plafond
    // s'échelonne comme les autres analyses de lot
    const timeoutMs = batchTimeoutMs(Math.max(2, corpus.dossiers))
    const result = await runAgent({
      keys,
      prompt: etudePrompt(trigger),
      runLabel: 'etude',
      title: `Étude corpus ${new Date().toISOString().slice(0, 10)}`,
      maxTurns: 30,
      timeoutMs,
      mcpToolTimeoutMs: timeoutMs - 120_000,
    })
    await writeState({
      etude: {
        ...etudeState(),
        lastRunAt: new Date().toISOString(),
        lastRunOk: result.ok,
        lastTrigger: trigger,
        // le niveau couvert n'avance QUE si l'étude a abouti
        ...(result.ok ? { corpusAtRun: corpus.count } : {}),
      },
    })
    await audit(keys, 'etude_corpus', { trigger, corpus: corpus.count, dossiers: corpus.dossiers, ok: result.ok, convId: result.convId, erreur: result.error })
    return { ok: result.ok, convId: result.convId, error: result.error }
  } finally {
    etudeRunning = false
  }
}

/** Étudie quand l'échéancier le justifie (comptage d'index en clair — gratuit). */
async function maybeScheduledEtude() {
  if (etudeRunning) return
  // Travail de FOND (dépouillement en sous-agents) : réservé à la nuit ;
  // « Étudier mes actes maintenant » force l'étude à tout moment.
  if (!inNightWindow()) return
  const keys = loadKeyring()
  if (!keys) return
  const raison = etudeDue()
  if (!raison) return
  if (await autonomousOnHold(keys, 'étude du corpus')) return
  runEtude(`auto — ${raison}`).catch((e) => console.error('[attache] étude :', e))
}

// ── Actualisation automatique de la description (« l'objet ») des dossiers ──
// L'attaché tient la description à jour AU FIL DE L'EAU : à chaque CR rédigé ou
// acte/document téléversé, un run COURT et ÉCONOME reprend la synthèse et la
// fait progresser, en deux parties (SYNTHÈSE globale + MIS EN CAUSE et charges),
// en prise de notes. Déclenché en arrière-plan par la détection de changement
// (maybeScheduledDescriptions, un seul dossier par tick — « lentement ») ou à la
// demande (icône « Actualiser » à côté du titre Description, dans le dossier).
// Période de calme avant de tirer : on attend qu'un dossier ne bouge plus
// (rafale d'ajouts fusionnée en une seule actualisation).
const DESC_QUIET_MS = Math.max(60_000, Number(process.env.SIRAL_ATTACHE_DESC_QUIET_MIN || 3) * 60 * 1000)
// Anti-rafale : jamais deux actualisations du MÊME dossier trop rapprochées.
const DESC_MIN_INTERVAL_MS = Math.max(0, Number(process.env.SIRAL_ATTACHE_DESC_MIN_INTERVAL_MIN || 20) * 60 * 1000)

function descriptionState() {
  const st = readState()
  return st.descriptions && typeof st.descriptions === 'object' ? st.descriptions : {}
}

// Le TEXTE du prompt vit dans attache/consignes.mjs (socle « description ») :
// le magistrat le lit, le complète ou le remplace depuis Paramètres → Attaché IA.
function descriptionPrompt(keys, numero) {
  return promptConsigne(keys, 'description', {
    entete: `ACTUALISATION DE LA DESCRIPTION du dossier « ${numero} » — tâche de fond, silencieuse et économe en jetons.`,
    vars: { dossier: numero },
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
    entete: `ACTUALISATION DES MIS EN CAUSE du dossier « ${numero} » — tâche de fond, silencieuse et économe en jetons.`,
    vars: { dossier: numero },
  })
}

let descriptionRunning = false
async function runActualiserDescription(numero, trigger = 'auto') {
  const num = String(numero || '').trim()
  if (!num) return { ok: false, error: 'numéro requis' }
  // Un seul run de description à la fois (les écritures visent le MÊME coffre) —
  // évite qu'un run n'écrase la description d'un dossier voisin (read-modify-write).
  if (descriptionRunning) return { ok: false, running: true, error: 'actualisation déjà en cours' }
  const keys = loadKeyring()
  if (!keys) return { ok: false, error: 'trousseau non remis' }
  descriptionRunning = true
  try {
    console.log(`[attache] actualisation description « ${num} » (${trigger})`)
    // Le run tient AUSSI la section « Mis en cause » en cohérence : la partie
    // MIS EN CAUSE de la description ne parle que des personnes enregistrées,
    // donc tout nom relevé au passage et absent du dossier part en proposition
    // ✓/✗. On compte avant/après (coût nul) pour le dire au magistrat.
    const avantMec = countPropositionsMec(keys, num)
    const result = await runAgent({
      keys,
      prompt: descriptionPrompt(keys, num),
      runLabel: 'description',
      title: `Description ${num} ${new Date().toISOString().slice(0, 10)}`,
      // Travail de fond léger : modèle économe, effort faible, peu de tours —
      // « minimum de jetons ».
      model: economicalModel(agentConfig()),
      effort: 'low',
      maxTurns: 8,
      timeoutMs: 8 * 60 * 1000,
    })
    const proposees = Math.max(0, countPropositionsMec(keys, num) - avantMec)
    await audit(keys, 'description_actualisee', { numero: num, trigger, ok: result.ok, proposees, convId: result.convId, erreur: result.error })
    // Recale le point de référence sur l'état COURANT (la signature exclut la
    // description, donc l'écriture ne l'a pas fait bouger) : l'auto ne se
    // redéclenche pas immédiatement, l'anti-rafale part de maintenant.
    try {
      const sig = dossierSyntheseSignals(keys).find((d) => d.numero === num)?.signature
      const descs = descriptionState()
      descs[num] = { sig: sig ?? descs[num]?.sig ?? '', lastRefreshedAt: new Date().toISOString(), pendingSig: null, pendingSince: null }
      await writeState({ descriptions: descs })
    } catch { /* recalage best-effort */ }
    return { ok: result.ok, proposees, convId: result.convId, error: result.error }
  } finally {
    descriptionRunning = false
  }
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
    const result = await runAgent({
      keys,
      prompt: mecPrompt(keys, num),
      runLabel: 'mec',
      title: `Mis en cause ${num} ${new Date().toISOString().slice(0, 10)}`,
      // Même régime que la description : modèle économe, effort faible, peu de tours.
      model: economicalModel(agentConfig()),
      effort: 'low',
      maxTurns: 8,
      timeoutMs: 8 * 60 * 1000,
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

/**
 * Actualise en fond la description des dossiers qui ont bougé (nouveau CR, acte
 * ou document téléversé). Comptage déterministe à chaque tick (aucun jeton hors
 * du run lui-même) : on repère les dossiers dont la signature a changé, on
 * attend une courte période de calme (fusion des rafales), puis on n'en tire
 * qu'UN seul par tick — la mise à jour se fait donc lentement, en arrière-plan.
 */
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
    if (b.empreintes || b.extraites || b.entites || b.echecs) {
      console.log(`[attache] ingestion : ${b.dossiers} dossier(s) — ${b.empreintes} empreinte(s), ${b.extraites} texte(s) extraits, ${b.entites} entrée(s) de registre, ${b.echecs} échec(s) mémorisé(s)${b.enAttente ? `, ${b.enAttente} pièce(s) au prochain tick` : ''}`)
    }
  } finally {
    ingestRunning = false
  }
}

// ── Mini-fiches du registre (fil de l'eau, modèle économe) ──
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

async function maybeScheduledDescriptions() {
  if (descriptionRunning) return
  const keys = loadKeyring()
  if (!keys) return
  let signals
  try { signals = dossierSyntheseSignals(keys) } catch { return }
  const descs = descriptionState()
  const now = Date.now()
  const present = new Set()
  let patched = false
  let due = null // { numero, pendingSince }
  for (const { numero, signature } of signals) {
    present.add(numero)
    const prev = descs[numero]
    if (!prev) {
      // Baseline SILENCIEUSE au premier passage : on n'actualise pas d'un coup
      // tout le stock existant — on ne réagit qu'aux changements ULTÉRIEURS.
      descs[numero] = { sig: signature, lastRefreshedAt: null, pendingSig: null, pendingSince: null }
      patched = true
      continue
    }
    if (signature === prev.sig) {
      // stable : purge d'un « en attente » devenu obsolète
      if (prev.pendingSig) { prev.pendingSig = null; prev.pendingSince = null; patched = true }
      continue
    }
    // le dossier a bougé depuis la dernière référence
    if (prev.pendingSig !== signature) {
      // nouveau changement (ou changement qui a encore évolué) : (re)démarre le calme
      prev.pendingSig = signature
      prev.pendingSince = now
      patched = true
      continue
    }
    // même changement en attente : période de calme écoulée + anti-rafale ?
    const quietOk = now - (prev.pendingSince || now) >= DESC_QUIET_MS
    const intervalOk = !prev.lastRefreshedAt || now - Date.parse(prev.lastRefreshedAt) >= DESC_MIN_INTERVAL_MS
    if (quietOk && intervalOk && (!due || (prev.pendingSince || 0) < due.pendingSince)) {
      due = { numero, pendingSince: prev.pendingSince || 0 }
    }
  }
  // Purge des dossiers disparus (archivés / supprimés) pour ne pas gonfler l'état.
  for (const numero of Object.keys(descs)) {
    if (!present.has(numero)) { delete descs[numero]; patched = true }
  }
  if (patched) await writeState({ descriptions: descs })
  if (!due) return
  // Forfait saturé : on diffère (rien n'est perdu — le dossier reste « en
  // attente », on relira au prochain tick une fois la fenêtre redescendue).
  if (await autonomousOnHold(keys, 'actualisation des descriptions')) return
  // Un seul dossier par tick → « en arrière-plan, lentement ».
  runActualiserDescription(due.numero, 'auto').catch((e) => console.error('[attache] description :', e))
}

// Plafond de durée d'une analyse de LOT (trames, base de connaissances) : ces
// runs délèguent à des sous-agents en parallèle (vagues bornées par la
// concurrence, ~8 min/tâche) et dépassent facilement les 20 min d'un run de
// chat. On échelonne selon la taille du lot, borné à ~2 h, ajustable par env.
const BATCH_TIMEOUT_MIN_BASE = Number(process.env.SIRAL_ATTACHE_BATCH_TIMEOUT_MIN || 25)
const BATCH_TIMEOUT_MIN_MAX = Number(process.env.SIRAL_ATTACHE_BATCH_TIMEOUT_MAX_MIN || 120)
function batchTimeoutMs(count) {
  const n = Math.max(1, Number(count) || 1)
  const minutes = Math.min(BATCH_TIMEOUT_MIN_MAX, BATCH_TIMEOUT_MIN_BASE + n * 6)
  return minutes * 60 * 1000
}

// Analyse transversale de renseignement lancée depuis le CHAT carto : comme
// l'étude du corpus, elle délègue à des sous-agents (un par dossier) et dépasse
// très largement les 20 min d'un run de chat ordinaire — c'est ce qui la
// faisait TUER avant d'avoir déposé la moindre proposition (« jamais de
// résultat »). On accorde donc aux runs carto le même ordre de grandeur qu'un
// run de lot, plafonné et ajustable par env. Ce plafond n'est qu'un garde-fou
// de durée : une question carto brève finit en quelques secondes (le minuteur
// est alors annulé), il ne ralentit rien. Le run se poursuit côté serveur même
// si le flux SSE se coupe : les propositions se déposent quand même et
// apparaissent dans le module de revue de la carte.
const CARTO_CHAT_TIMEOUT_MIN = Number(process.env.SIRAL_ATTACHE_CARTO_TIMEOUT_MIN || 90)
const CARTO_CHAT_TIMEOUT_MS = Math.max(20, CARTO_CHAT_TIMEOUT_MIN) * 60 * 1000

// ── Classement des trames de la bibliothèque (description par trame) ──
// « Ranger / classer » est une passe de DESCRIPTION rapide (classer.mjs) : un
// appel modèle par lot de ~20 trames, sans outil ni sous-agent. Auparavant, ce
// bouton déléguait UNE analyse juridique approfondie à N sous-agents rassemblés
// par un run principal qui ré-ingérait tout — lent, souvent tué avant de rendre
// quoi que ce soit, et ruineux en jetons. L'analyse en profondeur d'UNE trame
// reste possible à la demande, dans le chat de l'attaché.
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
// Les runs AUTONOMES (routines planifiées, étude du corpus, consolidation)
// sont la première source de sous-agents en parallèle — le poste qui fait
// exploser la fenêtre glissante de 5 h. Quand elle est pleine (config.cap5h),
// on les DIFFÈRE : rien n'est perdu, ils repartiront tout seuls au prochain tick
// une fois la fenêtre redescendue. On NE met JAMAIS en pause le chat du magistrat
// ni le traitement des mails (sa demande directe) — ceux-là sont seulement
// resserrés par le gouverneur des sous-agents. Sans plafond configuré, le
// gouverneur est inerte (aucun run n'est différé).
// Fenêtre de NUIT (heure serveur) réservée aux travaux de FOND lourds — étude
// du corpus, consolidation de l'apprentissage. Hors de la journée de travail,
// ils ne disputent jamais le forfait aux mails et au chat du magistrat (sa
// priorité : répondre à ses demandes et rédiger les actes). Repli 22 h → 7 h ;
// réglable, et désactivable (mettre début = fin) pour tout autoriser.
const NIGHT_START = Math.min(23, Math.max(0, Number(process.env.SIRAL_ATTACHE_NIGHT_START ?? 22)))
const NIGHT_END = Math.min(23, Math.max(0, Number(process.env.SIRAL_ATTACHE_NIGHT_END ?? 7)))
function inNightWindow(now = new Date()) {
  if (NIGHT_START === NIGHT_END) return true // fenêtre neutralisée : nuit = toujours
  const h = now.getHours()
  return NIGHT_START < NIGHT_END ? (h >= NIGHT_START && h < NIGHT_END) : (h >= NIGHT_START || h < NIGHT_END)
}

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

// ── Chantiers d'analyse profonde : boucle de dépouillement ──
// Un pas = un lot (~12 pièces → une fiche). La boucle enchaîne les pas tant
// que le feu est vert — nuit si le chantier l'exige, forfait non saturé —
// puis rend la main ; le tick suivant la relance. Chaque pas persiste tout :
// un arrêt (service, forfait, nuit finie) ne coûte jamais plus qu'un lot.
let chantierLoopRunning = false
async function maybeChantiers() {
  if (chantierLoopRunning) return
  {
    const keys0 = loadKeyring()
    if (!keys0 || !chantierActif(keys0)) return
  }
  chantierLoopRunning = true
  try {
    for (;;) {
      const keys = loadKeyring() // rechargé à chaque pas : une révocation vaut immédiatement
      if (!keys) break
      const verdict = await chantierStep(keys, (ch) => {
        const gov = consumptionGovernor(agentConfig())
        if (gov.level === 'stop') return { ok: false, attente: 'forfait' }
        if (ch.nuitSeulement && !inNightWindow()) return { ok: false, attente: 'nuit' }
        return { ok: true }
      })
      if (verdict !== 'travail') break
      await new Promise((r) => setTimeout(r, 3_000)) // respiration entre deux lots
    }
  } catch (e) {
    console.error('[attache] chantiers :', e)
  } finally {
    chantierLoopRunning = false
  }
}

// ── Boucle de relève ──
let polling = false
async function pollOnce(trigger = 'planifié') {
  if (polling) return { ok: false, error: 'relève déjà en cours' }
  polling = true
  try {
    const keys = loadKeyring()
    if (!keys) return { ok: false, error: 'trousseau non remis' }
    const res = await fetchInbox(keys)
    if (res.ok && res.ingested.length) {
      console.log(`[attache] ${res.ingested.length} message(s) ingéré(s) (${trigger})`)
      for (const id of res.ingested) queueProactiveRun(keys, id)
    }
    // Rattrapage : messages ingérés mais jamais traités (crash, redémarrage,
    // run en échec). Reprise pilotée par proactiveAttempts : jusqu'à
    // PROACTIVE_MAX_ATTEMPTS tentatives espacées d'un délai croissant, puis
    // abandon EXPLICITE (carte au fil) — plus d'arrêt silencieux.
    const now = Date.now()
    const pending = listInbox(keys).filter((m) => !m.traite)
    const known = new Set(res.ingested)
    for (const m of pending) {
      if (known.has(m.id)) continue
      const st = proactiveAttempts.get(m.id)
      // Relève MANUELLE (bouton du panneau) : le magistrat demande une reprise —
      // on remet le compteur à zéro, y compris pour un mail abandonné.
      if (trigger === 'manuel' && st) { proactiveAttempts.delete(m.id); queueProactiveRun(keys, m.id); continue }
      if (st?.abandoned) continue
      if (st && st.count >= PROACTIVE_MAX_ATTEMPTS) { await noteProactiveFailure(keys, m.id, 'reprises épuisées'); continue }
      if (st?.nextRetryAt && now < st.nextRetryAt) continue // backoff en cours
      queueProactiveRun(keys, m.id)
    }
    // Purge douce de l'état des mails traités/disparus (le service peut tourner des mois).
    if (proactiveAttempts.size > 200) {
      const alive = new Set(pending.map((m) => m.id))
      for (const id of proactiveAttempts.keys()) if (!alive.has(id)) proactiveAttempts.delete(id)
    }
    return res
  } finally {
    polling = false
  }
}

// ── API HTTP interne ──
const server = http.createServer(async (req, res) => {
  if (!authorized(req)) return json(res, 401, { error: 'Non autorisé' })
  const url = new URL(req.url, 'http://internal')
  const route = `${req.method} ${url.pathname}`

  try {
    if (route === 'GET /status') {
      const master = loadMasterKey()
      const keys = master ? loadKeyring() : null
      const cli = await checkClaudeCli()
      const mail = mailConfig()
      return json(res, 200, {
        enabled: true,
        tj: attacheTj(),
        contentieux: attacheContentieux(),
        masterKey: Boolean(master),
        keyring: keyringStatus(),
        scopesAttendus: allowedScopes(),
        claude: cli,
        mail: {
          imap: mail.imapReady, smtp: mail.smtpReady,
          owner: mail.owner ? mail.owner.replace(/^(..).*(@.*)$/, '$1…$2') : null,
          ...describeMailConfig(),
        },
        inbox: keys ? inboxStats(keys) : null,
        runsEnCours: running,
        state: readState(),
        config: agentConfig(),
        governor: consumptionGovernor(agentConfig()),
      })
    }

    if (route === 'GET /config') {
      return json(res, 200, { config: agentConfig() })
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

    if (route === 'POST /check-mail') {
      const out = await pollOnce('manuel')
      return json(res, 200, out)
    }

    if (route === 'POST /mail-test') {
      // diagnostic seul : ouvre INBOX en lecture seule, ne relève rien
      const out = await testImapConnection()
      const keys = loadKeyring()
      if (keys) await audit(keys, 'mail_test', { ok: out.ok, messages: out.messages ?? null, erreur: out.error || null })
      return json(res, 200, out)
    }

    if (route === 'PUT /mail-config') {
      // réglages IMAP/SMTP saisis dans l'app — chiffrés au repos par la clé-maître
      const body = await readBody(req)
      const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : undefined)
      const patch = {}
      if ('imapHost' in body) patch.imapHost = str(body.imapHost, 255)
      if ('imapUser' in body) patch.imapUser = str(body.imapUser, 320)
      if ('imapPassword' in body) patch.imapPassword = typeof body.imapPassword === 'string' ? body.imapPassword.slice(0, 1024) : undefined
      if ('imapPort' in body) patch.imapPort = Number(body.imapPort) || 993
      if ('imapSecure' in body) patch.imapSecure = body.imapSecure !== false
      if ('smtpHost' in body) patch.smtpHost = str(body.smtpHost, 255)
      if ('smtpUser' in body) patch.smtpUser = str(body.smtpUser, 320)
      if ('smtpPassword' in body) patch.smtpPassword = typeof body.smtpPassword === 'string' ? body.smtpPassword.slice(0, 1024) : undefined
      if ('smtpPort' in body) patch.smtpPort = Number(body.smtpPort) || 465
      if ('smtpSecure' in body) patch.smtpSecure = body.smtpSecure !== false
      if ('from' in body) patch.from = str(body.from, 320)
      try {
        writeMailOverride(patch, String(body.par || 'admin'))
      } catch (e) {
        return json(res, 500, { ok: false, error: String(e?.message || e) })
      }
      const keys = loadKeyring()
      if (keys) await audit(keys, 'mail_config_modifiee', { imapHost: patch.imapHost ?? null, imapUser: patch.imapUser ?? null, par: String(body.par || 'admin') })
      return json(res, 200, { ok: true, mail: describeMailConfig() })
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

    if (route === 'DELETE /mail-config') {
      const removed = clearMailOverride()
      const keys = loadKeyring()
      if (keys) await audit(keys, 'mail_config_effacee', { removed })
      return json(res, 200, { ok: true, removed, mail: describeMailConfig() })
    }

    if (route === 'POST /actualiser-description') {
      // Actualisation À LA DEMANDE (icône « Actualiser » du dossier) : run court,
      // AWAITÉ ici pour que le navigateur enchaîne sur syncAndRefresh et voie la
      // nouvelle description tout de suite. Un seul à la fois (voir le lock).
      const body = await readBody(req)
      const numero = String(body.numero || '').trim()
      if (!numero) return json(res, 400, { ok: false, error: 'Numéro requis' })
      if (!loadKeyring()) return json(res, 409, { ok: false, error: 'Trousseau non remis' })
      const out = await runActualiserDescription(numero, 'manuel')
      if (out.running) return json(res, 202, { ok: true, running: true })
      return json(res, out.ok ? 200 : 502, out)
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

    if (route === 'GET /apprentissage') {
      // statut de l'apprentissage : signaux en attente, dernière consolidation,
      // mémoire face à son budget, étude du corpus — lisible même trousseau
      // non remis (dégradé)
      return json(res, 200, {
        apprentissage: {
          ...learningStatus(loadKeyring()),
          running: apprentissageRunning,
          etude: { ...etudeStatus(), running: etudeRunning },
        },
      })
    }

    if (route === 'POST /apprentissage') {
      // consolidation à la demande — lancée en fond, comme les autres runs de fond
      if (apprentissageRunning) return json(res, 409, { ok: false, error: 'Consolidation déjà en cours' })
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { ok: false, error: 'Trousseau non remis' })
      runApprentissage('manuelle').catch((e) => console.error('[attache] apprentissage :', e))
      return json(res, 202, { ok: true, started: true })
    }

    if (route === 'POST /etude') {
      // étude du corpus à la demande — lancée en fond
      if (etudeRunning) return json(res, 409, { ok: false, error: 'Étude déjà en cours' })
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { ok: false, error: 'Trousseau non remis' })
      runEtude('manuelle').catch((e) => console.error('[attache] étude :', e))
      return json(res, 202, { ok: true, started: true })
    }

    if (route === 'GET /productions') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      // Variantes d'écriture du numéro comprises : l'atelier « Actes rédigés »
      // de l'enquête « 85103/843/2026 - GRIVESNES 2 » voit aussi les actes
      // rangés sous « 85103/843/2026 » (même dossier, écriture courte).
      return json(res, 200, { productions: listEnvelopesDossier(keys, url.searchParams.get('numero') || '') })
    }

    if (route === 'PUT /production') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      const body = await readBody(req, 4 * 1024 * 1024)
      const env = body.envelope
      if (!env || env.encrypted !== true || typeof env.iv !== 'string' || typeof env.ct !== 'string') {
        return json(res, 400, { error: 'Enveloppe chiffrée requise' })
      }
      const numero = String(body.numero || '')
      const id = String(body.id || '')
      if (!/^[a-f0-9]{6,32}$/.test(id)) return json(res, 400, { error: 'id invalide' })
      // État AVANT (le jet de l'attaché) puis contenu APRÈS (la correction du
      // magistrat) : le service détient la clé globale et compare dans SON
      // enceinte, sans jamais exposer le texte à l'app. On ne capte un signal
      // d'apprentissage QUE si le CONTENU a réellement changé — une simple
      // validation (✓) ou une réouverture (qui ré-enregistrent aussi l'acte)
      // ne sont pas des corrections et ne doivent rien « apprendre ».
      const avant = readProduction(keys, numero, id)
      let apres = null
      try { apres = decryptJson(keys.global, env) } catch { /* enveloppe d'une autre clé : on stocke sans analyser */ }
      const { archivedAt } = await writeEnvelope(numero, id, env)
      await audit(keys, 'production_editee_main', { numero, id })
      // REFUS du magistrat : transition vers refuse=true (le contenu, lui, n'a
      // pas changé). Signal FORT — le motif, saisi pour l'apprentissage, est en
      // clair dans le detail (chiffré au repos comme tout signal) pour que la
      // consolidation comprenne le rejet et n'y retombe pas. Une simple
      // réouverture (refuse repassé à false) n'apprend rien.
      const refusMaintenant = !!(apres && apres.refuse && !(avant && avant.refuse))
      if (refusMaintenant) {
        const source = apres.source
        const titre = String(apres.titre || '').slice(0, 80)
        const motif = String(apres.refuseMotif || '').replace(/\s+/g, ' ').trim().slice(0, 320)
        await audit(keys, 'production_refusee', { numero, id })
        await recordLearningSignal(keys, {
          type: 'acte_refuse',
          dossier: numero,
          source: source ? `trame ${source}` : undefined,
          // Motif en fin de chaîne : si le detail dépasse le plafond de capture,
          // c'est sa queue qui est tronquée, jamais le fait ni le début du motif.
          detail: `acte ${id}${titre ? ` « ${titre} »` : ''} REFUSÉ par le magistrat`
            + `${motif ? ` — motif : ${motif}` : ' (sans motif précisé)'}`,
        })
      }
      const contenuChange = !!(apres && avant && String(avant.contenu || '') !== String(apres.contenu || ''))
      if (contenuChange) {
        // Signal FORT : le magistrat a corrigé l'acte À LA MAIN — le premier
        // jet ne répondait pas pleinement à ses exigences. Le texte reste
        // chiffré : on capte le FAIT + un POINTEUR (versionAt) vers le diff
        // exact, que la consolidation lira (production_diff) pour comprendre
        // la correction et la mémoriser. On porte la trame suivie (source)
        // pour relier une trame à des retouches répétées.
        const source = apres.source || avant.source
        const titre = String(apres.titre || avant.titre || '').slice(0, 80)
        await recordLearningSignal(keys, {
          type: 'acte_edite_main',
          dossier: numero,
          source: source ? `trame ${source}` : undefined,
          detail: `acte ${id}${titre ? ` « ${titre} »` : ''} corrigé à la main — `
            + `production_diff numero="${numero}" id="${id}"${archivedAt ? ` versionAt="${archivedAt}"` : ''} `
            + 'montre exactement ce que le magistrat a retiré/ajouté ; distille-le en règle.',
        })
      }
      return json(res, 200, { ok: true, contenuChange })
    }

    if (route === 'DELETE /production') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      const ok = await deleteProduction(url.searchParams.get('numero') || '', url.searchParams.get('id') || '')
      if (ok) await audit(keys, 'production_supprimee', { numero: url.searchParams.get('numero'), id: url.searchParams.get('id') })
      return json(res, 200, { ok })
    }

    if (route === 'GET /dossier-memoire') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      return json(res, 200, { memoire: readDossierMemory(keys, url.searchParams.get('numero') || '') })
    }

    if (route === 'PUT /dossier-memoire') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      const body = await readBody(req)
      const { setDossierMemory } = await import('./attache/dossierMemory.mjs')
      await setDossierMemory(keys, String(body.numero || ''), String(body.contenu || ''))
      return json(res, 200, { ok: true })
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

    if (route === 'POST /analyse-documents') {
      // Extraction stateless : ne touche à AUCUNE donnée chiffrée du coffre —
      // le navigateur admin envoie le texte des PDF et le résumé des actes.
      // Pas besoin du trousseau ; seul le CLI claude est sollicité.
      const body = await readBody(req, 8 * 1024 * 1024)
      const docs = Array.isArray(body.docs) ? body.docs : []
      if (!docs.length) return json(res, 400, { ok: false, error: 'Aucun document fourni' })
      try {
        const out = await analyseDocuments({ docs, actesExistants: body.actesExistants || [], enquete: body.enquete || null })
        return json(res, out.ok ? 200 : 502, out)
      } catch (e) {
        return json(res, 500, { ok: false, error: String(e?.message || e).slice(0, 400) })
      }
    }

    if (route === 'GET /routines') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      return json(res, 200, { routines: listRoutines(keys) })
    }

    if (route === 'POST /routines') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      const body = await readBody(req)
      const out = await upsertRoutine(keys, body)
      await audit(keys, 'routine_enregistree', { nom: body.nom, par: String(body.par || 'admin') })
      return json(res, 200, { ok: true, ...out })
    }

    if (route === 'DELETE /routines') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      const id = url.searchParams.get('id') || ''
      const out = await deleteRoutine(keys, id)
      return json(res, 200, { ok: true, ...out })
    }

    if (route === 'POST /routines/run') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      const id = url.searchParams.get('id') || ''
      const routine = listRoutines(keys).find((r) => r.id === id)
      if (!routine) return json(res, 404, { error: 'Routine inconnue' })
      // lancée en fond : la réponse ne bloque pas sur le run
      runRoutine(routine, 'manuelle').catch((e) => console.error('[attache] routine :', e))
      return json(res, 202, { ok: true, started: true })
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

    if (route === 'POST /associations/suggest') {
      // Propose des associations acte → trame + skill (un appel modèle, sans
      // sous-agent) SANS RIEN ÉCRIRE : le panneau charge les suggestions en
      // brouillon, le magistrat vérifie et enregistre. Action DIRECTE du
      // magistrat (bouton) : synchrone, jamais différée par le gouverneur.
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { ok: false, error: 'Trousseau non remis' })
      try {
        const out = await suggererAssociations(keys)
        await audit(keys, 'associations_suggerees', { nb: out.suggestions?.length || 0, ok: out.ok }).catch(() => {})
        return json(res, out.ok ? 200 : 502, out)
      } catch (e) {
        return json(res, 500, { ok: false, error: String(e?.message || e).slice(0, 300) })
      }
    }

    if (route === 'GET /chronologie') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      const numero = url.searchParams.get('numero') || ''
      const chrono = buildChronologie(keys, numero)
      return chrono ? json(res, 200, chrono) : json(res, 404, { error: 'Dossier introuvable' })
    }

    if (route === 'GET /stats-graphique') {
      // Un graphique statistique (PNG + données), régénéré à la demande avec
      // les MÊMES règles et couleurs que la page Statistiques — sert à
      // remplacer les marqueurs [GRAPHIQUE : …] des bilans à l'export PDF/Word.
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      try {
        const { titre, note, donnees, png } = genererGraphique(keys, {
          graphique: url.searchParams.get('graphique') || '',
          du: url.searchParams.get('du') || undefined,
          au: url.searchParams.get('au') || undefined,
        })
        return json(res, 200, { titre, note, donnees, png: png.toString('base64') })
      } catch (e) {
        return json(res, 400, { error: String(e?.message || e) })
      }
    }

    if (route === 'POST /cotes') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      const body = await readBody(req, 8 * 1024 * 1024)
      const out = await saveArchitecture(keys, String(body.numero || ''), String(body.texte || ''))
      if (out.ok) await audit(keys, 'cotes_importees', { numero: body.numero, nbCotes: out.nbCotes, par: String(body.par || 'admin') })
      return json(res, out.ok ? 200 : 400, out)
    }

    if (route === 'GET /inbox') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      return json(res, 200, { messages: listInbox(keys) })
    }

    // Le catalogue des prompts métier (socles intégrés) — servi au panneau
    // d'administration pour que le magistrat voie ce qu'il complète ou remplace.
    if (route === 'GET /consignes-catalogue') {
      return json(res, 200, { catalogue: catalogueAvecSocles() })
    }

    // ── Chantiers d'analyse profonde ──
    if (route === 'GET /chantiers') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      return json(res, 200, { chantiers: listChantiers(keys) })
    }

    if (route === 'POST /chantiers') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      const body = await readBody(req, 256 * 1024)
      try {
        if (body.action) {
          const out = await actionChantier(keys, { id: String(body.id || ''), action: String(body.action) })
          // « lancer » : premier lot sans attendre le prochain tick (si le feu est vert)
          if (body.action === 'lancer') setTimeout(() => { maybeChantiers().catch(() => {}) }, 50)
          return json(res, 200, out)
        }
        const ch = await createChantier(keys, {
          type: ['dossier', 'liens', 'carto'].includes(body.type) ? body.type : 'dossier',
          numero: String(body.numero || ''),
          numeros: Array.isArray(body.numeros) ? body.numeros.map((n) => String(n)).filter(Boolean).slice(0, 12) : undefined,
          consigne: String(body.consigne || ''),
          nuitSeulement: body.nuitSeulement !== false,
        })
        return json(res, 200, ch)
      } catch (e) {
        return json(res, 400, { error: String(e?.message || e) })
      }
    }

    // Vider la boîte : les messages traités (défaut) ou tout (mode=tous).
    if (route === 'DELETE /inbox') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      const mode = url.searchParams.get('mode') === 'tous' ? 'tous' : 'traites'
      return json(res, 200, await purgeInbox(keys, { mode }))
    }

    // ── Relais d'écriture des collections (trames, skills, kb) ──
    // L'app web écrit d'abord elle-même sur le volume partagé ; quand son
    // utilisateur non-root se heurte à un répertoire créé par le service
    // (EACCES), elle relaie ici — le service écrit la même enveloppe opaque.
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

    if (route === 'GET /conversations') {
      return json(res, 200, { conversations: listConversations() })
    }

    if (route === 'GET /conversation') {
      const id = url.searchParams.get('id') || ''
      const envelope = readConversationEnvelope(id)
      return envelope ? json(res, 200, { envelope }) : json(res, 404, { error: 'Introuvable' })
    }

    if (route === 'DELETE /conversation') {
      const id = url.searchParams.get('id') || ''
      return json(res, 200, { ok: deleteConversation(id) })
    }

    if (route === 'POST /chat') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis — remettez les clés depuis Paramètres → Attaché' })
      const body = await readBody(req)
      const message = String(body.message || '').slice(0, 100_000)
      if (!message.trim()) return json(res, 400, { error: 'Message vide' })

      // Chat rattaché à un dossier précis (chat flottant) : on injecte le
      // contexte au PREMIER message de la conversation, pour cadrer l'agent
      // sans le répéter à chaque tour.
      let prompt = message
      if (body.carto && !body.convId) {
        prompt = promptConsigne(keys, 'carto_chat', {
          entete: 'CONTEXTE : le magistrat te consulte depuis le module CARTOGRAPHIE (vue réseau des personnes et affaires du contentieux).',
          donnees: ['', `Question du magistrat : ${message}`],
        })
      } else if (body.dossier && !body.convId) {
        const cadre = body.cadre === 'instruction' ? 'à l\'instruction' : 'en enquête préliminaire'
        const memoire = readDossierMemory(keys, String(body.dossier))
        prompt = [
          `CONTEXTE : le magistrat te consulte sur le dossier « ${String(body.dossier).slice(0, 80)} » (${cadre}), depuis le chat flottant ouvert sur ce dossier.`,
          'Sauf mention contraire, TOUTES ses questions portent sur ce dossier. Commence par lire_dossier (aperçu compact : objet, parties, actes + échéances, index des CR). Pour une donnée PRÉCISE (un propriétaire, une date, une échéance, une ligne), NE relis pas tout : cible-la — lire_dossier section:"fiche" cible:"<nom/ligne>", section:"cr" offset/limit pour un CR entier, ou lire_document sur une pièce. Pour LOCALISER une information dans les PIÈCES (« où parle-t-on de… », un nom, un numéro, une plaque) : registre_lire numero filtre:"…" (sommaire pièce par pièce — type, date, personnes, entités, résumé) puis pieces_chercher pour le texte intégral — les deux à coût nul, chemins + extraits en main ; relance pieces_chercher si des pièces restent nonExtraites. diagnostic_dossier, chronologie_lire, verifier_completude selon le besoin.',
          'RÔLE — aide au contrôle et à la maîtrise : surveiller la direction d\'enquête (éparpillement des enquêteurs : partent-ils dans tous les sens ?), la cohérence entre actes demandés et réalisés, et LES DÉLAIS (en préliminaire, les TSE sont enserrés dans des délais courts — 2 mois typiquement — qui contraignent l\'action ; signale tout risque de dépassement et son incidence).',
          'Réponses concises, factuelles, chiffrées, orientées décision. Tu peux déposer des propositions (proposer_mec/acte/cr) mais tu n\'écris jamais directement au dossier sans instruction explicite.',
          'CANTONNEMENT : tu es l\'attaché de CE dossier et tu deviens progressivement SON expert. Les outils transversaux (carto_*, lister_dossiers, recoupements hors dossier) ne servent que sur demande EXPLICITE du magistrat. S\'il veut comparer ou relier ce dossier à d\'autres, propose-lui de lancer un chantier « liens entre dossiers » (page Assistant de justice) — vérifie d\'abord chantiers_etat pour ne pas proposer ce qui tourne déjà.',
          'FICHES D\'ABORD : si un chantier d\'analyse profonde est passé, le dossier a des FICHES (productions_lister → type « fiche » ; production_lire) et souvent une synthèse. Pour toute question de fond, appuie-toi dessus AVANT de relire des pièces — elles portent les cotes. Sans fiches, ne te lance JAMAIS dans une relecture massive : réponds sur pièces ciblées et, si la demande exige un vrai dépouillement, propose au magistrat de lancer un chantier (état courant : chantiers_etat).',
          'MÉMOIRE DU DOSSIER : ci-dessous l\'essentiel retenu. Deux registres, à respecter strictement — « [fait] … (cote) » : un élément du dossier, TOUJOURS coté ; « [échange] JJ/MM/AAAA — … » : une position, décision ou orientation exprimée par le magistrat, datée. Ne sers JAMAIS un [échange] comme un fait établi : c\'est un souvenir de conversation, à rappeler comme tel (« on en avait parlé : … »). Quand un échange apporte du neuf, ajoute UNE ligne télégraphique du bon registre avec memoire_dossier_noter. Reste bref : cette mémoire est volontairement petite.',
          memoire ? `--- mémoire du dossier ---\n${memoire}\n--- fin ---` : '(mémoire du dossier vide pour l\'instant)',
          '',
          `Question du magistrat : ${message}`,
        ].join('\n')
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      const send = (ev) => { try { res.write(`data: ${JSON.stringify(ev)}\n\n`) } catch {} }
      const heartbeat = setInterval(() => { try { res.write(': ping\n\n') } catch {} }, 15_000)

      await audit(keys, 'chat_message', { convId: body.convId || '(nouvelle)', dossier: body.dossier || null, carto: Boolean(body.carto), apercu: message.slice(0, 200) })
      const result = await runAgent({
        keys,
        prompt,
        convId: body.convId || undefined,
        title: body.carto ? 'Cartographie' : body.dossier ? `Dossier ${body.dossier}` : undefined,
        runLabel: body.carto ? 'chat-carto' : body.dossier ? 'chat-dossier' : 'chat',
        onEvent: send,
        model: body.model,
        effort: body.effort,
        // Le chat carto peut déclencher une analyse transversale (sous-agents
        // sur des dizaines de dossiers) : plafond de durée élargi, sinon le run
        // est tué à 20 min avant de déposer ses propositions.
        ...(body.carto ? { timeoutMs: CARTO_CHAT_TIMEOUT_MS, mcpToolTimeoutMs: CARTO_CHAT_TIMEOUT_MS - 120_000 } : {}),
      })
      clearInterval(heartbeat)
      send({ type: 'final', convId: result.convId, ok: result.ok, error: result.error, replace: result.replace })
      return res.end()
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
  console.log(`[attache] relève boîte toutes les ${POLL_MINUTES} min`)
})

setInterval(() => {
  pollOnce().catch((e) => console.error('[attache] relève :', e))
  maybeDueRoutines().catch((e) => console.error('[attache] routines :', e))
  maybeScheduledApprentissage().catch((e) => console.error('[attache] apprentissage planifié :', e))
  maybeScheduledEtude().catch((e) => console.error('[attache] étude planifiée :', e))
  maybeScheduledDescriptions().catch((e) => console.error('[attache] descriptions :', e))
  maybeIngest().catch((e) => console.error('[attache] ingestion :', e))
  maybeRegistreFiches().catch((e) => console.error('[attache] registre :', e))
  maybeChantiers().catch((e) => console.error('[attache] chantiers :', e))
}, POLL_MINUTES * 60 * 1000)
// première relève 20 s après le démarrage (laisse le réseau docker s'établir)
setTimeout(() => { pollOnce('démarrage').catch(() => {}) }, 20_000)
writeState({ startedAt: new Date().toISOString() }).catch(() => {})
