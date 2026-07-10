/**
 * SIRAL — Attaché de justice · pont vers Claude Code.
 *
 * Le cerveau est le CLI `claude` installé sur le serveur et connecté avec
 * l'ABONNEMENT du magistrat (claude login / setup-token) — pas de clé API.
 * On le lance en mode headless (stream-json), bridé à nos seuls outils MCP :
 * pas de shell, pas de fichiers, pas de web. Les conversations reprennent
 * par --resume (l'état de session vit chez le CLI, le transcript chiffré
 * chez nous).
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { attacheDir, attacheContentieux, ensureDir, atomicWrite, readEnvelopeFile, writeEnvelopeFile, listFiles } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { readMemory } from './memory.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MCP_SERVER = path.join(HERE, '..', 'attache-mcp.mjs')

const CLAUDE_BIN = process.env.SIRAL_ATTACHE_CLAUDE_BIN || 'claude'
const MODEL = process.env.SIRAL_ATTACHE_MODEL || ''      // vide = défaut du CLI
const MAX_TURNS = Number(process.env.SIRAL_ATTACHE_MAX_TURNS || 40)
const RUN_TIMEOUT_MS = Number(process.env.SIRAL_ATTACHE_RUN_TIMEOUT_MIN || 20) * 60 * 1000

// Défense en profondeur : en headless les outils non listés sont refusés,
// on interdit EN PLUS explicitement tout ce qui touche machine et réseau.
const ALLOWED_TOOLS = 'mcp__siral__*'
const DISALLOWED_TOOLS = 'Bash,Edit,Write,NotebookEdit,Read,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,KillShell,BashOutput'

/** Prompt système : persona, règles de gouvernance, mémoire vivante. */
export function systemPrompt(keys) {
  const memory = readMemory(keys)
  return [
    `Tu es l'attaché de justice virtuel d'un magistrat du parquet, au sein de SIRAL (application métier de suivi des enquêtes, contentieux ${attacheContentieux()} — criminalité organisée).`,
    '',
    'RÈGLES DE GOUVERNANCE — non négociables :',
    '1. Tu PRÉPARES et tu AGIS librement DANS SIRAL : lire tous les dossiers, documents et comptes-rendus ; enregistrer actes, prolongations, notes, à-faire. Chaque écriture est versionnée, réversible et journalisée : agis, puis rends compte (outil signaler).',
    '2. La SEULE sortie vers l\'extérieur est l\'outil envoyer_a_mon_magistrat — un mail au magistrat lui-même. Tu ne contactes JAMAIS personne d\'autre, tu ne rédiges jamais pour envoi direct à un tiers : tout projet passe par lui, c\'est lui qui signe et envoie.',
    '3. Les décisions juridictionnelles et l\'appréciation en opportunité lui appartiennent : tu proposes, il décide. Formule tes analyses comme des projets à valider.',
    '4. ANTICIPE : quand un dossier révèle une échéance, un acte expirant, une pièce manquante, traite-le sans attendre qu\'on te le demande (verifier_completude, ajouter_todo, signaler). Quand tu apprends une préférence durable du magistrat, consigne-la (memoire_noter).',
    '5. Tu travailles sous le secret de l\'enquête : sobre, factuel, précis. Cite les pièces (dossier, CR, document) qui fondent chaque affirmation. En cas de doute sur un cadre juridique, dis le doute.',
    '6. Réponds toujours en français. Synthèses denses et structurées, plans apparents.',
    '',
    'MÉTHODE pour un mail transféré (boite_lister / boite_lire) : le corps du transfert est la consigne du magistrat. 1) Qualifier la pièce (notification DML, demande d\'actes TSE, réponse JLD, notification d\'acte d\'instruction, autre). 2) Rapprocher du dossier SIRAL (lister_dossiers, lire_dossier). 3) Agir : enregistrer ce qui doit l\'être, préparer synthèse et projets. 4) Envoyer les projets au magistrat. 5) boite_marquer_traite + signaler.',
    '',
    '--- MÉMOIRE (tenue à jour par toi, lisible et corrigeable par le magistrat) ---',
    memory,
  ].join('\n')
}

// ── Transcripts chiffrés des conversations ──

export function listConversations() {
  return listFiles('conversations')
    .map((f) => ({ id: f.name.replace(/\.json$/, ''), mtime: f.mtime, size: f.size }))
}

export function readConversation(keys, id) {
  if (!/^[\w-]+$/.test(id)) return null
  const env = readEnvelopeFile(path.join('conversations', id + '.json'))
  if (!env) return null
  try { return decryptJson(keys.global, env) } catch { return null }
}

export function readConversationEnvelope(id) {
  if (!/^[\w-]+$/.test(id)) return null
  return readEnvelopeFile(path.join('conversations', id + '.json'))
}

async function saveConversation(keys, conv) {
  const env = encryptJson(keys.global, conv, { savedAt: new Date().toISOString(), savedBy: 'attache-ia' })
  await writeEnvelopeFile(path.join('conversations', conv.id + '.json'), env)
}

/** Fichier de configuration MCP consommé par le CLI (régénéré à chaque run). */
function writeMcpConfig() {
  const cfg = {
    mcpServers: {
      siral: {
        command: process.execPath,
        args: [MCP_SERVER],
        env: {
          SIRAL_DATA_DIR: process.env.SIRAL_DATA_DIR || '',
          SIRAL_ATTACHE_TJ: process.env.SIRAL_ATTACHE_TJ || '',
          SIRAL_ATTACHE_CONTENTIEUX: process.env.SIRAL_ATTACHE_CONTENTIEUX || '',
          SIRAL_ATTACHE_MASTER_KEY: process.env.SIRAL_ATTACHE_MASTER_KEY || '',
          SIRAL_ATTACHE_MASTER_KEY_FILE: process.env.SIRAL_ATTACHE_MASTER_KEY_FILE || '',
          SIRAL_ATTACHE_OWNER_EMAIL: process.env.SIRAL_ATTACHE_OWNER_EMAIL || '',
          SIRAL_ATTACHE_SMTP_HOST: process.env.SIRAL_ATTACHE_SMTP_HOST || '',
          SIRAL_ATTACHE_SMTP_PORT: process.env.SIRAL_ATTACHE_SMTP_PORT || '',
          SIRAL_ATTACHE_SMTP_SECURE: process.env.SIRAL_ATTACHE_SMTP_SECURE || '',
          SIRAL_ATTACHE_SMTP_USER: process.env.SIRAL_ATTACHE_SMTP_USER || '',
          SIRAL_ATTACHE_SMTP_PASSWORD: process.env.SIRAL_ATTACHE_SMTP_PASSWORD || '',
          SIRAL_ATTACHE_IMAP_HOST: process.env.SIRAL_ATTACHE_IMAP_HOST || '',
          SIRAL_ATTACHE_IMAP_PORT: process.env.SIRAL_ATTACHE_IMAP_PORT || '',
          SIRAL_ATTACHE_IMAP_SECURE: process.env.SIRAL_ATTACHE_IMAP_SECURE || '',
          SIRAL_ATTACHE_IMAP_USER: process.env.SIRAL_ATTACHE_IMAP_USER || '',
          SIRAL_ATTACHE_IMAP_PASSWORD: process.env.SIRAL_ATTACHE_IMAP_PASSWORD || '',
          SIRAL_ATTACHE_FROM: process.env.SIRAL_ATTACHE_FROM || '',
          SIRAL_ATTACHE_RUN: process.env.SIRAL_ATTACHE_RUN || 'chat',
        },
      },
    },
  }
  ensureDir(attacheDir('workdir'))
  const p = attacheDir('workdir', 'mcp-config.json')
  atomicWrite(p, JSON.stringify(cfg))
  return p
}

/**
 * Exécute un tour d'agent.
 * @param {object} opts
 *  - keys        : trousseau chargé
 *  - prompt      : message utilisateur (ou consigne du worker)
 *  - convId      : conversation existante à reprendre (sinon nouvelle)
 *  - title       : titre de la conversation à la création
 *  - runLabel    : 'chat' | 'proactif' (audit + prompt MCP)
 *  - onEvent     : callback({type, ...}) — delta de texte, outil, fin
 * @returns {Promise<{convId, text, ok, error?}>}
 */
export async function runAgent({ keys, prompt, convId, title, runLabel = 'chat', onEvent = () => {} }) {
  const isNew = !convId
  const id = convId || new Date().toISOString().slice(0, 10) + '-' + crypto.randomBytes(4).toString('hex')
  const conv = (!isNew && readConversation(keys, id)) || {
    id,
    title: (title || String(prompt).slice(0, 80)).replace(/\s+/g, ' ').trim(),
    createdAt: new Date().toISOString(),
    claudeSessionId: crypto.randomUUID(),
    messages: [],
  }

  const mcpConfig = writeMcpConfig()
  const args = [
    '-p', String(prompt),
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--mcp-config', mcpConfig,
    '--allowedTools', ALLOWED_TOOLS,
    '--disallowedTools', DISALLOWED_TOOLS,
    '--append-system-prompt', systemPrompt(keys),
    '--max-turns', String(MAX_TURNS),
    ...(MODEL ? ['--model', MODEL] : []),
    ...(isNew || !conv.resumable ? ['--session-id', conv.claudeSessionId] : ['--resume', conv.claudeSessionId]),
  ]

  const cwd = attacheDir('workdir')
  ensureDir(cwd)

  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, args, {
      cwd,
      env: { ...process.env, SIRAL_ATTACHE_RUN: runLabel },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let assistantText = ''
    let stderrTail = ''
    let settled = false

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
    }, RUN_TIMEOUT_MS)

    const finish = async (ok, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      conv.messages.push({ role: 'user', text: String(prompt), at: new Date().toISOString(), run: runLabel })
      conv.messages.push({ role: 'assistant', text: assistantText || (error ? `⚠️ ${error}` : ''), at: new Date().toISOString() })
      conv.resumable = ok || conv.resumable // une session entamée reste reprenable
      conv.updatedAt = new Date().toISOString()
      try { await saveConversation(keys, conv) } catch {}
      onEvent({ type: 'done', convId: id, ok, error })
      resolve({ convId: id, text: assistantText, ok, error })
    }

    let buffer = ''
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let ev
        try { ev = JSON.parse(line) } catch { continue }
        // Deltas de texte en continu (stream_event enveloppe l'API brute)
        if (ev.type === 'stream_event') {
          const delta = ev.event?.delta
          if (ev.event?.type === 'content_block_delta' && delta?.type === 'text_delta' && delta.text) {
            assistantText += delta.text
            onEvent({ type: 'delta', text: delta.text })
          }
          const cb = ev.event?.content_block
          if (ev.event?.type === 'content_block_start' && cb?.type === 'tool_use') {
            onEvent({ type: 'tool', name: cb.name || 'outil' })
          }
          continue
        }
        // Message assistant complet (fallback si pas de partials)
        if (ev.type === 'assistant' && ev.message?.content) {
          const text = ev.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
          if (text && !assistantText.endsWith(text)) {
            const missing = text.startsWith(assistantText) ? text.slice(assistantText.length) : (assistantText ? '\n' + text : text)
            assistantText += missing
            onEvent({ type: 'delta', text: missing })
          }
          for (const b of ev.message.content) {
            if (b.type === 'tool_use') onEvent({ type: 'tool', name: b.name || 'outil' })
          }
          continue
        }
        if (ev.type === 'result') {
          if (ev.subtype === 'success') {
            if (!assistantText && typeof ev.result === 'string') {
              assistantText = ev.result
              onEvent({ type: 'delta', text: ev.result })
            }
            finish(true)
          } else {
            finish(false, ev.subtype || 'échec du run')
          }
        }
      }
    })

    child.stderr.on('data', (c) => { stderrTail = (stderrTail + c.toString('utf8')).slice(-4000) })
    child.on('error', (e) => finish(false, `CLI claude introuvable ou non exécutable : ${e.message}`))
    child.on('close', (code) => {
      if (!settled) {
        finish(code === 0, code === 0 ? undefined : `claude s'est arrêté (code ${code}) — ${stderrTail.split('\n').slice(-3).join(' ').slice(0, 500)}`)
      }
    })
  })
}

/** Test de santé du CLI (authentification abonnement comprise). */
export function checkClaudeCli() {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => { try { child.kill() } catch {}; resolve({ ok: false, error: 'timeout' }) }, 15_000)
    child.stdout.on('data', (c) => { out += c.toString() })
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: e.message }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? { ok: true, version: out.trim() } : { ok: false, error: 'code ' + code })
    })
  })
}

export function deleteConversation(id) {
  if (!/^[\w-]+$/.test(id)) return false
  const p = attacheDir('conversations', id + '.json')
  if (fs.existsSync(p)) { fs.unlinkSync(p); return true }
  return false
}
