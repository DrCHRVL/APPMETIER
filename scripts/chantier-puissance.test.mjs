/**
 * SIRAL — test du MOTEUR DES ANALYSES PROFONDES (chantiers).
 *
 * Scénario réel, celui qui a motivé ce test : un chantier « 387/081-2026 —
 * Prison Break V2 » (1074 pièces, 11 pochettes, 97 lots) est créé et validé un
 * dimanche matin. Le lendemain matin, le compteur affiche toujours 0 / 1074 et
 * le journal une seule ligne : « En attente : forfait saturé — reprise
 * automatique. » La nuit entière est passée sans qu'une pièce soit lue.
 *
 * Deux causes, deux familles de vérifications :
 *
 *  1. UN PLAFOND DEVINÉ bloquait tout. Le repère hebdomadaire de SIRAL (une
 *     estimation en jetons d'un forfait qui n'en publie aucun) affichait
 *     « 112 % » quand l'abonnement lui-même annonçait 9 %. On vérifie qu'un tel
 *     repère ne stoppe plus un chantier (il le resserre), que la fenêtre de 5 h
 *     garde son pouvoir d'arrêt, que la nuit se calcule dans le fuseau du
 *     magistrat et non celui du conteneur, et que « forcer » lève tout.
 *
 *  2. LE DÉBIT. Les lots partaient un par un ; ils partent désormais par
 *     vagues. On vérifie qu'une vague mène bien plusieurs lots DE FRONT, qu'un
 *     refus de quota ne condamne pas un lot en « échec », et qu'un arrêt
 *     brutal en pleine vague se rattrape sans perdre de pièces.
 *
 *   node scripts/chantier-puissance.test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
// Le bac à sable du moteur vit DANS le dépôt, à la même profondeur que
// `scripts/attache` : plusieurs modules du service importent `../../lib/…`, et
// une copie posée dans /tmp les perdrait.
const BAC = path.join(REPO, '.chantier-test-' + crypto.randomBytes(4).toString('hex'), 'attache')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-chantier-'))
const menage = () => {
  fs.rmSync(path.dirname(BAC), { recursive: true, force: true })
  fs.rmSync(TMP, { recursive: true, force: true })
}
process.on('exit', menage)

let echecs = 0
function ok(condition, titre, detail) {
  if (condition) { console.log(`  ✓ ${titre}`); return }
  echecs++
  console.log(`  ✗ ${titre}${detail ? `\n      ${detail}` : ''}`)
}
const eq = (a, b, titre) => ok(a === b, titre, `attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`)

// ── 1. Ordonnancement : la règle pure, sans moteur ni disque ────────────────
console.log('\nOrdonnancement — la nuit et le forfait')
const ordo = await import(path.join(REPO, 'scripts/attache/ordonnancement.mjs'))

{
  // 24/08/2026 à 23 h 30 UTC = 25/08 à 1 h 30 à Paris : la nuit, des deux côtés.
  const nuitProfonde = new Date('2026-08-24T23:30:00Z')
  // 24/08/2026 à 21 h 00 UTC = 23 h 00 à Paris : NUIT à Paris, JOUR en UTC.
  // C'est très exactement l'heure que le conteneur lisait de travers.
  const nuitParisJourUtc = new Date('2026-08-24T21:00:00Z')
  // 24/08/2026 à 06 h 00 UTC = 8 h 00 à Paris : JOUR à Paris, NUIT en UTC.
  const jourParisNuitUtc = new Date('2026-08-24T06:00:00Z')

  ok(ordo.inNightWindow(nuitProfonde, { tz: 'Europe/Paris' }), 'nuit profonde : fenêtre ouverte')
  ok(ordo.inNightWindow(nuitParisJourUtc, { tz: 'Europe/Paris' }),
    '23 h à Paris compte comme la nuit (le conteneur en UTC y lisait 21 h, donc « jour »)')
  ok(!ordo.inNightWindow(jourParisNuitUtc, { tz: 'Europe/Paris' }),
    '8 h à Paris ne compte pas comme la nuit (en UTC il y était 6 h, donc « nuit »)')
  ok(ordo.inNightWindow(jourParisNuitUtc, { tz: 'UTC' }), 'le fuseau est bien ce qui décide')
  eq(ordo.heureLocale(nuitParisJourUtc, 'Europe/Paris'), 23, 'heure lue dans le fuseau du magistrat')
  ok(ordo.inNightWindow(jourParisNuitUtc, { debut: 9, fin: 9 }), 'début = fin : fenêtre neutralisée, tout est permis')

  const p = ordo.prochaineNuit(jourParisNuitUtc, { tz: 'Europe/Paris' })
  eq(p?.heure, 22, 'prochaine ouverture annoncée')
  eq(p?.dansHeures, 14, 'délai avant ouverture, en heures')
}

console.log('\nFeu vert d\'un chantier — le faux plafond ne bloque plus')
{
  const nuit = { nuitSeulement: true }
  const jour = { nuitSeulement: false }

  // LE CAS RÉEL : fenêtre de 5 h à 0 %, repère hebdomadaire deviné à 112 %.
  // L'abonnement, lui, annonçait 9 %. C'est ce verdict-là qui a coûté la nuit.
  const faussementSature = { level: 'stop', cause: '7j', pct5h: 0, pct7d: 1.12, cap5h: 15e6, capHebdo: 150e6 }
  const feuNuit = ordo.feuChantier(nuit, { gov: faussementSature, nuit: true })
  ok(feuNuit.ok, 'repère hebdomadaire à 112 % : le chantier travaille quand même la nuit')
  eq(feuNuit.front, 1, '… mais resserré à un lot à la fois, le forfait reste protégé')

  // La fenêtre de 5 h, elle, se recoupe avec l'abonnement : elle arrête.
  const vraimentSature = { level: 'stop', cause: '5h', pct5h: 1.04, pct7d: 0.2, cap5h: 15e6, capHebdo: 150e6 }
  const bloque = ordo.feuChantier(nuit, { gov: vraimentSature, nuit: true })
  ok(!bloque.ok, 'fenêtre de 5 h saturée : le chantier attend')
  eq(bloque.attente, 'forfait', 'attente qualifiée « forfait »')
  ok(/5 h à 104 %/.test(bloque.detail || ''), 'le motif exact est dit, pas seulement « saturé »')

  // Nuit seulement, en plein jour.
  const dejour = ordo.feuChantier(nuit, { gov: { level: 'ok' }, nuit: false })
  ok(!dejour.ok && dejour.attente === 'nuit', 'chantier « nuit seulement » : attend la nuit en journée')
  ok(ordo.feuChantier(jour, { gov: { level: 'ok' }, nuit: false }).ok, 'chantier de jour : travaille en journée')

  // La dérogation du magistrat lève TOUT — nuit comprise, fenêtre de 5 h comprise.
  ok(ordo.feuChantier(nuit, { gov: vraimentSature, nuit: false, force: true }).ok,
    '« Forcer maintenant » passe outre la nuit ET la fenêtre de 5 h')

  // Sans plafond configuré, le gouverneur est inerte : rien ne doit bloquer.
  const inerte = { level: 'ok', pct5h: 0, pct7d: 0, cap5h: 0, capHebdo: 0 }
  ok(ordo.feuChantier(jour, { gov: inerte, nuit: false }).ok, 'aucun plafond posé : aucun blocage inventé')

  // Le partage de la machine avec l'application du magistrat : pleine vague la
  // nuit, un seul lot le jour. C'est ce qui a fait ramer SIRAL — une vague
  // lancée en pleine journée disputait le CPU au conteneur de l'app.
  eq(ordo.feuChantier(jour, { gov: inerte, nuit: true }).front, undefined, 'la nuit : pleine vague')
  eq(ordo.feuChantier(jour, { gov: inerte, nuit: false }).front, 1, 'le jour : un seul lot, l\'app passe devant')
  eq(ordo.feuChantier(nuit, { gov: inerte, nuit: false, force: true }).front, 1,
    'forcer en journée démarre tout de suite, mais ne prend pas toute la machine')
  eq(ordo.feuChantier(nuit, { gov: inerte, nuit: true, force: true }).front, undefined,
    'forcer la nuit garde la pleine vague')
}

// ── 2. Moteur : vagues, réservations, échecs ────────────────────────────────
// Le moteur est copié dans un bac à sable où `agent.mjs` et `productions.mjs`
// sont remplacés par des doublures : on teste l'ORDONNANCEMENT DES LOTS, pas
// le modèle ni le stockage des productions.
console.log('\nMoteur — vagues de lots')

fs.mkdirSync(BAC, { recursive: true })
for (const f of fs.readdirSync(path.join(REPO, 'scripts/attache'))) {
  if (f.endsWith('.mjs')) fs.copyFileSync(path.join(REPO, 'scripts/attache', f), path.join(BAC, f))
}

// Doublure du modèle : compte les runs, mesure le PARALLÉLISME RÉEL (combien
// de runs en vol au même instant) et rend ce que le scénario demande.
fs.writeFileSync(path.join(BAC, 'agent.mjs'), `
export const journalRuns = { total: 0, enVol: 0, maxEnVol: 0, reponse: null }
export function agentConfig() { return { subModel: null, econome: false } }
export async function runAgent() {
  journalRuns.total++
  journalRuns.enVol++
  journalRuns.maxEnVol = Math.max(journalRuns.maxEnVol, journalRuns.enVol)
  await new Promise((r) => setTimeout(r, 30))
  journalRuns.enVol--
  return journalRuns.reponse()
}
export function writeMcpConfig() { return '' }
export function sanitizeModel(v) { return v || null }
export function sanitizeEffort(v) { return v || null }
export function systemPrompt() { return '' }
`)
fs.writeFileSync(path.join(BAC, 'productions.mjs'), `
let n = 0
export async function saveProduction() { return { id: 'prod-' + (++n) } }
export function readProduction() { return { contenu: '## fiche\\n' + 'x'.repeat(600) } }
export function listProductions() { return [] }
`)
// Le fil et la mémoire du dossier ne sont pas le sujet : on les neutralise.
fs.writeFileSync(path.join(BAC, 'dossierMemory.mjs'), 'export async function appendDossierMemory() {}\n')

process.env.SIRAL_DATA_DIR = path.join(TMP, 'data')
process.env.SIRAL_ATTACHE_TJ = 'default'

const { readChantier, chantierStep, actionChantier, forceActive, estLimiteForfait, concurrenceChantier, createChantiersEnMasse, masseEtat, listChantiers } = await import(path.join(BAC, 'chantier.mjs'))
const { encryptJson } = await import(path.join(BAC, 'crypto.mjs'))
const { attacheDir, ensureDir } = await import(path.join(BAC, 'store.mjs'))
const { journalRuns } = await import(path.join(BAC, 'agent.mjs'))

const KEYS = { global: crypto.randomBytes(32) }
// La largeur d'une vague SUIT LA MACHINE (cœurs disponibles) : le test ne la
// fige pas, il vérifie qu'elle est respectée et qu'elle reste raisonnable.
const FRONT = concurrenceChantier()
ok(FRONT >= 1 && FRONT <= 3, `la vague est bornée par la machine (ici ${FRONT} lot(s) de front)`)
ok(FRONT <= Math.max(1, os.cpus().length - 2), 'elle laisse au moins deux cœurs à l\'application du magistrat')
const FICHE_VALIDE = () => ({ ok: true, text: '## Chronologie\n' + 'x'.repeat(400) })

/** Pose un chantier « dossier » prêt à tourner, avec `nbLots` lots à faire. */
function poserChantier({ id, nbLots, nuitSeulement = false, creeLe = '2026-08-24T09:53:20.000Z', lots }) {
  const ch = {
    id, type: 'dossier', numero: '387/081-2026', consigne: '',
    nuitSeulement, origine: 'magistrat', etat: 'en_cours', creeLe,
    plan: [{
      nom: 'PV',
      lots: lots || Array.from({ length: nbLots }, (_, i) => ({
        n: i + 1, pieces: [`PV/piece-${i + 1}.pdf`], etat: 'a_faire', echecs: 0,
      })),
    }],
    fiches: [], totalPieces: nbLots || (lots || []).length, piecesDeposees: nbLots, doublons: [], journal: [],
  }
  ensureDir(attacheDir('chantiers'))
  fs.writeFileSync(path.join(attacheDir('chantiers'), id + '.json'), JSON.stringify(encryptJson(KEYS.global, ch)))
  return ch
}
const viderChantiers = () => fs.rmSync(attacheDir('chantiers'), { recursive: true, force: true })
const tousLots = (ch) => ch.plan.flatMap((p) => p.lots)
const feuVert = () => ({ ok: true })

{
  viderChantiers()
  poserChantier({ id: 'a'.repeat(16), nbLots: FRONT + 2 })
  journalRuns.total = 0; journalRuns.maxEnVol = 0; journalRuns.reponse = FICHE_VALIDE

  const verdict = await chantierStep(KEYS, feuVert)
  const ch = readChantier(KEYS, 'a'.repeat(16))

  eq(verdict, 'travail', 'un pas de chantier travaille')
  eq(journalRuns.total, FRONT, `une vague lance ${FRONT} lot(s)`)
  eq(journalRuns.maxEnVol, FRONT, 'ils tournent VRAIMENT de front, pas à la queue leu leu')
  eq(tousLots(ch).filter((l) => l.etat === 'fait').length, FRONT, 'autant de lots faits')
  eq(tousLots(ch).filter((l) => l.etat === 'a_faire').length, 2, 'le reste attend le pas suivant')
  eq(ch.fiches.length, FRONT, 'une fiche par lot')
  ok(!(ch.pas || []).length, 'aucun marqueur de pas ne survit à la vague')
}

{
  // Vague plus large que le reste à faire : on ne lance pas dans le vide.
  viderChantiers()
  poserChantier({ id: 'b'.repeat(16), nbLots: 1 })
  journalRuns.total = 0; journalRuns.maxEnVol = 0; journalRuns.reponse = FICHE_VALIDE
  await chantierStep(KEYS, () => ({ ok: true, front: 6 }))
  eq(journalRuns.total, 1, 'un seul lot restant : on en lance un, pas une vague vide')
  eq(readChantier(KEYS, 'b'.repeat(16)).etat, 'en_cours', 'le chantier reste en cours jusqu\'au pas suivant')
}

{
  // Le feu peut resserrer la vague à un seul lot (forfait tendu).
  viderChantiers()
  poserChantier({ id: 'c'.repeat(16), nbLots: FRONT + 2 })
  journalRuns.total = 0; journalRuns.maxEnVol = 0; journalRuns.reponse = FICHE_VALIDE
  await chantierStep(KEYS, () => ({ ok: true, front: 1 }))
  eq(journalRuns.total, 1, 'forfait tendu (ou plein jour) : un seul lot à la fois')
}

console.log('\nMoteur — un chantier bloqué n\'en bloque plus d\'autres')
{
  viderChantiers()
  // Le plus ANCIEN est « nuit seulement » et nous sommes en journée ; le plus
  // récent peut travailler. L'ancien moteur ne regardait que le premier de la
  // file : tout s'arrêtait derrière lui.
  poserChantier({ id: 'd'.repeat(16), nbLots: 3, nuitSeulement: true, creeLe: '2026-08-01T09:00:00.000Z' })
  poserChantier({ id: 'e'.repeat(16), nbLots: 3, nuitSeulement: false, creeLe: '2026-08-20T09:00:00.000Z' })
  journalRuns.total = 0; journalRuns.reponse = FICHE_VALIDE

  const verdict = await chantierStep(KEYS, (ch) => (ch.nuitSeulement ? { ok: false, attente: 'nuit', detail: 'reprise vers 22 h (Europe/Paris)' } : { ok: true }))
  const bloque = readChantier(KEYS, 'd'.repeat(16))
  const passant = readChantier(KEYS, 'e'.repeat(16))

  eq(verdict, 'travail', 'le pas travaille malgré le chantier bloqué en tête de file')
  eq(tousLots(passant).filter((l) => l.etat === 'fait').length, Math.min(FRONT, 3), 'le chantier de jour a bien avancé')
  eq(tousLots(bloque).filter((l) => l.etat === 'fait').length, 0, 'le chantier de nuit n\'a pas bougé')
  eq(bloque.attente, 'nuit', 'son attente est notée')
  eq(bloque.attenteDetail, 'reprise vers 22 h (Europe/Paris)', 'avec le motif exact, affichable à l\'écran')
  ok(bloque.attenteDepuis, 'et depuis quand il attend')
}

console.log('\nMoteur — une limite de forfait n\'est pas un lot raté')
{
  ok(estLimiteForfait('Error: rate limit exceeded'), 'reconnaît « rate limit »')
  ok(estLimiteForfait('429 Too Many Requests'), 'reconnaît un 429')
  ok(estLimiteForfait('API Error: 529 overloaded_error'), 'reconnaît une surcharge')
  ok(!estLimiteForfait('fiche invalide'), 'ne confond pas avec un rendu invalide')

  viderChantiers()
  poserChantier({ id: 'f'.repeat(16), nbLots: 3 })
  journalRuns.total = 0
  journalRuns.reponse = () => ({ ok: false, error: 'API Error: 429 rate_limit_error', text: '' })

  await chantierStep(KEYS, feuVert)
  const ch = readChantier(KEYS, 'f'.repeat(16))
  const lots = tousLots(ch)

  eq(lots.filter((l) => l.etat === 'a_faire').length, 3, 'les lots refusés par le quota repartent tous à faire')
  eq(lots.filter((l) => l.etat === 'echec').length, 0, 'aucun lot marqué en échec')
  eq(lots.reduce((n, l) => n + (l.echecs || 0), 0), 0, 'AUCUNE tentative comptée : personne n\'a lu ces pièces')
  eq(ch.attente, 'forfait', 'le chantier passe en attente de forfait')
}

{
  // À l'inverse, un vrai rendu invalide compte comme une tentative.
  viderChantiers()
  poserChantier({ id: '0'.repeat(16), nbLots: 1 })
  journalRuns.reponse = () => ({ ok: true, text: 'trois mots' })
  await chantierStep(KEYS, feuVert)
  const lot = tousLots(readChantier(KEYS, '0'.repeat(16)))[0]
  eq(lot.echecs, 1, 'rendu invalide : une tentative comptée')
  eq(lot.etat, 'a_faire', '… et le lot repart à faire pour un nouvel essai')
}

console.log('\nMoteur — un arrêt brutal en pleine vague ne perd rien')
{
  viderChantiers()
  // Trois lots restés « en vol » : le service a été tué au milieu d'une vague.
  poserChantier({
    id: '1'.repeat(16), nbLots: 0,
    lots: [
      { n: 1, pieces: ['PV/1.pdf'], etat: 'en_vol', echecs: 0 },
      { n: 2, pieces: ['PV/2.pdf'], etat: 'en_vol', echecs: 2 },
      { n: 3, pieces: ['PV/3.pdf'], etat: 'fait', echecs: 0 },
    ],
  })
  journalRuns.total = 0; journalRuns.reponse = FICHE_VALIDE
  for (let i = 0; i < 5 && (await chantierStep(KEYS, feuVert)) === 'travail'; i++) { /* jusqu'à épuisement */ }
  const ch = readChantier(KEYS, '1'.repeat(16))
  const lots = tousLots(ch)

  eq(lots.filter((l) => l.etat === 'fait').length, 3, 'les deux lots orphelins ont été repris et faits')
  eq(lots.find((l) => l.n === 2).echecs, 2, 'un arrêt brutal ne compte pas de tentative supplémentaire')
  ok(ch.journal.some((e) => /interrompu/.test(e.evenement)), 'la reprise est dite au journal')
}

console.log('\nMoteur — pause et suppression pendant une vague')
{
  // Le magistrat clique « Pause » alors que trois lots sont en vol. Les lots
  // finissent leur course (rien n'est perdu), mais leur enregistrement en fin
  // de run ne doit PAS rouvrir le chantier qu'il vient de fermer.
  viderChantiers()
  poserChantier({ id: '3'.repeat(16), nbLots: FRONT + 3 })
  journalRuns.total = 0; journalRuns.reponse = FICHE_VALIDE

  const pas = chantierStep(KEYS, feuVert)
  await new Promise((r) => setTimeout(r, 10))
  await actionChantier(KEYS, { id: '3'.repeat(16), action: 'pause' })
  await pas

  const ch = readChantier(KEYS, '3'.repeat(16))
  eq(ch.etat, 'pause', 'la pause tient : la vague ne rouvre pas le chantier')
  eq(tousLots(ch).filter((l) => l.etat === 'fait').length, FRONT, 'les lots en vol ont bien été menés à terme')
  ok(!(ch.pas || []).length, 'aucun pas fantôme ne subsiste')
}

{
  // Même chose pour la suppression : les lots en vol ne doivent pas
  // ressusciter le fichier effacé.
  viderChantiers()
  poserChantier({ id: '4'.repeat(16), nbLots: FRONT + 3 })
  journalRuns.reponse = FICHE_VALIDE

  const pas = chantierStep(KEYS, feuVert)
  await new Promise((r) => setTimeout(r, 10))
  await actionChantier(KEYS, { id: '4'.repeat(16), action: 'supprimer' })
  await pas

  ok(!fs.existsSync(path.join(attacheDir('chantiers'), '4'.repeat(16) + '.json')),
    'un chantier supprimé pendant une vague ne ressuscite pas')
}

console.log('\nDérogation « Forcer maintenant »')
{
  viderChantiers()
  poserChantier({ id: '2'.repeat(16), nbLots: 2, nuitSeulement: true })
  // Un chantier resté en devis doit pouvoir être forcé d'un seul clic.
  const enDevis = readChantier(KEYS, '2'.repeat(16))
  enDevis.etat = 'devis'
  fs.writeFileSync(path.join(attacheDir('chantiers'), '2'.repeat(16) + '.json'), JSON.stringify(encryptJson(KEYS.global, enDevis)))

  const apres = await actionChantier(KEYS, { id: '2'.repeat(16), action: 'forcer' })
  eq(apres.etat, 'en_cours', 'forcer vaut validation du devis')
  ok(apres.forceJusqu, 'la dérogation est horodatée')
  ok(forceActive(readChantier(KEYS, '2'.repeat(16))), 'elle court')
  ok(!forceActive({ forceJusqu: '2020-01-01T00:00:00.000Z' }), 'une dérogation périmée ne court plus')
  ok(!forceActive({}), 'pas de dérogation par défaut')

  const enPause = await actionChantier(KEYS, { id: '2'.repeat(16), action: 'pause' })
  eq(enPause.forceJusqu, null, 'la pause referme la dérogation')
}

// ── 3. Création en masse : « tous les dossiers archivés » ───────────────────
// Le formulaire n'acceptait qu'UN numéro : demander le dépouillement de tout
// le stock archivé échouait sur « dossier introuvable ». La masse déroule la
// portée elle-même — un chantier (et un devis) par dossier archivé qui a des
// pièces, en écartant sans doublon ceux déjà en chantier.
console.log('\nCréation en masse — « tous les dossiers archivés »')
{
  viderChantiers()

  // Sans le moindre dossier archivé, la masse le dit en clair.
  let refus = null
  try { createChantiersEnMasse(KEYS, { portee: 'archives' }) } catch (e) { refus = String(e?.message || e) }
  ok(/Aucun dossier archivé/.test(refus || ''), 'sans archives : refus explicite, pas de silence')

  // Un contentieux : deux archivés dépouillables ou non, un archivé déjà en
  // chantier, un dossier en cours (hors portée).
  const ctxKey = crypto.randomBytes(32)
  KEYS.byScope = new Map([['ctx-crimorg', ctxKey]])
  const enquetes = [
    { numero: 'A-1/2020 - VIEUX', statut: 'archive' },
    { numero: 'A-2/2021 - SANS PIECES', statut: 'archive' },
    { numero: 'A-3/2022 - DEJA', statut: 'archive' },
    { numero: 'B-1/2026 - EN COURS', statut: 'en_cours' },
  ]
  const { encryptJson: chiffrer } = await import(path.join(BAC, 'crypto.mjs'))
  const { docServerKey } = await import(path.join(BAC, 'store.mjs'))
  const dataDir = process.env.SIRAL_DATA_DIR
  fs.mkdirSync(path.join(dataDir, 'vaults'), { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'vaults', 'ctx-crimorg.json'),
    JSON.stringify(chiffrer(ctxKey, { data: { enquetes, version: 1 }, metadata: null })))
  for (const numero of ['A-1/2020 - VIEUX', 'A-3/2022 - DEJA']) {
    const dossierDir = path.join(dataDir, 'docs', docServerKey(numero))
    fs.mkdirSync(dossierDir, { recursive: true })
    fs.writeFileSync(path.join(dossierDir, '.index.json'),
      JSON.stringify([{ rel: 'PV/p1.pdf' }, { rel: 'PV/p2.pdf' }]))
  }
  // A-3 a déjà son chantier « dossier » : la masse ne doit pas le doubler.
  const existant = {
    id: 'f'.repeat(16), type: 'dossier', numero: 'A-3/2022 - DEJA', etat: 'termine',
    creeLe: '2026-01-01T00:00:00.000Z', plan: [], fiches: [], totalPieces: 2, journal: [],
  }
  ensureDir(attacheDir('chantiers'))
  fs.writeFileSync(path.join(attacheDir('chantiers'), existant.id + '.json'),
    JSON.stringify(encryptJson(KEYS.global, existant)))

  const out = createChantiersEnMasse(KEYS, { portee: 'archives', consigne: 'angle test', nuitSeulement: true })
  eq(out.lances, 1, 'un seul dossier archivé reste à dépouiller')
  ok(out.dejaEnChantier.includes('A-3/2022 - DEJA'), 'déjà en chantier : écarté et nommé (idempotence)')
  ok(out.sansPieces.includes('A-2/2021 - SANS PIECES'), 'sans pièces : écarté et nommé')
  ok(!JSON.stringify(out).includes('B-1/2026'), 'les dossiers en cours restent hors de la portée « archives »')

  // Le devis se crée en ARRIÈRE-PLAN : on attend qu'il tombe.
  let devis = null
  for (let i = 0; i < 100 && !devis; i++) {
    await new Promise((r) => setTimeout(r, 25))
    devis = listChantiers(KEYS).find((c) => c.numero === 'A-1/2020 - VIEUX') || null
  }
  ok(devis, 'le devis du dossier archivé apparaît au fil de l\'eau')
  eq(devis?.etat, 'devis', 'il attend la validation du magistrat — rien ne se lance seul')
  eq(devis?.totalPieces, 2, 'son plan couvre les pièces du dossier')

  // La masse s'annonce finie (bilan publié, garde levée) avant toute relance.
  for (let i = 0; i < 100 && masseEtat(); i++) await new Promise((r) => setTimeout(r, 25))
  ok(!masseEtat(), 'la garde « masse en cours » retombe une fois le bilan publié')

  // Relancer la même masse ne crée AUCUN doublon.
  const bis = createChantiersEnMasse(KEYS, { portee: 'archives' })
  eq(bis.lances, 0, 'relancer la masse ne crée aucun doublon')
  eq(listChantiers(KEYS).filter((c) => c.numero === 'A-1/2020 - VIEUX').length, 1, 'un seul chantier par dossier')
}

console.log(echecs ? `\n${echecs} vérification(s) en échec.\n` : '\nToutes les vérifications passent.\n')
process.exit(echecs ? 1 : 0)
