// Base de connaissances : une fiche de plus de 400 000 caractères (ex. QD)
// est conservée EN ENTIER, se lit page par page (kb_lire) et kb_chercher
// donne l'offset d'une occurrence lointaine.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-kb-longue-test-'))
const DATA_DIR = path.join(SCRATCH, 'data')
fs.mkdirSync(path.join(DATA_DIR, 'vaults'), { recursive: true })
process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)
grantKeyring({ global: crypto.randomBytes(32).toString('base64') }, 'Test')
const keys = loadKeyring()
const { saveKbEntry, readKbEntryPage, searchKb, KB_PAGE_MAX } = await import(`${REPO}/scripts/attache/kb.mjs`)

try {
  const contenu = 'Abus de confiance. '.repeat(40_000) + 'VOL AGGRAVÉ — art. 311-4' + ' Violences.'.repeat(40_000) + ' FIN-V'
  assert.ok(contenu.length > 1_000_000)
  const { id } = await saveKbEntry(keys, { titre: 'QD test', categorie: 'fiche', contenu })

  let offset = 0, lu = '', pages = 0, p
  do {
    p = readKbEntryPage(keys, id, { offset })
    assert.ok(p.contenu.length <= KB_PAGE_MAX)
    assert.equal(p.longueurTotale, contenu.length)
    assert.ok(Object.keys(p).indexOf('contenu') === Object.keys(p).length - 1, 'contenu en dernier')
    lu += p.contenu; pages++; offset = p.offsetSuivant
  } while (offset)
  assert.equal(lu, contenu, 'fiche relue en entier')
  assert.ok(pages >= 8)

  const [hit] = searchKb(keys, { requete: 'vol aggrave 311-4' })
  assert.equal(hit.id, id)
  const passage = readKbEntryPage(keys, id, { offset: hit.offset, limite: 5_000 })
  assert.ok(passage.contenu.includes('VOL AGGRAVÉ'))
  console.log('ok — kb longue :', contenu.length, 'caractères,', pages, 'pages')
} finally {
  fs.rmSync(SCRATCH, { recursive: true, force: true })
}
