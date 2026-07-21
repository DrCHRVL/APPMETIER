/**
 * SIRAL — Attaché de justice · comptage de la consommation de tokens.
 *
 * Le cerveau tourne sur l'ABONNEMENT Claude (Max), pas sur une clé API : il n'y
 * a donc pas de facture, mais un FORFAIT avec des plafonds d'usage (fenêtre
 * glissante de 5 h + plafond hebdomadaire). Pour que le magistrat sache où
 * passent ses jetons — et voie que les SOUS-AGENTS en consomment beaucoup —,
 * chaque run du CLI émet, en fin d'exécution, un bilan `usage` (jetons entrée /
 * sortie / cache) et un `total_cost_usd` (l'équivalent au tarif API). On les
 * consigne ici, ligne par ligne, EN CLAIR : ce ne sont que des nombres et des
 * horodatages — aucune donnée d'enquête —, ce qui permet d'afficher le bilan
 * même trousseau non remis.
 */
import { appendEncryptedLine, readEncryptedLines } from './store.mjs'

const USAGE_FILE = 'usage.jsonl'
const MAX_LINES = 20_000 // ~ plusieurs mois de runs ; lecture bornée

/** Regroupe un libellé de run en catégorie lisible par le magistrat. */
export function runCategory(run) {
  const r = String(run || '')
  if (r === 'sous-agent') return 'sous-agents'
  if (r === 'proactif') return 'mails'
  if (r === 'majordome') return 'brief'
  if (r === 'trames-analyse' || r === 'kb-analyse' || r === 'skills-analyse' || r === 'associations-suggest') return 'classements'
  if (r === 'apprentissage' || r === 'etude') return 'apprentissage'
  if (r.startsWith('routine:')) return 'routines'
  if (r === 'chat' || r === 'chat-carto' || r === 'chat-dossier') return 'conversations'
  return 'autres'
}

/**
 * Extrait le bilan de jetons d'un événement `result` du CLI (stream-json ou
 * json). Tolérant aux variantes de nommage (snake_case de l'API brute).
 */
export function extractUsage(resultEvent) {
  if (!resultEvent || typeof resultEvent !== 'object') return null
  const u = resultEvent.usage || {}
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const input = num(u.input_tokens ?? u.inputTokens)
  const output = num(u.output_tokens ?? u.outputTokens)
  const cacheW = num(u.cache_creation_input_tokens ?? u.cacheCreationInputTokens)
  const cacheR = num(u.cache_read_input_tokens ?? u.cacheReadInputTokens)
  if (input + output + cacheW + cacheR === 0 && resultEvent.total_cost_usd == null) return null
  return {
    in: input,
    out: output,
    cacheW,
    cacheR,
    cost: num(resultEvent.total_cost_usd),
    turns: num(resultEvent.num_turns),
    ms: num(resultEvent.duration_ms),
  }
}

/**
 * Consigne un run. Best-effort : ne bloque JAMAIS un run si l'écriture échoue.
 * @param {object} opts { run, model, usage:{in,out,cacheW,cacheR,cost,turns,ms}, parent }
 *   - parent : pour un sous-agent, le libellé du run qui l'a lancé (brief,
 *     mail, étude…) — c'est ce qui permet d'expliquer « d'où viennent les lots
 *     parallèles » au lieu de tout mettre dans un même sac « sous-agents ».
 */
export async function recordUsage({ run, model, usage, parent }) {
  try {
    if (!usage) return
    const line = {
      ts: Date.now(),
      run: String(run || 'chat').slice(0, 60),
      model: String(model || '').slice(0, 64),
      in: usage.in | 0,
      out: usage.out | 0,
      cacheW: usage.cacheW | 0,
      cacheR: usage.cacheR | 0,
      cost: Number(usage.cost) || 0,
      turns: usage.turns | 0,
      ms: usage.ms | 0,
      ...(parent ? { parent: String(parent).slice(0, 60) } : {}),
    }
    await appendEncryptedLine(USAGE_FILE, line)
  } catch { /* le comptage ne doit jamais gêner l'attaché */ }
}

/** Poste « source » d'un sous-agent, d'après le run parent qui l'a lancé. */
export function sousAgentSource(parent) {
  const cat = runCategory(parent)
  return cat === 'sous-agents' || cat === 'autres' ? 'autre' : cat
}

const HOUR = 3600 * 1000
const DAY = 24 * HOUR

function emptyBucket() {
  // sousAgentsBySource : d'OÙ viennent les lots parallèles (brief, mails, étude…)
  return { in: 0, out: 0, cacheW: 0, cacheR: 0, total: 0, cost: 0, runs: 0, byCategory: {}, sousAgentsBySource: {} }
}

function addLine(bucket, l) {
  const total = (l.in | 0) + (l.out | 0) + (l.cacheW | 0) + (l.cacheR | 0)
  bucket.in += l.in | 0
  bucket.out += l.out | 0
  bucket.cacheW += l.cacheW | 0
  bucket.cacheR += l.cacheR | 0
  bucket.total += total
  bucket.cost += Number(l.cost) || 0
  bucket.runs += 1
  const cat = runCategory(l.run)
  const c = bucket.byCategory[cat] || (bucket.byCategory[cat] = { total: 0, cost: 0, runs: 0 })
  c.total += total
  c.cost += Number(l.cost) || 0
  c.runs += 1
  // Détail des sous-agents PAR SOURCE (le run qui les a lancés) : c'est ce qui
  // explique « lots parallèles » — brief quotidien, mails, étude…
  if (cat === 'sous-agents') {
    const src = sousAgentSource(l.parent)
    const s = bucket.sousAgentsBySource[src] || (bucket.sousAgentsBySource[src] = { total: 0, runs: 0 })
    s.total += total
    s.runs += 1
  }
}

/**
 * Bilan agrégé sur plusieurs fenêtres temporelles. Le service renvoie des
 * SOMMES brutes ; l'app calcule les pourcentages contre les plafonds du
 * forfait (configurables), pour que le repère reste ajustable côté magistrat.
 */
export function usageSummary(now = Date.now()) {
  const lines = readEncryptedLines(USAGE_FILE, MAX_LINES)
  const windows = {
    w5h: { since: now - 5 * HOUR, bucket: emptyBucket() },
    today: { since: now - DAY, bucket: emptyBucket() },
    w7d: { since: now - 7 * DAY, bucket: emptyBucket() },
    w30d: { since: now - 30 * DAY, bucket: emptyBucket() },
  }
  let first = null
  for (const l of lines) {
    if (!l || typeof l.ts !== 'number') continue
    if (first == null || l.ts < first) first = l.ts
    for (const k of Object.keys(windows)) {
      if (l.ts >= windows[k].since) addLine(windows[k].bucket, l)
    }
  }
  // Derniers runs, les plus récents d'abord — pour VOIR ce qui a consommé et
  // quand (le brief du matin apparaît comme une rafale de « sous-agents »). Que
  // des nombres et des libellés : lisible sans trousseau.
  const recent = lines.slice(-80).reverse().map((l) => {
    const cat = runCategory(l.run)
    return {
      ts: l.ts,
      run: String(l.run || 'chat').slice(0, 60),
      cat,
      src: cat === 'sous-agents' ? sousAgentSource(l.parent) : undefined,
      total: (l.in | 0) + (l.out | 0) + (l.cacheW | 0) + (l.cacheR | 0),
      model: String(l.model || '').slice(0, 40),
    }
  })
  return {
    generatedAt: now,
    firstAt: first,
    entries: lines.length,
    w5h: windows.w5h.bucket,
    today: windows.today.bucket,
    w7d: windows.w7d.bucket,
    w30d: windows.w30d.bucket,
    recent,
  }
}
