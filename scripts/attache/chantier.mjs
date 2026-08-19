/**
 * SIRAL — Attaché de justice · CHANTIERS d'analyse profonde.
 *
 * Un chantier dépouille un dossier ENTIER (des milliers de pièces versées en
 * arborescence) en runs COURTS et BORNÉS, jamais en marathon : chaque run
 * traite UN LOT (~12 pièces d'une même pochette), produit UNE FICHE
 * FACTUELLE (chronologie, personnes, verbatims cotés, contradictions) rangée
 * dans les productions du dossier (type « fiche »), puis avance le curseur.
 *
 * Principe économique : LIRE UNE FOIS, CAPITALISER. Les fiches sont le
 * capital ; la synthèse finale (et plus tard les chantiers « liens » et
 * « carto ») lisent les FICHES, jamais les pièces. Interruption gratuite :
 * l'état = fiches déjà produites + curseur — reprise exacte au tick suivant.
 *
 * L'ordonnancement (nuit, forfait) est fourni PAR LE SERVICE via un rappel
 * `autorise(chantier)` : ce module ne connaît ni le gouverneur ni l'heure —
 * il exécute, journalise, persiste (état chiffré, clé globale).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { attacheDir, ensureDir, atomicWrite, readJson, listFiles, listDocsMeta, docServerKey, attacheTj } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { audit, publishFeed } from './journal.mjs'
import { numeroCanonique } from './dossier.mjs'
import { appendDossierMemory } from './dossierMemory.mjs'
import { saveProduction, readProduction } from './productions.mjs'
import { runAgent, agentConfig } from './agent.mjs'

const LOT_PIECES = 12          // pièces par run — tient largement dans un contexte
const MAX_LOT_ECHECS = 3       // au 3e échec, le lot est marqué en échec et on passe
const LOT_TIMEOUT_MS = 20 * 60_000
const SYNTHESE_BUDGET_CHARS = 300_000 // fiches concaténées servies à la synthèse

// ── Stockage (une enveloppe chiffrée par chantier) ──
function chantierPath(id) {
  if (!/^[a-f0-9]{8,32}$/.test(String(id))) throw new Error('Identifiant de chantier invalide')
  return attacheDir('chantiers', id + '.json')
}

export function readChantier(keys, id) {
  const env = readJson(chantierPath(id), null)
  if (!env) return null
  try { return decryptJson(keys.global, env) } catch { return null }
}

function writeChantier(keys, ch) {
  ch.majLe = new Date().toISOString()
  ensureDir(attacheDir('chantiers'))
  atomicWrite(chantierPath(ch.id), JSON.stringify(encryptJson(keys.global, ch)))
}

function journal(ch, evenement) {
  ch.journal = ch.journal || []
  ch.journal.push({ date: new Date().toISOString(), evenement: String(evenement).slice(0, 300) })
  if (ch.journal.length > 200) ch.journal = ch.journal.slice(-200)
}

/** Résumés pour l'écran Chantiers (jamais le plan complet : trop lourd). */
export function listChantiers(keys) {
  const out = []
  for (const f of listFiles('chantiers')) {
    const env = readJson(attacheDir('chantiers', f.name), null)
    if (!env) continue
    let ch = null
    try { ch = decryptJson(keys.global, env) } catch { continue }
    if (!ch) continue
    out.push(resumeChantier(ch))
  }
  return out.sort((a, b) => String(b.creeLe).localeCompare(String(a.creeLe)))
}

function totalLots(ch) { return (ch.plan || []).reduce((n, p) => n + p.lots.length, 0) }
function lotsFaits(ch) { return (ch.plan || []).reduce((n, p) => n + p.lots.filter((l) => l.etat === 'fait' || l.etat === 'echec').length, 0) }
function piecesFaites(ch) { return (ch.plan || []).reduce((n, p) => n + p.lots.filter((l) => l.etat === 'fait').reduce((m, l) => m + l.pieces.length, 0), 0) }

function resumeChantier(ch) {
  return {
    id: ch.id, type: ch.type, numero: ch.numero, consigne: ch.consigne,
    etat: ch.etat, attente: ch.attente || null, nuitSeulement: Boolean(ch.nuitSeulement),
    creeLe: ch.creeLe, majLe: ch.majLe,
    totalPieces: ch.totalPieces, totalLots: totalLots(ch), lotsFaits: lotsFaits(ch), piecesFaites: piecesFaites(ch),
    pochettes: (ch.plan || []).map((p) => ({
      nom: p.nom, pieces: p.lots.reduce((n, l) => n + l.pieces.length, 0),
      lots: p.lots.length, faits: p.lots.filter((l) => l.etat === 'fait' || l.etat === 'echec').length,
      echecs: p.lots.filter((l) => l.etat === 'echec').length,
    })),
    fiches: (ch.fiches || []).map((f) => ({ prodId: f.prodId, titre: f.titre, pochette: f.pochette })),
    syntheseProdId: ch.syntheseProdId || null,
    estimation: ch.estimation,
    journal: (ch.journal || []).slice(-12),
  }
}

/**
 * Création : fige le PLAN depuis l'index des documents (pochettes → lots) et
 * calcule le DEVIS. Le chantier attend la validation du magistrat (état
 * « devis ») — rien ne se lance sans lui.
 */
export async function createChantier(keys, { numero, consigne, nuitSeulement = true }) {
  const canon = numeroCanonique(keys, numero)
  if (!canon) throw new Error(`Dossier « ${numero} » introuvable`)
  const metas = listDocsMeta(attacheTj(), docServerKey(canon)).filter((d) => !String(d.rel).startsWith('MD/'))
  if (!metas.length) throw new Error('Aucune pièce déposée sous ce dossier — versez le dossier avant de lancer un chantier')

  // pochette = zone/premier-niveau (même règle que l'arborescence servie à l'IA)
  const parPochette = new Map()
  for (const d of metas) {
    const segs = String(d.rel).split('/')
    const nom = segs.length > 2 ? segs[0] + '/' + segs[1] : segs[0]
    if (!parPochette.has(nom)) parPochette.set(nom, [])
    parPochette.get(nom).push(d.rel)
  }
  const plan = [...parPochette.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([nom, rels]) => ({
      nom,
      lots: chunk(rels.sort(), LOT_PIECES).map((pieces, i) => ({ n: i + 1, pieces, etat: 'a_faire', echecs: 0 })),
    }))

  const totalPieces = metas.length
  const nbLots = plan.reduce((n, p) => n + p.lots.length, 0)
  const ch = {
    id: crypto.randomBytes(8).toString('hex'),
    type: 'dossier',
    numero: canon,
    consigne: String(consigne || '').slice(0, 2000),
    nuitSeulement: Boolean(nuitSeulement),
    etat: 'devis',
    creeLe: new Date().toISOString(),
    plan,
    curseur: { pochette: 0, lot: 0 },
    fiches: [],
    totalPieces,
    estimation: {
      pieces: totalPieces,
      lots: nbLots,
      // fourchette grossière : ~30-60 k jetons lus/écrits par lot
      jetonsMin: nbLots * 30_000,
      jetonsMax: nbLots * 60_000,
      // ~3 min par lot, nuit de ~9 h ≈ 150 lots par nuit au mieux
      nuits: Math.max(1, Math.ceil(nbLots / 120)),
    },
    journal: [],
  }
  journal(ch, `Chantier créé — ${totalPieces} pièces, ${plan.length} pochettes, ${nbLots} lots. En attente de validation du devis.`)
  writeChantier(keys, ch)
  await audit(keys, 'chantier_cree', { id: ch.id, numero: canon, pieces: totalPieces, lots: nbLots })
  return resumeChantier(ch)
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function actionChantier(keys, { id, action }) {
  const ch = readChantier(keys, id)
  if (!ch) throw new Error('Chantier introuvable')
  if (action === 'supprimer') {
    try { fs.unlinkSync(chantierPath(id)) } catch {}
    await audit(keys, 'chantier_supprime', { id, numero: ch.numero, etat: ch.etat })
    return { ok: true, supprime: true }
  }
  if (action === 'lancer') {
    if (!['devis', 'pause'].includes(ch.etat)) throw new Error(`Ce chantier est « ${ch.etat} » — rien à lancer`)
    ch.etat = lotsRestants(ch) ? 'en_cours' : 'synthese'
    ch.attente = null
    journal(ch, ch.etat === 'en_cours' ? 'Devis validé — dépouillement lancé.' : 'Relancé — plus que la synthèse.')
    writeChantier(keys, ch)
    await audit(keys, 'chantier_lance', { id, numero: ch.numero })
    return resumeChantier(ch)
  }
  if (action === 'pause') {
    if (!['en_cours', 'synthese'].includes(ch.etat)) throw new Error(`Ce chantier est « ${ch.etat} » — rien à mettre en pause`)
    ch.etat = 'pause'
    ch.attente = null
    journal(ch, 'Mis en pause par le magistrat (reprise sans perte : re-cliquer « Reprendre »).')
    writeChantier(keys, ch)
    return resumeChantier(ch)
  }
  throw new Error(`Action inconnue : ${action}`)
}

function lotsRestants(ch) {
  return (ch.plan || []).some((p) => p.lots.some((l) => l.etat === 'a_faire'))
}

function prochainLot(ch) {
  for (let pi = 0; pi < ch.plan.length; pi++) {
    const p = ch.plan[pi]
    for (let li = 0; li < p.lots.length; li++) {
      if (p.lots[li].etat === 'a_faire') return { pi, li, pochette: p, lot: p.lots[li] }
    }
  }
  return null
}

// ── Prompts ──
// Le format de fiche est LE contrat : factuel, sourcé, sans opinion. La
// sortie finale du run EST la fiche — le moteur l'enregistre lui-même
// (aucune porte de qualité d'acte : une fiche n'est pas un acte).
function promptLot(ch, pochette, lot) {
  const pieces = lot.pieces.map((r) => `- ${r}`).join('\n')
  return [
    `CHANTIER D'ANALYSE PROFONDE — dossier « ${ch.numero} », pochette « ${pochette.nom} », lot ${lot.n} (${lot.pieces.length} pièces).`,
    ch.consigne ? `ANGLE DEMANDÉ PAR LE MAGISTRAT (à garder en tête, sans exclure le reste) : ${ch.consigne}` : '',
    '',
    'TRAVAIL : lis INTÉGRALEMENT chacune des pièces ci-dessous (lire_document, chemin exact ; si offsetSuivant apparaît, lis la suite avant de conclure), puis rends UNE FICHE FACTUELLE unique couvrant tout le lot.',
    'PAGES IMAGES : ne les lis PAS (pas de integrale:true) — recense-les simplement dans la section dédiée de la fiche.',
    'LECTURE SEULE ABSOLUE : tu n\'appelles AUCUN outil d\'écriture (ni produire_document, ni proposer_*, ni classer_note, ni memoire) — le moteur du chantier range ta fiche lui-même.',
    '',
    'PIÈCES DU LOT :',
    pieces,
    '',
    'FORMAT IMPOSÉ DE LA FICHE (markdown, sections exactes ; chaque fait porte sa COTE = le chemin de la pièce ; verbatims entre guillemets, JAMAIS reformulés) :',
    '## Chronologie',
    '(faits datés, un par ligne : date — fait — cote)',
    '## Personnes',
    '(par personne : identité, alias, téléphones, véhicules/plaques, adresses, comptes, rôle apparent — avec cotes)',
    '## Déclarations utiles (verbatim)',
    '(citations exactes entre guillemets, qui parle, cote)',
    '## À charge / À décharge',
    '(éléments factuels, cotes — pas d\'appréciation)',
    '## Contradictions et points à vérifier',
    '## Actes manquants ou à envisager',
    '## Annexes images non lues',
    '(pièce — pages concernées)',
    '## Pièces sans intérêt d\'enquête',
    '(procédure pure : notifications, réquisitions type — une ligne par pièce)',
    '',
    'TA RÉPONSE FINALE EST LA FICHE, ET RIEN D\'AUTRE : aucun préambule, aucun commentaire, aucune conclusion hors fiche. Si une pièce est illisible, note-le dans la fiche (section Contradictions/à vérifier) et poursuis.',
  ].filter(Boolean).join('\n')
}

function promptSynthese(ch, fichesTexte) {
  return [
    `SYNTHÈSE D'ANALYSE PROFONDE — dossier « ${ch.numero} ». Le dépouillement est terminé : ${ch.fiches.length} fiches factuelles couvrant ${piecesFaites(ch)} pièces, jointes ci-dessous.`,
    ch.consigne ? `ANGLE DEMANDÉ PAR LE MAGISTRAT : ${ch.consigne}` : '',
    '',
    'TRAVAIL : à partir des SEULES fiches (ne relis aucune pièce), rends une NOTE DE SYNTHÈSE d\'ensemble pour le magistrat :',
    '1. Vue générale (faits, période, organisation apparente).',
    '2. Par personne mise en cause : rôle, éléments à charge et à décharge (cotes).',
    '3. Recoupements transversaux (mêmes numéros, plaques, adresses, lieux à travers les pochettes).',
    '4. Contradictions majeures et points à trancher.',
    '5. Actes manquants / investigations à envisager.',
    '6. Angles morts : pochettes en échec, annexes images non lues — ce que la synthèse NE couvre PAS.',
    'Chaque affirmation porte ses cotes. Prose dense de magistrat, pas de remplissage.',
    'LECTURE SEULE ABSOLUE : aucun outil d\'écriture. TA RÉPONSE FINALE EST LA NOTE, RIEN D\'AUTRE.',
    '',
    '───── FICHES ─────',
    fichesTexte,
  ].filter(Boolean).join('\n')
}

// ── Exécution ──
let running = false

/**
 * Un pas de chantier par appel : le prochain lot du premier chantier actif,
 * ou sa synthèse. Le SERVICE l'appelle en boucle tant que `autorise` le
 * permet — chaque pas persiste tout avant de rendre la main.
 * @param {(ch) => {ok: boolean, attente?: 'nuit'|'forfait'}} autorise
 * @returns {Promise<'travail'|'rien'|'bloque'>}
 */
export async function chantierStep(keys, autorise) {
  if (running) return 'rien'
  running = true
  try {
    const actifs = listFiles('chantiers')
      .map((f) => { try { return decryptJson(keys.global, readJson(attacheDir('chantiers', f.name), null)) } catch { return null } })
      .filter((ch) => ch && ['en_cours', 'synthese'].includes(ch.etat))
      .sort((a, b) => String(a.creeLe).localeCompare(String(b.creeLe)))
    const ch = actifs[0]
    if (!ch) return 'rien'

    const feu = autorise(ch)
    if (!feu.ok) {
      if (ch.attente !== feu.attente) {
        ch.attente = feu.attente || 'forfait'
        journal(ch, ch.attente === 'nuit' ? 'En attente de la fenêtre de nuit.' : 'En attente : forfait saturé — reprise automatique.')
        writeChantier(keys, ch)
      }
      return 'bloque'
    }
    if (ch.attente) { ch.attente = null; writeChantier(keys, ch) }

    if (ch.etat === 'en_cours') {
      const next = prochainLot(ch)
      if (!next) {
        ch.etat = 'synthese'
        journal(ch, 'Dépouillement terminé — synthèse en préparation.')
        writeChantier(keys, ch)
        return 'travail'
      }
      await runLot(keys, ch, next)
      return 'travail'
    }
    if (ch.etat === 'synthese') {
      await runSynthese(keys, ch)
      return 'travail'
    }
    return 'rien'
  } finally {
    running = false
  }
}

async function runLot(keys, ch, { pochette, lot }) {
  const cfg = agentConfig()
  const titre = `Fiche — ${pochette.nom} — lot ${lot.n} (${lot.pieces.length} pièces)`
  const res = await runAgent({
    keys,
    prompt: promptLot(ch, pochette, lot),
    runLabel: 'chantier',
    title: `Chantier ${ch.numero} · ${titre}`,
    // fiches = extraction : le modèle des sous-agents (souvent plus économe) s'il est réglé
    model: cfg.subModel || undefined,
    effort: 'high',
    maxTurns: Math.max(30, lot.pieces.length * 3 + 6),
    timeoutMs: LOT_TIMEOUT_MS,
    mcpToolTimeoutMs: LOT_TIMEOUT_MS - 120_000,
  }).catch((e) => ({ ok: false, error: String(e?.message || e), text: '' }))

  const fiche = String(res?.text || '').trim()
  if (!res?.ok || fiche.length < 200 || !/##/.test(fiche)) {
    lot.echecs = (lot.echecs || 0) + 1
    if (lot.echecs >= MAX_LOT_ECHECS) {
      lot.etat = 'echec'
      journal(ch, `Lot ${lot.n} de « ${pochette.nom} » en ÉCHEC après ${lot.echecs} tentatives (${res?.error || 'fiche invalide'}) — pièces non dépouillées, signalées dans la synthèse.`)
    } else {
      journal(ch, `Lot ${lot.n} de « ${pochette.nom} » : tentative ${lot.echecs} échouée (${res?.error || 'fiche invalide'}) — nouvel essai au prochain pas.`)
    }
    writeChantier(keys, ch)
    return
  }

  const prod = await saveProduction(keys, {
    numero: ch.numero, type: 'fiche', titre,
    contenu: fiche, source: `chantier:${ch.id}`,
  })
  lot.etat = 'fait'
  ch.fiches.push({ pochette: pochette.nom, lot: lot.n, prodId: prod.id, titre })
  journal(ch, `${titre} — produite.`)

  // pochette terminée : un jalon au fil + la mémoire du dossier (une ligne)
  if (pochette.lots.every((l) => l.etat === 'fait' || l.etat === 'echec')) {
    const nbPieces = pochette.lots.reduce((n, l) => n + l.pieces.length, 0)
    const nbEchecs = pochette.lots.filter((l) => l.etat === 'echec').length
    const resume = `Chantier ${ch.numero} : pochette « ${pochette.nom} » dépouillée — ${nbPieces} pièces, ${pochette.lots.length} fiche(s)${nbEchecs ? `, ${nbEchecs} lot(s) en échec` : ''}.`
    await publishFeed(keys, { type: 'note', titre: `Chantier — pochette « ${pochette.nom} » terminée`, resume }).catch(() => {})
    await appendDossierMemory(keys, ch.numero, `[chantier] ${resume} Fiches dans « Actes rédigés » (type Fiche).`).catch(() => {})
  }
  writeChantier(keys, ch)
}

async function runSynthese(keys, ch) {
  // les fiches, bornées : si trop volumineuses, on tronque équitablement par fiche
  const textes = []
  for (const f of ch.fiches) {
    const p = readProduction(keys, ch.numero, f.prodId)
    if (p?.contenu) textes.push(`\n\n═══ ${f.titre} ═══\n${p.contenu}`)
  }
  const parFiche = Math.max(4_000, Math.floor(SYNTHESE_BUDGET_CHARS / Math.max(1, textes.length)))
  const corpus = textes.map((t) => t.slice(0, parFiche)).join('')

  const res = await runAgent({
    keys,
    prompt: promptSynthese(ch, corpus),
    runLabel: 'chantier',
    title: `Chantier ${ch.numero} · synthèse`,
    effort: 'high', // modèle principal (réglage du panneau) : c'est ici que la qualité paie
    maxTurns: 8,
    timeoutMs: LOT_TIMEOUT_MS,
    mcpToolTimeoutMs: LOT_TIMEOUT_MS - 120_000,
  }).catch((e) => ({ ok: false, error: String(e?.message || e), text: '' }))

  const note = String(res?.text || '').trim()
  if (!res?.ok || note.length < 400) {
    ch.syntheseEchecs = (ch.syntheseEchecs || 0) + 1
    journal(ch, `Synthèse : tentative ${ch.syntheseEchecs} échouée (${res?.error || 'note trop courte'}).`)
    if (ch.syntheseEchecs >= MAX_LOT_ECHECS) {
      ch.etat = 'termine'
      journal(ch, 'Synthèse abandonnée après 3 échecs — les fiches restent exploitables ; relancez une synthèse en supprimant/relançant le chantier ou via le chat du dossier.')
    }
    writeChantier(keys, ch)
    return
  }

  const prod = await saveProduction(keys, {
    numero: ch.numero, type: 'note',
    titre: `Synthèse d'analyse profonde — ${ch.numero}`,
    contenu: note, source: `chantier:${ch.id}`,
  })
  ch.syntheseProdId = prod.id
  ch.etat = 'termine'
  journal(ch, 'Synthèse produite — chantier terminé.')
  writeChantier(keys, ch)
  const nbEchecs = (ch.plan || []).reduce((n, p) => n + p.lots.filter((l) => l.etat === 'echec').length, 0)
  await publishFeed(keys, {
    type: 'note',
    titre: `Chantier terminé — ${ch.numero}`,
    resume: `${piecesFaites(ch)} pièces dépouillées, ${ch.fiches.length} fiches, synthèse déposée dans « Actes rédigés »${nbEchecs ? ` · ${nbEchecs} lot(s) en échec (voir journal du chantier)` : ''}.`,
  }).catch(() => {})
  await appendDossierMemory(keys, ch.numero, `[chantier] Dépouillement complet terminé (${ch.fiches.length} fiches + synthèse « Synthèse d'analyse profonde »). S'appuyer sur les fiches, jamais relire les pièces en masse.`).catch(() => {})
  await audit(keys, 'chantier_termine', { id: ch.id, numero: ch.numero, fiches: ch.fiches.length, echecs: nbEchecs })
}

/** Un chantier actif existe-t-il ? (pour la boucle du service — comptage gratuit) */
export function chantierActif(keys) {
  return listFiles('chantiers').some((f) => {
    try {
      const ch = decryptJson(keys.global, readJson(attacheDir('chantiers', f.name), null))
      return ch && ['en_cours', 'synthese'].includes(ch.etat)
    } catch { return false }
  })
}
