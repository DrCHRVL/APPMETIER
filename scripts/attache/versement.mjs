/**
 * SIRAL — Attaché de justice · ANALYSE COMPLÈTE D'UN VERSEMENT MASSIF.
 *
 * Un versement de dizaines ou de centaines de pièces d'un coup (jonction,
 * dossier entier versé) ne passe pas par le flux tendu — trop gros pour un
 * passage rapide. Il n'est pas laissé en jachère pour autant : il est
 * PROGRAMMÉ ici, puis analysé automatiquement, sans validation.
 *
 * Deux temps :
 *   1. Le REGISTRE fiche chaque pièce EN ENTIER (personnes et rôle que la
 *      pièce leur prête, véhicules, lignes, résumé ; entités extraites) — au
 *      fil de l'eau, et à plein régime la nuit pour ce dossier.
 *   2. Quand toutes les pièces sont fichées, un run rédige la SYNTHÈSE
 *      COMPLÈTE du versement à partir du registre AGRÉGÉ (toutes les
 *      personnes et leurs rôles, véhicules, lignes, adresses, comptes,
 *      chronologie — cotes à l'appui), en relisant au besoin les pièces
 *      clés. Elle est classée au dossier comme compte rendu ; les mis en
 *      cause manquants sont PROPOSÉS.
 *
 * De nuit de préférence ; si la nuit ne vient pas (fenêtre désactivée,
 * forfait), l'analyse part d'elle-même au-delà de 24 h d'attente. Le forfait
 * peut la différer, jamais l'annuler.
 */
import { attacheDir, readJson, atomicWrite, docServerKey } from './store.mjs'
import { loadContentieux, numeroCanonique, classerNote } from './dossier.mjs'
import { readRegistre, registreFichesStep } from './registre.mjs'
import { mecCanonId } from './carto.mjs'
import { runAgent } from './agent.mjs'
import { audit, publishFeed } from './journal.mjs'
import { prompt as promptConsigne } from './consignes.mjs'

const FILE = () => attacheDir('versements.json')
const ATTENTE_MAX_MS = 24 * 3600 * 1000 // au-delà, plus d'attente de la nuit
const TENTATIVES_MAX = 3
const LOTS_NUIT = 6 // lots de mini-fiches poussés par passage, la nuit
const DONNEES_MAX = 95_000 // caractères joints au prompt (argv unitaire : 128 Kio)
const COTES_MAX = 8
const RE_ROLE_NEUTRE = /enqu[eê]teur|policier|gendarme|\bOPJ\b|\bAPJ\b|magistrat|procureur|juge|avocat|greffier|expert|interpr[eè]te|traducteur/i

// Dépendances remplaçables (tests) : la brique qui parle au modèle.
const deps = { runAgent, registreFichesStep }
export function configurerVersement(overrides = {}) { Object.assign(deps, overrides) }

function readEtat() {
  const st = readJson(FILE(), null)
  return st && Array.isArray(st.versements) ? st : { versements: [] }
}
function writeEtat(st) { atomicWrite(FILE(), JSON.stringify(st, null, 2)) }

/** Programme l'analyse complète d'un versement (appelé par le flux tendu). */
export function enregistrerVersement(numero, rels) {
  const st = readEtat()
  const v = {
    id: `v-${Date.now().toString(36)}`,
    numero: String(numero),
    rels: [...new Set(rels.map(String))].sort(),
    enregistreLe: new Date().toISOString(),
    etat: 'attente',
    tentatives: 0,
  }
  st.versements.push(v)
  writeEtat(st)
  return v
}

/** Les versements programmés et leur état (pour l'affichage et le diagnostic). */
export function listerVersements() {
  return readEtat().versements
}

/** Une pièce est prête quand sa fiche est établie sur la pièce entière (ou abandonnée). */
function couverture(keys, v) {
  const reg = readRegistre(keys, docServerKey(numeroCanonique(keys, v.numero)))
  let pretes = 0
  for (const rel of v.rels) {
    const e = reg.pieces[rel]
    if (!e) continue // pas encore ingérée
    if ((e.fiche && e.fiche.integrale) || (e.ficheEchecs || 0) >= 2) pretes++
  }
  return { total: v.rels.length, pretes, reg }
}

const cotes = (liste) => {
  const u = [...new Set(liste)]
  return u.slice(0, COTES_MAX).join(', ') + (u.length > COTES_MAX ? ` (+${u.length - COTES_MAX})` : '')
}

/**
 * Le registre du versement AGRÉGÉ — ce que le run reçoit : toutes les
 * personnes (rôles distincts, cotes), véhicules, lignes, adresses, comptes,
 * puis la chronologie pièce par pièce dans la limite du budget.
 */
export function donneesVersement(keys, v, reg, { titre } = {}) {
  const { data } = loadContentieux(keys)
  const canon = numeroCanonique(keys, v.numero)
  const e = (data.enquetes || []).find((x) => String(x.numero) === String(canon))
  const declares = new Set((e?.misEnCause || []).map((m) => mecCanonId(m.nom)).filter(Boolean))

  const personnes = new Map()
  const vehicules = new Map()
  const lignes = new Map()
  const adresses = new Map()
  const ibans = new Map()
  const chrono = []
  const ajouter = (map, cle, init, rel, maj) => {
    if (!cle) return
    if (!map.has(cle)) map.set(cle, { ...init, cotes: [] })
    const x = map.get(cle)
    x.cotes.push(rel)
    if (maj) maj(x)
  }
  for (const rel of v.rels) {
    const entree = reg.pieces[rel]
    if (!entree) continue
    const f = entree.fiche || {}
    for (const p of f.personnes || []) {
      if (RE_ROLE_NEUTRE.test(String(p.role || ''))) continue
      ajouter(personnes, mecCanonId(p.nom) || p.nom, { nom: p.nom, alias: new Set(), roles: new Set() }, rel, (x) => {
        if (p.alias) x.alias.add(p.alias)
        if (p.role) x.roles.add(p.role)
      })
    }
    for (const veh of f.vehicules || []) {
      const cle = String(veh.plaque || veh.description || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      ajouter(vehicules, cle, { plaque: veh.plaque || '', description: veh.description || '', utilisateurs: new Set() }, rel, (x) => {
        if (veh.utilisateur) x.utilisateurs.add(veh.utilisateur)
        if (veh.plaque) x.plaque = veh.plaque // la plaque telle qu'écrite dans la pièce
        if (!x.description && veh.description) x.description = veh.description
      })
    }
    for (const pl of entree.entites?.plaque || []) ajouter(vehicules, pl, { plaque: pl, description: '', utilisateurs: new Set() }, rel)
    for (const l of f.lignes || []) {
      const cle = String(l.numero || '').replace(/\D/g, '').slice(-9)
      ajouter(lignes, cle, { numero: l.numero, utilisateurs: new Set() }, rel, (x) => { if (l.utilisateur) x.utilisateurs.add(l.utilisateur) })
    }
    for (const t of entree.entites?.tel || []) ajouter(lignes, t.slice(-9), { numero: t, utilisateurs: new Set() }, rel)
    for (const a of entree.entites?.adresse || []) ajouter(adresses, a, { adresse: a }, rel)
    for (const i of entree.entites?.iban || []) ajouter(ibans, i, { iban: i }, rel)
    chrono.push({ rel, date: f.datePiece || '', type: f.type || '', resume: f.resume || (entree.fiche ? '' : '(pièce non fichée)') })
  }

  const parPoids = (a, b) => b.cotes.length - a.cotes.length
  const out = [
    '',
    `───── ${titre || `VERSEMENT : ${v.rels.length} pièces, versées le ${v.enregistreLe.slice(0, 10)}`} ─────`,
    e?.description ? `Description actuelle du dossier : ${String(e.description).replace(/<[^>]+>/g, ' ').slice(0, 2000)}` : null,
    `Mis en cause déjà déclarés : ${(e?.misEnCause || []).map((m) => m.nom).join(', ') || 'aucun'}`,
    '',
    `───── PERSONNES (${personnes.size}) — nom · alias · rôles relevés · cotes ─────`,
    ...[...personnes.entries()].sort((a, b) => parPoids(a[1], b[1])).map(([cle, p]) =>
      `- ${p.nom}${declares.has(cle) ? ' [MIS EN CAUSE DÉCLARÉ]' : ''}${p.alias.size ? ` · alias ${[...p.alias].join(', ')}` : ''}${p.roles.size ? ` · ${[...p.roles].join(' / ')}` : ''} · ${p.cotes.length} pièce(s) : ${cotes(p.cotes)}`),
    '',
    `───── VÉHICULES (${vehicules.size}) ─────`,
    ...[...vehicules.values()].sort(parPoids).map((x) =>
      `- ${[x.plaque, x.description].filter(Boolean).join(' — ')}${x.utilisateurs.size ? ` · utilisé par : ${[...x.utilisateurs].join(' / ')}` : ''} · ${cotes(x.cotes)}`),
    '',
    `───── LIGNES TÉLÉPHONIQUES (${lignes.size}) ─────`,
    ...[...lignes.values()].sort(parPoids).map((x) =>
      `- ${x.numero}${x.utilisateurs.size ? ` · utilisée par : ${[...x.utilisateurs].join(' / ')}` : ''} · ${cotes(x.cotes)}`),
    '',
    `───── ADRESSES (${adresses.size}) ─────`,
    ...[...adresses.values()].sort(parPoids).map((x) => `- ${x.adresse} · ${cotes(x.cotes)}`),
    ...(ibans.size ? ['', `───── COMPTES (${ibans.size}) ─────`, ...[...ibans.values()].map((x) => `- ${x.iban} · ${cotes(x.cotes)}`)] : []),
  ].filter((l) => l !== null)

  let taille = out.join('\n').length
  const lignesChrono = []
  let omises = 0
  chrono.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.rel.localeCompare(b.rel))
  for (const c of chrono) {
    const l = `- ${c.date || 's.d.'} · ${c.type} · ${c.rel} : ${c.resume}`
    if (taille + l.length > DONNEES_MAX) { omises++; continue }
    taille += l.length + 1
    lignesChrono.push(l)
  }
  out.push('', `───── CHRONOLOGIE PIÈCE PAR PIÈCE (${chrono.length}) ─────`, ...lignesChrono)
  if (omises) out.push(`(${omises} pièce(s) non jointes faute de place — registre_lire numero:"${canon}" pour les consulter)`)
  return out.join('\n')
}

/**
 * Un pas : le premier versement en attente. Pousse ses mini-fiches la nuit ;
 * une fois tout fiché, lance l'analyse (nuit, ou attente > 24 h).
 * Rend null si rien à faire, sinon un bilan.
 */
export async function versementsStep(keys, { nuit = false, onHold = async () => false, maintenant = Date.now() } = {}) {
  const st = readEtat()
  const v = st.versements.find((x) => x.etat === 'attente')
  if (!v) return null
  let cov = couverture(keys, v)

  if (cov.pretes < cov.total) {
    if (!nuit) return { numero: v.numero, etape: 'fiches', total: cov.total, pretes: cov.pretes }
    if (await onHold('analyse de versement (mini-fiches)')) return { numero: v.numero, etape: 'differe' }
    const docKey = docServerKey(numeroCanonique(keys, v.numero))
    for (let i = 0; i < LOTS_NUIT; i++) {
      let r = null
      try { r = await deps.registreFichesStep(keys, { docKey }) } catch { r = null }
      if (!r || !r.restantes) break
    }
    cov = couverture(keys, v)
    if (cov.pretes < cov.total) return { numero: v.numero, etape: 'fiches', total: cov.total, pretes: cov.pretes }
  }

  const attente = maintenant - Date.parse(v.enregistreLe)
  if (!nuit && attente < ATTENTE_MAX_MS) return { numero: v.numero, etape: 'attente_nuit' }
  if (await onHold('analyse de versement')) return { numero: v.numero, etape: 'differe' }

  const canon = numeroCanonique(keys, v.numero)
  const result = await deps.runAgent({
    keys,
    prompt: promptConsigne(keys, 'versement', {
      entete: `ANALYSE COMPLÈTE D'UN VERSEMENT — dossier « ${canon} », ${v.rels.length} pièces.`,
      vars: { dossier: canon },
      donnees: donneesVersement(keys, v, cov.reg),
    }),
    runLabel: 'versement',
    title: `Versement ${canon} ${v.enregistreLe.slice(0, 10)}`,
    maxTurns: 60,
    timeoutMs: 45 * 60 * 1000,
  })
  const texte = String(result?.text || '').trim()
  const etat = readEtat()
  const w = etat.versements.find((x) => x.id === v.id)
  if (!result?.ok || texte.length < 200) {
    w.tentatives = (w.tentatives || 0) + 1
    w.erreur = result?.error || 'synthèse vide'
    if (w.tentatives >= TENTATIVES_MAX) w.etat = 'echec'
    writeEtat(etat)
    await audit(keys, 'versement_echec', { numero: canon, tentatives: w.tentatives, erreur: w.erreur })
    return { numero: canon, etape: 'echec', erreur: w.erreur }
  }
  const titre = `Analyse du versement du ${v.enregistreLe.slice(0, 10).split('-').reverse().join('/')} — ${v.rels.length} pièces`
  const cr = await classerNote(keys, { numero: canon, titre, contenu: texte })
  w.etat = 'fait'
  w.faitLe = new Date().toISOString()
  w.crId = cr?.id
  delete w.erreur
  writeEtat(etat)
  await publishFeed(keys, { type: 'note', titre: `${titre} — ${canon}`, resume: 'Synthèse complète classée au dossier (compte rendu) : personnes et rôles, véhicules, lignes, adresses, chronologie.', numero: canon }).catch(() => {})
  await audit(keys, 'versement_analyse', { numero: canon, pieces: v.rels.length, convId: result.convId })
  return { numero: canon, etape: 'fait', crId: cr?.id }
}
