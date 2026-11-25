/**
 * SIRAL — test : un run dont le CLI signale une erreur d'API (is_error, alors
 * que subtype vaut « success ») n'est PAS compté comme réussi. Sans cela,
 * l'actualisation de description affichait « terminé sans écrire de
 * description » au lieu de la vraie cause (forfait épuisé, prompt trop long…).
 *
 *   node scripts/attache-run-is-error.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-is-error-test-'))
process.env.SIRAL_DATA_DIR = path.join(SCRATCH, 'data')
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const FAUX = path.join(SCRATCH, 'claude')
fs.writeFileSync(FAUX, `#!/usr/bin/env node
require('fs').readFileSync(0, 'utf8')
const erreur = process.env.FAUX_ERREUR === '1'
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: erreur, result: erreur ? 'Prompt is too long' : 'fait', usage: { input_tokens: 1, output_tokens: 1 } }) + '\\n')
`)
fs.chmodSync(FAUX, 0o755)
process.env.SIRAL_ATTACHE_CLAUDE_BIN = FAUX

const { runAgent } = await import(`${REPO}/scripts/attache/agent.mjs`)

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

const keys = {}
process.env.FAUX_ERREUR = '1'
const r = await runAgent({ keys, prompt: 'test', timeoutMs: 30_000 })
attendu('is_error → run en échec', r.ok === false, JSON.stringify({ ok: r.ok, error: r.error }))
attendu('la cause remonte au magistrat', /Prompt is too long/.test(String(r.error)), String(r.error))

process.env.FAUX_ERREUR = '0'
const r2 = await runAgent({ keys, prompt: 'test', timeoutMs: 30_000 })
attendu('run normal → réussi', r2.ok === true, JSON.stringify({ ok: r2.ok, error: r2.error }))

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) { console.log(`\n${echecs.length} échec(s).`); process.exit(1) }
console.log('\nTous les tests passent.')
