/**
 * SIRAL — Attaché de justice · REGISTRE des pièces (le sommaire vivant).
 *
 * Le chaînon entre l'arborescence (OÙ sont les pièces) et les fiches de
 * chantier (ce qu'elles contiennent, en profondeur) : une entrée PAR PIÈCE,
 * constituée AU FIL DE L'EAU, en deux étages :
 *
 *  1. ENTITÉS DÉTERMINISTES — téléphones, plaques, IBAN, adresses — extraites
 *     du texte par les MÊMES regex que la cartographie (carto.mjs), pendant
 *     l'ingestion : zéro jeton, couverture TOTALE de la masse versée. C'est
 *     là que se cachent les liens entre dossiers (un numéro qui apparaît dans
 *     deux procédures, une plaque, une adresse commune).
 *  2. MINI-FICHE IA — type de pièce, date, PERSONNES (noms, alias, rôle),
 *     résumé de 2-3 lignes — produite par lots courts (modèle économe, un
 *     seul tour, AUCUN outil), au fil de l'eau, gouvernance forfait comprise.
 *     Les copies exactes (même empreinte) héritent de la fiche du porteur :
 *     jamais deux lectures du même contenu.
 *
 * Le registre nourrit : registre_lire (sommaire pièce par pièce, filtrable),
 * registre_recouper (recoupement inter-dossiers PAR ENTITÉ, avec citation
 * des pièces exactes des deux côtés — la matière première de la carto), la
 * description du dossier et le démarrage ciblé d'un chantier.
 *
 * Stockage : une enveloppe CHIFFRÉE (clé globale) par dossier —
 * attache/registre/<docKey>.json — noms, numéros et adresses n'apparaissent
 * jamais en clair sur le disque, contrairement à l'état d'ingestion qui ne
 * contient que des chemins.
 */
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import {
  attacheDir, attacheTj, attacheContentieux, ensureDir, readJson, atomicWrite,
  listDocsMeta, docServerKey,
} from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { RE_ENTITES, normEntite, mecCanonId } from './carto.mjs'
import { texteDocumentIntegral, numeroCanonique, normAligne, loadContentieux } from './dossier.mjs'
import { bloc as blocConsigne } from './consignes.mjs'
import { economicalModel } from './subagents.mjs'
import { extractUsage, recordUsage } from './usage.mjs'

const CLAUDE_BIN = process.env.SIRAL_ATTACHE_CLAUDE_BIN || 'claude'
const RUN_TIMEOUT_MS = Number(process.env.SIRAL_ATTACHE_REGISTRE_TIMEOUT_MIN || 4) * 60 * 1000
// Aucun outil : le modèle lit le texte joint et répond en JSON, point.
const DISALLOWED_TOOLS = 'Bash,Edit,Write,NotebookEdit,Read,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,KillShell,BashOutput'

// Un lot = quelques pièces par run court. Le prompt part en UN argument
// (-p) : argv unitaire plafonné à 128 Kio sous Linux — on reste largement
// en dessous, consignes comprises (mêmes bornes de principe qu'analyse.mjs).
const LOT_PIECES = 8
const CHARS_PAR_PIECE = 9_000
const CHARS_TOTAL = 80_000
const ECHECS_MAX = 2 // au-delà, la pièce est laissée sans fiche (entités déjà là)

// ── Stockage ─────────────────────────────────────────────────────────────

function registrePath(docKey) {
  return attacheDir('registre', String(docKey).replace(/[^a-zA-Z0-9._@-]/g, '_') + '.json')
}

export function readRegistre(keys, docKey) {
  const env = readJson(registrePath(docKey), null)
  if (!env) return { v: 1, pieces: {} }
  try {
    const r = decryptJson(keys.global, env)
    return r && typeof r === 'object' && r.pieces ? r : { v: 1, pieces: {} }
  } catch { return { v: 1, pieces: {} } }
}

export function writeRegistre(keys, docKey, reg) {
  ensureDir(attacheDir('registre'))
  reg.majLe = new Date().toISOString()
  atomicWrite(registrePath(docKey), JSON.stringify(encryptJson(keys.global, reg)))
}

function docKeysAvecRegistre() {
  const dir = attacheDir('registre')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('.')).map((f) => f.slice(0, -5)).sort()
}

// ── Étage 1 : entités déterministes (zéro jeton) ─────────────────────────

/**
 * Entités d'un texte — mêmes regex et même normalisation que la carto, mêmes
 * seuils de longueur : un numéro trouvé ici et un numéro trouvé là-bas se
 * recoupent à l'identique.
 */
export function extraireEntites(texte) {
  const out = { tel: [], plaque: [], iban: [], adresse: [] }
  const s = String(texte || '')
  for (const [type, re] of Object.entries(RE_ENTITES)) {
    re.lastIndex = 0
    const found = new Set()
    let m
    while ((m = re.exec(s)) !== null) {
      const norm = normEntite(type, m[0])
      if (norm && norm.length >= (type === 'adresse' ? 8 : 4)) found.add(norm)
      if (found.size >= 200) break // borne de sécurité (annuaires, listings)
    }
    out[type] = [...found].sort()
  }
  return out
}

/**
 * Met à jour les entrées ENTITÉS d'un dossier en un seul passage (une
 * lecture + une écriture d'enveloppe, quel que soit le nombre de pièces).
 * `items` : [{ rel, sha, entites }] — entités précalculées par l'appelant
 * (extraireEntites au fil de l'ingestion : les textes ne s'accumulent jamais
 * en mémoire). Une entrée déjà à jour (même sha) est laissée telle quelle —
 * fiche IA comprise. Rend le nombre d'entrées écrites.
 */
export function majEntitesRegistre(keys, docKey, items) {
  if (!items || !items.length) return 0
  const reg = readRegistre(keys, docKey)
  let n = 0
  for (const { rel, sha, entites } of items) {
    const prev = reg.pieces[rel]
    if (prev && prev.sha === (sha ?? null) && prev.entites) continue
    reg.pieces[rel] = {
      ...(prev && prev.sha === (sha ?? null) ? prev : {}), // sha changé = pièce re-versée : fiche périmée
      sha: sha ?? null,
      entites,
      entitesLe: new Date().toISOString(),
    }
    n++
  }
  if (n) writeRegistre(keys, docKey, reg)
  return n
}

// ── Étage 2 : mini-fiches IA (lots courts, modèle économe) ───────────────

function systemPromptRegistre() {
  return [
    `Tu es un analyste juridique, attaché d'un magistrat du parquet (contentieux ${attacheContentieux()}). Tu dresses le SOMMAIRE d'un dossier d'enquête : pour chaque pièce jointe, une mini-fiche factuelle.`,
    'Tu réponds UNIQUEMENT par un tableau JSON strict, sans texte autour, sans balises markdown.',
  ].join('\n')
}

function promptLotFiches(keys, numero, lot) {
  const donnees = lot.map(({ rel, texte }) => `\n\n═══ PIÈCE ${rel} ═══\n${texte}`).join('')
  return [
    `SOMMAIRE DU DOSSIER « ${numero} » — mini-fiche de chacune des ${lot.length} pièces jointes ci-dessous.`,
    '',
    blocConsigne(keys, 'registre_fiche', { dossier: numero }),
    '',
    '───── PIÈCES ─────',
    donnees,
  ].join('\n')
}

function parseJsonLoose(text) {
  const s = String(text || '')
  try { return JSON.parse(s) } catch { /* continue */ }
  const i = s.indexOf('[')
  const j = s.lastIndexOf(']')
  if (i >= 0 && j > i) { try { return JSON.parse(s.slice(i, j + 1)) } catch { /* continue */ } }
  return null
}

function runClaudeJson(userPrompt, model) {
  const cwd = attacheDir('workdir')
  ensureDir(cwd)
  const args = [
    '-p', userPrompt,
    '--output-format', 'json',
    '--append-system-prompt', systemPromptRegistre(),
    '--disallowedTools', DISALLOWED_TOOLS,
    '--max-turns', '1',
    ...(model ? ['--model', model] : []),
  ]
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(CLAUDE_BIN, args, { cwd, env: { ...process.env, SIRAL_ATTACHE_RUN: 'registre' }, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return resolve({ ok: false, error: `CLI claude non lançable : ${e.message}` })
    }
    let stdout = ''
    let stderrTail = ''
    let settled = false
    const done = (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v) }
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* déjà mort */ }; done({ ok: false, error: 'délai dépassé' }) }, RUN_TIMEOUT_MS)
    child.stdout.on('data', (c) => { stdout += c.toString('utf8') })
    child.stderr.on('data', (c) => { stderrTail = (stderrTail + c.toString('utf8')).slice(-2000) })
    child.on('error', (e) => done({ ok: false, error: `CLI claude introuvable : ${e.message}` }))
    child.on('close', (code) => {
      if (code !== 0) return done({ ok: false, error: `claude a échoué (code ${code}) — ${stderrTail.split('\n').slice(-2).join(' ').slice(0, 300)}` })
      let envelope = null
      try { envelope = JSON.parse(stdout.trim()) } catch { /* stdout brut */ }
      if (envelope && envelope.is_error) return done({ ok: false, error: String(envelope.result || 'échec du run').slice(0, 300) })
      const data = parseJsonLoose(envelope && typeof envelope.result === 'string' ? envelope.result : stdout)
      if (!Array.isArray(data)) return done({ ok: false, error: 'réponse du modèle non exploitable (tableau JSON absent)' })
      done({ ok: true, data, envelope })
    })
  })
}

function nettoieFiche(f) {
  if (!f || typeof f !== 'object') return null
  const personnes = (Array.isArray(f.personnes) ? f.personnes : [])
    .map((p) => (typeof p === 'string' ? { nom: p } : p))
    .filter((p) => p && String(p.nom || '').trim())
    .slice(0, 30)
    .map((p) => ({
      nom: String(p.nom).slice(0, 120),
      ...(p.alias ? { alias: String(p.alias).slice(0, 120) } : {}),
      ...(p.role ? { role: String(p.role).slice(0, 160) } : {}),
    }))
  return {
    type: String(f.type || 'autre').slice(0, 60),
    ...(f.datePiece ? { datePiece: String(f.datePiece).slice(0, 10) } : {}),
    personnes,
    resume: String(f.resume || '').slice(0, 700),
    majLe: new Date().toISOString(),
  }
}

/**
 * Propage la fiche d'un porteur vers ses copies exactes (même sha) — gratuit.
 * Rend le nombre de copies servies.
 */
function propageFichesDoublons(reg) {
  const ficheParSha = new Map()
  for (const [rel, e] of Object.entries(reg.pieces)) {
    if (e.sha && e.fiche && !ficheParSha.has(e.sha)) ficheParSha.set(e.sha, { rel, fiche: e.fiche })
  }
  let n = 0
  for (const [rel, e] of Object.entries(reg.pieces)) {
    if (e.fiche || !e.sha) continue
    const porteur = ficheParSha.get(e.sha)
    if (porteur && porteur.rel !== rel) {
      e.fiche = { ...porteur.fiche, copieDe: porteur.rel }
      n++
    }
  }
  return n
}

/**
 * UN pas de mini-fiches : le premier dossier du registre qui a des pièces
 * sans fiche (échecs répétés exclus), un lot court, un run économe, tout
 * persisté. Le service l'appelle au tick, APRÈS son contrôle de forfait.
 * Rend null si rien à faire, sinon { dossier, faites, copies, echecs, restantes }.
 */
export async function registreFichesStep(keys, { maxPieces = LOT_PIECES } = {}) {
  for (const docKey of docKeysAvecRegistre()) {
    const reg = readRegistre(keys, docKey)
    const copies = propageFichesDoublons(reg)
    const metas = listDocsMeta(attacheTj(), docKey)
    const presentes = new Set(metas.map((d) => String(d.rel)))
    // pièces retirées du dossier : leurs entrées partent aussi
    let purgees = 0
    for (const rel of Object.keys(reg.pieces)) {
      if (!presentes.has(rel)) { delete reg.pieces[rel]; purgees++ }
    }
    const aFicher = Object.entries(reg.pieces)
      .filter(([, e]) => !e.fiche && (e.ficheEchecs || 0) < ECHECS_MAX)
      .map(([rel]) => rel)
      .sort()
    if (!aFicher.length) {
      if (copies || purgees) writeRegistre(keys, docKey, reg)
      continue
    }

    // Le numéro lisible du dossier : retrouvé depuis la clé serveur.
    const numero = numeroDepuisDocKey(keys, docKey) || docKey

    // Textes du lot (déjà extraits par l'ingestion : extraire:false suffit)
    const lot = []
    let total = 0
    for (const rel of aFicher) {
      if (lot.length >= maxPieces || total >= CHARS_TOTAL) break
      let res
      try { res = await texteDocumentIntegral(keys, docKey, rel, { extraire: false }) } catch { res = { ok: false } }
      if (!res.ok) { reg.pieces[rel].ficheEchecs = (reg.pieces[rel].ficheEchecs || 0) + 1; continue }
      const texte = String(res.texte).slice(0, CHARS_PAR_PIECE)
      total += texte.length
      lot.push({ rel, texte })
    }
    if (!lot.length) { writeRegistre(keys, docKey, reg); continue }

    const model = economicalModel()
    const run = await runClaudeJson(promptLotFiches(keys, numero, lot), model)
    let faites = 0
    let echecs = 0
    if (run.ok) {
      const parChemin = new Map()
      for (const f of run.data) {
        const rel = String(f?.chemin || f?.rel || '')
        if (rel) parChemin.set(rel, f)
      }
      for (const { rel } of lot) {
        const fiche = nettoieFiche(parChemin.get(rel))
        if (fiche) { reg.pieces[rel].fiche = fiche; delete reg.pieces[rel].ficheEchecs; faites++ }
        else { reg.pieces[rel].ficheEchecs = (reg.pieces[rel].ficheEchecs || 0) + 1; echecs++ }
      }
      await recordUsage({ run: 'registre', model, usage: extractUsage(run.envelope) })
    } else {
      for (const { rel } of lot) reg.pieces[rel].ficheEchecs = (reg.pieces[rel].ficheEchecs || 0) + 1
      echecs = lot.length
    }
    propageFichesDoublons(reg)
    writeRegistre(keys, docKey, reg)
    const restantes = Object.values(reg.pieces).filter((e) => !e.fiche && (e.ficheEchecs || 0) < ECHECS_MAX).length
    return { dossier: numero, faites, copies, echecs, restantes, ...(run.ok ? {} : { erreur: run.error }) }
  }
  return null
}

/** Retrouve le numéro lisible d'un dossier depuis sa clé serveur. */
function numeroDepuisDocKey(keys, docKey) {
  try {
    const { data } = loadContentieux(keys)
    for (const e of data.enquetes || []) {
      if (docServerKey(String(e.numero)) === docKey) return String(e.numero)
    }
  } catch { /* coffre indisponible */ }
  return null
}

// ── Lecture et recoupement ───────────────────────────────────────────────

/**
 * Le SOMMAIRE pièce par pièce d'un dossier : chemin, type, date, personnes,
 * entités, résumé. `filtre` (insensible casse/accents) restreint aux entrées
 * dont le chemin, une personne, une entité ou le résumé contient le terme.
 */
export function lireRegistre(keys, numero, { filtre, offset, limit } = {}) {
  const canon = numeroCanonique(keys, numero)
  const docKey = docServerKey(canon)
  const reg = readRegistre(keys, docKey)
  let entrees = Object.entries(reg.pieces)
    .map(([rel, e]) => ({
      chemin: rel,
      ...(e.fiche ? {
        type: e.fiche.type,
        ...(e.fiche.datePiece ? { datePiece: e.fiche.datePiece } : {}),
        personnes: e.fiche.personnes,
        resume: e.fiche.resume,
        ...(e.fiche.copieDe ? { copieDe: e.fiche.copieDe } : {}),
      } : { fiche: 'pas encore établie (fil de l\'eau en cours)' }),
      entites: e.entites || {},
    }))
    .sort((a, b) => a.chemin.localeCompare(b.chemin))
  const total = entrees.length
  const sansFiche = entrees.filter((e) => !e.resume && !e.copieDe).length
  const q = normAligne(String(filtre || '')).trim()
  // repli insensible au formatage : « FG-527-XZ » ou « 06 12 34 56 78 »
  // retrouvent les valeurs normalisées FG527XZ / 0612345678
  const qSquash = q.replace(/[^a-z0-9]/g, '')
  if (q) {
    entrees = entrees.filter((e) => {
      const bloc = [
        e.chemin, e.type, e.resume,
        ...(e.personnes || []).flatMap((p) => [p.nom, p.alias, p.role]),
        ...Object.values(e.entites || {}).flat(),
      ].filter(Boolean).join('\n')
      const n = normAligne(bloc)
      return n.includes(q) || (qSquash.length >= 4 && n.replace(/[^a-z0-9]/g, '').includes(qSquash))
    })
  }
  const start = Math.max(0, Number(offset) || 0)
  const lim = Math.max(1, Math.min(200, Number(limit) || 50))
  const page = entrees.slice(start, start + lim)
  const reste = entrees.length - start - page.length
  return {
    dossier: canon,
    total,
    ...(sansFiche ? { sansFiche, note: `${sansFiche} pièce(s) sans mini-fiche pour l'instant (constituée au fil de l'eau) — leurs ENTITÉS sont déjà là` } : {}),
    ...(q ? { filtre: String(filtre), correspondantes: entrees.length } : {}),
    affichees: page.length,
    ...(reste > 0 ? { offsetSuivant: start + page.length } : {}),
    pieces: page,
  }
}

/**
 * RECOUPEMENT INTER-DOSSIERS par entité : téléphones, plaques, IBAN,
 * adresses (déterministes) et PERSONNES (mini-fiches, nom normalisé comme la
 * carto) présents dans AU MOINS DEUX dossiers — chaque côté cité avec ses
 * pièces exactes. C'est la matière première des liens de renseignement :
 * l'agent VÉRIFIE dans les pièces citées puis propose (proposer_lien).
 * `numero` : ne garder que les recoupements impliquant ce dossier.
 * `entite` : chercher UNE valeur précise (un numéro, une plaque…) partout.
 */
export function recouperRegistres(keys, { numero, entite } = {}) {
  const cible = numero ? docServerKey(numeroCanonique(keys, numero)) : null
  // recherche d'une valeur : insensible au FORMATAGE (« 06 12 34 56 78 »,
  // « FG-527-XZ » retrouvent 0612345678 et FG527XZ) — on compare en
  // alphanumérique nu des deux côtés
  const squash = (s) => normAligne(s).replace(/[^a-z0-9]/g, '')
  const valeurCherchee = entite ? squash(String(entite)) : null
  // entité (type:valeur) → docKey → Set(rels)
  const index = new Map()
  const numeros = new Map() // docKey → numéro lisible (si retrouvable)
  for (const docKey of docKeysAvecRegistre()) {
    const reg = readRegistre(keys, docKey)
    for (const [rel, e] of Object.entries(reg.pieces)) {
      const entites = []
      for (const [type, vals] of Object.entries(e.entites || {})) {
        for (const v of vals || []) entites.push(`${type}:${v}`)
      }
      // clé canonique de la carto (mots triés) : « DURAND Kévin » ici et
      // « Kévin DURAND » là-bas se recoupent
      for (const p of e.fiche?.personnes || []) {
        const n = mecCanonId(p.nom)
        if (n && n.length >= 5) entites.push(`personne:${n}`)
        if (p.alias) {
          const a = mecCanonId(p.alias)
          if (a && a.length >= 5) entites.push(`personne:${a}`)
        }
      }
      for (const ent of entites) {
        if (!index.has(ent)) index.set(ent, new Map())
        const parDossier = index.get(ent)
        if (!parDossier.has(docKey)) parDossier.set(docKey, new Set())
        const rels = parDossier.get(docKey)
        if (rels.size < 12) rels.add(rel)
      }
    }
  }
  const recoupements = []
  for (const [ent, parDossier] of index) {
    if (valeurCherchee) {
      if (!squash(ent.split(':').slice(1).join(':')).includes(valeurCherchee)) continue
    } else if (parDossier.size < 2) continue
    if (cible && !parDossier.has(cible)) continue
    recoupements.push({
      entite: ent,
      dossiers: [...parDossier.entries()].map(([docKey, rels]) => ({
        dossier: numeros.get(docKey) || (numeros.set(docKey, numeroDepuisDocKey(keys, docKey) || docKey), numeros.get(docKey)),
        pieces: [...rels].sort(),
      })),
    })
  }
  recoupements.sort((a, b) => b.dossiers.length - a.dossiers.length || a.entite.localeCompare(b.entite))
  const total = recoupements.length
  const page = recoupements.slice(0, 80)
  return {
    ...(numero ? { dossier: numeroDepuisDocKey(keys, cible) || numero } : {}),
    ...(entite ? { entite } : {}),
    total,
    ...(total > page.length ? { note: `${total - page.length} recoupement(s) supplémentaires — cible un dossier (numero) ou une valeur (entite)` } : {}),
    recoupements: page,
    rappel: 'Un recoupement est un SIGNALEMENT, pas une preuve : lis les pièces citées (lire_document) avant de proposer un lien (proposer_lien) — et souviens-toi qu\'une entité peut être anodine (taxi, avocat, service public).',
  }
}
