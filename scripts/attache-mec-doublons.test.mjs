/**
 * SIRAL — test du DÉDOUBLONNAGE des propositions de mis en cause.
 *
 * L'icône « Actualiser » de la section Mis en cause fait déposer à l'attaché des
 * propositions ✓/✗. Ce test vérifie la garde qui les entoure :
 *   - un nom DÉJÀ aux mis en cause du dossier ⇒ rien n'est déposé ;
 *   - un nom TRÈS PROCHE (orthographe, mots inversés, prénom en moins) ⇒ déposé,
 *     mais AVEC son avertissement ;
 *   - un nom IDENTIQUE connu d'une AUTRE enquête ⇒ déposé, avec le numéro de
 *     l'enquête où il figure déjà ;
 *   - un nom sans rapport ⇒ déposé, sans avertissement.
 *
 * Fabrique un SIRAL_DATA_DIR réel (clé-maître, trousseau remis, coffre
 * ctx-crimorg chiffré) puis appelle directement les modules de l'attaché.
 *
 *   node scripts/attache-mec-doublons.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-mec-test-'))
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

// ── Deux enquêtes : la seconde partage un nom avec la première (recoupement)
const enquetes = [
  {
    id: 1, numero: '387/081/2026 - PERONNE', dateDebut: '2026-01-05', statut: 'en_cours',
    tags: [], actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [],
    misEnCause: [
      { id: 101, nom: 'ABAZ YOUSSEF Selim', role: 'tête de réseau', statut: 'actif' },
      { id: 102, nom: 'LAACHIRA Medhi', role: 'lieutenant', statut: 'actif' },
    ],
  },
  {
    id: 2, numero: '412/900/2026 - NOYON', dateDebut: '2026-02-10', statut: 'en_cours',
    tags: [], actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [],
    misEnCause: [{ id: 201, nom: 'BARBOUCH Zakari', role: 'confectionneur', statut: 'actif' }],
  },
]
const syncData = { enquetes, audienceResultats: {}, customTags: [], alertRules: [], version: 1 }
fs.writeFileSync(
  path.join(DATA_DIR, 'vaults', 'ctx-crimorg.json'),
  JSON.stringify(encryptJson(keyCtx, { data: syncData, metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 1 } }))
)

const { proximiteNoms, mecParNom } = await import(`${REPO}/scripts/attache/dossier.mjs`)
const { addProposition, listPropositions } = await import(`${REPO}/scripts/attache/propositions.mjs`)

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

// ── Rapprochement de noms (fonction pure)
attendu('mots inversés rapprochés', proximiteNoms('ABAZ YOUSSEF Selim', 'Selim ABAZ YOUSSEF') !== null)
attendu('orthographe voisine rapprochée', proximiteNoms('LAACHIRA Medhi', 'LAACHIRRA Mehdi') !== null)
attendu('prénom en moins rapproché', proximiteNoms('KADER', 'KADER Marco Paulo') !== null)
attendu('deux personnes distinctes NON rapprochées', proximiteNoms('KOPERA Vincent', 'DELONGHE Romain') === null)
attendu('même prénom seul NON rapproché', proximiteNoms('Mohamed BENALI', 'Mohamed ZOUAOUI') === null)

// ── Recoupement inter-dossiers : le dossier visé est exclu
const ailleurs = mecParNom(keys, { exclureNumero: '387/081/2026 - PERONNE' })
attendu('mecParNom exclut le dossier visé', !ailleurs.some((m) => m.nom === 'LAACHIRA Medhi'), ailleurs.map((m) => m.nom).join(', '))
attendu('mecParNom voit l\'autre dossier', ailleurs.some((m) => m.nom === 'BARBOUCH Zakari' && m.dossiers.includes('412/900/2026 - NOYON')))

const NUM = '387/081/2026 - PERONNE'
const propose = (nom, role) => addProposition(keys, { numero: NUM, type: 'mec', payload: { nom, role }, source: 'PV D8092' })

// 1. Nom déjà aux mis en cause du dossier : RIEN n'est déposé
const doublon = await propose('ABAZ YOUSSEF Selim', 'tête de réseau')
attendu('doublon exact refusé', doublon.doublon === true && !doublon.id, JSON.stringify(doublon))

// 2. Nom très proche d'un mis en cause du dossier : déposé AVEC avertissement
const proche = await propose('LAACHIRRA Mehdi', 'lieutenant')
attendu('nom voisin déposé', Boolean(proche.id))
attendu('nom voisin averti', (proche.avertissements || []).some((a) => a.includes('LAACHIRA Medhi') && a.includes('ce dossier')),
  JSON.stringify(proche.avertissements))

// 3. Nom identique connu d'une AUTRE enquête : déposé, avec le numéro de l'autre dossier
const ailleursProp = await propose('BARBOUCH Zakari', 'confectionneur')
attendu('nom d\'un autre dossier déposé', Boolean(ailleursProp.id))
attendu('nom d\'un autre dossier averti avec son numéro',
  (ailleursProp.avertissements || []).some((a) => a.includes('AUTRE dossier') && a.includes('412/900/2026 - NOYON')),
  JSON.stringify(ailleursProp.avertissements))

// 4. Nom sans rapport : déposé, sans avertissement
const neuf = await propose('KOPERA Vincent', 'vendeur Chauny')
attendu('nom neuf déposé sans avertissement', Boolean(neuf.id) && !neuf.avertissements, JSON.stringify(neuf))

// 5. Proposition identique déjà en attente : refusée
const rebelote = await propose('KOPERA Vincent', 'vendeur Chauny')
attendu('proposition identique en attente refusée', rebelote.doublon === true && !rebelote.id, JSON.stringify(rebelote))

// 6. Nom voisin d'une proposition EN ATTENTE : déposé, averti
const voisinPendant = await propose('KOPERA Vincente', 'vendeur')
attendu('nom voisin d\'une proposition en attente averti',
  Boolean(voisinPendant.id) && (voisinPendant.avertissements || []).some((a) => a.includes('en attente')),
  JSON.stringify(voisinPendant.avertissements))

// ── État final : 4 propositions en attente sur le dossier (2, 3, 4, 6)
const enAttente = listPropositions(keys, { numero: NUM }).filter((p) => p.type === 'mec')
attendu('4 propositions en attente', enAttente.length === 4, `obtenu ${enAttente.length}`)
attendu('avertissements stockés hors payload', enAttente.every((p) => !('avertissements' in p.payload)))

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) {
  console.error(`\n${echecs.length} test(s) en échec : ${echecs.join(' · ')}`)
  process.exit(1)
}
console.log('\nTous les tests passent.')
