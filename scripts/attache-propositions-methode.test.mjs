/**
 * SIRAL — test des propositions de MÉTHODE (trame / skill) : résumé et motif.
 *
 * Le magistrat lit en tête un RÉSUMÉ d'une phrase, puis déplie le MOTIF. Ce
 * test vérifie qu'aucun des deux n'est jamais coupé :
 *   - sans résumé ⇒ refusé ;
 *   - résumé trop long ⇒ refusé (l'attaché reformule), jamais tronqué ;
 *   - motif très long ⇒ conservé ENTIER.
 *
 *   node scripts/attache-propositions-methode.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-methode-test-'))
const DATA_DIR = path.join(SCRATCH, 'siral-test-data')
fs.mkdirSync(path.join(DATA_DIR, 'vaults'), { recursive: true })

process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)
grantKeyring({ global: crypto.randomBytes(32).toString('base64') }, 'Audran CHEVALIER')
const keys = loadKeyring()

const { addProposition, listPropositions } = await import(`${REPO}/scripts/attache/propositions.mjs`)

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}
async function erreur(fn) {
  try { await fn(); return null } catch (e) { return String(e?.message || e) }
}

const contenu = 'Vu l\'article 76 du code de procédure pénale ;\n'.repeat(10)
const motifLong = 'Le JLD a rejeté partiellement la requête au regard de l\'article 8 de la CEDH. '.repeat(60).trim()
const propose = (payload) => addProposition(keys, { type: 'trame', payload: { nom: 'enq-art-76', contenu, ...payload }, source: 'test' })

const sansResume = await erreur(() => propose({ motif: 'Pourquoi.' }))
attendu('sans résumé : refusé', /Résumé requis/.test(sansResume || ''), sansResume)

const tropLong = await erreur(() => propose({ resume: 'x'.repeat(241), motif: 'Pourquoi.' }))
attendu('résumé trop long : refusé (jamais coupé)', /trop long/.test(tropLong || ''), tropLong)

const ok = await propose({ resume: 'Ajoute un attendu de nécessité et de proportionnalité.', motif: motifLong })
attendu('proposition déposée', Boolean(ok.id), JSON.stringify(ok))

const p = listPropositions(keys).find((x) => x.type === 'trame')
attendu('motif conservé entier', p?.payload.motif === motifLong, `${p?.payload.motif?.length} / ${motifLong.length} caractères`)
attendu('résumé conservé', p?.payload.resume === 'Ajoute un attendu de nécessité et de proportionnalité.')

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) {
  console.error(`\n${echecs.length} test(s) en échec : ${echecs.join(' · ')}`)
  process.exit(1)
}
console.log('\nTous les tests passent.')
