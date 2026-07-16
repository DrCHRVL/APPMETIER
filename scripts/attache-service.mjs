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
import { attacheTj, attacheContentieux, readState, writeState, fixSharedPermissions, writeCollectionEnvelopeRaw, deleteCollectionEnvelopeRaw, writeSingleEnvelopeRaw, setStatusMapEntryRaw } from './attache/store.mjs'
import { audit, publishFeed } from './attache/journal.mjs'
import { fetchInbox, listInbox, mailConfig, inboxStats, markInboxStatus, readInboxMessage, describeMailConfig, testImapConnection, writeMailOverride, clearMailOverride } from './attache/mail.mjs'
import { runAgent, checkClaudeCli, listConversations, readConversationEnvelope, deleteConversation, agentConfig, sanitizeModel, sanitizeEffort } from './attache/agent.mjs'
import { saveArchitecture, buildChronologie } from './attache/cotes.mjs'
import { listRoutines, upsertRoutine, deleteRoutine, markRun, dueRoutines } from './attache/routines.mjs'
import { listPropositions, decideProposition } from './attache/propositions.mjs'
import { analyseDocuments } from './attache/analyse.mjs'
import { readDossierMemory } from './attache/dossierMemory.mjs'
import { listEnvelopes, readEnvelope, writeEnvelope, deleteProduction } from './attache/productions.mjs'

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

// ── Runs proactifs : un mail = un run, sérialisés ──
let proactiveChain = Promise.resolve()
let running = 0

function queueProactiveRun(keys, mailId) {
  proactiveChain = proactiveChain.then(async () => {
    running++
    try {
      // statut visible dans le widget BAL : reçu → EN COURS → traité
      await markInboxStatus(keys, mailId, 'en_cours').catch(() => {})
      const prompt = [
        `Un nouveau message vient d'arriver dans la boîte dédiée (id : ${mailId}).`,
        'Traite-le entièrement selon ta méthode : boite_lire pour prendre connaissance de la consigne et de la pièce,',
        'qualification, rapprochement avec le dossier SIRAL concerné, actions dans SIRAL si elles s\'imposent,',
        'préparation des synthèses/projets — remis DANS SIRAL (remettre_livrable, signaler, produire_document) :',
        'aucun mail sortant n\'existe plus.',
        'SI AUCUN dossier en cours ne correspond : (a) la consigne du transfert dit « créer procédure » (ou équivalent',
        'sans ambiguïté) → crée le dossier (creer_dossier, tout renseigné depuis la pièce), puis traite-y la demande ;',
        '(b) la consigne dit seulement de traiter → rédige l\'acte demandé sous le pseudo-dossier "_hors-dossier"',
        '(produire_document) : il apparaîtra dans « Actes rédigés — hors dossier » du tableau de bord.',
        'Termine par boite_marquer_traite (résumé d\'une phrase) et signaler.',
        'Si le message est hors sujet (spam, notification technique), marque-le traité avec un résumé d\'un mot et ne signale rien.',
      ].join('\n')
      const result = await runAgent({ keys, prompt, runLabel: 'proactif', title: `Mail ${mailId}` })
      await audit(keys, 'run_proactif', { mailId, ok: result.ok, convId: result.convId, erreur: result.error })
      if (!result.ok) {
        await publishFeed(keys, {
          type: 'alerte',
          titre: 'Traitement automatique interrompu',
          resume: `Le mail ${mailId} n'a pas pu être traité (${result.error || 'erreur inconnue'}). Il reste dans la boîte, non marqué traité.`,
        })
      }
      // si l'agent n'a pas marqué traité (erreur, oubli), le statut redevient « reçu »
      const rec = readInboxMessage(keys, mailId)
      if (rec && !rec.traite) await markInboxStatus(keys, mailId, result.ok ? 'recu' : 'erreur').catch(() => {})
    } catch (e) {
      console.error('[attache] run proactif :', e)
      try {
        const rec = readInboxMessage(keys, mailId)
        if (rec && !rec.traite) await markInboxStatus(keys, mailId, 'erreur')
      } catch { /* statut best-effort */ }
    } finally {
      running--
    }
  })
  return proactiveChain
}

// ── Brief du majordome : un run quotidien qui balaye tout ──
const BRIEFING_HOUR = Math.min(23, Math.max(0, Number(process.env.SIRAL_ATTACHE_BRIEFING_HOUR || 6)))

function briefingPrompt() {
  return [
    'C\'est l\'heure du brief quotidien du magistrat. Balaye TOUS les dossiers en cours et prépare son tableau',
    'de bord via majordome_publier. MÉTHODE : lister_dossiers, puis DÉLÈGUE le balayage à des sous-agents en',
    'parallèle (sous_agents — un lot de tâches, une par dossier ou par petit groupe : chaque consigne donne le',
    'numéro et demande verifier_completude + diagnostic_dossier + les points saillants, réponse télégraphique).',
    'Tu synthétises leurs analyses et c\'est TOI qui publies (eux ne peuvent pas écrire) :',
    '1. echeance — actes expirant sous 15 jours, attentes JLD qui traînent, CR anciens : dis QUOI préparer et POUR QUAND.',
    '2. projet_mail — pour chaque dossier qui le justifie, le mail prêt à coller au directeur d\'enquête',
    '   (demande de requête pour prolongation, point d\'étape, actualisation, envoi du dossier pour relecture).',
    '3. projet_dml — s\'il existe des DML archivées (lister_dml) et que le dossier a évolué depuis la dernière,',
    '   prépare la version actualisée ; publie AUSSI une verification NPP pour les actes récents que tu ne vois pas.',
    '4. appel — les relances où un mail ne suffit plus.',
    '5. DOSSIERS DORMANTS (priorité haute) — ceux que lister_dossiers marque dormant:true (le seuil est CELUI de',
    '   l\'alerte « dossier sans CR » configurée dans SIRAL, champ seuilSansCR — jamais un délai de ton choix) :',
    '   publie le projet_mail de relance au directeur d\'enquête, prêt à coller (point d\'étape, actualisation, ou envoi',
    '   du dossier complet pour relecture selon le cas).',
    '6. DESCRIPTIONS PÉRIMÉES — si la description d\'un dossier ne reflète plus son état (nouveaux CR/actes/documents),',
    '   actualise-la directement (actualiser_description) : c\'est réversible et archivé.',
    '7. INSTRUCTION (instru_lister) — les échéances du module instruction : DML en attente (réquisitions à rendre',
    '   avant l\'échéance +10 jours — publie une echeance, et prépare la réponse selon ta MÉTHODE DML si elle manque),',
    '   débats JLD à venir sans réquisitions rédigées, fins de période de détention proches.',
    '8. DÉPÔT (depot_lister) — des pièces confiées attendent encore d\'être rangées ? Range-les (MAJORDOME DES PIÈCES)',
    '   ou pose la question qui te bloque.',
    'Termine par signaler (type note) : un résumé du brief en 2 phrases. Sois sélectif : uniquement ce qui appelle',
    'un geste du magistrat. Ne republie pas ce qui n\'a pas changé depuis le brief précédent (ta mémoire et les',
    'conversations récentes t\'indiquent ce qui a déjà été publié).',
  ].join('\n')
}

let briefingRunning = false
async function runBriefing(trigger = 'planifié') {
  if (briefingRunning) return { ok: false, error: 'brief déjà en cours' }
  const keys = loadKeyring()
  if (!keys) return { ok: false, error: 'trousseau non remis' }
  briefingRunning = true
  try {
    console.log(`[attache] brief du majordome (${trigger})`)
    const result = await runAgent({ keys, prompt: briefingPrompt(), runLabel: 'majordome', title: `Brief ${new Date().toISOString().slice(0, 10)}` })
    await audit(keys, 'brief_majordome', { trigger, ok: result.ok, convId: result.convId, erreur: result.error })
    await writeState({ lastBriefingAt: new Date().toISOString(), lastBriefingOk: result.ok })
    return { ok: result.ok, convId: result.convId, error: result.error }
  } finally {
    briefingRunning = false
  }
}

// ── Routines du magistrat : exécutées à leur cadence, sérialisées ──
let routineRunning = false
async function runRoutine(routine, trigger = 'planifiée') {
  const keys = loadKeyring()
  if (!keys) return { ok: false, error: 'trousseau non remis' }
  console.log(`[attache] routine « ${routine.nom} » (${trigger})`)
  // réserver l'exécution AVANT le run (évite un doublon si le run est long)
  await markRun(keys, routine.id, null)
  const prompt = [
    `ROUTINE « ${routine.nom} » — consigne récurrente définie par le magistrat, exécutée automatiquement :`,
    '',
    routine.prompt,
    '',
    'Termine par signaler (le fil « pendant votre absence ») si ton travail appelle un geste du magistrat ;',
    'si la consigne demande une remise (« envoie-moi », « prépare-moi »), utilise remettre_livrable — le livrable',
    's\'affiche dans SIRAL, aucun mail ne part. Si rien de notable : ne publie rien.',
  ].join('\n')
  const result = await runAgent({ keys, prompt, runLabel: `routine:${routine.nom}`, title: `Routine ${routine.nom} ${new Date().toISOString().slice(0, 10)}` })
  await markRun(keys, routine.id, result.ok)
  await audit(keys, 'routine_executee', { routine: routine.nom, trigger, ok: result.ok, convId: result.convId, erreur: result.error })
  return { ok: result.ok, convId: result.convId, error: result.error }
}

async function maybeDueRoutines() {
  if (routineRunning) return
  const keys = loadKeyring()
  if (!keys) return
  const due = dueRoutines(keys)
  if (!due.length) return
  routineRunning = true
  try {
    for (const r of due) {
      await runRoutine(r).catch((e) => console.error('[attache] routine :', e))
    }
  } finally {
    routineRunning = false
  }
}

/** Déclenche le brief quotidien à l'heure dite (vérifié à chaque tick de relève). */
async function maybeScheduledBriefing() {
  const now = new Date()
  if (now.getHours() < BRIEFING_HOUR) return
  const today = now.toISOString().slice(0, 10)
  const state = readState()
  if ((state.lastBriefingAt || '').slice(0, 10) === today) return
  // réserver la date AVANT le run (évite un double brief si le run est long)
  await writeState({ lastBriefingAt: now.toISOString(), lastBriefingOk: null })
  runBriefing('planifié').catch((e) => console.error('[attache] brief :', e))
}

// ── Analyse des trames téléversées : classement + propositions d'amélioration ──
let trameAnalyseRunning = false
async function runTrameAnalyse(noms) {
  const keys = loadKeyring()
  if (!keys) return { ok: false, error: 'trousseau non remis' }
  trameAnalyseRunning = true
  try {
    console.log(`[attache] analyse de ${noms.length} trame(s) téléversée(s)`)
    const prompt = [
      `Le magistrat vient de téléverser ${noms.length} trame(s) dans sa bibliothèque : ${noms.join(', ')}.`,
      'MÉTHODE : si le lot dépasse 3 trames, DÉLÈGUE lecture et évaluation à des sous-agents en parallèle',
      '(sous_agents — une tâche par trame : « lis la trame X (trame_lire) et livre : (a) classification en une',
      'phrase — type d\'acte, cadre juridique, articles visés, régime 706-80 ou non, quand l\'utiliser ; (b) analyse',
      'de solidité juridique et de structure »). Sinon traite-les toi-même une à une.',
      'Puis, à partir de ces analyses, pour CHAQUE trame :',
      '1. Enregistre sa classification avec trame_decrire (qui ne touche PAS au contenu).',
      '2. Retiens ses points d\'amélioration : solidité juridique (fondements cités encore en vigueur, mentions obligatoires, points de fragilité procédurale) et structure (plan, clarté, champs à compléter, doublons avec une autre trame de la bibliothèque).',
      'À LA FIN, un SEUL signaler (type note, titre « Trames téléversées : classement et propositions ») : pour chaque trame, sa classification retenue et tes propositions d\'amélioration LÉGALE ou STRUCTURELLE, concrètes et hiérarchisées (ce qui fragilise l\'acte d\'abord).',
      'RÈGLE STRICTE : tu ne MODIFIES JAMAIS le contenu d\'une trame — tu proposes, le magistrat décide. Seule la description (classement) est mise à jour via trame_decrire.',
      'Si le corpus de la base de connaissances (kb_chercher) éclaire une trame (circulaire, jurisprudence), appuie tes propositions dessus et cite l\'entrée.',
    ].join('\n')
    const result = await runAgent({ keys, prompt, runLabel: 'trames-analyse', title: `Analyse trames ${new Date().toISOString().slice(0, 10)}` })
    await audit(keys, 'trames_analysees', { nb: noms.length, noms: noms.join(', ').slice(0, 500), ok: result.ok, convId: result.convId, erreur: result.error })
    if (!result.ok) {
      await publishFeed(keys, {
        type: 'alerte',
        titre: 'Analyse des trames interrompue',
        resume: `L'analyse des trames téléversées (${noms.slice(0, 5).join(', ')}${noms.length > 5 ? '…' : ''}) a échoué (${result.error || 'erreur inconnue'}). Relancez-la depuis Paramètres → Attaché IA.`,
      })
    }
    return { ok: result.ok, convId: result.convId, error: result.error }
  } finally {
    trameAnalyseRunning = false
  }
}

// ── Analyse/classement des entrées de la base de connaissances ──
let kbAnalyseRunning = false
async function runKbAnalyse(ids) {
  const keys = loadKeyring()
  if (!keys) return { ok: false, error: 'trousseau non remis' }
  kbAnalyseRunning = true
  try {
    console.log(`[attache] classement de ${ids.length} entrée(s) de la base de connaissances`)
    const prompt = [
      `Le magistrat vient de verser ${ids.length} document(s) dans sa base de connaissances : ${ids.join(', ')}.`,
      'Tu es le BIBLIOTHÉCAIRE de ce fonds. MÉTHODE : si le lot dépasse 3 entrées, DÉLÈGUE la lecture à des',
      'sous-agents en parallèle (sous_agents — une tâche par entrée : « lis l\'entrée X (kb_lire) et livre : (a) une',
      'description d\'une phrase — ce que contient le document et quand s\'en servir ; (b) la catégorie la plus juste ;',
      '(c) si le chemin actuel est incohérent avec le contenu, le chemin de pochette recommandé »). Sinon lis-les toi-même.',
      'Puis, pour CHAQUE entrée : enregistre description/catégorie (et chemin si tu recommandes un rangement plus',
      'cohérent) avec kb_decrire — le CONTENU n\'est JAMAIS modifié.',
      'Signale aussi les doublons manifestes et les documents visiblement périmés (texte abrogé, version ancienne).',
      'À LA FIN, un SEUL signaler (type note, titre « Base de connaissances : classement ») : le rangement effectué',
      'en 2-5 phrases, et tes signalements (doublons, contenu périmé) s\'il y en a.',
    ].join('\n')
    const result = await runAgent({ keys, prompt, runLabel: 'kb-analyse', title: `Classement base ${new Date().toISOString().slice(0, 10)}` })
    await audit(keys, 'kb_analysee', { nb: ids.length, ids: ids.join(', ').slice(0, 500), ok: result.ok, convId: result.convId, erreur: result.error })
    if (!result.ok) {
      await publishFeed(keys, {
        type: 'alerte',
        titre: 'Classement de la base de connaissances interrompu',
        resume: `Le classement des entrées versées (${ids.slice(0, 5).join(', ')}${ids.length > 5 ? '…' : ''}) a échoué (${result.error || 'erreur inconnue'}). Relancez-le depuis Paramètres → Attaché IA.`,
      })
    }
    return { ok: result.ok, convId: result.convId, error: result.error }
  } finally {
    kbAnalyseRunning = false
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
    // rattrapage : messages ingérés mais jamais traités (crash, redémarrage)
    const pending = listInbox(keys).filter((m) => !m.traite)
    const known = new Set(res.ingested)
    for (const m of pending) {
      if (!known.has(m.id) && !recentlyQueued.has(m.id)) {
        recentlyQueued.add(m.id)
        queueProactiveRun(keys, m.id)
      }
    }
    return res
  } finally {
    polling = false
  }
}
const recentlyQueued = new Set()

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
      })
    }

    if (route === 'GET /config') {
      return json(res, 200, { config: agentConfig() })
    }

    if (route === 'PUT /config') {
      const body = await readBody(req)
      const current = agentConfig()
      const config = {
        model: 'model' in body ? sanitizeModel(body.model) : current.model,
        effort: 'effort' in body ? sanitizeEffort(body.effort) : current.effort,
        webAccess: 'webAccess' in body ? body.webAccess === true : current.webAccess,
        subModel: 'subModel' in body ? sanitizeModel(body.subModel) : current.subModel,
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

    if (route === 'DELETE /mail-config') {
      const removed = clearMailOverride()
      const keys = loadKeyring()
      if (keys) await audit(keys, 'mail_config_effacee', { removed })
      return json(res, 200, { ok: true, removed, mail: describeMailConfig() })
    }

    if (route === 'POST /briefing') {
      // lancé en arrière-plan : la réponse ne bloque pas sur le run complet
      if (briefingRunning) return json(res, 409, { ok: false, error: 'Brief déjà en cours' })
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { ok: false, error: 'Trousseau non remis' })
      runBriefing('manuel').catch((e) => console.error('[attache] brief :', e))
      return json(res, 202, { ok: true, started: true })
    }

    if (route === 'GET /productions') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      return json(res, 200, { productions: listEnvelopes(url.searchParams.get('numero') || '') })
    }

    if (route === 'PUT /production') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      const body = await readBody(req, 4 * 1024 * 1024)
      const env = body.envelope
      if (!env || env.encrypted !== true || typeof env.iv !== 'string' || typeof env.ct !== 'string') {
        return json(res, 400, { error: 'Enveloppe chiffrée requise' })
      }
      if (!/^[a-f0-9]{6,32}$/.test(String(body.id || ''))) return json(res, 400, { error: 'id invalide' })
      await writeEnvelope(String(body.numero || ''), String(body.id), env)
      await audit(keys, 'production_editee_main', { numero: body.numero, id: body.id })
      return json(res, 200, { ok: true })
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
        const out = await decideProposition(keys, { id: String(body.id || ''), action: String(body.action || ''), par: String(body.par || '') })
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
        const out = await analyseDocuments({ docs, actesExistants: body.actesExistants || [] })
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

    if (route === 'GET /inbox') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      return json(res, 200, { messages: listInbox(keys) })
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

    // …et pour les cartes de statut en clair (majordome / questions).
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
        prompt = [
          'CONTEXTE : le magistrat te consulte depuis le module CARTOGRAPHIE (vue réseau des personnes et affaires du contentieux).',
          'S\'il te colle un PV / un résumé / une synthèse pour en cartographier l\'affaire : RECOUPE d\'abord les noms (recouper_personnes), puis dépose une proposition de dossier EX NIHILO (proposer_dossier_carto — label, misEnCause, source). Les personnes connues seront rattachées, les inconnues créées en « MEC lié ex nihilo ». Le dossier n\'est créé qu\'à la validation ✓.',
          'Sinon, commence par carto_analyser (figures centrales, ponts entre affaires, co-occurrences, liens de renseignement tracés). Objectif : l\'aider à VOIR LES CONNEXIONS et améliorer la visibilité.',
          'S\'il te demande une ANALYSE TRANSVERSALE (« analyse TOUS les dossiers », « trouve les liens cachés », « quelle architecture derrière ces affaires ») : suis la MÉTHODE D\'ANALYSE TRANSVERSALE DE RENSEIGNEMENT de ton prompt système — carto_corpus (enquêtes archivées + instruction, avec pièces), puis sous_agents qui LISENT les pièces pour remonter surnoms, personnes au 2nd plan, adresses, plaques, téléphones, puis proposer_lien / proposer_mec_carto / proposer_dossier_carto. Les signaux faibles sont dans les PV, pas dans les listes de mis en cause.',
          'Tu peux aussi : identifier les figures pivots et les ponts entre affaires, repérer les cloisonnements, et SUGGÉRER les liens de renseignement manquants — que tu déposes en propositions (proposer_lien, avec la pièce source), jamais tracés d\'office. Réponses concises et structurées.',
          '',
          `Question du magistrat : ${message}`,
        ].join('\n')
      } else if (body.dossier && !body.convId) {
        const cadre = body.cadre === 'instruction' ? 'à l\'instruction' : 'en enquête préliminaire'
        const memoire = readDossierMemory(keys, String(body.dossier))
        prompt = [
          `CONTEXTE : le magistrat te consulte sur le dossier « ${String(body.dossier).slice(0, 80)} » (${cadre}), depuis le chat flottant ouvert sur ce dossier.`,
          'Sauf mention contraire, TOUTES ses questions portent sur ce dossier. Commence par lire_dossier ; utilise diagnostic_dossier, chronologie_lire, verifier_completude selon le besoin.',
          'RÔLE — aide au contrôle et à la maîtrise : surveiller la direction d\'enquête (éparpillement des enquêteurs : partent-ils dans tous les sens ?), la cohérence entre actes demandés et réalisés, et LES DÉLAIS (en préliminaire, les TSE sont enserrés dans des délais courts — 2 mois typiquement — qui contraignent l\'action ; signale tout risque de dépassement et son incidence).',
          'Réponses concises, factuelles, chiffrées, orientées décision. Tu peux déposer des propositions (proposer_mec/acte/cr) mais tu n\'écris jamais directement au dossier sans instruction explicite.',
          'MÉMOIRE DU DOSSIER : ci-dessous l\'essentiel retenu des échanges passés sur ce dossier. Tiens-la à jour — dès qu\'un échange apporte du neuf (une décision, une orientation, un élément découvert), ajoute UNE ligne télégraphique avec memoire_dossier_noter. Reste bref : cette mémoire est volontairement petite.',
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
      })
      clearInterval(heartbeat)
      send({ type: 'final', convId: result.convId, ok: result.ok, error: result.error })
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
  maybeScheduledBriefing().catch((e) => console.error('[attache] brief planifié :', e))
  maybeDueRoutines().catch((e) => console.error('[attache] routines :', e))
}, POLL_MINUTES * 60 * 1000)
// première relève 20 s après le démarrage (laisse le réseau docker s'établir)
setTimeout(() => { pollOnce('démarrage').catch(() => {}) }, 20_000)
writeState({ startedAt: new Date().toISOString() }).catch(() => {})
