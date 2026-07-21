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
import { listSkills, readSkill, setSkillDescription } from './skills.mjs'
import { listAssociations } from './associations.mjs'
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

/**
 * Clé de rapprochement TOLÉRANTE entre l'identifiant renvoyé par le modèle et
 * l'identifiant réel. Le modèle recopie rarement un slug de 60 caractères
 * (« ddejld-captation-de-donnees-keylogger ») au caractère près — un tiret ou
 * une casse suffisait à ce que la description soit jetée et la trame reste
 * « pas encore classée ». On compare une forme normalisée (minuscules, sans
 * accents ni séparateurs). Sans risque de faux positif : on ne mappe QUE vers
 * un identifiant effectivement demandé dans le lot.
 */
const normKey = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '')

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
    const byNorm = new Map()
    for (const t of Array.isArray(run.data.trames) ? run.data.trames : []) {
      if (t && typeof t.nom === 'string' && typeof t.description === 'string' && t.description.trim()) {
        byNorm.set(normKey(t.nom), t.description.trim())
      }
    }
    for (const it of safeLot) {
      const desc = byNorm.get(normKey(it.nom))
      if (!desc) { echecs.push(it.nom); continue }
      try { await setTrameDescription(keys, it.nom, desc); classees++ }
      catch { echecs.push(it.nom) }
    }
  }

  // RATTRAPAGE — toute trame qu'un lot n'a pas décrite (nom non retrouvé dans le
  // JSON groupé) est reprise UNE PAR UNE : appel minuscule, plus aucun
  // appariement à faire (la réponse ne porte que cette trame). C'est ce qui
  // garantit qu'une trame ne reste pas indéfiniment « pas encore classée ».
  if (echecs.length) {
    const rest = [...new Set(echecs)]
    echecs.length = 0
    for (const nom of rest) {
      const it = items.find((x) => x.nom === nom)
      if (!it) { echecs.push(nom); continue }
      const run = await runClaudeJson({ systemPrompt, userPrompt: tramesUserPrompt([it]), model, runLabel: 'trames-analyse' })
      const t0 = run.ok && Array.isArray(run.data.trames) ? run.data.trames[0] : null
      const desc = t0 && typeof t0.description === 'string' ? t0.description.trim() : ''
      if (!desc) { echecs.push(nom); if (run.error) lastError = run.error; continue }
      try { await setTrameDescription(keys, nom, desc); classees++ }
      catch { echecs.push(nom) }
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

/** Applique (déterministe) description/catégorie/chemin d'une entrée si le
 *  modèle a rendu quelque chose d'exploitable. Renvoie true si écrit. */
async function applyKbEntry(keys, it, e) {
  if (!e || (!e.description && !e.categorie && !e.chemin)) return false
  try {
    await setKbMeta(keys, it.id, {
      description: typeof e.description === 'string' ? e.description.trim() : undefined,
      categorie: typeof e.categorie === 'string' && e.categorie.trim() ? e.categorie.trim() : undefined,
      chemin: typeof e.chemin === 'string' && e.chemin.trim() ? e.chemin.trim() : undefined,
    })
    return true
  } catch { return false }
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
    const byNorm = new Map()
    for (const e of Array.isArray(run.data.entrees) ? run.data.entrees : []) {
      if (e && typeof e.id === 'string') byNorm.set(normKey(e.id), e)
    }
    for (const it of safeLot) {
      if (await applyKbEntry(keys, it, byNorm.get(normKey(it.id)))) classees++
      else echecs.push(it.id)
    }
  }

  // RATTRAPAGE — une par une pour les entrées qu'un lot n'a pas rangées.
  if (echecs.length) {
    const rest = [...new Set(echecs)]
    echecs.length = 0
    for (const id of rest) {
      const it = items.find((x) => x.id === id)
      if (!it) { echecs.push(id); continue }
      const run = await runClaudeJson({ systemPrompt, userPrompt: kbUserPrompt([it]), model, runLabel: 'kb-analyse' })
      const e0 = run.ok && Array.isArray(run.data.entrees) ? run.data.entrees[0] : null
      if (await applyKbEntry(keys, it, e0)) classees++
      else { echecs.push(id); if (run.error) lastError = run.error }
    }
  }

  const ok = classees > 0 || (anyRun && !echecs.length)
  return {
    ok, total: items.length, classees, echecs,
    doublons: [...new Set(doublons)].slice(0, 20), perimes: [...new Set(perimes)].slice(0, 20),
    model, error: ok ? undefined : (lastError || 'classement sans effet'),
  }
}

// ── Skills ───────────────────────────────────────────────────────────────────
// Même passe rapide que les trames (un appel modèle par lot, SANS sous-agent),
// mais les skills arrivent le plus souvent AVEC une description (le front-matter
// des fichiers .skill exportés de Claude web) : on ne la CLOBBER jamais. Cette
// passe ne remplit que les descriptions MANQUANTES (skill collée en markdown nu).

const HEAD_SKILL = 2500

function skillsSystemPrompt() {
  return [
    `Tu es l'attaché d'un magistrat du parquet (contentieux ${attacheContentieux()} — criminalité organisée). Tu classes des SKILLS (méthodes réutilisables de rédaction / d'analyse).`,
    'Tu ne réécris RIEN : tu DÉCRIS. Ne pose aucune question.',
    'Pour CHAQUE skill fournie, rends une description d\'UNE phrase (280 caractères max) qui dit SURTOUT QUAND l\'appliquer — c\'est elle qui déclenche la skill plus tard : le type de tâche ou d\'acte concerné, et en quelques mots la méthode.',
    'SORTIE — réponds EXCLUSIVEMENT par un objet JSON valide, sans texte autour, sans bloc de code markdown :',
    '{ "skills": [ { "nom": string /* recopié à l\'identique */, "description": string } ] }',
  ].join('\n')
}

function skillsUserPrompt(items) {
  const parts = [`SKILLS À DÉCRIRE (${items.length}) — nom + en-tête du contenu :`]
  for (const it of items) {
    parts.push('', '===== SKILL =====', `nom: ${it.nom}`, '--- début du contenu ---', it.tete, '--- fin ---')
  }
  parts.push('', 'Réponds par le JSON strict décrit dans les consignes système.')
  return parts.join('\n')
}

/**
 * Décrit les skills dont la description MANQUE (jamais celles déjà décrites — on
 * ne touche pas au front-matter d'un .skill). Un appel modèle par lot, sans
 * sous-agent ; rapprochement normalisé + rattrapage une par une.
 * @returns {Promise<{ ok, total, classees, echecs, ignorees, model, error? }>}
 */
export async function classerSkills(keys, noms) {
  const demandes = new Set((Array.isArray(noms) ? noms : []).map((n) => String(n)))
  const dispo = new Map(listSkills(keys).map((s) => [s.nom, s]))
  const items = []
  let ignorees = 0
  for (const nom of demandes) {
    const meta = dispo.get(nom)
    if (!meta) continue
    if (String(meta.description || '').trim()) { ignorees++; continue } // déjà décrite : intacte
    const rec = readSkill(keys, nom)
    if (!rec || !String(rec.contenu || '').trim()) continue
    items.push({ nom, tete: head(rec.contenu, HEAD_SKILL) })
  }
  if (!items.length) return { ok: true, total: 0, classees: 0, echecs: [], ignorees }

  const model = economicalModel()
  const systemPrompt = skillsSystemPrompt()
  let classees = 0
  const echecs = []
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
    const run = await runClaudeJson({ systemPrompt, userPrompt: skillsUserPrompt(safeLot), model, runLabel: 'skills-analyse' })
    anyRun = true
    if (!run.ok) { lastError = run.error; for (const it of safeLot) echecs.push(it.nom); continue }
    const byNorm = new Map()
    for (const s of Array.isArray(run.data.skills) ? run.data.skills : []) {
      if (s && typeof s.nom === 'string' && typeof s.description === 'string' && s.description.trim()) {
        byNorm.set(normKey(s.nom), s.description.trim())
      }
    }
    for (const it of safeLot) {
      const desc = byNorm.get(normKey(it.nom))
      if (!desc) { echecs.push(it.nom); continue }
      try { await setSkillDescription(keys, it.nom, desc); classees++ }
      catch { echecs.push(it.nom) }
    }
  }

  // RATTRAPAGE — une par une pour les skills qu'un lot n'a pas décrites.
  if (echecs.length) {
    const rest = [...new Set(echecs)]
    echecs.length = 0
    for (const nom of rest) {
      const it = items.find((x) => x.nom === nom)
      if (!it) { echecs.push(nom); continue }
      const run = await runClaudeJson({ systemPrompt, userPrompt: skillsUserPrompt([it]), model, runLabel: 'skills-analyse' })
      const s0 = run.ok && Array.isArray(run.data.skills) ? run.data.skills[0] : null
      const desc = s0 && typeof s0.description === 'string' ? s0.description.trim() : ''
      if (!desc) { echecs.push(nom); if (run.error) lastError = run.error; continue }
      try { await setSkillDescription(keys, nom, desc); classees++ }
      catch { echecs.push(nom) }
    }
  }

  const ok = classees > 0 || (anyRun && !echecs.length)
  return { ok, total: items.length, classees, echecs, ignorees, model, error: ok ? undefined : (lastError || 'classement sans effet') }
}

// ── Suggestion d'associations « type d'acte → trame(s) + skill(s) » ───────────
// Le manque signalé par le magistrat : après avoir téléversé trames et skills,
// rien ne PRÉ-REMPLIT la table des associations (elle ne se peuplait qu'en le
// disant en chat, une par une). Ici, UNE passe rapide (un appel modèle, sans
// outil ni sous-agent) lit les noms + descriptions des trames et des skills et
// PROPOSE des associations. Elle N'ÉCRIT RIEN : les suggestions remontent au
// panneau, qui les charge en lignes de brouillon ; le magistrat vérifie, ajuste
// et ENREGISTRE — rien n'est appliqué à une rédaction tant qu'il n'a pas validé.

function assocSystemPrompt() {
  return [
    `Tu es l'attaché d'un magistrat du parquet (contentieux ${attacheContentieux()} — criminalité organisée). Tu proposes une table d'ASSOCIATIONS « type d'acte → trame(s) + skill(s) » : pour chaque type d'acte récurrent, quelle TRAME sert de gabarit et quelle SKILL donne la méthode de rédaction.`,
    'On te fournit la bibliothèque de TRAMES (plans-types d\'actes) et de SKILLS (méthodes), chacune avec son nom et sa description.',
    'Pour CHAQUE trame qui correspond à un type d\'acte identifiable, propose UNE association :',
    '- « acte » : un libellé LISIBLE du type d\'acte (ex. « Prolongation de géolocalisation (JLD) », « Soit-transmis de saisine — stupéfiants 706-80 », « Requête de saisie de compte bancaire ») ;',
    '- « trames » : la ou les trames pertinentes — le plus souvent UNE SEULE (celle qui porte ce type d\'acte) ;',
    '- « skills » : la ou les skills de méthode qui s\'appliquent à ce type d\'acte (0, 1 ou plusieurs — vide si aucune ne colle vraiment) ;',
    '- « notes » : une courte justification facultative.',
    'RÈGLES STRICTES : n\'invente AUCUN nom — recopie les noms de trames et de skills EXACTEMENT tels que fournis. Ne propose PAS d\'association sans trame. N\'associe une skill que si elle couvre réellement ce type d\'acte. Regroupe sous un seul libellé les trames quasi équivalentes si c\'est plus clair. Ne pose aucune question.',
    'SORTIE — réponds EXCLUSIVEMENT par un objet JSON valide, sans texte autour, sans bloc de code markdown :',
    '{ "associations": [ { "acte": string, "trames": [string], "skills": [string], "notes": string } ] }',
  ].join('\n')
}

function assocUserPrompt(trames, skills) {
  const line = (x) => `- ${x.nom}${x.description ? ` : ${String(x.description).slice(0, 200)}` : ''}`
  return [
    `TRAMES (${trames.length}) — nom : description :`,
    ...trames.map(line),
    '',
    `SKILLS (${skills.length}) — nom : description :`,
    ...skills.map(line),
    '',
    'Réponds par le JSON strict décrit dans les consignes système.',
  ].join('\n')
}

/**
 * Propose des associations acte → trame(s) + skill(s) à partir de la
 * bibliothèque. NE PERSISTE RIEN — renvoie une liste de suggestions que le
 * panneau charge en brouillon, à valider par « Enregistrer ». Chaque nom de
 * trame/skill renvoyé est VÉRIFIÉ contre la bibliothèque réelle (rapprochement
 * normalisé) : les noms inventés par le modèle sont écartés. Les types d'acte
 * déjà présents dans la table ne sont pas re-suggérés.
 * @returns {Promise<{ ok, suggestions:Array<{acte,trames,skills,notes?}>, model?, error? }>}
 */
export async function suggererAssociations(keys) {
  const trames = listTrames(keys).map((t) => ({ nom: t.nom, description: t.description || '' }))
  const skills = listSkills(keys).map((s) => ({ nom: s.nom, description: s.description || '' }))
  if (!trames.length) return { ok: false, suggestions: [], error: 'Aucune trame en bibliothèque à associer.' }

  const model = economicalModel()
  const run = await runClaudeJson({
    systemPrompt: assocSystemPrompt(),
    userPrompt: assocUserPrompt(trames.slice(0, 150), skills.slice(0, 60)),
    model,
    runLabel: 'associations-suggest',
  })
  if (!run.ok) return { ok: false, suggestions: [], model, error: run.error || 'suggestion sans effet' }

  // Rapprochement normalisé sur les noms RÉELS (on n'accepte aucun nom inventé).
  const trByNorm = new Map(trames.map((t) => [normKey(t.nom), t.nom]))
  const skByNorm = new Map(skills.map((s) => [normKey(s.nom), s.nom]))
  const dejaVus = new Set(listAssociations(keys).map((a) => normKey(a.acte)))
  const seen = new Set()
  const suggestions = []
  for (const a of Array.isArray(run.data.associations) ? run.data.associations : []) {
    const acte = String(a?.acte || '').trim().slice(0, 120)
    if (!acte) continue
    const cle = normKey(acte)
    if (!cle || dejaVus.has(cle) || seen.has(cle)) continue
    const resolve = (list, map) => [...new Set(
      (Array.isArray(list) ? list : []).map((x) => map.get(normKey(x))).filter(Boolean),
    )]
    const tr = resolve(a.trames, trByNorm)
    if (!tr.length) continue // une association sans trame réelle n'a aucune valeur
    seen.add(cle)
    suggestions.push({
      acte,
      trames: tr,
      skills: resolve(a.skills, skByNorm),
      notes: a.notes ? String(a.notes).slice(0, 300) : undefined,
    })
  }
  return { ok: true, suggestions: suggestions.slice(0, 100), model }
}
