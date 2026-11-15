/**
 * SIRAL — test des PIÈCES INTROUVABLES (fiche ↔ serveur).
 *
 * Scénario vécu : la fiche d'un dossier liste ses pièces, mais lire_document
 * répond « Document introuvable » pour toutes. Vérifie :
 *   - dossier RENOMMÉ après versement : les pièces sont signalées manquantes
 *     ET retrouvées sous l'ancien rangement (orphelin) ; pieces_rattacher les
 *     ramène sans rien écraser, et lire_document les lit ensuite ;
 *   - pièce de l'application bureau jamais recopiée : signalée, non retrouvée ;
 *   - chemin de fiche « bureau » (accents, espaces, parenthèses) et chemin
 *     serveur encodé : même pièce — ni signalée, ni introuvable à la lecture ;
 *   - un rangement qui appartient à un dossier existant n'est pas orphelin.
 *
 *   node scripts/attache-pieces-introuvables.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-introuvables-test-'))
const DATA_DIR = path.join(SCRATCH, 'data')
const VAULTS = path.join(DATA_DIR, 'vaults')
fs.mkdirSync(VAULTS, { recursive: true })
process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { encryptJson, encryptDocBlob } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)
const keyGlobal = crypto.randomBytes(32)
const keyCtx = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': keyCtx.toString('base64') }, 'test')
const keys = loadKeyring()

const RENOMME = '2025/14076 GUYNEMER point de deal'   // ex « 2025/14076 »
const BUREAU = '2025/112 - COQ'
const AUTRE = '2026/40 - Q3'
const enquete = (id, numero, rels) => ({
  id, numero, statut: 'archive', tags: [], actes: [], comptesRendus: [], geolocalisations: [], ecoutes: [], misEnCause: [],
  documents: rels.map((rel) => ({ cheminRelatif: rel, nom: rel.split('/').pop(), dateAjout: '2026-03-16T10:00:00Z' })),
})
fs.writeFileSync(path.join(VAULTS, 'ctx-crimorg.json'), JSON.stringify(encryptJson(keyCtx, {
  data: {
    enquetes: [
      enquete(1, RENOMME, ['Actes/Saisie_TAMOUHI.pdf.txt', 'Actes/requête (20).txt']),
      enquete(2, BUREAU, ['PV/Synthèse finale.txt', 'PV/D12 audition.txt']),
      enquete(3, AUTRE, ['PV/D1.txt']),
    ],
    version: 1,
  },
  metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 1 },
})))

const { writeDocBlob, docServerKey, attacheTj } = await import(`${REPO}/scripts/attache/store.mjs`)
const verse = (cle, rel, texte) => writeDocBlob(attacheTj(), cle, rel, encryptDocBlob(keyGlobal, Buffer.from(texte, 'utf8')), { savedBy: 'test' })

// Dossier renommé : les pièces ont été versées sous l'ANCIEN numéro.
verse(docServerKey('2025/14076'), 'Actes/Saisie_TAMOUHI.pdf.txt', 'Saisie bancaire TAMOUHI.')
verse(docServerKey('2025/14076'), 'Actes/requete__20_.txt', 'Requête 20.')
// Dossier bureau : une pièce recopiée (chemin encodé), l'autre jamais.
verse(docServerKey(BUREAU), 'PV/Synthese_finale.txt', 'Synthèse finale COQ.')
// Dossier sain.
verse(docServerKey(AUTRE), 'PV/D1.txt', 'D1.')
// Et une pièce déjà présente sous la nouvelle clé du dossier renommé (conflit).
verse(docServerKey(RENOMME), 'Actes/requete__20_.txt', 'Requête 20 — déjà là.')

const { piecesIntrouvables, rattacherPieces } = await import(`${REPO}/scripts/attache/piecesIntrouvables.mjs`)
const { readDocumentText } = await import(`${REPO}/scripts/attache/dossier.mjs`)

let r = piecesIntrouvables(keys)
const parNumero = Object.fromEntries(r.dossiers.map((d) => [d.numero, d]))
assert.ok(!parNumero[AUTRE], 'dossier sain non signalé')
assert.equal(parNumero[BUREAU].manquantes, 1, 'seule la pièce jamais recopiée manque (chemin bureau ≈ chemin serveur)')
assert.deepEqual(parNumero[BUREAU].pieces, ['PV/D12 audition.txt'])
assert.ok(!parNumero[BUREAU].retrouveesSous, 'pièce bureau non retrouvée')
assert.equal(parNumero[RENOMME].manquantes, 1, 'la requête 20 est déjà sous la nouvelle clé ; la saisie manque')
assert.deepEqual(parNumero[RENOMME].retrouveesSous, { [docServerKey('2025/14076')]: 1 })
assert.equal(r.rangementsOrphelins.length, 1)
assert.equal(r.rangementsOrphelins[0].cle, docServerKey('2025/14076'))
assert.deepEqual(r.rangementsOrphelins[0].dossiersProbables, [RENOMME])

// lecture : chemin de fiche « bureau » → pièce serveur encodée
let lu = await readDocumentText(keys, BUREAU, 'PV/Synthèse finale.txt')
assert.equal(lu.ok, true)
assert.match(lu.texte, /Synthèse finale COQ/)
// lecture d'un dossier sans aucun fichier : message explicite
lu = await readDocumentText(keys, RENOMME, 'Actes/Saisie_TAMOUHI.pdf.txt')
assert.equal(lu.ok, false)

// rattacher : refuse un rangement de dossier existant, puis récupère l'orphelin
assert.ok(rattacherPieces(keys, { cle: docServerKey(AUTRE), numero: RENOMME }).erreur)
const rat = rattacherPieces(keys, { cle: docServerKey('2025/14076'), numero: '2025/14076 GUYNEMER point de deal' })
assert.equal(rat.deplacees, 1)
assert.deepEqual(rat.conflits, ['Actes/requete__20_.txt'], 'homonyme jamais écrasé')
lu = await readDocumentText(keys, RENOMME, 'Actes/Saisie_TAMOUHI.pdf.txt')
assert.equal(lu.ok, true)
lu = await readDocumentText(keys, RENOMME, 'Actes/requête (20).txt')
assert.match(lu.texte, /déjà là/, 'la pièce en place n\'a pas été écrasée')

r = piecesIntrouvables(keys, { numero: RENOMME })
assert.equal(r.dossiers.length, 0, 'plus rien ne manque après rattachement')

fs.rmSync(SCRATCH, { recursive: true, force: true })
console.log('✓ pièces introuvables : renommage, bureau, chemins canoniques, rattachement sans écrasement')
