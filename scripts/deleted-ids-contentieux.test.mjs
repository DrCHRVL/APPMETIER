/**
 * SIRAL — tombstones d'enquête RATTACHÉS au contentieux.
 *
 * Les ids d'enquête sont attribués par contentieux (crimorg #2, ecofi #2…).
 * Un tombstone global ferait disparaître, à la fusion, l'enquête de même numéro
 * d'un AUTRE contentieux. On vérifie ici le cœur du correctif : le filtrage par
 * contentieux (scopeEnqueteTombstones) et la clé de dédoublonnage, transpilés à
 * la volée depuis le vrai module de l'app — pas une copie qui dérive.
 *
 *   node scripts/deleted-ids-contentieux.test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function importTs(rel) {
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8')
  const js = ts.transpileModule(src, {
    compilerOptions: { module: 'ES2020', target: 'ES2020' },
  }).outputText
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  return import(dataUrl)
}

let failed = 0
function check(label, cond) {
  if (cond) { console.log('  ✓ ' + label) }
  else { console.error('  ✗ ' + label); failed++ }
}

const { scopeEnqueteTombstones, enqueteTombstoneKey } = await importTs('utils/dataSync/deletedEnqueteScope.ts')

console.log('\nFiltrage par contentieux')
const tombs = [
  { id: 2, contentieux: 'crimorg', deletedAt: '2026-01-01T00:00:00Z' },
  { id: 5, contentieux: 'ecofi', deletedAt: '2026-01-02T00:00:00Z' },
  { id: 9 /* vestige global, sans contentieux */, deletedAt: '2025-01-01T00:00:00Z' },
]

const crim = scopeEnqueteTombstones(tombs, 'crimorg')
check('crimorg voit sa suppression #2', crim.includes(2))
check('crimorg hérite du vestige global #9', crim.includes(9))
check("crimorg NE voit PAS la suppression ecofi #5", !crim.includes(5))

const eco = scopeEnqueteTombstones(tombs, 'ecofi')
check("ecofi NE voit PAS la suppression crimorg #2 (bug corrigé)", !eco.includes(2))
check('ecofi voit sa suppression #5', eco.includes(5))
check('ecofi hérite du vestige global #9', eco.includes(9))

console.log('\nRobustesse')
check('entrée non-tableau → liste vide', scopeEnqueteTombstones(undefined, 'crimorg').length === 0)
check('tombstone malformé ignoré', scopeEnqueteTombstones([{ contentieux: 'crimorg' }, null], 'crimorg').length === 0)

console.log('\nClé de dédoublonnage (contentieux, id)')
check('même id, contentieux différents → clés distinctes',
  enqueteTombstoneKey({ id: 2, contentieux: 'crimorg' }) !== enqueteTombstoneKey({ id: 2, contentieux: 'ecofi' }))
check('même couple → clé identique',
  enqueteTombstoneKey({ id: 2, contentieux: 'crimorg' }) === enqueteTombstoneKey({ id: 2, contentieux: 'crimorg' }))
check('vestige (sans contentieux) ≠ tombstone rattaché, même id',
  enqueteTombstoneKey({ id: 2 }) !== enqueteTombstoneKey({ id: 2, contentieux: 'crimorg' }))

if (failed) { console.error(`\n❌ ${failed} échec(s)`); process.exit(1) }
console.log('\n✅ TOUS LES TESTS PASSENT')
