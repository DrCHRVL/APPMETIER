/**
 * SIRAL — Attaché de justice · FLUX TENDU (file d'attente + pipeline par dossier).
 *
 * Un dossier qui BOUGE (pièce versée, CR rédigé, acte ajouté — par le
 * magistrat ou par un collègue) entre dans une FILE D'ATTENTE. Deux entrées :
 *  - le RÉVEIL : l'app prévient dès l'écriture (POST /reveil) — ne porte que
 *    « ce dossier a bougé, par qui, pourquoi », jamais une donnée : l'attaché
 *    relit ses propres coffres ;
 *  - la RELÈVE : à chaque tick, la signature déterministe de chaque dossier
 *    (dossierSyntheseSignals) rattrape tout réveil manqué.
 *
 * Après une courte période de calme (rafale fusionnée), UN dossier à la fois
 * passe le PIPELINE — qui ne traite que le NEUF, petit bout par petit bout :
 *  1. ingestion ciblée (texte, empreinte, entités — zéro jeton) ;
 *  2. mini-fiches des pièces nouvelles (lots courts ; le reste au passage
 *     suivant) ;
 *  3. analyse d'actes SERVEUR pour les zones Actes/Geoloc/Ecoutes/DML
 *     (propositions d'actes ✓/✗, alerte sur les incohérences) ;
 *  4. UN run économe qui reçoit tout le neuf (fiches, CR, actes, candidats
 *     mis en cause pré-calculés) et : rédige un CR complet si des faits ou
 *     infractions nouveaux apparaissent, ajoute les NATINF, PROPOSE les mis
 *     en cause (rôle décrit), actualise la description.
 *
 * État (attache/flux.json, EN CLAIR — numéros, dates, compteurs, identifiants
 * numériques de CR/actes : rien qui ne soit déjà en clair sur le disque) :
 *   { v, dossiers: { [numero]: { sig, pendingSince, pendingAt, raisons,
 *                                 baselineAt, lastRunAt, crIds, acteIds } },
 *     derniers: [ bilan… ] }
 * Le marquage « déjà traité » d'une PIÈCE vit dans le registre (chiffré),
 * entrée par entrée : reg.pieces[rel].flux = { le }.
 */
import { attacheDir, ensureDir, readJson, atomicWrite, listDocsMeta, docServerKey, attacheTj } from './store.mjs'
import {
  loadContentieux, numeroCanonique, dossierSyntheseSignals, normalizeNom, proximiteNoms,
  texteDocumentIntegral,
} from './dossier.mjs'
import { readRegistre, writeRegistre, registreFichesStep, numeroDepuisDocKey } from './registre.mjs'
import { ingestPass, readIngestState } from './ingest.mjs'
import { analyseDocuments } from './analyse.mjs'
import { addProposition, listPropositions } from './propositions.mjs'
import { listChantiers, createChantier } from './chantier.mjs'
import { audit, publishFeed } from './journal.mjs'
import { runAgent, agentConfig } from './agent.mjs'
import { economicalModel } from './subagents.mjs'
import { prompt as promptConsigne } from './consignes.mjs'

const FILE = () => attacheDir('flux.json')

// Calme avant de tirer : le temps qu'une rafale (dépôt d'une arborescence, CR
// puis acte dans la foulée) se termine. Court : c'est un flux TENDU.
export const FLUX_QUIET_MS = Math.max(15_000, Number(process.env.SIRAL_ATTACHE_FLUX_QUIET_SEC || 60) * 1000)
// Pièces nouvelles fichées par passage (lots du registre) : au-delà, le
// dossier revient en file pour la suite — petit bout par petit bout.
const FLUX_LOTS_MAX = 3
// Pièces nouvelles jointes au run (fiches) par passage.
const FLUX_PIECES_MAX = 24
// Au-delà de ce nombre de pièces NOUVELLES d'un coup (jonction, versement
// d'un dossier entier), le passage rapide n'a plus de sens : bascule sur un
// chantier de dépouillement complet. Même réglage que l'actualisation de la
// description à la demande.
const bounded = (v, min, max, dflt) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt
}
export const CHANTIER_SEUIL = bounded(process.env.SIRAL_ATTACHE_DESC_CHANTIER_SEUIL, 10, 1000, 100)
const CR_NOUVEAUX_MAX = 5
const CR_CHARS_MAX = 2_500
const DESCRIPTION_CHARS_MAX = 6_000
const ZONES_ACTES = ['Actes/', 'Geoloc/', 'Ecoutes/', 'DML/']
const DERNIERS_MAX = 20

// Rôles qui font d'une personne d'une mini-fiche un CANDIDAT mis en cause —
// pré-calcul déterministe : le run ne confirme que ceux-là (plus ce qu'il
// relève lui-même), il ne cherche pas au hasard.
const RE_ROLE_MEC = /mis en cause|auteur|suspect|complice|fourniss|guetteur|logisti|nourrice|trafiqu|dealer|vendeur|revendeur|organisat|commandit|convoyeur|receleur|blanchi|tête de réseau|lieutenant/i
const RE_ROLE_EXCLU = /victime|témoin|temoin|enquêteur|enqueteur|policier|gendarme|OPJ|APJ|magistrat|procureur|juge|avocat|greffier|expert|interprète|interprete/i

// Dépendances remplaçables (tests) : les seules briques qui parlent au modèle
// ou lancent un chantier.
const deps = { runAgent, registreFichesStep, analyseDocuments, createChantier }
export function configurerFlux(overrides = {}) { Object.assign(deps, overrides) }

// ── État ────────────────────────────────────────────────────────────────

function readEtat() {
  const st = readJson(FILE(), null)
  return st && typeof st === 'object' && st.dossiers ? st : { v: 1, dossiers: {}, derniers: [] }
}

function writeEtat(st) {
  ensureDir(attacheDir())
  atomicWrite(FILE(), JSON.stringify(st, null, 2))
}

function idsDe(e) {
  return {
    crIds: (e.comptesRendus || []).map((c) => Number(c.id)).filter(Number.isFinite),
    acteIds: [...(e.actes || []), ...(e.ecoutes || []), ...(e.geolocalisations || [])].map((a) => Number(a.id)).filter(Number.isFinite),
  }
}

function enqueteDe(keys, numero) {
  const { data } = loadContentieux(keys)
  const wanted = String(numero).trim()
  return (data.enquetes || []).find((e) => String(e.numero).trim() === wanted) || null
}

/** Point de référence SILENCIEUX d'un dossier : on ne réagira qu'aux changements ultérieurs. */
function baseline(st, e, signature) {
  st.dossiers[String(e.numero)] = {
    sig: signature, pendingSince: null, pendingAt: null, raisons: [],
    baselineAt: new Date().toISOString(), lastRunAt: null, ...idsDe(e),
  }
}

// ── File d'attente ──────────────────────────────────────────────────────

/**
 * Met un dossier en file (ou rafraîchit son attente). `raison` : document |
 * cr | acte | dossier | tick | suite ; `par` : qui a fait bouger le dossier.
 * Rend la position dans la file (1 = prochain), ou null si le dossier est
 * inconnu de l'attaché.
 */
export function enfiler(keys, { numero, docKey, raison = 'dossier', par } = {}) {
  let num = String(numero || '').trim()
  if (!num && docKey) num = numeroDepuisDocKey(keys, String(docKey)) || ''
  if (!num) return null
  num = numeroCanonique(keys, num)
  const e = enqueteDe(keys, num)
  if (!e || e.statut === 'archive') return null
  const st = readEtat()
  const now = Date.now()
  let d = st.dossiers[num]
  if (!d) {
    // Dossier jamais vu : point de référence sur l'existant (CR et actes
    // courants sont réputés connus), et mise en file quand même — le
    // pipeline ne verra que les pièces sans marque de flux.
    baseline(st, e, null)
    d = st.dossiers[num]
  }
  d.pendingSince = d.pendingSince || now
  d.pendingAt = now
  const lib = [raison, par].filter(Boolean).join(' — ').slice(0, 80)
  d.raisons = [...(d.raisons || []).filter((r) => r !== lib), lib].slice(-6)
  writeEtat(st)
  const position = Object.values(st.dossiers).filter((x) => x.pendingSince && x.pendingSince <= d.pendingSince).length
  return { numero: num, position }
}

/**
 * Relève : signature de chaque dossier vs référence — un dossier qui a bougé
 * sans réveil entre en file ; un dossier jamais vu reçoit sa référence en
 * silence ; les dossiers disparus (archivés, supprimés) sortent de l'état.
 */
export function balayer(keys) {
  let signals
  try { signals = dossierSyntheseSignals(keys) } catch { return { enfiles: [] } }
  const st = readEtat()
  const { data } = loadContentieux(keys)
  const present = new Set()
  const enfiles = []
  let patched = false
  for (const { numero, signature } of signals) {
    present.add(numero)
    const d = st.dossiers[numero]
    if (!d) {
      const e = (data.enquetes || []).find((x) => String(x.numero) === numero)
      if (e) { baseline(st, e, signature); patched = true }
      continue
    }
    if (d.sig === signature || d.pendingSince) continue
    d.pendingSince = Date.now()
    d.pendingAt = Date.now()
    d.raisons = [...(d.raisons || []), 'tick'].slice(-6)
    enfiles.push(numero)
    patched = true
  }
  for (const numero of Object.keys(st.dossiers)) {
    if (!present.has(numero)) { delete st.dossiers[numero]; patched = true }
  }
  if (patched) writeEtat(st)
  return { enfiles }
}

/** La file telle que le moniteur l'affiche : sans clé, sans contenu. */
export function fileAttente() {
  const st = readEtat()
  const now = Date.now()
  const enAttente = Object.entries(st.dossiers)
    .filter(([, d]) => d.pendingSince)
    .map(([numero, d]) => ({
      numero,
      depuis: new Date(d.pendingSince).toISOString(),
      raisons: d.raisons || [],
      pretDansMs: Math.max(0, (d.pendingAt || d.pendingSince) + FLUX_QUIET_MS - now),
    }))
    .sort((a, b) => a.depuis.localeCompare(b.depuis))
  return { enAttente, enCours: enCours || null, derniers: st.derniers || [] }
}

function prochainDu(st) {
  const now = Date.now()
  let best = null
  for (const [numero, d] of Object.entries(st.dossiers)) {
    if (!d.pendingSince) continue
    if (now - (d.pendingAt || d.pendingSince) < FLUX_QUIET_MS) continue
    if (!best || d.pendingSince < best.pendingSince) best = { numero, pendingSince: d.pendingSince }
  }
  return best?.numero || null
}

let enCours = null
/**
 * Traite les dossiers dus, un par un, tant qu'il y en a. `onHold(quoi)` :
 * le gouverneur de forfait (true = différer ce qui consomme des jetons).
 */
export async function pomper(keys, { onHold = async () => false } = {}) {
  if (enCours) return { ok: false, running: true }
  const traites = []
  try {
    for (;;) {
      const numero = prochainDu(readEtat())
      if (!numero) break
      enCours = numero
      let bilan
      try {
        bilan = await traiterDossier(keys, numero, { onHold })
      } catch (err) {
        // Erreur inattendue : le dossier SORT de la file (sinon la pompe
        // rejouerait la même erreur à chaque période de calme) ; la relève le
        // remettra en file au prochain mouvement. Trace au journal.
        const st = readEtat()
        if (st.dossiers[numero]) Object.assign(st.dossiers[numero], { pendingSince: null, pendingAt: null, raisons: [] })
        st.derniers = [{ numero, at: new Date().toISOString(), erreur: String(err?.message || err), run: false }, ...(st.derniers || [])].slice(0, DERNIERS_MAX)
        writeEtat(st)
        await audit(keys, 'flux_erreur', { numero, erreur: String(err?.message || err) }).catch(() => {})
        bilan = { numero, erreur: String(err?.message || err) }
      }
      traites.push(bilan)
      if (bilan.differe) break // forfait saturé : rien ne servirait d'insister
    }
  } finally {
    enCours = null
  }
  return { ok: true, traites }
}

// ── Pipeline ────────────────────────────────────────────────────────────

/**
 * Bascule d'un dossier volumineux sur un chantier de dépouillement. Rend
 * { chantier, cree, message } — le message est dit tel quel au magistrat.
 */
export async function basculerEnChantier(keys, { numero, pieces, trigger }) {
  const existant = listChantiers(keys).find((c) => c.type === 'dossier' && String(c.numero) === String(numero) && c.etat !== 'termine')
  if (existant) {
    const message = existant.etat === 'devis'
      ? `Dossier volumineux — un chantier de dépouillement est déjà en attente de votre validation (devis du ${String(existant.creeLe || '').slice(0, 10)}). Validez-le dans Assistant de justice → Chantiers pour que la description en profite.`
      : `Dossier volumineux — un chantier de dépouillement est déjà en cours (${existant.piecesFaites}/${existant.totalPieces} pièces). La description se mettra à jour une fois le dépouillement avancé.`
    return { chantier: existant, cree: false, message }
  }
  const ch = await deps.createChantier(keys, {
    type: 'dossier',
    numero,
    consigne: `Dépouillement complet — bascule automatique (${trigger}) : dossier volumineux.`,
    nuitSeulement: true,
    origine: 'attache',
  })
  await audit(keys, 'description_chantier', { numero, trigger, chantierId: ch.id, pieces: ch.estimation?.pieces, lots: ch.estimation?.lots })
  const h = ch.estimation?.heures
  const message = `Dossier volumineux (${pieces} pièces) : l'actualisation rapide laisse place à un chantier de dépouillement complet — ${ch.estimation?.lots ?? '?'} lot(s), ~${ch.estimation?.nuits ?? '?'} nuit(s)${h ? ` (~${h} h)` : ''}. Le devis attend votre validation dans Assistant de justice → Chantiers.`
  return { chantier: ch, cree: true, message }
}

function stripHtml(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
}

/** Ce que le dossier a de NEUF depuis le dernier passage (coût nul). */
function deltas(keys, e, d, reg, metas) {
  const crConnus = new Set(d.crIds || [])
  const acteConnus = new Set(d.acteIds || [])
  const crs = (e.comptesRendus || []).filter((c) => !crConnus.has(Number(c.id)))
  const actes = [
    ...(e.ecoutes || []).map((a) => ({ kind: 'ecoute', ...a })),
    ...(e.geolocalisations || []).map((a) => ({ kind: 'geolocalisation', ...a })),
    ...(e.actes || []).map((a) => ({ kind: 'autre', ...a })),
  ].filter((a) => !acteConnus.has(Number(a.id)))

  // Pièces : nouvelles = versées après la référence et sans marque de flux.
  // Une pièce antérieure à la référence rencontrée sans marque est marquée en
  // silence (stock ancien qui vient seulement d'être ingéré).
  const baselineAt = String(d.baselineAt || '')
  const ingest = readIngestState(docServerKey(String(e.numero)))
  const pretes = []   // fichées (ou fiche abandonnée) → jointes au run
  const enAttente = [] // pas encore ingérées / fichées → prochain passage
  let marqueesSilence = 0
  for (const m of metas) {
    const rel = String(m.rel)
    if (rel.startsWith('MD/')) continue
    const r = reg.pieces[rel]
    if (r?.flux) continue
    if (String(m.savedAt || '') < baselineAt) {
      if (r) { r.flux = { le: new Date().toISOString(), baseline: true }; marqueesSilence++ }
      continue
    }
    if (!r) {
      // pas encore au registre : ingestion à venir — sauf échec mémorisé
      if (ingest.echecs?.[rel] !== String(m.savedAt)) enAttente.push(rel)
      continue
    }
    if (r.fiche || (r.ficheEchecs || 0) >= 2) pretes.push(rel)
    else enAttente.push(rel)
  }
  pretes.sort()
  return { crs, actes, pretes, enAttente, marqueesSilence }
}

/** Personnes des fiches jointes qui méritent d'être proposées — pré-calcul. */
function candidatsMec(keys, e, fiches) {
  const enregistres = (e.misEnCause || []).map((m) => String(m.nom || ''))
  const enAttente = listPropositions(keys, { numero: e.numero, enAttente: true })
    .filter((p) => p.type === 'mec').map((p) => normalizeNom(p.payload?.nom || ''))
  const vus = new Set()
  const out = []
  for (const f of fiches) {
    for (const p of f.personnes || []) {
      const nom = String(p.nom || '').trim()
      const role = String(p.role || '')
      if (!nom || !RE_ROLE_MEC.test(role) || RE_ROLE_EXCLU.test(role)) continue
      const norm = normalizeNom(nom)
      if (!norm || vus.has(norm) || enAttente.includes(norm)) continue
      if (enregistres.some((n) => normalizeNom(n) === norm)) continue
      vus.add(norm)
      const voisin = enregistres.map((n) => ({ n, p: proximiteNoms(nom, n) })).find((x) => x.p)
      out.push({ nom, alias: p.alias || undefined, role, piece: f.chemin, ...(voisin ? { voisinDe: `${voisin.n} (${voisin.p})` } : {}) })
    }
  }
  return out
}

function chiffres(s) { return String(s || '').replace(/\D/g, '') }
function squash(s) { return String(s || '').normalize('NFKD').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() }

/**
 * Analyse d'actes SERVEUR sur les pièces nouvelles des zones d'actes : le
 * moteur d'analyse.mjs (un tour, sans outil) puis, ici, les propositions ✓/✗
 * dédoublonnées contre les actes enregistrés et les propositions en attente.
 * Rend ce que le run doit savoir (prolongations, incohérences, CR suggéré).
 */
async function analyserActes(keys, e, docKey, rels) {
  const cibles = rels.filter((rel) => ZONES_ACTES.some((z) => rel.startsWith(z)))
  const vide = { docs: 0, proposes: 0, ignores: 0, prolongations: [], incoherences: [], chaineLegale: [], crSuggere: null }
  if (!cibles.length) return vide
  const docs = []
  for (const rel of cibles.slice(0, 40)) {
    let res
    try { res = await texteDocumentIntegral(keys, docKey, rel, { extraire: false }) } catch { res = { ok: false } }
    if (res.ok && String(res.texte).trim().length >= 40) {
      docs.push({ fileName: rel, sourceFolder: rel.split('/')[0], textContent: String(res.texte) })
    }
  }
  if (!docs.length) return vide
  const actesExistants = [
    ...(e.ecoutes || []).map((x, i) => ({ acteType: 'ecoute', acteIndex: i, numero: x.numero, cible: x.cible || '', dateDebut: x.dateDebut || '', prolongations: (x.prolongationsHistory || []).map((p) => ({ date: p.date })) })),
    ...(e.geolocalisations || []).map((x, i) => ({ acteType: 'geoloc', acteIndex: i, objet: x.objet, dateDebut: x.dateDebut || '', prolongations: (x.prolongationsHistory || []).map((p) => ({ date: p.date })) })),
  ]
  const out = await deps.analyseDocuments({
    docs, actesExistants,
    enquete: { numero: e.numero, numeroParquet: e.numeroParquet, numeroIDJ: e.numeroIDJ, natinfs: e.infractionNatinfCodes || [] },
  })
  if (!out?.ok) return { ...vide, docs: docs.length, erreur: out?.error }

  // Dédoublonnage contre l'existant ET les propositions en attente.
  const lignesConnues = new Set((e.ecoutes || []).map((x) => chiffres(x.numero)).filter(Boolean))
  const objetsConnus = new Set((e.geolocalisations || []).map((x) => squash(x.objet)).filter(Boolean))
  for (const p of listPropositions(keys, { numero: e.numero, enAttente: true }).filter((p) => p.type === 'acte')) {
    if (p.payload?.kind === 'ecoute') lignesConnues.add(chiffres(p.payload.cible))
    if (p.payload?.kind === 'geolocalisation') objetsConnus.add(squash(p.payload.objet))
  }
  let proposes = 0
  let ignores = 0
  const prolongations = []
  for (const a of out.actes || []) {
    const type = String(a.type || '')
    if (type === 'autre') continue
    if (Number(a.confidence) < 0.5) { ignores++; continue }
    if (type.startsWith('prolongation_')) {
      prolongations.push({ type, cibles: a.cibles, dateAutorisation: a.dateAutorisation, duree: a.duree, dureeUnit: a.dureeUnit, fileName: a.fileName, motif: a.motif })
      continue
    }
    const requete = type.startsWith('requete_')
    const ecoute = type.endsWith('_ecoute')
    for (const cible of a.cibles || []) {
      const cle = ecoute ? chiffres(cible) : squash(a.objetDescription || cible)
      if (!cle || (ecoute ? lignesConnues : objetsConnus).has(cle)) { ignores++; continue }
      ;(ecoute ? lignesConnues : objetsConnus).add(cle)
      const description = [a.titulaire ? `Titulaire : ${a.titulaire}` : '', a.utilisateur ? `Utilisateur : ${a.utilisateur}` : '', a.motif || ''].filter(Boolean).join(' — ')
      await addProposition(keys, {
        numero: e.numero, type: 'acte', source: `${a.fileName} (analyse au versement)`,
        payload: {
          kind: ecoute ? 'ecoute' : 'geolocalisation',
          ...(ecoute ? { cible } : { objet: a.objetDescription || cible }),
          dateDebut: requete ? '' : (a.dateAutorisation || ''),
          duree: Number(a.duree) || undefined, dureeUnit: a.dureeUnit === 'mois' ? 'mois' : 'jours',
          description,
          statut: requete ? 'autorisation_pending' : 'en_cours',
        },
      })
      proposes++
    }
  }
  const incoherences = Array.isArray(out.incoherences) ? out.incoherences : []
  const chaineLegale = Array.isArray(out.chaineLegale) ? out.chaineLegale : []
  if (incoherences.length || chaineLegale.length) {
    const lignes = [
      ...incoherences.map((i) => `• ${i.severite === 'error' ? '⚠' : '–'} ${i.type} — ${i.fileName} : ${i.detail}`),
      ...chaineLegale.map((c) => `• ${c.severite === 'error' ? '⚠' : '–'} chaîne légale (${c.acteType} n°${c.acteIndex}) : ${c.documentManquant} manquant parmi les pièces versées`),
    ]
    await publishFeed(keys, {
      type: 'alerte',
      titre: `Pièces versées — contrôles de cohérence (${e.numero})`,
      resume: lignes.slice(0, 12).join('\n'),
      numero: e.numero,
    })
  }
  return { docs: docs.length, proposes, ignores, prolongations, incoherences, chaineLegale, crSuggere: out.crSuggere || null }
}

function promptFlux(keys, e, { fiches, crs, actes, candidats, actesAnalyse }) {
  const crIndex = (e.comptesRendus || []).slice(-15).map((c) => `${c.date} — ${stripHtml(c.description).replace(/\s+/g, ' ').slice(0, 140)}`)
  const donnees = [
    '',
    '───── DOSSIER ─────',
    `Numéro : ${e.numero}`,
    `NATINF enregistrés : ${(e.infractionNatinfCodes || []).join(', ') || '(aucun)'}`,
    `Mis en cause ENREGISTRÉS : ${(e.misEnCause || []).map((m) => `${m.nom}${m.role ? ` (${m.role})` : ''}`).join(' ; ') || '(aucun)'}`,
    '',
    '───── DESCRIPTION ACTUELLE ─────',
    String(e.description || '(vide)').slice(0, DESCRIPTION_CHARS_MAX),
    '',
    '───── INDEX DES CR EXISTANTS (les 15 derniers) ─────',
    ...(crIndex.length ? crIndex : ['(aucun)']),
  ]
  if (crs.length) {
    donnees.push('', `───── CR NOUVEAUX (${crs.length}) ─────`)
    for (const c of crs.slice(-CR_NOUVEAUX_MAX)) {
      donnees.push(`[${c.date}${c.enqueteur ? ` — ${c.enqueteur}` : ''}]`, stripHtml(c.description).slice(0, CR_CHARS_MAX), '')
    }
  }
  if (actes.length) {
    donnees.push('', `───── ACTES NOUVEAUX (${actes.length}) ─────`)
    for (const a of actes) {
      donnees.push(`• ${a.kind} — ${a.numero || a.objet || a.type || ''} — début ${a.dateDebut || '?'} — fin ${a.dateFin || '?'} — statut ${a.statut || ''}${a.description ? ` — ${String(a.description).slice(0, 160)}` : ''}`)
    }
  }
  if (fiches.length) {
    donnees.push('', `───── PIÈCES NOUVELLES (${fiches.length}) — fiches du registre ─────`)
    for (const f of fiches) {
      const pers = (f.personnes || []).map((p) => `${p.nom}${p.alias ? ` dit ${p.alias}` : ''}${p.role ? ` [${p.role}]` : ''}`).join(' ; ')
      const ent = f.entites ? Object.entries(f.entites).filter(([, v]) => v?.length).map(([k, v]) => `${k}: ${v.slice(0, 6).join(', ')}`).join(' · ') : ''
      donnees.push(
        `■ ${f.chemin}${f.type ? ` — ${f.type}` : ''}${f.datePiece ? ` — ${f.datePiece}` : ''}${f.copieDe ? ` (copie de ${f.copieDe})` : ''}`,
        f.resume ? `  ${f.resume}` : '  (pas de fiche : pièce illisible ou non textuelle)',
        pers ? `  Personnes : ${pers}` : null,
        ent ? `  Entités : ${ent}` : null,
      )
    }
  }
  if (candidats.length) {
    donnees.push('', `───── CANDIDATS MIS EN CAUSE (pré-calcul : rôle de mis en cause dans une fiche, absents des enregistrés) ─────`)
    for (const c of candidats) donnees.push(`• ${c.nom}${c.alias ? ` dit ${c.alias}` : ''} — ${c.role} — pièce ${c.piece}${c.voisinDe ? ` — ATTENTION nom voisin de ${c.voisinDe}` : ''}`)
  }
  if (actesAnalyse.docs) {
    donnees.push('', '───── ANALYSE DES ACTES (déjà faite, serveur) ─────',
      `${actesAnalyse.proposes} acte(s) PROPOSÉ(S) au magistrat (✓/✗) — ne les repropose pas ; ${actesAnalyse.ignores} écarté(s) (doublon ou confiance faible).`)
    for (const p of actesAnalyse.prolongations) donnees.push(`• PROLONGATION détectée : ${p.type} — cibles ${(p.cibles || []).join(', ')} — autorisation du ${p.dateAutorisation || '?'} — +${p.duree || '?'} ${p.dureeUnit || ''} — pièce ${p.fileName}`)
    for (const i of actesAnalyse.incoherences) donnees.push(`• INCOHÉRENCE ${i.type} (${i.fileName}) : ${i.detail}`)
    if (actesAnalyse.crSuggere) donnees.push('Projet de CR de réception issu de l\'analyse (à fondre dans TON CR, pas à classer tel quel) :', actesAnalyse.crSuggere)
  }
  return promptConsigne(keys, 'flux', {
    entete: `FLUX TENDU — dossier « ${e.numero} » : intégrer le NEUF (tâche de fond, silencieuse, économe).`,
    vars: { dossier: e.numero },
    donnees: donnees.filter((l) => l !== null),
  })
}

/** Un passage complet du pipeline sur un dossier. Rend un bilan chiffré. */
export async function traiterDossier(keys, numero, { onHold = async () => false } = {}) {
  const t0 = Date.now()
  const num = numeroCanonique(keys, numero)
  const docKey = docServerKey(num)
  const bilan = { numero: num, at: new Date().toISOString(), pieces: 0, enAttente: 0, crs: 0, actes: 0, crEcrit: 0, mecProposes: 0, actesProposes: 0, run: false }

  const fin = async (patch = {}) => {
    Object.assign(bilan, patch, { dureeMs: Date.now() - t0 })
    const st = readEtat()
    const d = st.dossiers[num]
    if (d) {
      const e = enqueteDe(keys, num)
      const sig = dossierSyntheseSignals(keys).find((s) => s.numero === num)?.signature ?? d.sig
      // suite à venir (pièces pas encore fichées) : on reste en file, calme relancé
      const suite = bilan.enAttente > 0 && !bilan.differe && !bilan.chantier
      Object.assign(d, {
        sig, lastRunAt: bilan.at,
        pendingSince: (suite || bilan.differe) ? (d.pendingSince || Date.now()) : null,
        pendingAt: (suite || bilan.differe) ? Date.now() : null,
        raisons: suite ? ['suite'] : (bilan.differe ? d.raisons : []),
        ...(bilan.differe ? {} : (e ? idsDe(e) : {})),
      })
      if (!bilan.differe) {
        st.derniers = [bilan, ...(st.derniers || [])].slice(0, DERNIERS_MAX)
      }
      writeEtat(st)
    }
    return bilan
  }

  const e = enqueteDe(keys, num)
  if (!e || e.statut === 'archive') {
    const st = readEtat(); delete st.dossiers[num]; writeEtat(st)
    return { ...bilan, ignore: true }
  }
  const st0 = readEtat()
  if (!st0.dossiers[num]) { baseline(st0, e, null); writeEtat(st0) }

  // 1. Ingestion ciblée — zéro jeton, hors gouverneur.
  try { await ingestPass(keys, { docKeys: [docKey], maxDossiers: 1, maxExtractions: 40, maxShas: 400, maxProbes: 600 }) } catch { /* jamais bloquant */ }

  // 2. Mini-fiches des pièces nouvelles — consomme des jetons.
  if (await onHold('flux tendu (mini-fiches)')) return fin({ differe: true })
  for (let i = 0; i < FLUX_LOTS_MAX; i++) {
    let r = null
    try { r = await deps.registreFichesStep(keys, { docKey }) } catch { r = null }
    if (!r || !r.restantes) break
  }

  // 3. Le neuf.
  const reg = readRegistre(keys, docKey)
  const metas = listDocsMeta(attacheTj(), docKey)
  const d = readEtat().dossiers[num]
  const delta = deltas(keys, e, d, reg, metas)
  bilan.enAttente = delta.enAttente.length
  bilan.crs = delta.crs.length
  bilan.actes = delta.actes.length
  if (delta.marqueesSilence) writeRegistre(keys, docKey, reg)

  // Versement massif : chantier plutôt qu'un passage rapide.
  const nouvelles = delta.pretes.length + delta.enAttente.length
  if (nouvelles >= CHANTIER_SEUIL) {
    let message = ''
    try {
      const b = await basculerEnChantier(keys, { numero: num, pieces: nouvelles, trigger: 'flux' })
      message = b.message
      if (b.cree) await publishFeed(keys, { type: 'note', titre: `Versement massif — ${num}`, resume: b.message, numero: num })
    } catch (err) {
      message = `bascule chantier écartée (${err?.message || err})`
    }
    for (const rel of [...delta.pretes, ...delta.enAttente]) {
      if (reg.pieces[rel]) reg.pieces[rel].flux = { le: new Date().toISOString(), chantier: true }
    }
    writeRegistre(keys, docKey, reg)
    await audit(keys, 'flux_chantier', { numero: num, pieces: nouvelles, message })
    return fin({ chantier: true, enAttente: 0, pieces: nouvelles, message })
  }

  const pretes = delta.pretes.slice(0, FLUX_PIECES_MAX)
  if (delta.pretes.length > FLUX_PIECES_MAX) bilan.enAttente += delta.pretes.length - FLUX_PIECES_MAX
  bilan.pieces = pretes.length
  if (!pretes.length && !delta.crs.length && !delta.actes.length) return fin()

  if (await onHold('flux tendu (analyse)')) return fin({ differe: true })

  // 4. Actes (zones d'actes) — moteur serveur + propositions.
  let actesAnalyse = { docs: 0, proposes: 0, ignores: 0, prolongations: [], incoherences: [], chaineLegale: [], crSuggere: null }
  try { actesAnalyse = await analyserActes(keys, e, docKey, pretes) } catch (err) { actesAnalyse.erreur = String(err?.message || err) }
  bilan.actesProposes = actesAnalyse.proposes

  // 5. Le run : fiches jointes, candidats pré-calculés.
  const fiches = pretes.map((rel) => {
    const r = reg.pieces[rel] || {}
    return { chemin: rel, ...(r.fiche || {}), entites: r.entites }
  })
  const candidats = candidatsMec(keys, e, fiches)
  const avantCr = (e.comptesRendus || []).length
  const avantMec = listPropositions(keys, { numero: num, enAttente: true }).filter((p) => p.type === 'mec').length
  const result = await deps.runAgent({
    keys,
    prompt: promptFlux(keys, e, { fiches, crs: delta.crs, actes: delta.actes, candidats, actesAnalyse }),
    runLabel: 'flux',
    title: `Flux ${num} ${bilan.at.slice(0, 10)}`,
    model: economicalModel(agentConfig()),
    effort: 'low',
    maxTurns: 14,
    timeoutMs: 8 * 60 * 1000,
  })
  bilan.run = true
  const apres = enqueteDe(keys, num) || e
  bilan.crEcrit = Math.max(0, (apres.comptesRendus || []).length - avantCr)
  bilan.mecProposes = Math.max(0, listPropositions(keys, { numero: num, enAttente: true }).filter((p) => p.type === 'mec').length - avantMec)
  bilan.descriptionChangee = String(apres.description || '') !== String(e.description || '')

  // Marques de flux sur les pièces traitées (même si le run a échoué : on ne
  // rejoue pas un lot en boucle — l'audit garde l'erreur).
  const regApres = readRegistre(keys, docKey)
  for (const rel of pretes) if (regApres.pieces[rel]) regApres.pieces[rel].flux = { le: new Date().toISOString(), ...(result.ok ? {} : { erreur: true }) }
  writeRegistre(keys, docKey, regApres)
  await audit(keys, 'flux_traite', { numero: num, ...bilan, ok: result.ok, convId: result.convId, erreur: result.error })
  return fin({ ok: result.ok, erreur: result.error || undefined })
}
