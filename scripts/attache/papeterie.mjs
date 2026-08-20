/**
 * SIRAL — Attaché de justice · aiguillage des papeteries (choix + découpage).
 *
 * Quand le magistrat exporte un acte en Word, l'application doit répondre à
 * deux questions : DANS QUELLE PAPETERIE l'imprimer, et OÙ SONT SES FRONTIÈRES
 * (bandeau, titre, corps, signature, objet, destinataire, date). Les regex de
 * l'application y répondent bien pour un acte de forme habituelle, mal pour le
 * reste. Ce module est appelé — uniquement dans ce reste — pour trancher.
 *
 * Trois partis pris, qui en font un outil sûr sur des actes signés :
 *
 *  1. LE MODÈLE NE RÉÉCRIT RIEN. Il reçoit les lignes NUMÉROTÉES des
 *     extrémités de l'acte et rend des NUMÉROS DE LIGNE. C'est l'application
 *     qui découpe son propre texte : aucune paraphrase, aucune troncature,
 *     aucune hallucination possible sur le contenu d'un acte de procédure.
 *  2. IL NE CHOISIT QUE PARMI L'EXISTANT. La papeterie retenue est rapprochée
 *     des identifiants réellement soumis ; un nom inventé est écarté.
 *  3. IL SUIT LES HABITUDES DU MAGISTRAT. Les règles déjà retenues lui sont
 *     données en exemple : l'aiguillage se conforme à ce qui a été validé
 *     plutôt qu'à une idée générale de ce qu'est une requête.
 *
 * Un appel, un tour, aucun outil, modèle économe — de l'ordre du millier de
 * jetons. La consommation apparaît au tableau de bord (catégorie
 * « papeterie »).
 */
import { spawn } from 'node:child_process'
import { attacheDir, attacheContentieux, ensureDir } from './store.mjs'
import { economicalModel } from './subagents.mjs'
import { extractUsage, recordUsage } from './usage.mjs'

const CLAUDE_BIN = process.env.SIRAL_ATTACHE_CLAUDE_BIN || 'claude'
/** Un export attend la réponse : mieux vaut retomber sur l'heuristique que faire patienter. */
const RUN_TIMEOUT_MS = Math.max(10, Math.min(180,
  Number(process.env.SIRAL_ATTACHE_PAPETERIE_TIMEOUT_S || 45))) * 1000

// Aucun outil : le modèle lit et répond, point.
const DISALLOWED_TOOLS = 'Bash,Edit,Write,NotebookEdit,Read,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,KillShell,BashOutput'

const MAX_PAPETERIES = 40
const MAX_LIGNES = 120
const MAX_REGLES = 40

/** Clé de rapprochement tolérante (le modèle recopie mal un identifiant long). */
const normKey = (s) => String(s || '').toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036F]/g, '').replace(/[^a-z0-9]+/g, '')

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
      child = spawn(CLAUDE_BIN, args, { cwd, env: { ...process.env, SIRAL_ATTACHE_RUN: 'papeterie' }, stdio: ['ignore', 'pipe', 'pipe'] })
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

// ── Choix de la papeterie + frontières de l'acte ─────────────────────────────

function systemPrompt() {
  return [
    `Tu assistes un magistrat du parquet (SIRAL, contentieux ${attacheContentieux()}) au moment où il EXPORTE un acte en Word.`,
    'Sa « papeterie » est un modèle Word qui porte son en-tête, son logo et sa police ; le texte de l\'acte vient s\'y déverser.',
    '',
    'TU AS DEUX CHOSES À FAIRE, et rien d\'autre :',
    '1. CHOISIR la papeterie la mieux adaptée PARMI CELLES QUI TE SONT LISTÉES (leur identifiant exact, jamais un nom inventé).',
    '2. DÉSIGNER LES FRONTIÈRES de l\'acte, par NUMÉROS DE LIGNE — c\'est l\'application qui découpera son texte.',
    '',
    'TU NE RECOPIES, NE RÉÉCRIS NI NE RÉSUMES JAMAIS LE TEXTE DE L\'ACTE : il est signé, il fait foi. Tu ne rends que des numéros.',
    '',
    'Ce que désignent les frontières :',
    '- l\'EN-TÊTE INSTITUTIONNEL (Cour d\'appel, tribunal, parquet, section) n\'appartient PAS au corps : la papeterie le porte déjà. Le corps commence APRÈS lui.',
    '- le TITRE est la désignation de l\'acte (« REQUÊTE AUX FINS DE… », « SOIT-TRANSMIS ») ; l\'ARTICLE est la ligne d\'article qui le suit parfois.',
    '- le CORPS va des visas (« Vu l\'article… ») jusqu\'à la dernière ligne de fond, formule de politesse comprise pour un courrier.',
    '- la SIGNATURE est le bloc final (« Fait à …, le … », « P/ Le Procureur de la République », nom, qualité).',
    '- pour un COURRIER : le DESTINATAIRE (une ou plusieurs lignes d\'adresse), l\'OBJET (« Objet : … ») et la DATE (« Amiens, le … ») remontent dans l\'en-tête de la papeterie et ne doivent PAS rester dans le corps.',
    '',
    'Si une région est absente de l\'acte, mets 0 — ne l\'invente pas. Dans le doute sur une frontière, élargis le corps : une ligne de trop dans le corps est bénigne, une ligne perdue ne l\'est pas.',
    '',
    'Réponds UNIQUEMENT par cet objet JSON, sans commentaire :',
    '{"papeterie":"<identifiant exact>","motif":"<une demi-phrase>","decoupage":{"titre":0,"article":0,"destinataireDebut":0,"destinataireFin":0,"objet":0,"date":0,"corpsDebut":0,"corpsFin":0,"signatureDebut":0}}',
  ].join('\n')
}

function userPrompt({ acte, papeteries, lignes, total, tronque, regles }) {
  const pap = papeteries.map((p) => (
    `- ${p.id} | « ${p.nom} » | famille : ${p.type}${p.usage ? ` | quand l'utiliser : ${p.usage}` : ''}`
  )).join('\n')
  const hab = regles.length
    ? ['', 'HABITUDES DÉJÀ VALIDÉES PAR LE MAGISTRAT (suis-les quand le cas s\'en rapproche) :', ...regles.map((r) => `- ${r}`)].join('\n')
    : ''
  const corpsLignes = lignes.map((l) => `${l.n}: ${l.t}`).join('\n')
  return [
    'PAPETERIES ENREGISTRÉES :',
    pap,
    hab,
    '',
    'ACTE À EXPORTER :',
    `- titre enregistré : ${acte.titre || '(aucun)'}`,
    `- trame de rédaction suivie : ${acte.source || '(aucune)'}`,
    `- type de production : ${acte.type || '(non précisé)'}`,
    `- longueur : ${total} lignes`,
    '',
    tronque
      ? `LIGNES NUMÉROTÉES (début et fin de l'acte ; les lignes non listées, au milieu, sont du corps) :`
      : 'LIGNES NUMÉROTÉES (acte complet) :',
    corpsLignes,
  ].filter(Boolean).join('\n')
}

/**
 * Choisit la papeterie d'un acte et désigne ses frontières.
 * Ne lève jamais : en cas d'échec, l'application garde son propre découpage.
 */
export async function choisirPapeterie({ acte, papeteries, lignes, total, tronque, regles }) {
  const pap = (Array.isArray(papeteries) ? papeteries : [])
    .filter((p) => p && p.id)
    .slice(0, MAX_PAPETERIES)
    .map((p) => ({
      id: String(p.id).slice(0, 60),
      nom: String(p.nom || '').slice(0, 80),
      type: String(p.type || '').slice(0, 30),
      usage: String(p.usage || '').slice(0, 300),
    }))
  if (!pap.length) return { ok: false, error: 'Aucune papeterie enregistrée à choisir.' }

  const lig = (Array.isArray(lignes) ? lignes : [])
    .filter((l) => l && Number.isFinite(Number(l.n)))
    .slice(0, MAX_LIGNES)
    .map((l) => ({ n: Math.floor(Number(l.n)), t: String(l.t || '').slice(0, 200) }))
  if (!lig.length) return { ok: false, error: 'Acte vide.' }

  const model = economicalModel()
  const run = await runClaudeJson({
    systemPrompt: systemPrompt(),
    userPrompt: userPrompt({
      acte: {
        titre: String(acte?.titre || '').slice(0, 160),
        source: String(acte?.source || '').slice(0, 120),
        type: String(acte?.type || '').slice(0, 60),
      },
      papeteries: pap,
      lignes: lig,
      total: Math.max(1, Math.floor(Number(total) || lig.length)),
      tronque: Boolean(tronque),
      regles: (Array.isArray(regles) ? regles : []).slice(0, MAX_REGLES).map((r) => String(r).slice(0, 200)),
    }),
    model,
    runLabel: 'papeterie',
  })
  if (!run.ok) return { ok: false, model, error: run.error || 'aiguillage sans effet' }

  // On n'accepte QUE l'un des identifiants soumis : pas de papeterie inventée.
  const parNorm = new Map(pap.map((p) => [normKey(p.id), p.id]))
  for (const p of pap) if (!parNorm.has(normKey(p.nom))) parNorm.set(normKey(p.nom), p.id)
  const papeterieId = parNorm.get(normKey(run.data.papeterie)) || null

  const d = run.data.decoupage && typeof run.data.decoupage === 'object' ? run.data.decoupage : {}
  const num = (v) => {
    const n = Math.floor(Number(v))
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  return {
    ok: true,
    model,
    papeterieId,
    motif: run.data.motif ? String(run.data.motif).slice(0, 200) : '',
    // Les bornes sont revalidées côté application (cohérence, dépassements) :
    // ici on ne fait que normaliser des entiers.
    decoupage: {
      titre: num(d.titre),
      article: num(d.article),
      destinataireDebut: num(d.destinataireDebut),
      destinataireFin: num(d.destinataireFin),
      objet: num(d.objet),
      date: num(d.date),
      corpsDebut: num(d.corpsDebut),
      corpsFin: num(d.corpsFin),
      signatureDebut: num(d.signatureDebut),
    },
  }
}

// ── Fiche d'une papeterie importée ───────────────────────────────────────────

/**
 * Rédige le « quand l'utiliser » d'une papeterie que le magistrat vient
 * d'importer, à partir du texte visible de son modèle Word (en-tête, titre,
 * mentions). C'est cette phrase qui guide ensuite l'aiguillage — et elle reste
 * entièrement corrigeable dans le panneau.
 */
export async function decrirePapeterie({ nom, texte, familles }) {
  const extrait = String(texte || '').replace(/\r/g, '').slice(0, 3000)
  if (!extrait.trim()) return { ok: false, error: 'Modèle sans texte exploitable.' }
  const run = await runClaudeJson({
    systemPrompt: [
      `Tu assistes un magistrat du parquet (SIRAL, contentieux ${attacheContentieux()}) qui range ses modèles Word (« papeteries »).`,
      'On te donne le TEXTE VISIBLE d\'un modèle : en-tête institutionnel, intitulés, mentions de pied de page, balises {{…}}.',
      'Dis à quels actes ce modèle est destiné, en UNE PHRASE de 25 mots au plus, à la deuxième personne (« Pour les requêtes au JLD… »), sans jargon inutile.',
      `Range-le aussi dans l'une de ces familles : ${(familles || []).join(', ')}.`,
      'Réponds UNIQUEMENT par : {"usage":"…","famille":"…"}',
    ].join('\n'),
    userPrompt: [`NOM DONNÉ PAR LE MAGISTRAT : ${String(nom || '').slice(0, 80)}`, '', 'TEXTE VISIBLE DU MODÈLE :', extrait].join('\n'),
    model: economicalModel(),
    runLabel: 'papeterie',
  })
  if (!run.ok) return { ok: false, error: run.error || 'description sans effet' }
  const famille = String(run.data.famille || '').trim()
  return {
    ok: true,
    usage: String(run.data.usage || '').slice(0, 300),
    famille: (familles || []).includes(famille) ? famille : '',
  }
}
