/**
 * SIRAL — test de la RÉSOLUTION des extrémités d'un lien proposé (proposer_lien).
 * À la validation ✓, le lien doit s'attacher au nœud EXISTANT (casse, accents et
 * ordre des mots indifférents) ; sans nœud correspondant, la validation est
 * refusée au lieu de créer un lien orphelin.
 *
 *   node scripts/attache-lien-resolution.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-lien-test-'))
const DATA_DIR = path.join(SCRATCH, 'siral-test-data')
fs.mkdirSync(path.join(DATA_DIR, 'vaults'), { recursive: true })

process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { encryptJson } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)

const keyGlobal = crypto.randomBytes(32)
const keyCtx = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': keyCtx.toString('base64') }, 'Audran CHEVALIER')
const keys = loadKeyring()

const enquetes = [{
  id: 1, numero: '387/081/2026 - PERONNE', dateDebut: '2026-01-05', statut: 'en_cours',
  tags: [], actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [],
  misEnCause: [
    { id: 101, nom: 'reziga belkacem', role: 'tête de réseau', statut: 'actif' },
    { id: 102, nom: 'LAACHIRA Medhi', role: 'lieutenant', statut: 'actif' },
  ],
}]
const syncData = { enquetes, audienceResultats: {}, customTags: [], alertRules: [], version: 1 }
fs.writeFileSync(
  path.join(DATA_DIR, 'vaults', 'ctx-crimorg.json'),
  JSON.stringify(encryptJson(keyCtx, { data: syncData, metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 1 } }))
)

const { appendLien, loadOverlay } = await import(`${REPO}/scripts/attache/carto.mjs`)

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

const r = await appendLien(keys, { sourceNom: 'Belkacem REZIGA', targetNom: 'Laachira MEDHI', label: 'frères' })
attendu('lien créé sur les nœuds existants',
  r.ok === true && r.source === 'reziga belkacem' && r.target === 'laachira medhi', JSON.stringify(r))

const liens = loadOverlay(keys)?.liensRenseignement || []
attendu('lien enregistré', liens.length === 1 && liens[0].source === 'reziga belkacem', JSON.stringify(liens))

let refus = ''
try { await appendLien(keys, { sourceNom: 'Belkacem REZIGA', targetNom: 'Personne INCONNUE' }) } catch (e) { refus = e.message }
attendu('nœud inexistant refusé avec message', refus.includes('Personne INCONNUE'), refus)
attendu('aucun lien orphelin créé', (loadOverlay(keys)?.liensRenseignement || []).length === 1)

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) {
  console.error(`\n${echecs.length} test(s) en échec : ${echecs.join(' · ')}`)
  process.exit(1)
}
console.log('\nTous les tests passent.')
