/**
 * SIRAL — l'assistant de justice a-t-il vraiment disparu ?
 *
 * Retour de terrain : « je n'ai plus d'assistant de justice — plus les
 * paramètres, plus la page, plus le raccourci, plus les actes rédigés ». Rien
 * n'avait été supprimé : une SEULE sonde (`/api/attache/status`) commandait tout
 * le module, et elle échouait fermée. Un conteneur attaché arrêté, un secret de
 * pont dépareillé ou une machine saturée effaçaient l'assistant de
 * l'application, sans un mot.
 *
 * Ce test couvre le repli qui rend l'épisode impossible à répéter en silence :
 * les actes rédigés se lisent depuis le volume partagé quand le service dort —
 * sans jamais mélanger deux dossiers voisins, l'app n'ayant aucune clé pour les
 * départager.
 *
 *   node scripts/attache-presence.test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-presence-'))
const DATA = path.join(TMP, 'data')
process.env.SIRAL_DATA_DIR = DATA

// Transpilation des modules serveur (TS → ESM), imports réécrits vers le tmp.
const transpile = (rel, out) => {
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  fs.writeFileSync(path.join(TMP, out), outputText
    .replace(/from '\.\/store'/g, "from './store.mjs'")
    .replace(/from '\.\/auth'/g, "from './auth.mjs'")
    .replace(/from '@\/utils\/numeroDossier'/g, "from './numeroDossier.mjs'"))
}
transpile('lib/server/store.ts', 'store.mjs')
transpile('lib/server/auth.ts', 'auth.mjs')
transpile('utils/numeroDossier.ts', 'numeroDossier.mjs')
transpile('lib/server/attache.ts', 'attache.mjs')
const { readProductionEnvelopes } = await import(path.join(TMP, 'attache.mjs'))

let failures = 0
const check = (nom, cond, detail = '') => {
  if (cond) { console.log(`  ✓ ${nom}`) } else { failures++; console.log(`  ✗ ${nom}${detail ? ' — ' + detail : ''}`) }
}

// Le TJ « default » reste sur les chemins historiques : data/attache/…
const racine = path.join(DATA, 'attache', 'productions')
const enveloppe = (id) => ({ v: 1, encrypted: true, iv: id + 'iv', ct: id + 'ct' })
const deposer = (dirKey, id) => {
  fs.mkdirSync(path.join(racine, dirKey), { recursive: true })
  fs.writeFileSync(path.join(racine, dirKey, id + '.json'), JSON.stringify(enveloppe(id)))
}

console.log('\nRepli de lecture des actes rédigés (service attaché endormi)')

check('aucun répertoire de productions → liste vide, pas d\'exception',
  readProductionEnvelopes('85103/843/2026').length === 0)

// Répertoire EXACT du dossier (docServerKey remplace / et espaces par « _ »).
deposer('85103_843_2026_-_GRIVESNES_2', 'aa11bb22')
// Même dossier rangé sous une AUTRE écriture : la clé se réduit au même numéro.
deposer('85103_843_2026_-_grivesnes.2', 'cc33dd44')
// Dossier VOISIN : son numéro normalisé diffère — il ne doit jamais remonter.
deposer('85103_843_2026_-_GRIVESNES', 'ee55ff66')
// Actes hors dossier : pseudo-dossier, aucun rapprochement de variantes. Son
// répertoire porte le préfixe « e_ » de docServerKey (une clé ne commence
// jamais par un caractère non alphanumérique).
deposer('e__hors-dossier', '778899aa')

const actes = readProductionEnvelopes('85103/843/2026 - GRIVESNES 2')
const ids = actes.map((a) => a.id).sort()
check('le répertoire exact est lu', ids.includes('aa11bb22'))
check('une écriture variante du MÊME numéro est reprise', ids.includes('cc33dd44'))
check('le dossier voisin (« …GRIVESNES ») reste dehors', !ids.includes('ee55ff66'), ids.join(', '))
check('les actes hors dossier ne s\'invitent pas', !ids.includes('778899aa'))
check('aucun doublon', new Set(ids).size === ids.length)
check('les enveloppes sont rendues telles quelles (le navigateur déchiffre)',
  actes.every((a) => a.envelope?.encrypted === true && typeof a.envelope.ct === 'string'))

const hors = readProductionEnvelopes('_hors-dossier')
check('« _hors-dossier » ne lit que son propre répertoire',
  hors.length === 1 && hors[0].id === '778899aa')

// Un fichier parasite à la racine ne doit pas faire tomber la lecture.
fs.writeFileSync(path.join(racine, 'note.txt'), 'parasite')
check('un fichier isolé à la racine ne casse rien',
  readProductionEnvelopes('85103/843/2026 - GRIVESNES 2').length === 2)

fs.rmSync(TMP, { recursive: true, force: true })
console.log(failures === 0 ? '\nOK — le repli tient.\n' : `\n${failures} échec(s).\n`)
process.exit(failures === 0 ? 0 : 1)
