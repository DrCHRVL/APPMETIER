/**
 * SIRAL — Attaché de justice · REGISTRE des pièces (le sommaire vivant).
 *
 * Le chaînon entre l'arborescence (OÙ sont les pièces) et leur lecture
 * intégrale (ce qu'elles contiennent, en profondeur) : une entrée PAR PIÈCE,
 * constituée AU FIL DE L'EAU, en deux étages :
 *
 *  1. ENTITÉS DÉTERMINISTES — téléphones, plaques, IBAN, adresses — extraites
 *     du texte par les MÊMES regex que la cartographie (carto.mjs), pendant
 *     l'ingestion : zéro jeton, couverture TOTALE de la masse versée. C'est
 *     là que se cachent les liens entre dossiers (un numéro qui apparaît dans
 *     deux procédures, une plaque, une adresse commune).
 *  2. MINI-FICHE IA — type de pièce, date, PERSONNES (noms, alias, rôle),
 *     résumé — établie sur la pièce ENTIÈRE (une pièce longue est lue en
 *     tranches successives, fusionnées) — produite par lots courts (modèle économe, un
 *     seul tour, AUCUN outil), au fil de l'eau, gouvernance forfait comprise.
 *     Les copies exactes (même empreinte) héritent de la fiche du porteur :
 *     jamais deux lectures du même contenu.
 *
 * Le registre nourrit : registre_lire (sommaire pièce par pièce, filtrable),
 * registre_recouper (recoupement inter-dossiers PAR ENTITÉ, avec citation
 * des pièces exactes des deux côtés — la matière première de la carto), la
 * description du dossier et le flux tendu.
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
import { detecterPiecesMalClassees } from './classement.mjs'
import { extractUsage, recordUsage } from './usage.mjs'

const CLAUDE_BIN = process.env.SIRAL_ATTACHE_CLAUDE_BIN || 'claude'
const RUN_TIMEOUT_MS = Number(process.env.SIRAL_ATTACHE_REGISTRE_TIMEOUT_MIN || 4) * 60 * 1000
// Aucun outil : le modèle lit le texte joint et répond en JSON, point.
const DISALLOWED_TOOLS = 'Bash,Edit,Write,NotebookEdit,Read,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,KillShell,BashOutput'

// Un lot = quelques tranches par run court. Le prompt part en UN argument
// (-p) : argv unitaire plafonné à 128 Kio sous Linux — on reste largement
// en dessous, consignes comprises (mêmes bornes de principe qu'analyse.mjs).
// Une pièce n'est JAMAIS tronquée : une pièce longue est lue en tranches
// successives (légèrement chevauchantes, pour ne pas couper un nom), réparties
// sur autant de lots qu'il faut ; la fiche se fusionne tranche après tranche.
const LOT_PIECES = 8
const TRANCHE = 9_000
const RECOUVREMENT = 300
const CHARS_TOTAL = 80_000
const ECHECS_MAX = 2 // échecs CONSÉCUTIFS : au-delà, la pièce est laissée sans fiche (entités déjà là)
const PERSONNES_MAX = 300
const OBJETS_MAX = 100 // véhicules, lignes par fiche
const REPONSE_CHARS_MAX = 350_000 // taille d'une réponse d'outil (pas un plafond de résultats)
const RESUME_MAX = 4_000

// Une fiche est à (re)faire tant qu'elle n'a pas été établie sur la pièce
// ENTIÈRE — les fiches d'avant le découpage en tranches ne lisaient que les
// 9 000 premiers caractères : elles sont reprises (l'ancienne reste servie
// d'ici là), sauf sur une pièce courte, simplement marquée.
function ficheAFaire(e) {
  return (!e.fiche || !e.fiche.integrale) && (e.ficheEchecs || 0) < ECHECS_MAX
}

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
  const donnees = lot.map(({ id, texte }) => `\n\n═══ PIÈCE ${id} ═══\n${texte}`).join('')
  const parties = lot.some((x) => x.parties > 1)
  return [
    `SOMMAIRE DU DOSSIER « ${numero} » — mini-fiche de chacune des ${lot.length} pièces jointes ci-dessous.`,
    '',
    blocConsigne(keys, 'registre_fiche', { dossier: numero }),
    ...(parties ? [
      '',
      'PIÈCES LONGUES : une pièce longue arrive par PARTIES (« [partie k/n] » dans son entête). Fiche chaque partie comme une pièce à part : "chemin" = l\'entête EXACT, mention de partie comprise ; personnes et résumé de CETTE partie seulement (les autres parties ont leur propre fiche, tout est fusionné ensuite).',
    ] : []),
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
    '-p',
    '--output-format', 'json',
    '--append-system-prompt', systemPromptRegistre(),
    '--disallowedTools', DISALLOWED_TOOLS,
    '--max-turns', '1',
    ...(model ? ['--model', model] : []),
  ]
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(CLAUDE_BIN, args, { cwd, env: { ...process.env, SIRAL_ATTACHE_RUN: 'registre' }, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (e) {
      return resolve({ ok: false, error: `CLI claude non lançable : ${e.message}` })
    }
    // Prompt par l'ENTRÉE STANDARD, jamais en argument : un argv unitaire est
    // plafonné à 128 Kio (E2BIG) — un dossier joint en entier le dépasse.
    child.stdin.on('error', () => {})
    child.stdin.end(String(userPrompt))
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
    .slice(0, PERSONNES_MAX)
    .map((p) => ({
      nom: String(p.nom).slice(0, 120),
      ...(p.alias ? { alias: String(p.alias).slice(0, 120) } : {}),
      ...(p.role ? { role: String(p.role).slice(0, 160) } : {}),
    }))
  const objets = (liste, champs) => (Array.isArray(liste) ? liste : [])
    .filter((x) => x && typeof x === 'object' && champs.some((c) => String(x[c] || '').trim()))
    .slice(0, OBJETS_MAX)
    .map((x) => Object.fromEntries(champs.filter((c) => String(x[c] || '').trim()).map((c) => [c, String(x[c]).slice(0, 160)])))
  const vehicules = objets(f.vehicules, ['plaque', 'description', 'utilisateur'])
  const lignes = objets(f.lignes, ['numero', 'utilisateur'])
  return {
    type: String(f.type || 'autre').slice(0, 60),
    ...(f.datePiece ? { datePiece: String(f.datePiece).slice(0, 10) } : {}),
    personnes,
    ...(vehicules.length ? { vehicules } : {}),
    ...(lignes.length ? { lignes } : {}),
    resume: String(f.resume || '').slice(0, 700),
    majLe: new Date().toISOString(),
  }
}

/**
 * Propage la fiche d'un porteur vers ses copies exactes (même sha) — gratuit.
 * Une fiche établie sur la pièce entière l'emporte sur une fiche ancienne.
 * Rend le nombre de copies servies.
 */
function propageFichesDoublons(reg) {
  const ficheParSha = new Map()
  for (const [rel, e] of Object.entries(reg.pieces)) {
    if (!e.sha || !e.fiche) continue
    const prev = ficheParSha.get(e.sha)
    if (!prev || (!prev.fiche.integrale && e.fiche.integrale)) ficheParSha.set(e.sha, { rel, fiche: e.fiche })
  }
  let n = 0
  for (const [rel, e] of Object.entries(reg.pieces)) {
    if (!e.sha) continue
    const porteur = ficheParSha.get(e.sha)
    if (!porteur || porteur.rel === rel) continue
    if (e.fiche && (e.fiche.integrale || !porteur.fiche.integrale)) continue
    e.fiche = { ...porteur.fiche, copieDe: porteur.fiche.copieDe || porteur.rel }
    delete e.ficheEnCours
    n++
  }
  return n
}

/** Fusionne la fiche d'une tranche dans la fiche cumulée de la pièce. */
function fusionnerFiches(cumul, f) {
  if (!cumul) return f
  const personnes = [...cumul.personnes]
  const index = new Map(personnes.map((p, i) => [mecCanonId(p.nom) || p.nom, i]))
  for (const p of f.personnes) {
    const cle = mecCanonId(p.nom) || p.nom
    if (!index.has(cle)) {
      if (personnes.length < PERSONNES_MAX) { index.set(cle, personnes.length); personnes.push(p) }
      continue
    }
    const q = personnes[index.get(cle)]
    personnes[index.get(cle)] = { ...q, ...(!q.alias && p.alias ? { alias: p.alias } : {}), ...(!q.role && p.role ? { role: p.role } : {}) }
  }
  const unir = (a = [], b = [], cle) => {
    const out = [...a]
    for (const x of b) {
      const k = cle(x)
      const i = out.findIndex((y) => cle(y) === k)
      if (i < 0) { if (out.length < OBJETS_MAX) out.push(x) } else out[i] = { ...x, ...out[i] }
    }
    return out
  }
  const vehicules = unir(cumul.vehicules, f.vehicules, (v) => normAligne(v.plaque || v.description || '').replace(/[^a-z0-9]/g, ''))
  const lignes = unir(cumul.lignes, f.lignes, (l) => String(l.numero || '').replace(/\D/g, '').slice(-9))
  return {
    ...cumul,
    ...(vehicules.length ? { vehicules } : {}),
    ...(lignes.length ? { lignes } : {}),
    type: cumul.type && cumul.type !== 'autre' ? cumul.type : f.type,
    ...(cumul.datePiece || f.datePiece ? { datePiece: cumul.datePiece || f.datePiece } : {}),
    personnes,
    resume: [cumul.resume, f.resume].filter(Boolean).join(' … ').slice(0, RESUME_MAX),
    majLe: f.majLe,
  }
}

/**
 * UN pas de mini-fiches : le premier dossier du registre qui a des pièces
 * sans fiche (échecs répétés exclus), un lot court, un run économe, tout
 * persisté. Le service l'appelle au tick, APRÈS son contrôle de forfait.
 * Rend null si rien à faire, sinon { dossier, faites, copies, echecs, restantes }.
 */
export async function registreFichesStep(keys, { maxPieces = LOT_PIECES, docKey: seulement = null } = {}) {
  // `docKey` : passage CIBLÉ sur un seul dossier (flux tendu) — sinon le
  // premier dossier du registre qui a du travail.
  for (const docKey of docKeysAvecRegistre().filter((k) => !seulement || k === seulement)) {
    const reg = readRegistre(keys, docKey)
    const copies = propageFichesDoublons(reg)
    const metas = listDocsMeta(attacheTj(), docKey)
    const presentes = new Set(metas.map((d) => String(d.rel)))
    // pièces retirées du dossier : leurs entrées partent aussi
    let purgees = 0
    for (const rel of Object.keys(reg.pieces)) {
      if (!presentes.has(rel)) { delete reg.pieces[rel]; purgees++ }
    }
    // une seule lecture par contenu : les copies exactes héritent ensuite
    const shaVus = new Set()
    const aFicher = Object.entries(reg.pieces)
      .filter(([, e]) => ficheAFaire(e))
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([, e]) => !e.sha || (!shaVus.has(e.sha) && shaVus.add(e.sha)))
      .map(([rel]) => rel)
    if (!aFicher.length) {
      if (copies || purgees) writeRegistre(keys, docKey, reg)
      continue
    }

    // Le numéro lisible du dossier : retrouvé depuis la clé serveur.
    const numero = numeroDepuisDocKey(keys, docKey) || docKey

    // Tranches du lot (textes déjà extraits par l'ingestion : extraire:false
    // suffit). Une pièce longue reprend à la tranche où elle s'était arrêtée.
    const lot = []
    let total = 0
    for (const rel of aFicher) {
      if (lot.length >= maxPieces || total >= CHARS_TOTAL) break
      const e = reg.pieces[rel]
      let res
      try { res = await texteDocumentIntegral(keys, docKey, rel, { extraire: false }) } catch { res = { ok: false } }
      if (!res.ok) { e.ficheEchecs = (e.ficheEchecs || 0) + 1; continue }
      const texte = String(res.texte)
      const parties = Math.max(1, Math.ceil(texte.length / TRANCHE))
      // fiche ancienne sur une pièce courte : elle avait déjà tout lu
      if (e.fiche && !e.fiche.integrale && parties === 1) { e.fiche.integrale = true; continue }
      const depuis = e.ficheEnCours?.parties === parties ? e.ficheEnCours.faites : 0
      for (let k = depuis; k < parties; k++) {
        if (lot.length >= maxPieces || total >= CHARS_TOTAL) break
        const t = texte.slice(Math.max(0, k * TRANCHE - RECOUVREMENT), (k + 1) * TRANCHE)
        total += t.length
        lot.push({ rel, partie: k, parties, texte: t, id: parties > 1 ? `${rel} [partie ${k + 1}/${parties}]` : rel })
      }
    }
    if (!lot.length) { writeRegistre(keys, docKey, reg); continue }

    const model = economicalModel()
    const run = await runClaudeJson(promptLotFiches(keys, numero, lot), model)
    let faites = 0
    let echecs = 0
    const echouees = new Set()
    const echoue = (rel) => {
      if (echouees.has(rel)) return
      echouees.add(rel)
      reg.pieces[rel].ficheEchecs = (reg.pieces[rel].ficheEchecs || 0) + 1
      echecs++
    }
    if (run.ok) {
      const parChemin = new Map()
      for (const f of run.data) {
        const rel = String(f?.chemin || f?.rel || '')
        if (rel) parChemin.set(rel, f)
      }
      const seule = (rel) => lot.filter((x) => x.rel === rel).length === 1
      for (const { rel, id, partie, parties } of lot) {
        if (echouees.has(rel)) continue // une tranche manquée : les suivantes attendront
        const e = reg.pieces[rel]
        const fiche = nettoieFiche(parChemin.get(id) || (seule(rel) ? parChemin.get(rel) : undefined))
        if (!fiche) { echoue(rel); continue }
        const enCours = partie === 0 ? null : e.ficheEnCours
        const cumul = fusionnerFiches(enCours?.fiche || null, fiche)
        delete e.ficheEchecs
        if (partie + 1 === parties) {
          e.fiche = { ...cumul, integrale: true, ...(parties > 1 ? { parties } : {}) }
          delete e.ficheEnCours
          faites++
        } else {
          e.ficheEnCours = { parties, faites: partie + 1, fiche: cumul }
        }
      }
      await recordUsage({ run: 'registre', model, usage: extractUsage(run.envelope) })
    } else {
      for (const { rel } of lot) echoue(rel)
    }
    propageFichesDoublons(reg)
    writeRegistre(keys, docKey, reg)
    const restantes = Object.values(reg.pieces).filter(ficheAFaire).length
    return { dossier: numero, faites, copies, echecs, restantes, ...(run.ok ? {} : { erreur: run.error }) }
  }
  return null
}

/** Retrouve le numéro lisible d'un dossier depuis sa clé serveur. */
export function numeroDepuisDocKey(keys, docKey) {
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
        ...(e.fiche.vehicules ? { vehicules: e.fiche.vehicules } : {}),
        ...(e.fiche.lignes ? { lignes: e.fiche.lignes } : {}),
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
        ...(e.vehicules || []).flatMap((v) => [v.plaque, v.description, v.utilisateur]),
        ...(e.lignes || []).flatMap((l) => [l.numero, l.utilisateur]),
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
export function recouperRegistres(keys, { numero, entite, offset, limite } = {}) {
  const cible = numero ? docServerKey(numeroCanonique(keys, numero)) : null
  // recherche d'une valeur : insensible au FORMATAGE (« 06 12 34 56 78 »,
  // « FG-527-XZ » retrouvent 0612345678 et FG527XZ) — on compare en
  // alphanumérique nu des deux côtés
  const squash = (s) => normAligne(s).replace(/[^a-z0-9]/g, '')
  const valeurCherchee = entite ? squash(String(entite)) : null
  // entité (type:valeur) → docKey → { rels: Set (12 cités au plus), n: total }
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
        if (!parDossier.has(docKey)) parDossier.set(docKey, { rels: new Set(), n: 0 })
        const cote = parDossier.get(docKey)
        if (!cote.rels.has(rel)) {
          cote.n++
          if (cote.rels.size < 12) cote.rels.add(rel)
        }
      }
    }
  }
  // Pièces peut-être mal classées (interception versée dans le mauvais
  // dossier…) : un côté qui ne repose QUE sur elles est un faux pont probable.
  let suspectes = new Map()
  try {
    suspectes = new Map(detecterPiecesMalClassees(keys).map((x) => [`${docServerKey(x.dossier)}|${x.piece}`, x]))
  } catch { /* détection indisponible : les recoupements restent servis */ }
  const recoupements = []
  for (const [ent, parDossier] of index) {
    if (valeurCherchee) {
      if (!squash(ent.split(':').slice(1).join(':')).includes(valeurCherchee)) continue
    } else if (parDossier.size < 2) continue
    if (cible && !parDossier.has(cible)) continue
    recoupements.push({
      entite: ent,
      dossiers: [...parDossier.entries()].map(([docKey, { rels, n }]) => {
        const s = n === rels.size ? [...rels].map((r) => suspectes.get(`${docKey}|${r}`)) : []
        return {
          dossier: numeros.get(docKey) || (numeros.set(docKey, numeroDepuisDocKey(keys, docKey) || docKey), numeros.get(docKey)),
          pieces: [...rels].sort(),
          ...(n > rels.size ? { piecesTotal: n, note: `${n - rels.size} autre(s) pièce(s) — registre_lire avec filtre sur la valeur` } : {}),
          ...(s.length && s.every(Boolean) ? {
            pieceSuspecte: {
              dossierProbable: s[0].dossierProbable,
              certitude: s.every((x) => x.certitude === 'forte') ? 'forte' : 'moyenne',
              motif: 'ce côté ne repose que sur des pièces peut-être MAL CLASSÉES (elles semblent appartenir à un autre dossier) — faux recoupement probable ; voir pieces_mal_classees',
            },
          } : {}),
        }
      }),
    })
  }
  recoupements.sort((a, b) => b.dossiers.length - a.dossiers.length || a.entite.localeCompare(b.entite))
  // TOUT est rendu : aucun plafond en nombre. Seule borne, la TAILLE d'une
  // réponse (au-delà, le client la tronquerait sans le dire) : la suite est
  // alors annoncée, offset à l'appui — rien n'est perdu.
  const total = recoupements.length
  const debut = Math.max(0, Math.floor(Number(offset) || 0))
  const lim = Number(limite) > 0 ? Math.floor(Number(limite)) : Infinity
  const page = []
  let taille = 0
  for (const r of recoupements.slice(debut)) {
    if (page.length >= lim) break
    const t = JSON.stringify(r).length
    if (page.length && taille + t > REPONSE_CHARS_MAX) break
    page.push(r)
    taille += t
  }
  const suite = debut + page.length < total ? debut + page.length : null
  return {
    ...(numero ? { dossier: numeroDepuisDocKey(keys, cible) || numero } : {}),
    ...(entite ? { entite } : {}),
    total,
    ...(suite != null ? { offsetSuivant: suite, note: `${total - suite} recoupement(s) après cette page — rappelle avec offset:${suite}` } : {}),
    recoupements: page,
    rappel: 'Un recoupement est un SIGNALEMENT, pas une preuve : lis les pièces citées (lire_document) avant de proposer un lien (proposer_lien) — et souviens-toi qu\'une entité peut être anodine (taxi, avocat, service public).',
  }
}
