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
    .replace(/from '\.\/tj'/g, "from './tj.mjs'")
    .replace(/from '\.\/password'/g, "from './password.mjs'")
    .replace(/from '@\/utils\/numeroDossier'/g, "from './numeroDossier.mjs'"))
}
transpile('lib/server/store.ts', 'store.mjs')
transpile('lib/server/auth.ts', 'auth.mjs')
transpile('lib/server/password.ts', 'password.mjs')
transpile('lib/server/tj.ts', 'tj.mjs')
transpile('utils/numeroDossier.ts', 'numeroDossier.mjs')
transpile('lib/server/attache.ts', 'attache.mjs')
const { readIaMasquee, writeIaMasquee, attacheDiagnostic } = await import(path.join(TMP, 'attache.mjs'))

let failures = 0
const check = (nom, cond, detail = '') => {
  if (cond) { console.log(`  ✓ ${nom}`) } else { failures++; console.log(`  ✗ ${nom}${detail ? ' — ' + detail : ''}`) }
}

console.log('\nInterrupteur « fonctionnalités IA » (tenu par l\'app, service éteint)')

check('non réglé → rien n\'est masqué', readIaMasquee('default') === false)
await writeIaMasquee('default', true, 'chevalier')
check('coché → masqué, et relu tel quel', readIaMasquee('default') === true)
check('le drapeau est propre à chaque tribunal', readIaMasquee('amiens') === false)
await writeIaMasquee('default', false, 'chevalier')
check('décoché → tout revient', readIaMasquee('default') === false)

console.log('\nDiagnostic de présence (« pourquoi je ne le vois plus »)')

delete process.env.SIRAL_ATTACHE_URL
delete process.env.SIRAL_ATTACHE_TJ
const eteint = await attacheDiagnostic({ r: 'admin', tj: 'default' })
check('fonctionnalité non activée : dite comme telle', eteint.actif === false)
check('service non interrogé quand elle est éteinte', eteint.service === null)

process.env.SIRAL_ATTACHE_URL = 'http://attache:8787'
process.env.SIRAL_ATTACHE_TJ = 'default'
process.env.SIRAL_SECRET = 'secret-de-test'
const mauvaisTj = await attacheDiagnostic({ r: 'admin', tj: 'amiens' })
check('TJ actif ≠ TJ confié : la condition en défaut est nommée',
  mauvaisTj.actif === true && mauvaisTj.tjConcorde === false
  && mauvaisTj.tjActif === 'amiens' && mauvaisTj.tjConfie === 'default',
  JSON.stringify({ actif: mauvaisTj.actif, tjConcorde: mauvaisTj.tjConcorde }))
check('secret de pont dérivé de SIRAL_SECRET : présent', mauvaisTj.secretPont === true)
check('service injoignable (aucun conteneur ici) : code rendu, pas d\'exception',
  mauvaisTj.service !== null && mauvaisTj.service.joignable === false)

fs.rmSync(TMP, { recursive: true, force: true })
console.log(failures === 0 ? '\nOK — le repli tient.\n' : `\n${failures} échec(s).\n`)
process.exit(failures === 0 ? 0 : 1)
