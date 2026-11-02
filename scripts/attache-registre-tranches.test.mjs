/**
 * SIRAL — test du REGISTRE sur les pièces LONGUES.
 *
 * Une mini-fiche ne doit jamais être établie sur un début de pièce : une
 * pièce longue est lue en tranches successives, fiche fusionnée, et les
 * fiches anciennes (établies sur les 9 000 premiers caractères) sont reprises.
 * Vérifie :
 *   - une personne citée loin dans une longue audition entre au registre ;
 *   - la fiche se construit sur plusieurs lots et reprend où elle s'était
 *     arrêtée ; les personnes vues dans deux tranches ne sont pas doublées ;
 *   - une fiche ancienne sur une pièce COURTE est simplement marquée (aucun
 *     run), sur une pièce LONGUE elle est refaite ;
 *   - une copie exacte n'est pas lue deux fois : elle hérite.
 *
 * Faux CLI claude : rend, pour chaque entête « ═══ PIÈCE … ═══ », les jetons
 * PERS_XXX trouvés dans le texte qui suit.
 *
 *   node scripts/attache-registre-tranches.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-registre-tranches-'))
const DATA_DIR = path.join(SCRATCH, 'data')
fs.mkdirSync(path.join(DATA_DIR, 'vaults'), { recursive: true })
process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const RUNS = path.join(SCRATCH, 'runs.txt')
const FAUX = path.join(SCRATCH, 'claude')
fs.writeFileSync(FAUX, `#!/usr/bin/env node
const fs = require('fs')
const prompt = process.argv[process.argv.indexOf('-p') + 1]
fs.appendFileSync(${JSON.stringify(RUNS)}, 'run\\n')
const blocs = prompt.split('═══ PIÈCE ').slice(1)
const fiches = blocs.map((b) => {
  const fin = b.indexOf(' ═══')
  const chemin = b.slice(0, fin)
  const noms = [...new Set(b.slice(fin).match(/PERS_[A-Z]+/g) || [])]
  return { chemin, type: 'PV audition', personnes: noms.map((nom) => ({ nom })), resume: 'partie lue' }
})
process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify(fiches), usage: { input_tokens: 10, output_tokens: 10 } }))
`)
fs.chmodSync(FAUX, 0o755)
process.env.SIRAL_ATTACHE_CLAUDE_BIN = FAUX

const { encryptJson, encryptDocBlob } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)
const keyGlobal = crypto.randomBytes(32)
const keyCtx = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': keyCtx.toString('base64') }, 'Audran CHEVALIER')
const keys = loadKeyring()

const NUM = '500/100/2026 - LONG'
fs.writeFileSync(path.join(DATA_DIR, 'vaults', 'ctx-crimorg.json'), JSON.stringify(encryptJson(keyCtx, {
  data: { enquetes: [{ id: 1, numero: NUM, statut: 'en_cours', tags: [], actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [], misEnCause: [] }], version: 1 },
  metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 1 },
})))

const { writeDocBlob, docServerKey, attacheTj } = await import(`${REPO}/scripts/attache/store.mjs`)
const KEY = docServerKey(NUM)
const verse = (rel, texte) => writeDocBlob(attacheTj(), KEY, rel, encryptDocBlob(keyGlobal, Buffer.from(texte, 'utf8')), { savedBy: 'test' })

const PHRASE = 'Le témoin poursuit sa déclaration sans citer personne. '
const remplissage = (n) => PHRASE.repeat(Math.ceil(n / PHRASE.length)).slice(0, n)
// 100 000 caractères : PERS_DEBUT au début, PERS_MILIEU vers 50 000, PERS_FIN tout au bout ; PERS_DEBUT revient au milieu
const LONGUE = 'Audition de PERS_DEBUT. ' + remplissage(50_000) + ' Il cite PERS_MILIEU et PERS_DEBUT. ' + remplissage(50_000) + ' Enfin PERS_FIN.'
verse('PV/D1_longue_audition.txt', LONGUE)
verse('PV/D2_copie_longue.txt', LONGUE) // copie exacte
verse('PV/D3_courte.txt', 'Audition courte de PERS_COURT.')
verse('PV/D4_ancienne_longue.txt', 'Début PERS_ANCIEN. ' + remplissage(20_000) + ' Plus loin PERS_OUBLIE.')

const { ingestPass } = await import(`${REPO}/scripts/attache/ingest.mjs`)
const { registreFichesStep, readRegistre, writeRegistre } = await import(`${REPO}/scripts/attache/registre.mjs`)
await ingestPass(keys)

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}
const runs = () => (fs.existsSync(RUNS) ? fs.readFileSync(RUNS, 'utf8').split('\n').filter(Boolean).length : 0)
const noms = (e) => (e?.fiche?.personnes || []).map((p) => p.nom).sort()

// fiches ANCIENNES (avant le découpage) : sur la courte et sur la longue
let reg = readRegistre(keys, KEY)
attendu('ingestion : 4 entrées au registre', Object.keys(reg.pieces).length === 4, JSON.stringify(Object.keys(reg.pieces)))
reg.pieces['PV/D3_courte.txt'].fiche = { type: 'PV audition', personnes: [{ nom: 'PERS_COURT' }], resume: 'ancienne', majLe: '2026-01-01' }
reg.pieces['PV/D4_ancienne_longue.txt'].fiche = { type: 'PV audition', personnes: [{ nom: 'PERS_ANCIEN' }], resume: 'ancienne', majLe: '2026-01-01' }
writeRegistre(keys, KEY, reg)

// on enchaîne les pas jusqu'à épuisement
let pas = 0
let r
while ((r = await registreFichesStep(keys)) && pas < 40) pas++
reg = readRegistre(keys, KEY)

const longue = reg.pieces['PV/D1_longue_audition.txt']
attendu('pièce longue : fiche INTÉGRALE', longue?.fiche?.integrale === true && longue.fiche.parties === Math.ceil(LONGUE.length / 9_000), JSON.stringify({ integrale: longue?.fiche?.integrale, parties: longue?.fiche?.parties }))
attendu('pièce longue : personnes du début, du milieu et de la fin', JSON.stringify(noms(longue)) === JSON.stringify(['PERS_DEBUT', 'PERS_FIN', 'PERS_MILIEU']), JSON.stringify(noms(longue)))
attendu('pièce longue : construite sur plusieurs lots', pas >= 2, `${pas} pas`)
attendu('pièce longue : plus de fiche en cours', !longue?.ficheEnCours)
const copie = reg.pieces['PV/D2_copie_longue.txt']
attendu('copie exacte : hérite sans relecture', copie?.fiche?.copieDe === 'PV/D1_longue_audition.txt' && copie.fiche.integrale === true, JSON.stringify(copie?.fiche?.copieDe))
const courte = reg.pieces['PV/D3_courte.txt']
attendu('fiche ancienne sur pièce courte : marquée, gardée', courte?.fiche?.integrale === true && courte.fiche.resume === 'ancienne', JSON.stringify(courte?.fiche))
const ancienne = reg.pieces['PV/D4_ancienne_longue.txt']
attendu('fiche ancienne sur pièce longue : refaite en entier', ancienne?.fiche?.integrale === true && noms(ancienne).includes('PERS_OUBLIE'), JSON.stringify(noms(ancienne)))
// 12 tranches + 3 tranches, 8 par lot : 15 tranches → 2 runs ; la copie et la courte n'en coûtent aucun
attendu('aucune lecture superflue', runs() === 2, `${runs()} run(s)`)
attendu('plus rien à faire', r === null)

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) {
  console.log(`\n${echecs.length} échec(s).`)
  process.exit(1)
}
console.log('\nTous les contrôles passent.')
