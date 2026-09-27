/**
 * SIRAL — sommaire des actes rédigés de tous les dossiers.
 *
 * La fiche enquête n'a plus de section « Actes rédigés » : la page « Assistant
 * de justice » les liste dossier par dossier, à partir de ce sommaire. Un acte
 * qui n'y figure pas n'est plus visible nulle part dans l'app — d'où ce test :
 *  - chaque dossier qui a un acte est listé, avec ses compteurs (en attente,
 *    traités — validés ou refusés —, productions de chantier à part) ;
 *  - une écriture VARIANTE du numéro compte pour l'enquête canonique, jamais
 *    pour son dossier voisin (« …GRIVESNES » / « …GRIVESNES 2 ») ;
 *  - un numéro sans enquête reste listé tel quel ; « _hors-dossier » non ;
 *  - aucun texte d'acte ne sort, et une enveloppe illisible ne casse rien.
 *
 *   node scripts/attache-actes-sommaire.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-sommaire-test-'))
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

const LONG = '85103/843/2026 - GRIVESNES 2'
const VOISIN = '85103/843/2026 - GRIVESNES'
const NORD = '2026/000123 - NORD'
const enquete = (id, numero, dateMiseAJour) => ({
  id, numero, dateDebut: '2026-03-01', dateMiseAJour, statut: 'en_cours',
  tags: [], actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [], misEnCause: [],
})
fs.writeFileSync(path.join(DATA_DIR, 'vaults', 'ctx-crimorg.json'), JSON.stringify(encryptJson(keyCtx, {
  data: {
    // GRIVESNES 2 est la plus récente : c'est elle que désigne l'écriture courte.
    enquetes: [enquete(1, LONG, '2026-09-20T10:00:00.000Z'), enquete(2, VOISIN, '2026-01-01T10:00:00.000Z'), enquete(3, NORD, '2026-05-01T10:00:00.000Z')],
    version: 1,
  },
  metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 1 },
})))

const { saveProduction, writeEnvelope, sommaireProductions, listEnvelopesDossier } = await import(`${REPO}/scripts/attache/productions.mjs`)
const { attacheDir } = await import(`${REPO}/scripts/attache/store.mjs`)

let failures = 0
const check = (nom, cond, detail = '') => {
  if (cond) { console.log(`  ✓ ${nom}`) } else { failures++; console.log(`  ✗ ${nom}${detail ? ' — ' + detail : ''}`) }
}

console.log('\nSommaire des actes rédigés (page « Assistant de justice »)')

check('aucun acte → sommaire vide, pas d\'exception', sommaireProductions(keys).length === 0)

// Acte rédigé à l'écriture canonique, puis un acte ANCIEN rangé sous l'écriture
// courte (avant la canonisation des numéros) : écrit tel quel, sans passer par
// saveProduction qui le rattacherait aujourd'hui à l'enquête.
await saveProduction(keys, { numero: LONG, type: 'prolongation_jld', titre: 'Prolongation écoute', contenu: 'Texte confidentiel A' })
const ancien = (numero, id, extra = {}) => writeEnvelope(numero, id, encryptJson(keyGlobal, {
  id, numero, type: 'requisition', titre: 'Acte ' + id, contenu: 'Texte confidentiel ' + id,
  updatedAt: '2026-06-01T10:00:00.000Z', ...extra,
}))
await ancien('85103/843/2026', 'a1a1a1a1')
await saveProduction(keys, { numero: VOISIN, type: 'requisition', titre: 'Réquisition voisin', contenu: 'Texte confidentiel B' })
// NORD : un validé, un refusé, une fiche de chantier — aucun en attente.
await ancien(NORD, 'b1b1b1b1', { traite: true, updatedAt: '2026-04-01T10:00:00.000Z' })
await ancien(NORD, 'b2b2b2b2', { refuse: true, refuseMotif: 'mauvaise trame', updatedAt: '2026-04-02T10:00:00.000Z' })
await ancien(NORD, 'b3b3b3b3', { type: 'fiche', source: 'chantier:c0ffee', updatedAt: '2026-04-03T10:00:00.000Z' })
// Numéro sans enquête, pseudo-dossier, enveloppe d'une autre clé, fichier parasite.
await ancien('9999/1/2026', 'c1c1c1c1', { updatedAt: '2026-02-01T10:00:00.000Z' })
await saveProduction(keys, { numero: '_hors-dossier', type: 'note', titre: 'Note hors dossier', contenu: 'Texte confidentiel C' })
await writeEnvelope(NORD, 'd1d1d1d1', encryptJson(crypto.randomBytes(32), { id: 'd1d1d1d1', numero: NORD, contenu: 'x' }))
fs.writeFileSync(path.join(attacheDir('productions'), 'note.txt'), 'parasite')

const sommaire = sommaireProductions(keys)
const de = (numero) => sommaire.find((d) => d.numero === numero)

check('l\'écriture courte compte pour l\'enquête canonique',
  de(LONG)?.enAttente === 2 && !de('85103/843/2026'), JSON.stringify(sommaire))
check('le dossier voisin garde ses actes, sans mélange', de(VOISIN)?.enAttente === 1)
check('déplié, l\'atelier du dossier montre exactement les actes comptés',
  listEnvelopesDossier(keys, LONG).length === 2 && listEnvelopesDossier(keys, VOISIN).length === 1)
check('validés et refusés = traités ; la fiche de chantier compte à part',
  de(NORD)?.enAttente === 0 && de(NORD)?.traites === 2 && de(NORD)?.chantier === 1, JSON.stringify(de(NORD)))
check('un numéro sans enquête reste listé tel quel', de('9999/1/2026')?.enAttente === 1)
check('« _hors-dossier » a sa propre section : absent', sommaire.every((d) => !d.numero.startsWith('_')))
check('enveloppe illisible et fichier parasite ignorés', sommaire.length === 4, sommaire.map((d) => d.numero).join(' | '))
check('les dossiers en attente d\'une décision passent devant',
  sommaire[sommaire.length - 1]?.numero === NORD && sommaire.slice(0, 3).every((d) => d.enAttente > 0))
check('dernier mouvement : l\'acte le plus récent du dossier', de(NORD)?.maj === '2026-04-03T10:00:00.000Z')
const brut = JSON.stringify(sommaire)
check('aucun texte ni titre d\'acte ne sort', !brut.includes('confidentiel') && !brut.includes('titre') && !brut.includes('mauvaise trame'))

fs.rmSync(SCRATCH, { recursive: true, force: true })
console.log(failures === 0 ? '\nOK — chaque acte reste visible sur la page.\n' : `\n${failures} échec(s).\n`)
process.exit(failures === 0 ? 0 : 1)
