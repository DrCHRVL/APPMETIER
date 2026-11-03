/**
 * SIRAL — test du TRANSFERT D'UNE PIÈCE VERS UN AUTRE DOSSIER
 * (lib/server/store.ts · transferDoc — pièce signalée comme mal classée).
 *
 * Vérifie :
 *   - l'original chiffré change de dossier SANS être réécrit (octets identiques) ;
 *   - l'entrée d'index suit (empreinte, date de dépôt, auteur conservés) ;
 *   - le jumeau markdown suit ;
 *   - la pochette d'origine vidée disparaît ;
 *   - refus d'écraser une pièce du dossier cible, refus du même dossier,
 *     refus d'une pièce inexistante — sans rien toucher ;
 *   - l'attaché retrouve et lit la pièce dans son nouveau dossier.
 *
 *   node scripts/doc-transfert.test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-transfert-'))
const DATA = path.join(TMP, 'data')
fs.mkdirSync(path.join(DATA, 'vaults'), { recursive: true })
process.env.SIRAL_DATA_DIR = DATA
process.env.SIRAL_ATTACHE_TJ = 'default'
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { outputText } = ts.transpileModule(fs.readFileSync(path.join(REPO, 'lib/server/store.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
fs.writeFileSync(path.join(TMP, 'store.mjs'), outputText)
const store = await import(path.join(TMP, 'store.mjs'))

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

// Les clés serveur : celles de l'app (bridge.serverKey) et de l'attaché (docServerKey).
const { docServerKey } = await import(`${REPO}/scripts/attache/store.mjs`)
const A = '100/1/2026 - STUP AMIENS'
const B = '200/2/2026 - STUP ABBEVILLE'
const KA = docServerKey(A)
const KB = docServerKey(B)
const TJ = 'default'

const { encryptDocBlob } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)
const keyGlobal = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': crypto.randomBytes(32).toString('base64') }, 'Audran CHEVALIER')
const keys = loadKeyring()
const blob = (t) => encryptDocBlob(keyGlobal, Buffer.from(t, 'utf8'))

const REL = 'Ecoutes/2026-04/R7_0622.txt'
const original = blob('Retranscription ligne 06 22 22 22 22 : MARTIN Paul appelle LEROY Sami.')
await store.saveDoc(TJ, KA, REL, original, { savedBy: 'juriste', sha: 'a'.repeat(64), originalName: 'R7.txt' })
await store.saveDoc(TJ, KA, 'MD/Ecoutes/2026-04/R7_0622.md', blob('copie markdown'), { savedBy: 'juriste' })
await store.saveDoc(TJ, KA, 'PV/D1.txt', blob('pièce de A'), { savedBy: 'juriste' })
await store.saveDoc(TJ, KB, 'Ecoutes/R1_0622.txt', blob('pièce de B'), { savedBy: 'juriste' })
const avant = JSON.parse(fs.readFileSync(store.docMetaPath(TJ, KA), 'utf8')).find((d) => d.rel === REL)

// refus — rien ne bouge
const refus = async (fn) => { try { await fn(); return null } catch (e) { return e.message } }
attendu('refus : même dossier', Boolean(await refus(() => store.transferDoc(TJ, KA, REL, KA))))
attendu('refus : pièce inexistante', Boolean(await refus(() => store.transferDoc(TJ, KA, 'PV/absente.txt', KB))))
await store.saveDoc(TJ, KB, 'PV/D1.txt', blob('homonyme dans B'), { savedBy: 'juriste' })
attendu('refus : jamais d\'écrasement dans le dossier cible', /existe déjà/.test(await refus(() => store.transferDoc(TJ, KA, 'PV/D1.txt', KB)) || ''))
attendu('après les refus, la pièce est toujours dans A', Boolean(store.readDoc(TJ, KA, 'PV/D1.txt')) && Boolean(store.readDoc(TJ, KA, REL)))

// le transfert
const meta = await store.transferDoc(TJ, KA, REL, KB)
attendu('l\'original a quitté A', store.readDoc(TJ, KA, REL) === null)
attendu('octets identiques dans B (rien n\'est réécrit)', Buffer.compare(store.readDoc(TJ, KB, REL), original) === 0)
const indexA = JSON.parse(fs.readFileSync(store.docMetaPath(TJ, KA), 'utf8'))
const indexB = JSON.parse(fs.readFileSync(store.docMetaPath(TJ, KB), 'utf8'))
const entreeB = indexB.find((d) => d.rel === REL)
attendu('index : sorti de A, entré dans B', !indexA.some((d) => d.rel === REL) && Boolean(entreeB))
attendu('index : empreinte, date de dépôt et auteur conservés',
  entreeB?.sha === avant.sha && entreeB.savedAt === avant.savedAt && entreeB.savedBy === 'juriste' && entreeB.originalName === 'R7.txt' && meta.rel === REL,
  JSON.stringify(entreeB))
attendu('le jumeau markdown suit', store.readDoc(TJ, KA, 'MD/Ecoutes/2026-04/R7_0622.md') === null
  && Boolean(store.readDoc(TJ, KB, 'MD/Ecoutes/2026-04/R7_0622.md'))
  && indexB.some((d) => d.rel === 'MD/Ecoutes/2026-04/R7_0622.md') && !indexA.some((d) => d.rel.startsWith('MD/Ecoutes/2026-04')))
attendu('la pochette d\'origine vidée disparaît', !fs.existsSync(path.join(DATA, 'tjs', TJ, 'docs', KA, 'Ecoutes', '2026-04'))
  && !fs.existsSync(path.dirname(store.docPath(TJ, KA, REL))))
attendu('les autres pièces de A ne bougent pas', Boolean(store.readDoc(TJ, KA, 'PV/D1.txt')))

// l'attaché la lit à sa nouvelle place
const { texteDocumentIntegral } = await import(`${REPO}/scripts/attache/dossier.mjs`)
const lu = await texteDocumentIntegral(keys, KB, REL)
attendu('l\'attaché lit la pièce dans son nouveau dossier', lu.ok && lu.texte.includes('MARTIN Paul'), JSON.stringify(lu).slice(0, 120))

fs.rmSync(TMP, { recursive: true, force: true })
if (echecs.length) {
  console.log(`\n${echecs.length} échec(s).`)
  process.exit(1)
}
console.log('\nTous les contrôles passent.')
