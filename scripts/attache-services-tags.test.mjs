/**
 * SIRAL — test des SERVICES d'enquête écrits par le connecteur.
 *
 * L'écran lit les services dans les tags « services » de l'enquête : un
 * dossier créé/modifié par creer_dossier / modifier_dossier doit donc porter
 * ces tags, rapprochés du référentiel (coffre `tags`).
 *
 *   node scripts/attache-services-tags.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-services-test-'))
const DATA_DIR = path.join(SCRATCH, 'siral-test-data')
fs.mkdirSync(path.join(DATA_DIR, 'vaults'), { recursive: true })

process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { encryptJson } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)

const keyGlobal = crypto.randomBytes(32)
const keyCtx = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': keyCtx.toString('base64') }, 'Audran CHEVALIER')
const keys = loadKeyring()

const ecrire = (nom, cle, contenu) => fs.writeFileSync(
  path.join(DATA_DIR, 'vaults', `${nom}.json`), JSON.stringify(encryptJson(cle, contenu)))

ecrire('ctx-crimorg', keyCtx, {
  data: {
    enquetes: [{ id: 1, numero: 'EXISTANT', dateDebut: '2026-01-01', statut: 'en_cours', description: '',
      tags: [{ id: 'suivi-JIRS', value: 'JIRS', category: 'suivi' }], services: [] }],
    customTags: [], version: 1,
  },
  metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 1 },
})
ecrire('tags', keyGlobal, {
  customTags: [
    { id: 't-gir', value: 'GIR', category: 'services' },
    { id: 't-oltim', value: 'OLTIM', category: 'services' },
    { id: 't-cob', value: 'COB DOMART EN PONTHIEU', category: 'services' },
    { id: 't-br', value: 'BR', category: 'services' },
    { id: 't-bra', value: 'BR ABBEVILLE', category: 'services' },
    { id: 't-x', value: 'JIRS', category: 'suivi' },
  ],
})

const { creerDossier, modifierDossier, loadContentieux } = await import(`${REPO}/scripts/attache/dossier.mjs`)

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}
const enquete = (num) => loadContentieux(keys).data.enquetes.find((e) => e.numero === num)
const servicesTags = (e) => (e.tags || []).filter((t) => t.category === 'services')

const r = await creerDossier(keys, { numero: 'NOUVEAU', services: ['oltim', 'GIR Amiens', 'COB Domart-en-Ponthieu'] })
const e = enquete('NOUVEAU')
attendu('création : tags services écrits (lus par l\'écran)',
  JSON.stringify(servicesTags(e).map((t) => [t.id, t.value])) === JSON.stringify([['t-oltim', 'OLTIM'], ['t-gir', 'GIR'], ['t-cob', 'COB DOMART EN PONTHIEU']]),
  JSON.stringify(servicesTags(e)))
attendu('création : services[] synchronisé', JSON.stringify(e.services) === JSON.stringify(['OLTIM', 'GIR', 'COB DOMART EN PONTHIEU']))
attendu('création : pas d\'avertissement quand tout est au référentiel', !r.servicesHorsReferentiel)

const r2 = await creerDossier(keys, { numero: 'INCONNU', services: ['BR Abbeville', 'Police municipale'] })
const e2 = enquete('INCONNU')
attendu('rapprochement : l\'entrée la plus longue l\'emporte', servicesTags(e2)[0]?.value === 'BR ABBEVILLE')
attendu('hors référentiel : conservé et signalé',
  servicesTags(e2)[1]?.value === 'Police municipale' && r2.servicesHorsReferentiel?.[0] === 'Police municipale' && r2.servicesConnus?.includes('GIR'))

const r3 = await modifierDossier(keys, { numero: 'EXISTANT', services: ['gir'] })
const e3 = enquete('EXISTANT')
attendu('modification : tags services remplacés, autres tags conservés',
  servicesTags(e3).length === 1 && servicesTags(e3)[0].value === 'GIR' && e3.tags.some((t) => t.category === 'suivi'),
  JSON.stringify(e3.tags))
attendu('modification : retour sans avertissement', !r3.servicesHorsReferentiel)

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) { console.error(`\n${echecs.length} échec(s)`); process.exit(1) }
console.log('\nOK')
