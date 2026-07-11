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
import { attacheTj, attacheContentieux, readState, writeState } from './attache/store.mjs'
import { audit, publishFeed } from './attache/journal.mjs'
import { fetchInbox, listInbox, mailConfig, inboxStats } from './attache/mail.mjs'
import { runAgent, checkClaudeCli, listConversations, readConversationEnvelope, deleteConversation } from './attache/agent.mjs'

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
      const prompt = [
        `Un nouveau message vient d'arriver dans la boîte dédiée (id : ${mailId}).`,
        'Traite-le entièrement selon ta méthode : boite_lire pour prendre connaissance de la consigne et de la pièce,',
        'qualification, rapprochement avec le dossier SIRAL concerné, actions dans SIRAL si elles s\'imposent,',
        'préparation des synthèses/projets et envoi au magistrat si utile, puis boite_marquer_traite et signaler.',
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
    } catch (e) {
      console.error('[attache] run proactif :', e)
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
    'C\'est l\'heure du brief quotidien du magistrat. Balaye TOUS les dossiers en cours (lister_dossiers,',
    'verifier_completude sur chacun, lire_dossier quand un point mérite le contexte) et prépare son tableau',
    'de bord via majordome_publier :',
    '1. echeance — actes expirant sous 15 jours, attentes JLD qui traînent, CR anciens : dis QUOI préparer et POUR QUAND.',
    '2. projet_mail — pour chaque dossier qui le justifie, le mail prêt à coller au directeur d\'enquête',
    '   (demande de requête pour prolongation, point d\'étape, actualisation, envoi du dossier pour relecture).',
    '3. projet_dml — s\'il existe des DML archivées (lister_dml) et que le dossier a évolué depuis la dernière,',
    '   prépare la version actualisée ; publie AUSSI une verification NPP pour les actes récents que tu ne vois pas.',
    '4. appel — les relances où un mail ne suffit plus.',
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
        },
        inbox: keys ? inboxStats(keys) : null,
        runsEnCours: running,
        state: readState(),
      })
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

    if (route === 'POST /briefing') {
      // lancé en arrière-plan : la réponse ne bloque pas sur le run complet
      if (briefingRunning) return json(res, 409, { ok: false, error: 'Brief déjà en cours' })
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { ok: false, error: 'Trousseau non remis' })
      runBriefing('manuel').catch((e) => console.error('[attache] brief :', e))
      return json(res, 202, { ok: true, started: true })
    }

    if (route === 'GET /inbox') {
      const keys = loadKeyring()
      if (!keys) return json(res, 409, { error: 'Trousseau non remis' })
      return json(res, 200, { messages: listInbox(keys) })
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

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      const send = (ev) => { try { res.write(`data: ${JSON.stringify(ev)}\n\n`) } catch {} }
      const heartbeat = setInterval(() => { try { res.write(': ping\n\n') } catch {} }, 15_000)

      await audit(keys, 'chat_message', { convId: body.convId || '(nouvelle)', apercu: message.slice(0, 200) })
      const result = await runAgent({
        keys,
        prompt: message,
        convId: body.convId || undefined,
        runLabel: 'chat',
        onEvent: send,
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
}, POLL_MINUTES * 60 * 1000)
// première relève 20 s après le démarrage (laisse le réseau docker s'établir)
setTimeout(() => { pollOnce('démarrage').catch(() => {}) }, 20_000)
writeState({ startedAt: new Date().toISOString() }).catch(() => {})
