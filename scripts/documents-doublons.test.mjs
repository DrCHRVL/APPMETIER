/**
 * SIRAL — test du DÉDOUBLONNAGE des pièces de la fiche
 * (utils/documents/dedupeDocuments.ts).
 *
 * Scénario vécu : la même pièce inscrite sous deux ids (deux onglets, deux
 * postes, deux synchronisations) apparaissait 2 ou 3 fois dans la fiche.
 * Vérifie : un chemin = une entrée, la plus récente gagne à la place de la
 * première ; entrées sans chemin distinguées par id ; et, composé à l'union
 * par id des fusions, une pièce DÉPLACÉE (même id) ne ressuscite pas à son
 * ancienne place.
 *
 *   node scripts/documents-doublons.test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-doublons-'))
const { outputText } = ts.transpileModule(fs.readFileSync(path.join(REPO, 'utils/documents/dedupeDocuments.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
fs.writeFileSync(path.join(TMP, 'm.mjs'), outputText)
const { dedupeDocuments } = await import(path.join(TMP, 'm.mjs'))

const d = (id, cheminRelatif, extra = {}) => ({ id, cheminRelatif, ...extra })

// HARBANE : un lot inscrit 3 fois sous des ids différents
let r = dedupeDocuments([d(1, 'PV/A.pdf'), d(2, 'PV/B.pdf'), d(3, 'PV/A.pdf'), d(4, 'PV/A.pdf', { copieCommun: 'ok' }), d(5, 'PV/C.pdf')])
assert.deepEqual(r.map((x) => x.cheminRelatif), ['PV/A.pdf', 'PV/B.pdf', 'PV/C.pdf'], 'ordre de première apparition')
assert.equal(r[0].id, 4, 'la dernière version gagne')
assert.equal(r[0].copieCommun, 'ok')

// entrées sans chemin : jamais confondues entre elles
r = dedupeDocuments([d(1, ''), d(2, ''), d(1, '')])
assert.deepEqual(r.map((x) => x.id), [1, 2])

// composition avec l'union par id de DataMergeService : pièce déplacée sur le poste récent
const unionById = (newer, older) => { const m = new Map(); older.forEach((x) => m.set(x.id, x)); newer.forEach((x) => m.set(x.id, x)); return [...m.values()] }
const older = [d(10, 'Ecoutes/IT.pdf'), d(11, 'PV/D1.pdf')]
const newer = [d(10, 'Geoloc/IT.pdf'), d(11, 'PV/D1.pdf'), d(12, 'PV/D1.pdf')]
r = dedupeDocuments(unionById(newer, older))
assert.deepEqual(r.map((x) => x.cheminRelatif).sort(), ['Geoloc/IT.pdf', 'PV/D1.pdf'], 'pas de résurrection Ecoutes/, pas de doublon D1')

fs.rmSync(TMP, { recursive: true, force: true })
console.log('✓ fiche : une pièce = un chemin, la plus récente gagne, déplacement respecté')
