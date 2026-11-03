/**
 * SIRAL — Attaché de justice · UN TOUR DE MODÈLE, AUCUN OUTIL.
 *
 * La brique commune des lectures de fond (interrogation du fonds, rapports de
 * dossier) : le CLI `claude` en mode headless, un seul tour, aucun outil (pas
 * de MCP, pas de shell, pas de fichiers, pas de web) — le modèle LIT le texte
 * joint et RÉPOND, en JSON strict (tableau) ou en texte. Même discipline que
 * les mini-fiches du registre (registre.mjs) et l'analyse d'actes
 * (analyse.mjs) : le prompt part en UN argument, borné par l'appelant.
 */
import { spawn } from 'node:child_process'
import { attacheDir, ensureDir } from './store.mjs'

const CLAUDE_BIN = process.env.SIRAL_ATTACHE_CLAUDE_BIN || 'claude'
const DISALLOWED_TOOLS = 'Bash,Edit,Write,NotebookEdit,Read,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,KillShell,BashOutput'

export function parseJsonLoose(text) {
  const s = String(text || '')
  try { return JSON.parse(s) } catch { /* continue */ }
  const i = s.indexOf('[')
  const j = s.lastIndexOf(']')
  if (i >= 0 && j > i) { try { return JSON.parse(s.slice(i, j + 1)) } catch { /* non */ } }
  return null
}

/**
 * Lance un tour. `json:true` exige un tableau JSON en réponse (`data`),
 * sinon le texte brut (`texte`). Rend { ok, data|texte, envelope } ou
 * { ok:false, error }. Ne lève jamais.
 */
export function runUnTour({ prompt, systeme, model, json = false, label = 'un-tour', timeoutMs = 6 * 60 * 1000 }) {
  const cwd = attacheDir('workdir')
  ensureDir(cwd)
  const args = [
    '-p', prompt,
    '--output-format', 'json',
    ...(systeme ? ['--append-system-prompt', systeme] : []),
    '--disallowedTools', DISALLOWED_TOOLS,
    '--max-turns', '1',
    ...(model ? ['--model', model] : []),
  ]
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(CLAUDE_BIN, args, { cwd, env: { ...process.env, SIRAL_ATTACHE_RUN: label }, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return resolve({ ok: false, error: `CLI claude non lançable : ${e.message}` })
    }
    let stdout = ''
    let stderrTail = ''
    let settled = false
    const done = (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v) }
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* déjà mort */ }; done({ ok: false, error: 'délai dépassé' }) }, timeoutMs)
    child.stdout.on('data', (c) => { stdout += c.toString('utf8') })
    child.stderr.on('data', (c) => { stderrTail = (stderrTail + c.toString('utf8')).slice(-2000) })
    child.on('error', (e) => done({ ok: false, error: `CLI claude introuvable : ${e.message}` }))
    child.on('close', (code) => {
      if (code !== 0) return done({ ok: false, error: `claude a échoué (code ${code}) — ${stderrTail.split('\n').slice(-2).join(' ').slice(0, 300)}` })
      let envelope = null
      try { envelope = JSON.parse(stdout.trim()) } catch { /* stdout brut */ }
      if (envelope && envelope.is_error) return done({ ok: false, error: String(envelope.result || 'échec du run').slice(0, 300) })
      const texte = envelope && typeof envelope.result === 'string' ? envelope.result : stdout
      if (!json) return done({ ok: true, texte, envelope })
      const data = parseJsonLoose(texte)
      if (!Array.isArray(data)) return done({ ok: false, error: 'réponse du modèle non exploitable (tableau JSON absent)' })
      done({ ok: true, data, envelope })
    })
  })
}
