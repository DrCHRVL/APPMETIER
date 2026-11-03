/**
 * SIRAL — test : les notes d'une personne de la carte ne sont jamais coupées.
 *
 * Avant : plafond de 8 000 caractères appliqué en gardant le DÉBUT — passé ce
 * seuil, chaque nouvel ajout de l'attaché était jeté aussitôt, et les notes du
 * magistrat au-delà étaient rognées.
 *
 *   node scripts/carto-notes-integrales.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-carto-notes-'))
process.env.SIRAL_DATA_DIR = path.join(SCRATCH, 'data')
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')
fs.mkdirSync(path.join(SCRATCH, 'data', 'vaults'), { recursive: true })

const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)
grantKeyring({ global: crypto.randomBytes(32).toString('base64') }, 'test')
const keys = loadKeyring()
const { appendMecNoteEnrichissement, loadOverlay } = await import(`${REPO}/scripts/attache/carto.mjs`)

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

await appendMecNoteEnrichissement(keys, { nom: 'LAMBERT Antoine', notes: `${'Renseignement ancien. '.repeat(500)}FIN-NOTE-1` })
await appendMecNoteEnrichissement(keys, { nom: 'LAMBERT Antoine', notes: 'Nouvel élément : utilise la ligne 07.81.76.72.88 — FIN-NOTE-2' })
const fiche = (loadOverlay(keys)?.mecsExNihilo || []).find((m) => /LAMBERT/.test(m.displayName))
attendu('première note (11 000 car.) conservée en entier', fiche?.notes.includes('FIN-NOTE-1'))
attendu('ajout suivant CONSERVÉ au-delà de 8 000 car.', fiche?.notes.includes('FIN-NOTE-2'), `${fiche?.notes.length} car.`)

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) { console.log(`\n${echecs.length} échec(s).`); process.exit(1) }
console.log('\nTous les tests passent.')
