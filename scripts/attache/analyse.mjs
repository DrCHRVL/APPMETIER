/**
 * SIRAL — Attaché de justice · analyse IA des documents (extraction d'actes
 * + chaîne légale).
 *
 * Moteur d'analyse RÉSERVÉ À L'ADMINISTRATEUR : quand l'attaché est actif, la
 * fonctionnalité « Analyse automatique des documents » de SIRAL délègue ici
 * plutôt qu'aux heuristiques regex (utiles mais bridées à un format d'acte).
 * On appelle le CLI `claude` en mode HEADLESS, en UN SEUL TOUR, sans AUCUN
 * outil (pas de MCP, pas de shell, pas de fichiers, pas de web) : le modèle
 * ne fait que LIRE le texte des PDF fournis et RÉPONDRE en JSON strict.
 *
 * Rien n'est écrit au dossier ici : le résultat remonte au navigateur de
 * l'administrateur, qui le passe dans le même pipeline de validation que le
 * moteur classique (dédoublonnage, chaînage, ✓ de l'utilisateur avant toute
 * création). L'IA propose, l'administrateur décide.
 *
 * Modèle : SIRAL_ATTACHE_ANALYSE_MODEL (défaut « sonnet » — Haiku suffit pour
 * les ordonnances standard, Sonnet est plus sûr sur les formats atypiques et
 * l'OCR bruité). Jamais Opus par défaut : la tâche ne le justifie pas.
 */
import { spawn } from 'node:child_process'
import { attacheDir, attacheContentieux, ensureDir } from './store.mjs'

const CLAUDE_BIN = process.env.SIRAL_ATTACHE_CLAUDE_BIN || 'claude'
const ANALYSE_MODEL = process.env.SIRAL_ATTACHE_ANALYSE_MODEL || 'sonnet'
const RUN_TIMEOUT_MS = Number(process.env.SIRAL_ATTACHE_ANALYSE_TIMEOUT_MIN || 4) * 60 * 1000

// Bornes de sécurité (un dossier peut charrier beaucoup de PDF volumineux).
// Le prompt part en UN SEUL argument (-p) : sous Linux, un argv unitaire est
// plafonné à 128 Kio (MAX_ARG_STRLEN). On borne donc le total bien en-dessous,
// consignes système et résumé des actes compris.
const MAX_DOCS = 40
const MAX_CHARS_PER_DOC = 14_000
const MAX_TOTAL_CHARS = 90_000

// Aucun outil : le modèle lit et répond, point. Défense en profondeur.
const DISALLOWED_TOOLS = 'Bash,Edit,Write,NotebookEdit,Read,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,KillShell,BashOutput'

const TYPES_ACTE = [
  'autorisation_initiale_ecoute',
  'autorisation_initiale_geoloc',
  'prolongation_ecoute',
  'prolongation_geoloc',
  'requete_ecoute',
  'requete_geoloc',
  'autre',
]

/** Persona d'extraction — cadrage juridique dense, sortie 100 % déterministe. */
function systemPrompt() {
  return [
    `Tu es un analyste juridique expert, attaché d'un magistrat du parquet (contentieux ${attacheContentieux()} — criminalité organisée). Tu extrais des données structurées d'ordonnances et de réquisitions relatives aux mesures d'enquête, et tu évalues la complétude de la chaîne légale.`,
    '',
    'CADRE JURIDIQUE — repères :',
    '- Écoute / interception de correspondances téléphoniques : art. 706-95, 100 et s. CPP. Chaîne : Requête du procureur → Autorisation du JLD (durée typique 1 mois) → [Requête de prolongation → Autorisation JLD de prolongation] × N.',
    '- Géolocalisation en temps réel : art. 230-32 et s. CPP. Chaîne : Autorisation initiale du procureur (durée typique 15 jours) → au-delà, [Requête au JLD → Autorisation JLD de prolongation] × N.',
    "- Distingue toujours : REQUÊTE (le procureur DEMANDE) ≠ AUTORISATION/ORDONNANCE (le JLD ou le procureur DÉCIDE) ; AUTORISATION INITIALE ≠ PROLONGATION/RENOUVELLEMENT/POURSUITE.",
    "- Autorité : « jld » si l'acte émane du juge des libertés et de la détention (mentions « PAR CES MOTIFS », « Nous, … vice-président », « juge des libertés »), sinon « procureur ».",
    '',
    'RÈGLES D\'EXTRACTION :',
    "- Le DISPOSITIF prime (parties « PAR CES MOTIFS », « Par conséquent », « AUTORISONS », « DEMANDONS »). Le titre et les visas ne sont que des indices.",
    '- cibles : pour une écoute, le/les numéro(s) de téléphone au format « 06.12.34.56.78 » (10 chiffres, points). Pour une géolocalisation, l\'objet suivi : « MARQUE Modèle IMMAT » (ex. « FORD Fiesta CF-554-GE ») ou un numéro de ligne géolocalisée. Corrige les confusions OCR évidentes (O→0, l/I→1) dans les chiffres.',
    '- duree : nombre entier en chaîne (« 15 », « 1 »). dureeUnit : « jours » ou « mois ». Convertis les nombres en lettres (« quinze » → « 15 »).',
    '- dateAutorisation : date de la décision (« Fait à …, le … ») au format ISO AAAA-MM-JJ.',
    '- Pour une PROLONGATION, renseigne dateAutorisationInitiale (AAAA-MM-JJ) et dureeInitiale si l\'acte initial est visé (« Vu l\'autorisation du … »).',
    '- tribunal : ville du tribunal judiciaire, en MAJUSCULES. titulaire / utilisateur : personnes physiques citées (titulaire de la ligne / utilisateur présumé). numeroPV : numéro de procès-verbal si présent.',
    '- confidence : 0 à 1, ta certitude réelle. motif : UNE phrase courte justifiant le type retenu et signalant toute ambiguïté (format inhabituel, OCR douteux, cible incertaine…).',
    "- Si un document n'est PAS un acte d'enquête de ce type (courrier, PV de synthèse, note…), classe-le type « autre » (il n'apparaîtra pas comme acte).",
    '',
    'CHAÎNE LÉGALE — pour CHAQUE acte DÉJÀ enregistré dans l\'enquête (liste fournie, avec index), vérifie si les documents légalement attendus figurent PARMI LES PDF SCANNÉS, et signale ceux qui MANQUENT :',
    '- Écoute : requête initiale au JLD (severite « warning »), autorisation JLD initiale (severite « error »), et pour chaque prolongation enregistrée : requête (« warning ») + autorisation JLD (« error »).',
    '- Géolocalisation : autorisation initiale du procureur (« error »), et pour chaque prolongation : requête JLD (« warning ») + autorisation JLD (« error »).',
    'Rapproche par le fond (même numéro/plaque, dates cohérentes) et non par le nom de fichier. N\'invente jamais un manque : si le document correspondant est présent dans le scan, ne le signale pas.',
    '',
    'SORTIE — réponds EXCLUSIVEMENT par un objet JSON valide, sans texte autour, sans bloc de code markdown. Schéma :',
    '{',
    '  "actes": [{',
    '    "fileName": string,               // recopié à l\'identique depuis le document',
    `    "type": ${JSON.stringify(TYPES_ACTE)},`,
    '    "autorite": "procureur" | "jld",',
    '    "cibles": string[],',
    '    "duree": string, "dureeUnit": "jours" | "mois",',
    '    "dateAutorisation": string,       // AAAA-MM-JJ ou ""',
    '    "tribunal": string,',
    '    "numeroPV": string | null, "titulaire": string | null, "utilisateur": string | null,',
    '    "objetDescription": string | null,        // géoloc : véhicule + plaque (+ utilisateur)',
    '    "dateAutorisationInitiale": string | null, "dureeInitiale": string | null,',
    '    "confidence": number, "motif": string',
    '  }],',
    '  "chaineLegale": [{',
    '    "acteType": "ecoute" | "geoloc",',
    '    "acteIndex": number,              // index dans la liste des actes existants fournie',
    '    "documentManquant": string,       // ex. "Autorisation JLD initiale"',
    '    "severite": "warning" | "error"',
    '  }],',
    '  "resume": string                    // 1–2 phrases : ce que contient le lot, points d\'attention',
    '}',
    'Si aucun acte : "actes": []. Si la chaîne est complète (ou aucun acte existant) : "chaineLegale": [].',
  ].join('\n')
}

/** Construit la charge utile texte remise au modèle. */
function buildUserPrompt({ docs, actesExistants }) {
  const parts = []
  parts.push('ACTES DÉJÀ ENREGISTRÉS DANS L\'ENQUÊTE (pour la chaîne légale — index à reprendre tel quel) :')
  if (Array.isArray(actesExistants) && actesExistants.length) {
    parts.push(JSON.stringify(actesExistants, null, 2))
  } else {
    parts.push('(aucun)')
  }
  parts.push('')
  parts.push(`DOCUMENTS À ANALYSER (${docs.length}) — texte brut extrait des PDF :`)
  for (const d of docs) {
    parts.push('')
    parts.push('===== DOCUMENT =====')
    parts.push(`fileName: ${d.fileName}`)
    parts.push(`sourceFolder: ${d.sourceFolder || ''}`)
    parts.push('--- texte ---')
    parts.push(d.textContent)
    parts.push('--- fin texte ---')
  }
  parts.push('')
  parts.push('Analyse chaque document et réponds par le JSON strict décrit dans les consignes système.')
  return parts.join('\n')
}

/** Isole et parse le premier objet JSON d'une chaîne (tolère les fences). */
function parseJsonLoose(text) {
  if (!text || typeof text !== 'string') return null
  let s = text.trim()
  // Retirer un éventuel bloc ```json … ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  // Sinon, borner du premier { au dernier }
  if (s[0] !== '{') {
    const a = s.indexOf('{')
    const b = s.lastIndexOf('}')
    if (a >= 0 && b > a) s = s.slice(a, b + 1)
  }
  try { return JSON.parse(s) } catch { return null }
}

/** Prépare/borne les documents avant envoi au modèle. */
function sanitizeDocs(docs) {
  const out = []
  let total = 0
  for (const d of Array.isArray(docs) ? docs.slice(0, MAX_DOCS) : []) {
    const fileName = String(d?.fileName || '').slice(0, 300)
    let text = String(d?.textContent || '')
    if (!fileName || text.trim().length < 40) continue
    if (text.length > MAX_CHARS_PER_DOC) {
      // Garder tête + queue : le dispositif et la date de décision sont en fin d'acte.
      const head = text.slice(0, Math.floor(MAX_CHARS_PER_DOC * 0.65))
      const tail = text.slice(-Math.floor(MAX_CHARS_PER_DOC * 0.35))
      text = `${head}\n[…]\n${tail}`
    }
    if (total + text.length > MAX_TOTAL_CHARS) break
    total += text.length
    out.push({ fileName, sourceFolder: String(d?.sourceFolder || '').slice(0, 200), textContent: text })
  }
  return out
}

/** Lance le CLI claude en un tour, capture le JSON de sortie. */
function runClaudeJson(userPrompt) {
  const cwd = attacheDir('workdir')
  ensureDir(cwd)
  const args = [
    '-p', userPrompt,
    '--output-format', 'json',
    '--append-system-prompt', systemPrompt(),
    '--disallowedTools', DISALLOWED_TOOLS,
    '--max-turns', '1',
    '--model', ANALYSE_MODEL,
  ]
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(CLAUDE_BIN, args, { cwd, env: { ...process.env, SIRAL_ATTACHE_RUN: 'analyse' }, stdio: ['ignore', 'pipe', 'pipe'] })
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
      if (code !== 0) {
        return done({ ok: false, error: `claude a échoué (code ${code}) — ${stderrTail.split('\n').slice(-2).join(' ').slice(0, 400)}` })
      }
      // --output-format json : enveloppe { type:"result", subtype, result:"…", is_error }
      let envelope = null
      try { envelope = JSON.parse(stdout.trim()) } catch {}
      const resultText = envelope && typeof envelope.result === 'string' ? envelope.result : stdout
      if (envelope && envelope.is_error) {
        return done({ ok: false, error: String(envelope.result || 'échec du run').slice(0, 400) })
      }
      const data = parseJsonLoose(resultText)
      if (!data || typeof data !== 'object') {
        return done({ ok: false, error: 'réponse du modèle non exploitable (JSON absent)' })
      }
      done({ ok: true, data })
    })
  })
}

/**
 * Analyse un lot de documents. Aucune écriture : renvoie seulement l'extraction.
 * @param {object} opts
 *   - docs           : [{ fileName, sourceFolder, textContent }]
 *   - actesExistants : résumé des actes de l'enquête (avec index) pour la chaîne légale
 * @returns {Promise<{ ok, actes, chaineLegale, resume, model, error? }>}
 */
export async function analyseDocuments({ docs, actesExistants } = {}) {
  const clean = sanitizeDocs(docs)
  if (!clean.length) {
    return { ok: true, actes: [], chaineLegale: [], resume: 'Aucun texte exploitable dans les documents fournis.', model: ANALYSE_MODEL }
  }
  const userPrompt = buildUserPrompt({ docs: clean, actesExistants: actesExistants || [] })
  const run = await runClaudeJson(userPrompt)
  if (!run.ok) return { ok: false, error: run.error, model: ANALYSE_MODEL }

  const data = run.data
  const actes = Array.isArray(data.actes) ? data.actes.filter((a) => a && typeof a === 'object') : []
  const chaineLegale = Array.isArray(data.chaineLegale) ? data.chaineLegale.filter((a) => a && typeof a === 'object') : []
  return {
    ok: true,
    actes,
    chaineLegale,
    resume: typeof data.resume === 'string' ? data.resume.slice(0, 800) : '',
    model: ANALYSE_MODEL,
  }
}
