/**
 * SIRAL — test du RENOMMAGE D'UN DOSSIER : les pièces suivent
 * (lib/server/store.ts · rekeyDocs).
 *
 * Le numéro du dossier est la clé de rangement de ses pièces. Vérifie :
 *   - clé cible vierge : tout le rangement suit, octets intacts, index compris ;
 *   - clé cible occupée : fusion pièce par pièce, homonyme JAMAIS écrasé
 *     (resté sous l'ancienne clé, rendu dans `conflits`) ;
 *   - ancienne clé absente / identique : rien ne bouge ;
 *   - la clé du client (folderUpload.docServerKey) est celle de l'attaché.
 *
 *   node scripts/doc-rekey.test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-rekey-'))
process.env.SIRAL_DATA_DIR = path.join(TMP, 'data')
const transpile = (rel, out) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(REPO, rel), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  fs.writeFileSync(path.join(TMP, out), outputText)
  return import(path.join(TMP, out))
}
const store = await transpile('lib/server/store.ts', 'store.mjs')
const { docServerKey: cleClient } = await transpile('lib/web/folderUpload.ts', 'folderUpload.mjs')
const { docServerKey: cleAttache } = await import(`${REPO}/scripts/attache/store.mjs`)

for (const n of ['2025/14076 GUYNEMER  point de deal ', ' 75227/876/2025 - GAMBET', '\t 25206000044', '2026/    11 vol roulottes']) {
  assert.equal(cleClient(n), cleAttache(n), `même clé client/attaché pour « ${n} »`)
}

const TJ = 'default'
const A = cleClient('2025/14076')
const B = cleClient('2025/14076 GUYNEMER')
const C = cleClient('2025/14076 GUYNEMER point de deal')
const octets = Buffer.from('SIR1-blob-chiffre-1')
await store.saveDoc(TJ, A, 'Actes/Saisie.pdf', octets, { savedBy: 'magistrat', sha: 'a'.repeat(64) })
await store.saveDoc(TJ, A, 'MD/Actes/Saisie.md', Buffer.from('md'), { savedBy: 'magistrat' })

// A → B (vierge) : le rangement suit en bloc
let r = await store.rekeyDocs(TJ, A, B)
assert.equal(r.deplacees, 2)
assert.deepEqual(store.listDocs(TJ, A), [])
assert.deepEqual(store.readDoc(TJ, B, 'Actes/Saisie.pdf'), octets)
assert.equal(store.listDocs(TJ, B).find((d) => d.rel === 'Actes/Saisie.pdf').sha, 'a'.repeat(64))

// B → C alors que C a déjà une pièce homonyme et une autre
await store.saveDoc(TJ, C, 'Actes/Saisie.pdf', Buffer.from('autre-version'), { savedBy: 'x' })
await store.saveDoc(TJ, C, 'PV/D1.pdf', Buffer.from('d1'), { savedBy: 'x' })
r = await store.rekeyDocs(TJ, B, C)
assert.equal(r.deplacees, 1, 'le jumeau MD suit')
assert.deepEqual(r.conflits, ['Actes/Saisie.pdf'])
assert.deepEqual(store.readDoc(TJ, C, 'Actes/Saisie.pdf'), Buffer.from('autre-version'), 'jamais écrasé')
assert.deepEqual(store.readDoc(TJ, B, 'Actes/Saisie.pdf'), octets, 'homonyme conservé sous l\'ancienne clé')
assert.deepEqual(store.listDocs(TJ, B).map((d) => d.rel), ['Actes/Saisie.pdf'])
assert.ok(store.listDocs(TJ, C).some((d) => d.rel === 'MD/Actes/Saisie.md'))

// sans objet
assert.deepEqual(await store.rekeyDocs(TJ, cleClient('inexistant'), C), { deplacees: 0, conflits: [] })
assert.deepEqual(await store.rekeyDocs(TJ, C, C), { deplacees: 0, conflits: [] })
await assert.rejects(store.rekeyDocs(TJ, '../x', C))

fs.rmSync(TMP, { recursive: true, force: true })
console.log('✓ renommage : pièces déplacées, fusion sans écrasement, clés client/attaché identiques')
