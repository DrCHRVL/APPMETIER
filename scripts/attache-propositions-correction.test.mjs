/**
 * SIRAL — test de la CORRECTION et du RETRAIT des propositions en attente.
 *
 * Cas d'origine : un dossier ex nihilo proposé avec « EL BOUZIANI Sofian »
 * alors que SIRAL connaît « EL BOUZIANI Sofiane » — la validation aurait
 * créé un doublon. Le test vérifie que :
 *   - modifier_proposition remplace les champs fournis, garde les autres,
 *     redépose la version corrigée et retire l'ancienne (remplaceePar) ;
 *   - une correction refusée (doublon) laisse l'ancienne en attente ;
 *   - retirer_proposition sort une proposition des ✓/✗ ;
 *   - une proposition déjà tranchée ne se corrige ni ne se retire.
 *
 *   node scripts/attache-propositions-correction.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-prop-correction-'))
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

const enquetes = [
  {
    id: 1, numero: '2026 - CLIO HF-684-FN', dateDebut: '2026-05-18', statut: 'en_cours',
    tags: [], actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [],
    misEnCause: [{ id: 101, nom: 'EL BOUZIANI Sofiane', role: 'usager du véhicule', statut: 'actif' }],
  },
]
const syncData = { enquetes, audienceResultats: {}, customTags: [], alertRules: [], version: 1 }
fs.writeFileSync(
  path.join(DATA_DIR, 'vaults', 'ctx-crimorg.json'),
  JSON.stringify(encryptJson(keyCtx, { data: syncData, metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 1 } }))
)

const { addProposition, listPropositions, modifierProposition, retirerProposition, decideProposition } = await import(`${REPO}/scripts/attache/propositions.mjs`)

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}
async function rejette(fn) {
  try { await fn(); return null } catch (e) { return String(e?.message || e) }
}
const tous = () => listPropositions(keys, { enAttente: false })
const enAttenteCarto = () => listPropositions(keys).filter((p) => p.type === 'dossier_carto')

// ── 1. Dépôt initial, avec la graphie fautive
const LABEL = '22188000069 - Réseau EL KIDAOUI / LEULLIER'
const depot = await addProposition(keys, {
  type: 'dossier_carto',
  payload: { label: LABEL, dateApprox: '2021-2023', misEnCause: ['LEULLIER Benjamin', 'EL BOUZIANI Sofian'], notes: 'Synthèse.' },
  source: 'ORTC du 27/05/2024',
})
attendu('proposition initiale déposée', Boolean(depot.id))

// ── 2. Correction de la liste des mis en cause : le reste est conservé
const corr = await modifierProposition(keys, {
  id: depot.id,
  payload: { misEnCause: ['LEULLIER Benjamin', 'EL BOUZIANI Sofiane'] },
  motif: 'graphie alignée sur SIRAL',
})
attendu('correction déposée sous un nouvel id', corr.ok === true && corr.id && corr.id !== depot.id, JSON.stringify(corr))
const pendantes = enAttenteCarto()
attendu('une seule proposition de dossier en attente', pendantes.length === 1, `obtenu ${pendantes.length}`)
const nouvelle = pendantes[0]
attendu('mis en cause corrigés', JSON.stringify(nouvelle?.payload.misEnCause) === JSON.stringify(['LEULLIER Benjamin', 'EL BOUZIANI Sofiane']))
attendu('autres champs conservés', nouvelle?.payload.label === LABEL && nouvelle?.payload.notes === 'Synthèse.' && nouvelle?.payload.dateApprox === '2021-2023')
attendu('source d\'origine conservée', nouvelle?.source === 'ORTC du 27/05/2024')
const ancienne = tous().find((p) => p.id === depot.id)
attendu('ancienne retirée et chaînée', ancienne?.statut === 'retiree' && ancienne?.remplaceePar === corr.id, JSON.stringify({ statut: ancienne?.statut, remplaceePar: ancienne?.remplaceePar }))

// ── 3. null retire un champ
const sansDate = await modifierProposition(keys, { id: corr.id, payload: { dateApprox: null } })
const apresNull = enAttenteCarto()[0]
attendu('null retire le champ', Boolean(sansDate.id) && apresNull && !('dateApprox' in apresNull.payload))

// ── 4. Correction refusée (doublon) : l'ancienne reste en attente, intacte
const autre = await addProposition(keys, { type: 'dossier_carto', payload: { label: 'Autre réseau' }, source: 'test' })
const refus = await modifierProposition(keys, { id: autre.id, payload: { label: LABEL } })
attendu('correction en doublon non déposée', refus.doublon === true && !refus.id, JSON.stringify(refus))
const autreApres = tous().find((p) => p.id === autre.id)
attendu('proposition d\'origine rétablie', autreApres?.statut === 'en_attente' && autreApres?.payload.label === 'Autre réseau')
attendu('toujours deux propositions de dossier en attente', enAttenteCarto().length === 2, `obtenu ${enAttenteCarto().length}`)

// ── 5. Retrait
const retrait = await retirerProposition(keys, { id: autre.id, motif: 'sans objet' })
attendu('retrait effectué', retrait.ok === true)
attendu('retirée absente des ✓/✗', !listPropositions(keys).some((p) => p.id === autre.id))
attendu('motif de retrait tracé', tous().find((p) => p.id === autre.id)?.retraitMotif === 'sans objet')

// ── 6. Proposition déjà tranchée : ni correction ni retrait
const tranchee = enAttenteCarto()[0]
await decideProposition(keys, { id: tranchee.id, action: 'refuser', par: 'test' })
attendu('correction impossible après décision', /déjà traitée/.test(await rejette(() => modifierProposition(keys, { id: tranchee.id, payload: { notes: 'x' } })) || ''))
attendu('retrait impossible après décision', /déjà traitée/.test(await rejette(() => retirerProposition(keys, { id: tranchee.id })) || ''))
attendu('retrait d\'une proposition retirée impossible', /déjà traitée/.test(await rejette(() => retirerProposition(keys, { id: autre.id })) || ''))
attendu('id inconnu rejeté', /inconnue/.test(await rejette(() => retirerProposition(keys, { id: 'zzz' })) || ''))
attendu('champs manquants rejetés', /requis/.test(await rejette(() => modifierProposition(keys, { id: tranchee.id })) || ''))

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) {
  console.error(`\n${echecs.length} test(s) en échec : ${echecs.join(' · ')}`)
  process.exit(1)
}
console.log('\nTous les tests passent.')
