/**
 * SIRAL — test : le prompt part au CLI par l'ENTRÉE STANDARD.
 *
 * Un argv unitaire est plafonné à 128 Kio sous Linux (E2BIG) : un dossier
 * joint en entier le dépasse. Un faux CLI renvoie la taille et la fin du
 * prompt reçu ; un prompt de 300 000 caractères accentués doit arriver intact.
 *
 *   node scripts/attache-prompt-stdin.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-stdin-test-'))
process.env.SIRAL_DATA_DIR = path.join(SCRATCH, 'data')
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const FAUX = path.join(SCRATCH, 'claude')
fs.writeFileSync(FAUX, `#!/usr/bin/env node
const prompt = require('fs').readFileSync(0, 'utf8')
const result = JSON.stringify({ longueur: prompt.length, fin: prompt.slice(-20) })
process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result, usage: { input_tokens: 1, output_tokens: 1 } }))
`)
fs.chmodSync(FAUX, 0o755)
process.env.SIRAL_ATTACHE_CLAUDE_BIN = FAUX

const { runClaudeJson } = await import(`${REPO}/scripts/attache/analyse.mjs`)

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

const prompt = 'é'.repeat(300_000) + 'FIN-DU-DOSSIER'
const r = await runClaudeJson(prompt, { timeoutMs: 30_000 })
const recu = r.data
attendu('prompt de 300 000 caractères (≈ 600 Kio) lancé sans E2BIG', r.ok, JSON.stringify(r).slice(0, 200))
attendu('prompt reçu INTACT par le CLI', recu?.longueur === prompt.length && recu?.fin.endsWith('FIN-DU-DOSSIER'), JSON.stringify(recu))

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) { console.log(`\n${echecs.length} échec(s).`); process.exit(1) }
console.log('\nTous les tests passent.')
