/**
 * SIRAL — test : la chronologie du dossier est COMPLÈTE et se lit par pages.
 *
 * Avant : coupée à 2 000 entrées en gardant les plus ANCIENNES — sur un gros
 * dossier, les événements récents disparaissaient sans avertissement.
 *
 *   node scripts/attache-chronologie-complete.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-chrono-test-'))
const DATA_DIR = path.join(SCRATCH, 'data')
fs.mkdirSync(path.join(DATA_DIR, 'vaults'), { recursive: true })
process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { encryptJson } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)
const keyCtx = crypto.randomBytes(32)
grantKeyring({ global: crypto.randomBytes(32).toString('base64'), 'ctx-crimorg': keyCtx.toString('base64') }, 'test')

const NUM = '900/1/2026 - CHRONO'
const N = 2500
const crs = Array.from({ length: N }, (_, i) => {
  const d = new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)
  return { id: i + 1, date: d, enqueteur: 'OPJ', description: i === N - 1 ? 'DERNIER-CR-RECENT' : `CR ${i}` }
})
const data = { enquetes: [{ id: 1, numero: NUM, dateDebut: '2020-01-01', statut: 'en_cours', description: '', tags: [], actes: [], ecoutes: [], geolocalisations: [], misEnCause: [], comptesRendus: crs }], audienceResultats: {}, customTags: [], alertRules: [], version: 1 }
fs.writeFileSync(path.join(DATA_DIR, 'vaults', 'ctx-crimorg.json'),
  JSON.stringify(encryptJson(keyCtx, { data, metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 1 } })))

const { dispatchMcp } = await import(`${REPO}/scripts/attache-mcp.mjs`)
const call = async (args) => {
  const r = await dispatchMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'chronologie_lire', arguments: args } })
  const txt = r.result.content[0].text
  if (/SORTIE BORNÉE/.test(txt)) throw new Error('page coupée par le plafond de sortie')
  return JSON.parse(txt)
}

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

const p1 = await call({ numero: NUM })
attendu('total : toute la chronologie (≥ 2 500 entrées)', p1.total >= N, `total=${p1.total}`)
attendu('page 1 : entière (sous le plafond de sortie) et offsetSuivant', p1.entries.length > 0 && p1.offsetSuivant === p1.entries.length, JSON.stringify({ n: p1.entries.length, s: p1.offsetSuivant }))
let page = p1
const vues = [...p1.entries]
while (page.offsetSuivant) { page = await call({ numero: NUM, offset: page.offsetSuivant }); vues.push(...page.entries) }
attendu('en suivant les pages, toutes les entrées sont lues', vues.length === p1.total)
attendu('l\'événement le PLUS RÉCENT est atteint', vues.some((e) => JSON.stringify(e).includes('DERNIER-CR-RECENT')))

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) { console.log(`\n${echecs.length} échec(s).`); process.exit(1) }
console.log('\nTous les tests passent.')
process.exit(0)
