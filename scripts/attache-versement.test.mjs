/**
 * SIRAL — test de l'ANALYSE COMPLÈTE D'UN VERSEMENT MASSIF.
 *
 * Vérifie :
 *   - de jour, pièces pas encore fichées : on attend, aucun run ;
 *   - la nuit, le registre du dossier est poussé, puis la synthèse part ;
 *   - de jour, tout fiché mais moins de 24 h d'attente : on attend la nuit ;
 *     au-delà de 24 h, l'analyse part d'elle-même ;
 *   - le run reçoit le registre AGRÉGÉ : personnes et rôles relevés (sans
 *     les enquêteurs), mis en cause déjà déclarés signalés, véhicules et
 *     lignes avec leur utilisateur, chronologie cotée ;
 *   - la synthèse est classée au dossier comme compte rendu ;
 *   - forfait saturé : différé ; run en échec : retenté, puis abandonné.
 *
 *   node scripts/attache-versement.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-versement-test-'))
const DATA_DIR = path.join(SCRATCH, 'data')
const VAULTS = path.join(DATA_DIR, 'vaults')
fs.mkdirSync(VAULTS, { recursive: true })
process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { encryptJson, decryptJson, encryptDocBlob } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)
const keyGlobal = crypto.randomBytes(32)
const keyCtx = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': keyCtx.toString('base64') }, 'Audran CHEVALIER')
const keys = loadKeyring()

const NUM = '700/7/2026 - JONCTION'
fs.writeFileSync(path.join(VAULTS, 'ctx-crimorg.json'), JSON.stringify(encryptJson(keyCtx, {
  data: { enquetes: [{ id: 1, numero: NUM, statut: 'en_cours', tags: [], actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [], misEnCause: [{ nom: 'DURAND Kévin' }] }], version: 1 },
  metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 1 },
})))

const { writeDocBlob, docServerKey, attacheTj } = await import(`${REPO}/scripts/attache/store.mjs`)
const KEY = docServerKey(NUM)
const RELS = ['PV/D1_audition_DURAND.txt', 'PV/D2_surveillance.txt', 'PV/D3_audition_LEROY.txt']
for (const rel of RELS) writeDocBlob(attacheTj(), KEY, rel, encryptDocBlob(keyGlobal, Buffer.from(`Pièce ${rel} : 06 11 22 33 44, véhicule FG-527-XZ.`, 'utf8')), { savedBy: 'test' })
const { ingestPass } = await import(`${REPO}/scripts/attache/ingest.mjs`)
for (let i = 0; i < 5; i++) { const r = await ingestPass(keys); if (!r.dossiers) break }

const { readRegistre, writeRegistre } = await import(`${REPO}/scripts/attache/registre.mjs`)
const FICHES = {
  'PV/D1_audition_DURAND.txt': { type: 'PV audition', datePiece: '2026-03-02', resume: 'DURAND reconnaît gérer le point de deal.', personnes: [{ nom: 'DURAND Kévin', role: 'mis en cause — gérant du point' }, { nom: 'ROUSSEAU Marc', role: 'enquêteur' }], lignes: [{ numero: '06 11 22 33 44', utilisateur: 'DURAND Kévin' }] },
  'PV/D2_surveillance.txt': { type: 'PV constatations', datePiece: '2026-02-20', resume: 'LEROY fait le guet devant le hall.', personnes: [{ nom: 'LEROY Sami', alias: 'Momo', role: 'mis en cause — guetteur' }], vehicules: [{ plaque: 'FG-527-XZ', description: 'Clio grise', utilisateur: 'LEROY Sami' }] },
  'PV/D3_audition_LEROY.txt': { type: 'PV audition', datePiece: '2026-03-05', resume: 'LEROY dit être payé 50 € par jour pour guetter.', personnes: [{ nom: 'Sami LEROY', role: 'mis en cause — guetteur payé à la journée' }, { nom: 'BERNARD Lucie', role: 'témoin — cliente régulière' }] },
}
const ficher = (rels) => {
  const reg = readRegistre(keys, KEY)
  for (const rel of rels) reg.pieces[rel].fiche = { ...FICHES[rel], integrale: true }
  writeRegistre(keys, KEY, reg)
}

const v = await import(`${REPO}/scripts/attache/versement.mjs`)
const runs = []
let reponse = { ok: true, text: '## Synthèse des faits\nUn point de deal tenu par DURAND, guet assuré par LEROY dit Momo (PV/D2). '.repeat(4), convId: 'c1' }
let pousses = 0
v.configurerVersement({
  runAgent: async (opts) => { runs.push(opts); return reponse },
  // le registre « tourne » : chaque lot poussé fiche une pièce de plus
  registreFichesStep: async () => {
    const reg = readRegistre(keys, KEY)
    const rel = RELS.find((r) => !reg.pieces[r].fiche)
    if (!rel) return null
    pousses++
    ficher([rel])
    return { restantes: RELS.filter((r) => !readRegistre(keys, KEY).pieces[r].fiche).length }
  },
})

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}
const crs = () => {
  const env = JSON.parse(fs.readFileSync(path.join(VAULTS, 'ctx-crimorg.json'), 'utf8'))
  return decryptJson(keyCtx, env).data.enquetes[0].comptesRendus || []
}

attendu('rien de programmé : rien à faire', await v.versementsStep(keys) === null)
v.enregistrerVersement(NUM, RELS)

// de jour, rien de fiché : on attend
let r = await v.versementsStep(keys, { nuit: false })
attendu('de jour, pièces pas encore fichées : attente, aucun run', r.etape === 'fiches' && r.pretes === 0 && runs.length === 0 && pousses === 0, JSON.stringify(r))

// forfait saturé la nuit : différé
r = await v.versementsStep(keys, { nuit: true, onHold: async () => true })
attendu('forfait saturé : différé', r.etape === 'differe' && runs.length === 0, JSON.stringify(r))

// la nuit : le registre du dossier est poussé, puis la synthèse part
r = await v.versementsStep(keys, { nuit: true })
attendu('la nuit : registre poussé jusqu\'au bout', pousses === 3, `${pousses} lot(s)`)
attendu('la nuit : synthèse rédigée et classée', r.etape === 'fait' && runs.length === 1 && Boolean(r.crId), JSON.stringify(r))

const prompt = runs[0]?.prompt || ''
attendu('prompt : la consigne « versement » (sections imposées)', prompt.includes('## Personnes et rôles') && prompt.includes('## Lignes téléphoniques'))
attendu('prompt : personnes fusionnées (ordre Nom/Prénom indifférent), rôles relevés', /LEROY Sami.*alias Momo.*guetteur.*guetteur payé à la journée/.test(prompt), (prompt.match(/- LEROY.*$/m) || [])[0])
attendu('prompt : mis en cause déjà déclaré signalé', /DURAND Kévin \[MIS EN CAUSE DÉCLARÉ\]/.test(prompt))
attendu('prompt : la cliente régulière y est', /BERNARD Lucie.*cliente régulière/.test(prompt))
attendu('prompt : les enquêteurs écartés', !prompt.includes('ROUSSEAU'))
attendu('prompt : véhicule avec son utilisateur', /FG-527-XZ — Clio grise · utilisé par : LEROY Sami/.test(prompt), (prompt.match(/- FG.*$/m) || [])[0])
attendu('prompt : ligne avec son utilisateur', /06 11 22 33 44 · utilisée par : DURAND Kévin/.test(prompt), (prompt.match(/- 06.*$/m) || [])[0])
attendu('prompt : chronologie datée et cotée', prompt.indexOf('2026-02-20') < prompt.indexOf('2026-03-05') && prompt.includes('PV/D2_surveillance.txt : LEROY fait le guet'))

const cr = crs().at(-1)
attendu('compte rendu classé au dossier', /Analyse du versement du .* — 3 pièces/.test(cr?.description || '') && cr.description.includes('point de deal'), String(cr?.description || '').slice(0, 120))
attendu('versement soldé', v.listerVersements()[0].etat === 'fait' && await v.versementsStep(keys) === null)

// de jour, tout fiché : on attend la nuit… sauf au-delà de 24 h
v.enregistrerVersement(NUM, RELS)
r = await v.versementsStep(keys, { nuit: false })
attendu('de jour, tout fiché, < 24 h : on attend la nuit', r.etape === 'attente_nuit' && runs.length === 1, JSON.stringify(r))
reponse = { ok: false, error: 'délai dépassé' }
const demain = Date.now() + 25 * 3600 * 1000
r = await v.versementsStep(keys, { nuit: false, maintenant: demain })
attendu('> 24 h : l\'analyse part d\'elle-même ; échec retenté', r.etape === 'echec' && runs.length === 2 && v.listerVersements()[1].etat === 'attente', JSON.stringify(r))
await v.versementsStep(keys, { nuit: false, maintenant: demain })
await v.versementsStep(keys, { nuit: false, maintenant: demain })
attendu('trois échecs : abandon (rien ne tourne en boucle)', v.listerVersements()[1].etat === 'echec' && runs.length === 4 && await v.versementsStep(keys, { nuit: true }) === null)

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) {
  console.log(`\n${echecs.length} échec(s).`)
  process.exit(1)
}
console.log('\nTous les contrôles passent.')
