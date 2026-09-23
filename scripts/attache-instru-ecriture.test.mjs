/**
 * SIRAL — test de bout en bout des ÉCRITURES dans le module instruction
 * (instru_modifier_dossier, instru_element, instru_mis_en_examen).
 *
 * Fabrique un SIRAL_DATA_DIR réel (trousseau remis, coffre personnel ET coffre
 * de groupe `instructions-*` portant le même dossier), lance
 * scripts/attache-mcp.mjs en stdio JSON-RPC comme le CLI Claude Code, écrit,
 * puis vérifie le coffre déchiffré (les deux copies), la version archivée,
 * la dateMiseAJour bumpée (contrat de fusion du client) et la relecture.
 *
 *   node scripts/attache-instru-ecriture.test.mjs
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-instru-test-'))
const DATA_DIR = path.join(SCRATCH, 'siral-test-data')
const VAULTS = path.join(DATA_DIR, 'vaults')
fs.mkdirSync(VAULTS, { recursive: true })

process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { encryptJson, decryptJson } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)

const keyGlobal = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': crypto.randomBytes(32).toString('base64') }, 'Audran CHEVALIER')

const DOSSIER = {
  id: 42, numeroInstruction: 'JIRS AC 26/01', numeroParquet: '85103/843/2026', cabinetId: 'cab-1',
  dateOuverture: '2026-01-20', dateRI: '2026-01-20', dateCreation: '2026-01-20', dateMiseAJour: '2026-06-01T10:00:00.000Z',
  etatReglement: 'en_cours', cotesTomes: 10,
  saisine: [{ id: 1, qualification: 'Trafic de stupéfiants', acte: 'introductif' }],
  suspects: [{ id: 5, nom: 'MARTIN Paul', role: 'chauffeur' }],
  misEnExamen: [{ id: 7, nom: 'DUPONT Jean', dateMiseEnExamen: '2026-01-21', infractions: [], elementsPersonnalite: [], mesureSurete: { type: 'libre' }, dmls: [] }],
  victimes: [], ops: [], debatsJLD: [], notesPerso: [], verifications: [], evenements: [],
}
const AUTRE = { ...DOSSIER, id: 43, numeroInstruction: 'JIRS AC 26/02', numeroParquet: '85103/900/2026', misEnExamen: [], saisine: [] }
const ecrire = (name, payload) => fs.writeFileSync(path.join(VAULTS, `${name}.json`), JSON.stringify(encryptJson(keyGlobal, payload)))
const lire = (name) => decryptJson(keyGlobal, JSON.parse(fs.readFileSync(path.join(VAULTS, `${name}.json`), 'utf8')))
ecrire('instructions-audran', { version: 3, dossiers: [DOSSIER, AUTRE], deletedIds: [], shareWith: ['collegue'] })
ecrire('instructions-groupe', { version: 5, dossiers: [DOSSIER], deletedIds: [] })

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
attendu('outils instruction exposés', ['instru_modifier_dossier', 'instru_element', 'instru_mis_en_examen'].every((n) => noms.includes(n)))

// ── Cotes, état du règlement, bloc-notes JI
let r = await call('instru_modifier_dossier', { numero: '85103/843/2026', cotesAjouter: 5, etatReglement: '175_recu', notesActesJIAjouter: 'Relancer l\'expertise ADN' })
attendu('modifier dossier : ok', !r.err && r.json.cotes === 15, r.text.slice(0, 200))
let perso = lire('instructions-audran').dossiers.find((d) => d.id === 42)
let groupe = lire('instructions-groupe').dossiers.find((d) => d.id === 42)
attendu('cotes 15 et 175 reçu dans le coffre personnel', perso.cotesTomes === 15 && perso.etatReglement === '175_recu')
attendu('coffre de groupe mis à jour aussi', groupe.cotesTomes === 15)
attendu('dateMiseAJour bumpée (fusion client)', perso.dateMiseAJour > DOSSIER.dateMiseAJour)
attendu('autre dossier intact', lire('instructions-audran').dossiers.find((d) => d.id === 43).cotesTomes === 10)
attendu('shareWith préservé', JSON.stringify(lire('instructions-audran').shareWith) === '["collegue"]')
attendu('version précédente archivée', fs.readdirSync(path.join(VAULTS, '.versions', 'instructions-audran')).length >= 1)
attendu('bloc-notes JI', /expertise ADN/.test(perso.notesActesJI))

// ── Saisine in rem
r = await call('instru_element', { numero: 'JIRS AC 26/01', collection: 'saisine', operation: 'ajouter', champs: { qualification: 'Importation de stupéfiants', natinfCode: '7995', acte: 'suppletif', dateActe: '2026-03-02' } })
attendu('saisine : ajout supplétif avec NATINF', !r.err && r.json.element.natinfRef?.code === '7995' && r.json.element.acte === 'suppletif', r.text.slice(0, 200))
r = await call('instru_element', { numero: 'JIRS AC 26/01', collection: 'saisine', operation: 'modifier', id: '1', champs: { qualification: 'Trafic de stupéfiants en bande organisée' } })
attendu('saisine : modification', !r.err && r.json.element.qualification.includes('bande organisée'))
r = await call('instru_element', { numero: 'JIRS AC 26/01', collection: 'saisine', operation: 'ajouter', champs: { qualification: 'X', natinfCode: '999999999' } })
attendu('saisine : NATINF inconnu refusé', r.err)

// ── Personnes, notes, chronologie, JLD
r = await call('instru_element', { numero: 'JIRS AC 26/01', collection: 'victimes', operation: 'ajouter', champs: { nom: 'DURAND Marie', partieCivile: true } })
attendu('victime ajoutée', !r.err && r.json.element.partieCivile === true)
r = await call('instru_element', { numero: 'JIRS AC 26/01', collection: 'victimes', operation: 'ajouter', champs: { nom: 'Durand marie' } })
attendu('victime en doublon refusée', r.err)
r = await call('instru_element', { numero: 'JIRS AC 26/01', collection: 'notesPerso', operation: 'ajouter', champs: { contenu: 'Penser au 175', tags: ['règlement'] } })
const noteId = r.json.element?.id
attendu('note ajoutée', !r.err && noteId)
r = await call('instru_element', { numero: 'JIRS AC 26/01', collection: 'notesPerso', operation: 'modifier', id: String(noteId), champs: { contenu: 'Penser au 175 — relancer le JI' } })
attendu('note modifiée', !r.err && /relancer/.test(r.json.element.contenu))
r = await call('instru_element', { numero: 'JIRS AC 26/01', collection: 'evenements', operation: 'ajouter', champs: { type: 'ipc', date: '2026-02-10', titre: 'IPC', misEnExamen: 'dupont' } })
attendu('événement rattaché au MEX par nom', !r.err && r.json.element.misEnExamenId === 7)
r = await call('instru_element', { numero: 'JIRS AC 26/01', collection: 'debatsJLD', operation: 'ajouter', champs: { type: 'dml', date: '2026-07-01', misEnExamen: '7' } })
attendu('débat JLD ajouté', !r.err && r.json.element.type === 'dml')
r = await call('instru_element', { numero: 'JIRS AC 26/01', collection: 'suspects', operation: 'supprimer', id: 'inconnu' })
attendu('suppression d\'un inconnu refusée', r.err)

// ── Mis en examen
r = await call('instru_mis_en_examen', {
  numero: 'JIRS AC 26/01', operation: 'ajouter', nom: 'MARTIN Paul', dateMiseEnExamen: '2026-01-31', depuisSuspect: 'MARTIN Paul',
  infractionsAjouter: [{ natinfCode: '7995' }, { qualification: 'Association de malfaiteurs' }],
  mesure: { type: 'detenu', regime: 'correctionnel', dureeMois: 4 },
})
const martin = r.json.misEnExamen
attendu('MEX ajouté depuis suspect', !r.err && r.json.suspectRetire === 'MARTIN Paul', r.text.slice(0, 300))
attendu('chefs : NATINF → qualification', martin?.infractions?.[0]?.qualification === 'IMPORTATION NON AUTORISEE DE STUPEFIANTS' && martin.infractions.length === 2)
attendu('placement DP : fin 31/05 (de date à date)', martin?.mesureSurete?.periodes?.[0]?.dateFin === '2026-05-31', JSON.stringify(martin?.mesureSurete))
r = await call('instru_mis_en_examen', { numero: 'JIRS AC 26/01', operation: 'modifier', cible: 'martin', mesure: { type: 'detenu', dureeMois: 4, prolongation: true }, dmlAjouter: { dateDepot: '2026-06-05' } })
const m2 = r.json.misEnExamen
attendu('prolongation DP à la suite', !r.err && m2.mesureSurete.periodes[1]?.type === 'prolongation' && m2.mesureSurete.periodes[1].dateDebut === '2026-05-31' && m2.mesureSurete.periodes[1].dateFin === '2026-09-30', JSON.stringify(m2?.mesureSurete?.periodes))
attendu('DML : échéance +10 jours ouvrables', m2?.dmls?.[0]?.dateEcheance === '2026-06-19', JSON.stringify(m2?.dmls))
r = await call('instru_mis_en_examen', { numero: 'JIRS AC 26/01', operation: 'modifier', id: 7, mesure: { type: 'cj', depuis: '2026-02-01' }, infractionsAjouter: ['Blanchiment'] })
attendu('CJ + chef ajoutés sur MEX existant', !r.err && r.json.misEnExamen.mesureSurete.type === 'cj' && r.json.misEnExamen.infractions.length === 1)
r = await call('instru_mis_en_examen', { numero: 'JIRS AC 26/01', operation: 'ajouter', nom: 'dupont jean' })
attendu('MEX en doublon refusé', r.err)

perso = lire('instructions-audran').dossiers.find((d) => d.id === 42)
groupe = lire('instructions-groupe').dossiers.find((d) => d.id === 42)
attendu('suspect retiré, 2 MEX', perso.suspects.length === 0 && perso.misEnExamen.length === 2)
attendu('coffres personnel et groupe identiques', JSON.stringify(perso) === JSON.stringify(groupe))

// ── Relecture : tout, avec les ids
r = await call('lire_dossier', { numero: 'JIRS AC 26/01' })
const md = r.text
attendu('lecture : cotes, saisine, victimes, notes, ids', /Cotes : 15/.test(md) && /\[#1\] Trafic de stupéfiants en bande organisée/.test(md)
  && /DURAND Marie/.test(md) && /relancer le JI/.test(md) && /\[#7\] DUPONT Jean/.test(md), md.slice(0, 300))

// ── Numéro inconnu
r = await call('instru_modifier_dossier', { numero: 'NOPE', cotes: 1 })
attendu('dossier inconnu : erreur', r.err)

child.kill()
fs.rmSync(SCRATCH, { recursive: true, force: true })
console.log(echecs.length ? `\n❌ ${echecs.length} échec(s) : ${echecs.join(' · ')}` : '\n✅ TOUS LES TESTS PASSENT')
process.exit(echecs.length ? 1 : 0)
