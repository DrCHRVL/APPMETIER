/**
 * SIRAL — Attaché de justice · classement RAPIDE des bibliothèques (trames et
 * base de connaissances).
 *
 * « Ranger / classer » n'est PAS une analyse juridique : c'est une passe de
 * DESCRIPTION. On lit l'en-tête de chaque pièce (les trames sont de courts
 * gabarits ; pour une entrée de la base, le début suffit à la situer), on
 * appelle le CLI `claude` en UN SEUL TOUR, SANS AUCUN outil (pas de MCP, pas
 * de sous-agents, pas de web), et il rend un JSON : par pièce, une description
 * d'une phrase (+ catégorie/chemin pour la base). Le service applique ensuite
 * ces descriptions de façon DÉTERMINISTE (setTrameDescription / setKbMeta) —
 * le contenu n'est jamais touché.
 *
 * Pourquoi ce module existe : classer la bibliothèque déléguait auparavant UNE
 * analyse approfondie à N sous-agents en parallèle, rassemblée par un run
 * principal qui ré-ingérait tous leurs comptes rendus — lent, souvent tué
 * avant de rendre quoi que ce soit, et ruineux en jetons. Ici, UN appel modèle
 * par lot de ~20 pièces : quelques secondes, quelques milliers de jetons.
 *
 * L'analyse juridique en profondeur (contrôle de légalité, nullités) reste
 * possible À LA DEMANDE, sur UNE trame précise, dans le chat de l'attaché —
 * ciblée et bornée, comme sur Claude web.
 */
import { spawn } from 'node:child_process'
import { attacheDir, attacheContentieux, ensureDir } from './store.mjs'
import { listTrames, readTrame, setTrameDescription } from './trames.mjs'
import { listKb, readKbEntry, setKbMeta, KB_CATEGORIES } from './kb.mjs'
import { economicalModel } from './subagents.mjs'
import { extractUsage, recordUsage } from './usage.mjs'

const CLAUDE_BIN = process.env.SIRAL_ATTACHE_CLAUDE_BIN || 'claude'
const RUN_TIMEOUT_MS = Number(process.env.SIRAL_ATTACHE_CLASSER_TIMEOUT_MIN || 4) * 60 * 1000

// Lot d'un appel modèle : assez large pour peu d'appels, assez petit pour tenir
// SOUS le plafond d'argv unitaire (128 Kio pour -p) et rester rapide.
const BATCH = Math.max(4, Math.min(40, Number(process.env.SIRAL_ATTACHE_CLASSER_BATCH || 20)))
// On ne lit que l'EN-TÊTE de chaque pièce : la situer (type, cadre) ne demande
// pas tout le corps. Borne par pièce + borne globale du lot (défense argv).
const HEAD_TRAME = 1600
const HEAD_KB = 2000
const MAX_TOTAL_CHARS = 90_000

// Aucun outil : le modèle lit et répond, point.
const DISALLOWED_TOOLS = 'Bash,Edit,Write,NotebookEdit,Read,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,KillShell,BashOutput'

const head = (s, n) => {
  const t = String(s || '').replace(/\r/g, '')
  return t.length > n ? t.slice(0, n) + '\n[…]' : t
}

/** Isole et parse le premier objet JSON d'une chaîne (tolère les fences). */
function parseJsonLoose(text) {
  if (!text || typeof text !== 'string') return null
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  if (s[0] !== '{') {
    const a = s.indexOf('{')
    const b = s.lastIndexOf('}')
    if (a >= 0 && b > a) s = s.slice(a, b + 1)
  }
  try { return JSON.parse(s) } catch { return null }
}

/** Un appel CLI `claude` en un tour, sans outil : renvoie l'objet JSON parsé. */
function runClaudeJson({ systemPrompt, userPrompt, model, runLabel }) {
  const cwd = attacheDir('workdir')
  ensureDir(cwd)
  const args = [
    '-p', userPrompt,
    '--output-format', 'json',
    '--append-system-prompt', systemPrompt,
    '--disallowedTools', DISALLOWED_TOOLS,
    '--max-turns', '1',
    ...(model ? ['--model', model] : []),
  ]
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(CLAUDE_BIN, args, { cwd, env: { ...process.env, SIRAL_ATTACHE_RUN: 'classement' }, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return resolve({ ok: false, error: `CLI claude non lançable : ${e.message}` })
    }
    let stdout = ''
    let stderrTail = ''
    let settled = false
    const done = (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v) }
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {}; done({ ok: false, error: 'délai dépassé' }) }, RUN_TIMEOUT_MS)
    child.stdout.on('data', (c) => { stdout += c.toString('utf8') })
    child.stderr.on('data', (c) => { stderrTail = (stderrTail + c.toString('utf8')).slice(-2000) })
    child.on('error', (e) => done({ ok: false, error: `CLI claude introuvable : ${e.message}` }))
    child.on('close', (code) => {
      let envelope = null
      try { envelope = JSON.parse(stdout.trim()) } catch {}
      // Chaque appel émet son bilan de jetons : la consommation (désormais
      // minime) reste visible au tableau de bord, catégorie « classements ».
      const usage = extractUsage(envelope)
      if (usage) recordUsage({ run: runLabel, model, usage })
      if (code !== 0) {
        return done({ ok: false, error: `claude a échoué (code ${code}) — ${stderrTail.split('\n').slice(-2).join(' ').slice(0, 300)}` })
      }
      if (envelope && envelope.is_error) {
        return done({ ok: false, error: String(envelope.result || 'échec du run').slice(0, 300) })
      }
      const resultText = envelope && typeof envelope.result === 'string' ? envelope.result : stdout
      const data = parseJsonLoose(resultText)
      if (!data || typeof data !== 'object') return done({ ok: false, error: 'réponse du modèle non exploitable (JSON absent)' })
      done({ ok: true, data })
    })
  })
}

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// ── Trames ──────────────────────────────────────────────────────────────────

function tramesSystemPrompt() {
  return [
    `Tu es l'attaché d'un magistrat du parquet (contentieux ${attacheContentieux()} — criminalité organisée). Tu CLASSES une bibliothèque de trames (plans-types d'actes).`,
    "Tu ne réécris RIEN et tu ne fais AUCUN contrôle de légalité : tu DÉCRIS pour ranger. Ne pose aucune question.",
    'Pour CHAQUE trame fournie, rends une description d\'UNE phrase (280 caractères max) : type d\'acte précis, cadre juridique et principaux articles visés (CPP notamment), régime applicable (droit commun ou dérogatoire criminalité organisée 706-73 s. / 706-80 s.), et en quelques mots quand s\'en servir.',
    'Signale seulement les DOUBLONS MANIFESTES (plusieurs trames couvrant exactement le même objet).',
    'SORTIE — réponds EXCLUSIVEMENT par un objet JSON valide, sans texte autour, sans bloc de code markdown :',
    '{ "trames": [ { "nom": string /* recopié à l\'identique */, "description": string } ], "doublons": [ string ] }',
  ].join('\n')
}

function tramesUserPrompt(items) {
  const parts = [`TRAMES À CLASSER (${items.length}) — nom + en-tête du contenu :`]
  for (const it of items) {
    parts.push('', '===== TRAME =====', `nom: ${it.nom}`, '--- début du contenu ---', it.tete, '--- fin ---')
  }
  parts.push('', 'Réponds par le JSON strict décrit dans les consignes système.')
  return parts.join('\n')
}

/**
 * Classe (décrit) un lot de trames en une passe par sous-lot. Déterministe côté
 * écriture : on n'applique une description qu'aux trames réellement demandées.
 * @returns {Promise<{ ok, total, classees, echecs, doublons, model, error? }>}
 */
export async function classerTrames(keys, noms) {
  const demandes = new Set((Array.isArray(noms) ? noms : []).map((n) => String(n)))
  const dispo = new Map(listTrames(keys).map((t) => [t.nom, t]))
  const items = []
  for (const nom of demandes) {
    const meta = dispo.get(nom)
    if (!meta) continue
    const rec = readTrame(keys, nom)
    if (!rec || !String(rec.contenu || '').trim()) continue
    items.push({ nom, tete: head(rec.contenu, HEAD_TRAME) })
  }
  if (!items.length) return { ok: false, total: 0, classees: 0, echecs: [], doublons: [], error: 'aucune trame lisible à classer' }

  const model = economicalModel()
  const systemPrompt = tramesSystemPrompt()
  let classees = 0
  const echecs = []
  const doublons = []
  let anyRun = false
  let lastError = null

  for (const lot of chunk(items, BATCH)) {
    // Sous-lot borné aussi en volume (défense argv) : on coupe si dépassement.
    const safeLot = []
    let total = 0
    for (const it of lot) {
      if (total + it.tete.length > MAX_TOTAL_CHARS && safeLot.length) break
      total += it.tete.length
      safeLot.push(it)
    }
    const run = await runClaudeJson({ systemPrompt, userPrompt: tramesUserPrompt(safeLot), model, runLabel: 'trames-analyse' })
    anyRun = true
    if (!run.ok) { lastError = run.error; for (const it of safeLot) echecs.push(it.nom); continue }
    if (Array.isArray(run.data.doublons)) doublons.push(...run.data.doublons.map(String).filter(Boolean))
    const byNom = new Map()
    for (const t of Array.isArray(run.data.trames) ? run.data.trames : []) {
      if (t && typeof t.nom === 'string' && typeof t.description === 'string') byNom.set(t.nom, t.description)
    }
    for (const it of safeLot) {
      const desc = byNom.get(it.nom)
      if (!desc || !desc.trim()) { echecs.push(it.nom); continue }
      try { await setTrameDescription(keys, it.nom, desc.trim()); classees++ }
      catch { echecs.push(it.nom) }
    }
  }
  const ok = classees > 0 || (anyRun && !echecs.length)
  return { ok, total: items.length, classees, echecs, doublons: [...new Set(doublons)].slice(0, 20), model, error: ok ? undefined : (lastError || 'classement sans effet') }
}

// ── Base de connaissances ────────────────────────────────────────────────────

function kbSystemPrompt() {
  return [
    'Tu es le BIBLIOTHÉCAIRE de la base de connaissances d\'un magistrat du parquet. Tu CLASSES des entrées documentaires.',
    "Tu ne modifies AUCUN contenu : tu DÉCRIS et tu RANGES. Ne pose aucune question.",
    'Pour CHAQUE entrée fournie, rends :',
    '- une description d\'UNE phrase (280 caractères max) : ce que contient le document et quand s\'en servir ;',
    `- la catégorie la plus juste parmi ${JSON.stringify(KB_CATEGORIES)} ;`,
    '- un chemin de pochette SEULEMENT s\'il est plus cohérent que le rangement actuel (ex. « Jurisprudence/Cassation »), sinon null.',
    'Signale les doublons manifestes et les documents visiblement périmés (texte abrogé, version ancienne).',
    'SORTIE — réponds EXCLUSIVEMENT par un objet JSON valide, sans texte autour, sans bloc de code markdown :',
    '{ "entrees": [ { "id": string /* recopié à l\'identique */, "description": string, "categorie": string, "chemin": string | null } ], "doublons": [string], "perimes": [string] }',
  ].join('\n')
}

function kbUserPrompt(items) {
  const parts = [`ENTRÉES À CLASSER (${items.length}) — identifiant, titre, chemin actuel + début du contenu :`]
  for (const it of items) {
    parts.push('', '===== ENTRÉE =====', `id: ${it.id}`, `titre: ${it.titre || ''}`, `chemin actuel: ${it.chemin || '(aucun)'}`, '--- début du contenu ---', it.tete, '--- fin ---')
  }
  parts.push('', 'Réponds par le JSON strict décrit dans les consignes système.')
  return parts.join('\n')
}

/**
 * Classe (décrit + range) un lot d'entrées de la base en une passe par sous-lot.
 * @returns {Promise<{ ok, total, classees, echecs, doublons, perimes, model, error? }>}
 */
export async function classerKb(keys, ids) {
  const demandes = new Set((Array.isArray(ids) ? ids : []).map((n) => String(n)))
  const dispo = new Map(listKb(keys).map((e) => [e.id, e]))
  const items = []
  for (const id of demandes) {
    const meta = dispo.get(id)
    if (!meta) continue
    const rec = readKbEntry(keys, id)
    if (!rec || !String(rec.contenu || '').trim()) continue
    items.push({ id, titre: rec.titre, chemin: rec.chemin, tete: head(rec.contenu, HEAD_KB) })
  }
  if (!items.length) return { ok: false, total: 0, classees: 0, echecs: [], doublons: [], perimes: [], error: 'aucune entrée lisible à classer' }

  const model = economicalModel()
  const systemPrompt = kbSystemPrompt()
  let classees = 0
  const echecs = []
  const doublons = []
  const perimes = []
  let anyRun = false
  let lastError = null

  for (const lot of chunk(items, BATCH)) {
    const safeLot = []
    let total = 0
    for (const it of lot) {
      if (total + it.tete.length > MAX_TOTAL_CHARS && safeLot.length) break
      total += it.tete.length
      safeLot.push(it)
    }
    const run = await runClaudeJson({ systemPrompt, userPrompt: kbUserPrompt(safeLot), model, runLabel: 'kb-analyse' })
    anyRun = true
    if (!run.ok) { lastError = run.error; for (const it of safeLot) echecs.push(it.id); continue }
    if (Array.isArray(run.data.doublons)) doublons.push(...run.data.doublons.map(String).filter(Boolean))
    if (Array.isArray(run.data.perimes)) perimes.push(...run.data.perimes.map(String).filter(Boolean))
    const byId = new Map()
    for (const e of Array.isArray(run.data.entrees) ? run.data.entrees : []) {
      if (e && typeof e.id === 'string') byId.set(e.id, e)
    }
    for (const it of safeLot) {
      const e = byId.get(it.id)
      if (!e || (!e.description && !e.categorie && !e.chemin)) { echecs.push(it.id); continue }
      try {
        await setKbMeta(keys, it.id, {
          description: typeof e.description === 'string' ? e.description.trim() : undefined,
          categorie: typeof e.categorie === 'string' && e.categorie.trim() ? e.categorie.trim() : undefined,
          chemin: typeof e.chemin === 'string' && e.chemin.trim() ? e.chemin.trim() : undefined,
        })
        classees++
      } catch { echecs.push(it.id) }
    }
  }
  const ok = classees > 0 || (anyRun && !echecs.length)
  return {
    ok, total: items.length, classees, echecs,
    doublons: [...new Set(doublons)].slice(0, 20), perimes: [...new Set(perimes)].slice(0, 20),
    model, error: ok ? undefined : (lastError || 'classement sans effet'),
  }
}
