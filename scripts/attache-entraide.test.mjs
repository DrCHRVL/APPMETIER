/**
 * SIRAL — test de bout en bout du module ENTRAIDE dans le connecteur
 * (entraide_lister, entraide_lire, entraide_creer, entraide_evenement,
 * entraide_modifier, entraide_autorite, entraide_importer, entraide_stats).
 *
 * Fabrique un SIRAL_DATA_DIR réel (trousseau remis, coffre `entraide`), lance
 * scripts/attache-mcp.mjs en stdio JSON-RPC comme le CLI Claude Code, écrit,
 * puis vérifie le coffre déchiffré (contrat de fusion du client : dateMiseAJour
 * bumpée, signataires préservés), l'idempotence de l'import et la lecture.
 *
 *   node scripts/attache-entraide.test.mjs
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-entraide-test-'))
const DATA_DIR = path.join(SCRATCH, 'siral-test-data')
const VAULTS = path.join(DATA_DIR, 'vaults')
fs.mkdirSync(VAULTS, { recursive: true })

process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { encryptJson, decryptJson } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)

const keyGlobal = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': crypto.randomBytes(32).toString('base64') }, 'Audran CHEVALIER')

const ecrire = (name, payload) => fs.writeFileSync(path.join(VAULTS, `${name}.json`), JSON.stringify(encryptJson(keyGlobal, payload)))
const lire = (name) => decryptJson(keyGlobal, JSON.parse(fs.readFileSync(path.join(VAULTS, `${name}.json`), 'utf8')))

// Registre existant : une autorité, un signataire (à préserver), une demande.
ecrire('entraide', {
  version: 4,
  demandes: [{
    id: 'd-existante', type: 'dee', sens: 'recue', refEsabora: 'B3221-2026/00100', pays: 'Belgique', objet: 'Audition témoin',
    dateEnregistrement: '2026-01-05', evenements: [{ id: 'e0', type: 'reception', date: '2026-01-05', creeLe: '2026-01-05T09:00:00Z' }],
    creeLe: '2026-01-05T09:00:00Z', dateMiseAJour: '2026-01-05T09:00:00Z',
  }],
  autorites: [{ id: 'a-mons', nom: 'Parquet du Procureur du Roi de Mons', ville: 'Mons', pays: 'Belgique', langue: 'fr', motsCles: ['tournai'], dateMiseAJour: '2026-01-01T00:00:00Z' }],
  services: [{ id: 'cgd_abbeville', libelle: "Compagnie de gendarmerie d'Abbeville", cases: ['cgd', 'cgd_abbeville'], dateMiseAJour: '2026-01-01T00:00:00Z' }],
  signataires: [{ username: 'audran', civilite: 'M.', prenomNom: 'Audran CHEVALIER', fonction: 'Substitut', dateMiseAJour: '2026-01-01T00:00:00Z' }],
  tombstones: [],
})

const child = spawn('node', [path.join(REPO, 'scripts/attache-mcp.mjs')], {
  env: { ...process.env, SIRAL_ATTACHE_RUN: 'chat' },
  stdio: ['pipe', 'pipe', 'inherit'],
})
let buffer = ''
const pending = new Map()
child.stdout.on('data', (c) => {
  buffer += c.toString()
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
})
let nextId = 1
function rpc(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)) } }, 30000)
  })
}
async function call(name, args) {
  const r = await rpc('tools/call', { name, arguments: args })
  const text = r.result.content[0].text
  let json; try { json = JSON.parse(text) } catch { json = text }
  return { err: r.result.isError === true, json, text }
}

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} })
const noms = (await rpc('tools/list', {})).result.tools.map((t) => t.name)
attendu('outils entraide exposés', ['entraide_lister', 'entraide_lire', 'entraide_creer', 'entraide_evenement', 'entraide_modifier', 'entraide_completer', 'entraide_autorite', 'entraide_importer', 'entraide_stats', 'entraide_referentiel'].every((n) => noms.includes(n)))

// ── Création : autorité retrouvée, service résolu, mesures contrôlées
let r = await call('entraide_creer', {
  type: 'dee', sens: 'recue', refEsabora: 'B3221-2026/00301', pays: 'belgique', autorite: 'Parquet du Procureur du Roi de Mons',
  dateEnregistrement: '2026-05-15', objet: 'Délit de fuite', mesures: ['audition_temoin'], service: "Compagnie de gendarmerie d'Abbeville", magistrat: 'audran',
})
attendu('création ok', !r.err && r.json.cree?.refEsabora === 'B3221-2026/00301', r.text.slice(0, 200))
let reg = lire('entraide')
let d = reg.demandes.find((x) => x.refEsabora === 'B3221-2026/00301')
attendu('autorité rattachée à la fiche', d?.autoriteId === 'a-mons')
attendu('service rattaché', d?.serviceId === 'cgd_abbeville')
attendu('pays normalisé', d?.pays === 'Belgique')
attendu('événement de réception créé', d?.evenements?.[0]?.type === 'reception' && d.evenements[0].date === '2026-05-15')
attendu('signataire préservé', reg.signataires.length === 1 && reg.signataires[0].username === 'audran')
attendu('version incrémentée', reg.version === 5)
attendu('version précédente archivée', fs.readdirSync(path.join(VAULTS, '.versions', 'entraide')).length >= 1)

r = await call('entraide_creer', { type: 'dee', sens: 'recue', refEsabora: 'X', pays: 'Belgique', mesures: ['inexistante'] })
attendu('mesure inconnue refusée', r.err)

// ── Événements : l'étape et l'échéance se déduisent
r = await call('entraide_evenement', { ref: 'B3221-2026/00301', type: 'envoi_enqueteurs', date: '2026-05-27' })
attendu('envoi aux enquêteurs → chez les enquêteurs', !r.err && r.json.etat.chez === 'enqueteurs', r.text.slice(0, 300))
attendu('prochaine échéance = délai légal annexe B (le plus proche)', r.json.etat.echeance === '2026-05-22')
attendu('échéance interne à 3 mois', (await call('entraide_lire', { ref: 'B3221-2026/00301' })).json.echeanceInterne?.date === '2026-08-27')
const avant = lire('entraide').demandes.find((x) => x.refEsabora === 'B3221-2026/00301').dateMiseAJour
r = await call('entraide_evenement', { ref: 'B3221-2026/00301', type: 'retour_enqueteurs', date: '2026-07-01', partiel: true, note: '1 PV sur 2' })
attendu('retour partiel : reste chez les enquêteurs', !r.err && r.json.etat.chez === 'enqueteurs')
attendu('dateMiseAJour bumpée (fusion client)', lire('entraide').demandes.find((x) => x.refEsabora === 'B3221-2026/00301').dateMiseAJour > avant)
r = await call('entraide_evenement', { ref: 'B3221-2026/00301', type: 'inconnu', date: '2026-07-01' })
attendu('type d’événement inconnu refusé', r.err)

// ── Lecture
r = await call('entraide_lire', { ref: 'B3221-2026/00301' })
attendu('lecture : délais légaux DEE et chronologie', !r.err && r.json.echeancesLegales.length === 2 && r.json.chronologie.length === 3, r.text.slice(0, 300))
attendu('lecture : mesure en clair', r.json.mesures?.[0] === 'Audition d’un témoin')
r = await call('entraide_lister', { filtre: 'fuite' })
attendu('liste filtrée', !r.err && r.json.total === 1 && r.json.demandes[0].refEsabora === 'B3221-2026/00301')

// ── Modification
r = await call('entraide_modifier', { ref: 'B3221-2026/00301', refEtrangere: 'BE-441', echeanceLegale: { date: '2026-12-01', libelle: 'Date butoir fixée par l’État' } })
attendu('modification', !r.err && lire('entraide').demandes.find((x) => x.refEsabora === 'B3221-2026/00301').refEtrangere === 'BE-441')
r = await call('entraide_modifier', { ref: 'B3221-2026/00301', type: 'faux' })
attendu('type invalide refusé sans rien écrire', r.err && lire('entraide').demandes.find((x) => x.refEsabora === 'B3221-2026/00301').type === 'dee')

// ── Autorité
r = await call('entraide_autorite', { nom: 'Prokuratura Okręgowa w Krakowie', pays: 'Pologne', ville: 'Kraków', nature: 'parquet' })
attendu('autorité créée, langue par défaut du pays', !r.err && r.json.autorite.langue === 'en' && r.json.operation === 'creee')

// ── Import idempotent
const lot = {
  autorites: [{ nom: 'UK Central Authority', pays: 'Royaume uni', langue: 'en' }],
  demandes: [
    { type: 'cri', sens: 'emise', refEsabora: '2025/00753', pays: 'Royaume-Uni', autorite: 'UK Central Authority', dateEnregistrement: '2025-09-04', objet: 'Vol à la roulotte',
      evenements: [{ type: 'envoi_autorite', date: '2026-01-08' }, { type: 'cloture', date: '2026-08-07' }], origine: { onglet: 'CRI', ligne: 7 } },
    { type: 'do', sens: 'emise', refEsabora: '2025/00410', pays: 'Belgique', dateEnregistrement: '2025-05-15', objet: 'Vol d’accessoires', origine: { onglet: 'DO', ligne: 4 } },
    { type: 'dee', sens: 'recue', refEsabora: 'bad', pays: 'Belgique', evenements: [{ type: 'envoi_enqueteurs', date: '07/04/2025' }], origine: { onglet: 'DE', ligne: 99 } },
  ],
}
r = await call('entraide_importer', lot)
attendu('import : 2 créées, 1 erreur détaillée', !r.err && r.json.crees === 2 && r.json.erreurs.length === 1 && r.json.erreurs[0].origine.ligne === 99, r.text.slice(0, 300))
attendu('import : pays « Royaume uni » normalisé', lire('entraide').autorites.some((a) => a.nom === 'UK Central Authority' && a.pays === 'Royaume-Uni'))
r = await call('entraide_importer', lot)
attendu('import rejoué : mises à jour, aucun doublon', !r.err && r.json.crees === 0 && r.json.misesAJour === 2 && lire('entraide').demandes.length === 4, r.text.slice(0, 200))
r = await call('entraide_completer', { affectations: [{ origine: { onglet: 'CRI', ligne: 7 }, natinf: ['7151'] }] })
attendu('complément par ligne d’origine', !r.err && lire('entraide').demandes.find((x) => x.refEsabora === '2025/00753').natinf?.[0] === '7151', r.text.slice(0, 200))
r = await call('entraide_lister', { portee: 'cloturees' })
attendu('demande importée clôturée', r.json.total === 1 && r.json.demandes[0].refEsabora === '2025/00753')

// ── NATINF en lot
r = await call('entraide_completer', { affectations: [{ ref: 'B3221-2026/00301', natinf: ['7151', '7151', '7875'], personnes: 'Paul X. (témoin) ; victime : Marie Y.' }] })
const complete = () => lire('entraide').demandes.find((x) => x.refEsabora === 'B3221-2026/00301')
attendu('complément en lot : natinf dédoublonné, personnes', !r.err && JSON.stringify(complete().natinf) === '["7151","7875"]' && /victime/.test(complete().personnes), r.text.slice(0, 200))
r = await call('entraide_completer', { affectations: [{ ref: 'B3221-2026/00301', natinf: ['7151'] }, { ref: 'B3221-2026/00301', natinf: ['99999999'] }] })
attendu('natinf inconnu : refus, rien écrit', r.err && lire('entraide').demandes.find((x) => x.refEsabora === 'B3221-2026/00301').natinf.length === 2)
r = await call('entraide_lire', { ref: 'B3221-2026/00301' })
attendu('lecture : NATINF en clair', r.json.natinf?.[0]?.libelle === 'VOL')

r = await call('entraide_modifier', { ref: 'B3221-2026/00301', drapeau: 'rouge' })
attendu('drapeau rouge posé et lisible', !r.err && complete().drapeau === 'rouge' && /urgents/.test(r.json.modifie?.drapeau || ''), r.text.slice(0, 200))

// ── Statistiques : mêmes règles que l'écran
r = await call('entraide_stats', { annee: 2026 })
const carte = (id) => r.json.cartes.find((c) => c.id === id)
attendu('stats : entrées 2026 = 2 (existante + créée)', !r.err && carte('entrees').valeur === 2, JSON.stringify(carte('entrees')))
attendu('stats : 1 clôture en 2026', carte('cloturees').valeur === 1)
attendu('stats : chaque carte porte sa règle', r.json.cartes.every((c) => typeof c.regle === 'string' && c.regle.length > 10))

child.kill()
fs.rmSync(SCRATCH, { recursive: true, force: true })
console.log(echecs.length ? `\n❌ ${echecs.length} échec(s) : ${echecs.join(' · ')}` : '\n✅ TOUS LES TESTS PASSENT')
process.exit(echecs.length ? 1 : 0)
