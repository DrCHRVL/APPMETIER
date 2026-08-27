/**
 * SIRAL — le texte des pièces servi depuis le serveur.
 *
 * C'est un chemin qui ne peut PAS échouer bruyamment : si le serveur ne
 * retrouve pas le cache, il répond « rien », le navigateur extrait lui-même, et
 * tout continue de fonctionner — en apparence. La panne serait invisible, et
 * chaque poste se remettrait à analyser tous les PDF pour son compte, sans
 * océrisation. D'où ce test, qui vérifie la chaîne complète sur un faux
 * dossier : l'attaché écrit, le serveur retrouve, le navigateur ouvre.
 *
 *   node scripts/doc-texte.test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { docCacheBasename } from '../lib/documents/docCacheCore.mjs'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-doctexte-'))
const DATA = path.join(TMP, 'data')
process.env.SIRAL_DATA_DIR = DATA
process.env.SIRAL_ATTACHE_TJ = 'default'

let echecs = 0
const ok = (cond, libelle, detail = '') => {
  if (cond) console.log(`  ✓ ${libelle}`)
  else { echecs++; console.error(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`) }
}

// ── Le module serveur, transpilé (TypeScript pur : fs, path, crypto) ──
function compile(rel) {
  const nom = path.basename(rel).replace(/\.ts$/, '')
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(REPO, rel), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  const js = outputText
    .replace(/from\s*['"]@\/(lib\/[^'"]+\.mjs)['"]/g, (_, m) => `from '${path.join(REPO, m)}'`)
    .replace(/from\s*['"]\.\/store['"]/g, "from './store.mjs'")
  fs.writeFileSync(path.join(TMP, `${nom}.mjs`), js)
}
compile('lib/server/store.ts')
compile('lib/server/docTexte.ts')
const { lireTexteEnCache } = await import(path.join(TMP, 'docTexte.mjs'))

// ── Chiffrement de l'attaché (miroir de scripts/attache/crypto.mjs) ──
const CLE = crypto.randomBytes(32)
function encryptJson(rawKey, payload) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', rawKey, iv)
  const data = Buffer.from(JSON.stringify(payload), 'utf8')
  const ct = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()])
  return { v: 1, encrypted: true, iv: iv.toString('base64'), ct: ct.toString('base64') }
}
function decryptJson(rawKey, env) {
  const iv = Buffer.from(env.iv, 'base64')
  const blob = Buffer.from(env.ct, 'base64')
  const decipher = crypto.createDecipheriv('aes-256-gcm', rawKey, iv)
  decipher.setAuthTag(blob.subarray(blob.length - 16))
  return JSON.parse(Buffer.concat([decipher.update(blob.subarray(0, blob.length - 16)), decipher.final()]).toString('utf8'))
}

// ── Un faux dossier : une pièce chiffrée sur le disque ──
const ENQUETE = '2026_9026'
const REL = 'PV/synthese.pdf'
const TEXTE = 'Procès-verbal de synthèse. MOKRANI Mickael, ligne 06 79 55 13 84.'

const dirDoc = path.join(DATA, 'docs', ENQUETE, 'PV')
fs.mkdirSync(dirDoc, { recursive: true })
const blob = crypto.randomBytes(4096) // le blob chiffré, opaque par nature
fs.writeFileSync(path.join(DATA, 'docs', ENQUETE, REL + '.enc'), blob)
const empreinteBlob = crypto.createHash('sha256').update(blob).digest('hex')

const dirCache = path.join(DATA, 'attache', 'doccache')
fs.mkdirSync(dirCache, { recursive: true })
const ecrireCache = (texte, blobHash, variante = '') => {
  fs.writeFileSync(
    path.join(dirCache, docCacheBasename(ENQUETE, REL, variante) + '.json'),
    JSON.stringify(encryptJson(CLE, { v: 2, chemin: REL, blobHash, texte, extraitLe: new Date().toISOString() })),
  )
}

console.log('\nLe serveur retrouve ce que l\'attaché a écrit :')
ok(lireTexteEnCache('default', ENQUETE, REL) === null, 'aucun cache : le serveur répond « rien » (le navigateur extraira)')

ecrireCache(TEXTE, empreinteBlob)
const trouve = lireTexteEnCache('default', ENQUETE, REL)
ok(trouve !== null, 'cache écrit par l\'attaché : le serveur le retrouve')
ok(trouve && decryptJson(CLE, trouve.envelope).texte === TEXTE,
  'l\'enveloppe s\'ouvre avec la clé globale et rend le texte intact')
ok(trouve && trouve.blobHash === empreinteBlob,
  'le serveur joint l\'empreinte de la pièce EN PLACE, pour que le navigateur juge de la fraîcheur')

console.log('\nUne pièce re-téléversée ne doit jamais servir son ancien texte :')
const perime = decryptJson(CLE, lireTexteEnCache('default', ENQUETE, REL).envelope)
ok(perime.blobHash === empreinteBlob, 'cache à jour : les deux empreintes concordent')
fs.writeFileSync(path.join(DATA, 'docs', ENQUETE, REL + '.enc'), crypto.randomBytes(4096)) // nouvelle version
const apres = lireTexteEnCache('default', ENQUETE, REL)
ok(apres !== null, 'le cache est toujours servi…')
ok(apres && decryptJson(CLE, apres.envelope).blobHash !== apres.blobHash,
  '…mais les empreintes DIVERGENT : le navigateur écartera ce texte périmé')

console.log('\nLa lecture océrisée prime sur la lecture ordinaire :')
const empreinteNouvelle = crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(DATA, 'docs', ENQUETE, REL + '.enc'))).digest('hex')
ecrireCache('texte ordinaire', empreinteNouvelle)
ecrireCache('texte océrisé, pages images comprises', empreinteNouvelle, 'integrale')
const complet = lireTexteEnCache('default', ENQUETE, REL)
ok(complet && decryptJson(CLE, complet.envelope).texte === 'texte océrisé, pages images comprises',
  'entre les deux variantes, c\'est la plus complète qui est servie')

console.log('\nLa pièce disparue :')
fs.rmSync(path.join(DATA, 'docs', ENQUETE, REL + '.enc'))
ok(lireTexteEnCache('default', ENQUETE, REL) === null,
  'plus de pièce sur le disque : plus de texte servi (pas de fantôme)')

console.log('')
fs.rmSync(TMP, { recursive: true, force: true })
if (echecs > 0) {
  console.error(`${echecs} vérification(s) en échec.`)
  process.exit(1)
}
console.log('Texte des pièces servi par le serveur : la chaîne complète tient.\n')
