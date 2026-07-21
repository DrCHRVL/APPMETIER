/**
 * SIRAL — Attaché de justice · sous-agents (travail en parallèle).
 *
 * L'attaché peut déléguer des sous-tâches INDÉPENDANTES (analyser 20 PDF,
 * balayer les dossiers du brief, évaluer un lot de trames) à des instances
 * Claude exécutées EN PARALLÈLE — même mécanique que les subagents de
 * Claude Code/Cowork, mais bornée à notre périmètre :
 *
 *  - un sous-agent est en LECTURE SEULE : le serveur MCP, lancé avec
 *    SIRAL_ATTACHE_SUBAGENT=1, refuse tous les outils d'écriture et
 *    l'outil sous_agents lui-même (pas de récursion) ;
 *  - concurrence bornée (défaut 3), lot borné (24 tâches), timeout par
 *    tâche — un PDF illisible ne bloque pas le reste du lot ;
 *  - le résultat de chaque sous-agent (texte final) revient à l'agent
 *    principal, qui reste seul à écrire, proposer et signaler.
 */
import { spawn } from 'node:child_process'
import os from 'node:os'
import { attacheContentieux } from './store.mjs'
import { writeMcpConfig, agentConfig, sanitizeModel, sanitizeEffort } from './agent.mjs'
import { extractUsage, recordUsage } from './usage.mjs'
import { consumptionGovernor } from './budget.mjs'

const CLAUDE_BIN = process.env.SIRAL_ATTACHE_CLAUDE_BIN || 'claude'
const MAX_TACHES = 24
const CONCURRENCY = Math.max(1, Math.min(6,
  Number(process.env.SIRAL_ATTACHE_SUBAGENT_CONCURRENCY || 0) || Math.min(3, Math.max(1, os.cpus().length - 1))))
// Les sous-agents sont en LECTURE SEULE (extraction / balayage) : une poignée
// de tours suffit presque toujours. Le plafond ne sert qu'à couvrir la queue
// (dossier à plusieurs pièces) — on l'a resserré de 15 à 10 : le coût d'un run
// grimpe à chaque tour (contexte renvoyé), et la valeur marginale des derniers
// tours est quasi nulle.
const SUB_MAX_TURNS = Number(process.env.SIRAL_ATTACHE_SUBAGENT_MAX_TURNS || 10)
const SUB_TIMEOUT_MS = Number(process.env.SIRAL_ATTACHE_SUBAGENT_TIMEOUT_MIN || 8) * 60 * 1000

const ALLOWED_TOOLS = 'mcp__siral__*'
const DISALLOWED_TOOLS = 'Bash,Edit,Write,NotebookEdit,Read,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,KillShell,BashOutput'
const WEB_TOOLS = ['WebSearch', 'WebFetch']

// Travail DIRECT du magistrat, JAMAIS bridé pour cause de forfait : le chat et
// le traitement d'un mail (rédaction d'acte, sa priorité n°1) gardent toute la
// qualité de leurs sous-agents. Seuls les runs de FOND (brief, étude,
// consolidation, routines) subissent le gouverneur. On reconnaît le run parent
// par SIRAL_ATTACHE_RUN, propagé au serveur MCP où tourne ce module.
const DIRECT_RUNS = new Set(['chat', 'chat-dossier', 'chat-carto', 'proactif'])

// Modèle des travaux d'appoint (sous-agents, consolidation d'apprentissage) :
// un modèle RAPIDE par défaut — jamais celui du run principal, qui peut être
// Opus et rendrait ces lots lourds et gourmands.
const DEFAULT_SUBMODEL_ENV = () => sanitizeModel(process.env.SIRAL_ATTACHE_SUBAGENT_MODEL) || 'claude-sonnet-5'
const ECO_SUBMODEL = 'claude-haiku-4-5-20251001'

/** Modèle économe effectif : choix du magistrat (« Sous-agents »), sinon rapide (Haiku en mode économe). */
export function economicalModel(cfg = agentConfig()) {
  return cfg.subModel || (cfg.econome ? ECO_SUBMODEL : DEFAULT_SUBMODEL_ENV())
}

function subagentSystemPrompt(contexte) {
  return [
    `Tu es un SOUS-AGENT de l'attaché de justice virtuel d'un magistrat du parquet (SIRAL, contentieux ${attacheContentieux()}).`,
    'L\'agent principal t\'a délégué UNE sous-tâche d\'analyse. Exécute-la entièrement, puis livre le résultat en texte final : dense, factuel, structuré, en français, chaque affirmation appuyée sur la pièce qui la fonde (dossier, document, CR).',
    'Tu es en LECTURE SEULE : les outils d\'écriture sont désactivés — n\'essaie pas d\'écrire, de proposer au magistrat ou d\'envoyer quoi que ce soit. C\'est l\'agent principal qui agit à partir de ton analyse.',
    'Ne pose aucune question : si une donnée manque, dis-le dans ta réponse et livre ce que tu as pu établir.',
    ...(contexte ? ['', 'CONTEXTE DONNÉ PAR L\'AGENT PRINCIPAL :', String(contexte).slice(0, 4000)] : []),
  ].join('\n')
}

/** Exécute UNE sous-tâche (un run headless, résultat = texte final). */
function runOne({ consigne, mcpConfig, systemPrompt, allowedTools, disallowedTools, model, effort, maxTurns, parent }) {
  const args = [
    '-p', String(consigne),
    '--output-format', 'json',
    '--mcp-config', mcpConfig,
    '--allowedTools', allowedTools,
    '--disallowedTools', disallowedTools,
    '--append-system-prompt', systemPrompt,
    '--max-turns', String(maxTurns || SUB_MAX_TURNS),
    ...(model ? ['--model', model] : []),
    ...(effort ? ['--effort', effort] : []),
  ]
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, args, {
      env: { ...process.env, SIRAL_ATTACHE_RUN: 'sous-agent', SIRAL_ATTACHE_SUBAGENT: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let errTail = ''
    let settled = false
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, SUB_TIMEOUT_MS)
    const finish = (ok, resultat, erreur) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok, resultat, erreur })
    }
    child.stdout.on('data', (c) => { out += c.toString('utf8') })
    child.stderr.on('data', (c) => { errTail = (errTail + c.toString('utf8')).slice(-2000) })
    child.on('error', (e) => finish(false, '', `CLI claude : ${e.message}`))
    child.on('close', (code) => {
      let parsed = null
      try { parsed = JSON.parse(out) } catch {}
      // Chaque sous-agent est un process CLI distinct : son bilan de jetons
      // s'ajoute à celui de l'agent principal (pas de double comptage).
      const usage = extractUsage(parsed)
      if (usage) recordUsage({ run: 'sous-agent', model, usage, parent })
      if (parsed && parsed.subtype === 'success' && typeof parsed.result === 'string') {
        return finish(true, parsed.result.slice(0, 60_000))
      }
      finish(false, '', parsed?.subtype || `run interrompu (code ${code}) ${errTail.split('\n').slice(-2).join(' ').slice(0, 300)}`)
    })
  })
}

/**
 * Lance un lot de sous-tâches en parallèle (concurrence bornée).
 * @param {object} opts
 *  - taches   : [{ titre, consigne }] (≤ 24)
 *  - contexte : texte commun donné à tous les sous-agents (optionnel)
 *  - modele / effort : surcharge pour CE lot (sinon config « sous-agents », sinon config principale)
 * @returns {Promise<Array<{titre, ok, resultat?, erreur?}>>}
 */
export async function runSubagents({ taches, contexte, modele, effort }) {
  const list = (Array.isArray(taches) ? taches : [])
    .map((t) => ({ titre: String(t?.titre || '').slice(0, 120), consigne: String(t?.consigne || '').slice(0, 20_000) }))
    .filter((t) => t.titre && t.consigne)
    .slice(0, MAX_TACHES)
  if (!list.length) throw new Error('Aucune tâche valide (titre + consigne requis, 24 max)')

  const cfg = agentConfig()
  // GOUVERNEUR DE CONSOMMATION — le garde-fou qui manquait : les sous-agents en
  // parallèle sont le PREMIER poste de dépense (≈ 77 %), et rien ne les bridait
  // quand la fenêtre de 5 h du forfait était déjà pleine. Quel que soit
  // l'appelant (brief, étude, mail, chat), si le forfait chauffe on resserre
  // AUTOMATIQUEMENT le lot — modèle rapide, effort faible, moins de tours, moins
  // de parallélisme — sans jamais bloquer ni perdre de tâche (chat du magistrat
  // dégradé, jamais interrompu). C'est indépendant du mode économe : même
  // décoché, un forfait à saturation freine tout seul.
  const parentRun = String(process.env.SIRAL_ATTACHE_RUN || '')
  const direct = DIRECT_RUNS.has(parentRun)
  const gov = direct ? { level: 'ok' } : consumptionGovernor(cfg)
  const tighten = gov.level === 'serrer' || gov.level === 'stop'
  const hard = gov.level === 'stop'
  const eco = cfg.econome || tighten
  // Les sous-agents sont des OUVRIERS DE LECTURE (extraction, audit, balayage
  // de PDF ou de trames) exécutés EN PARALLÈLE : le premier poste de dépense.
  // Par défaut on les met sur un modèle RAPIDE (Sonnet ; Haiku en mode économe)
  // et surtout PAS sur le modèle du run principal — qui peut être Opus et
  // rendrait N runs lourds simultanés, lents et gourmands en mémoire (c'était
  // la cause des analyses de trames qui s'éternisaient puis se faisaient tuer).
  // Le magistrat garde la main : sélecteur « Sous-agents » du panneau
  // (cfg.subModel) ou paramètre `modele` du lot pour forcer un autre modèle —
  // mais fenêtre saturée, on force le modèle rapide faute de choix explicite.
  const model = sanitizeModel(modele)
    || (tighten ? (cfg.subModel || ECO_SUBMODEL) : economicalModel(cfg))
  const useEffort = sanitizeEffort(effort) || (eco ? 'low' : cfg.effort)
  const subMaxTurns = hard ? Math.min(SUB_MAX_TURNS, 6) : eco ? Math.min(SUB_MAX_TURNS, 8) : SUB_MAX_TURNS
  // Moins de fronts simultanés quand la fenêtre chauffe : on étale le lot au
  // lieu de le déverser d'un coup dans un forfait déjà tendu.
  const concurrency = tighten ? Math.min(CONCURRENCY, 2) : CONCURRENCY
  const allowedTools = cfg.webAccess ? [ALLOWED_TOOLS, ...WEB_TOOLS].join(',') : ALLOWED_TOOLS
  const disallowedTools = cfg.webAccess
    ? DISALLOWED_TOOLS.split(',').filter((t) => !WEB_TOOLS.includes(t)).join(',')
    : DISALLOWED_TOOLS
  const mcpConfig = writeMcpConfig({ SIRAL_ATTACHE_SUBAGENT: '1', SIRAL_ATTACHE_RUN: 'sous-agent' }, 'mcp-config-sousagent.json')
  const systemPrompt = subagentSystemPrompt(contexte)

  const results = new Array(list.length)
  let next = 0
  async function worker() {
    while (next < list.length) {
      const i = next++
      const t = list[i]
      const r = await runOne({ consigne: t.consigne, mcpConfig, systemPrompt, allowedTools, disallowedTools, model, effort: useEffort, maxTurns: subMaxTurns, parent: parentRun })
      results[i] = { titre: t.titre, ...r }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker))
  return results
}
