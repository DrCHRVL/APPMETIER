/**
 * SIRAL — test de la détection des PIÈCES PEUT-ÊTRE MAL CLASSÉES.
 *
 * Scénario vécu : une interception téléphonique versée dans le mauvais
 * dossier fabrique un faux recoupement. Vérifie :
 *   - la retranscription d'une ligne interceptée dans B, versée dans A,
 *     est signalée (certitude forte), B désigné comme dossier probable ;
 *   - un LOT entier versé au mauvais endroit ne se donne pas raison à
 *     lui-même ;
 *   - une pièce bien classée, même si elle cite l'autre affaire, ne l'est pas ;
 *   - une pièce de l'enquête préliminaire n'« appartient » pas à
 *     l'instruction qui en est issue ;
 *   - un marqueur commun (OPJ, service) ne situe rien ;
 *   - registre_recouper signale le recoupement qui repose sur la pièce.
 *
 *   node scripts/attache-classement.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-classement-test-'))
const DATA_DIR = path.join(SCRATCH, 'data')
const VAULTS = path.join(DATA_DIR, 'vaults')
fs.mkdirSync(VAULTS, { recursive: true })
process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { encryptJson, encryptDocBlob } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)
const keyGlobal = crypto.randomBytes(32)
const keyCtx = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': keyCtx.toString('base64') }, 'Audran CHEVALIER')
const keys = loadKeyring()

const A = '100/1/2026 - STUP AMIENS'
const B = '200/2/2026 - STUP ABBEVILLE'
const P = '300/3/2025 - PRELIM'
// les pièces référencées par l'enquête (la veille lit `documents`)
const DOCS = {
  A: ['Ecoutes/2026-03/R1_0611.txt', 'PV/D5_synthese.txt', 'Ecoutes/2026-04/R7_0622.txt', 'Ecoutes/2026-04/R8_0622.txt', 'Ecoutes/2026-04/R9_0622.txt', 'PV/D99_pv_opj.txt'],
  B: ['Ecoutes/R1_0622.txt', 'PV/D99_pv_opj.txt'],
  P: ['PV/D1_audition.txt', 'PV/D99_pv_opj.txt'],
}
const enquete = (id, numero, misEnCause, ecoutes, docs) => ({
  id, numero, statut: 'en_cours', tags: [], actes: [], comptesRendus: [], geolocalisations: [],
  misEnCause: misEnCause.map((nom) => ({ nom })), ecoutes: ecoutes.map((numero) => ({ numero })),
  documents: docs.map((rel) => ({ cheminRelatif: rel, nom: rel.split('/').pop() })),
})
fs.writeFileSync(path.join(VAULTS, 'ctx-crimorg.json'), JSON.stringify(encryptJson(keyCtx, {
  data: {
    enquetes: [
      enquete(1, A, ['DURAND Kévin'], ['06 11 11 11 11'], DOCS.A),
      enquete(2, B, ['MARTIN Paul', 'LEROY Sami'], ['06 22 22 22 22'], DOCS.B),
      enquete(3, P, [], [], DOCS.P),
    ],
    version: 1,
  },
  metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 1 },
})))
fs.writeFileSync(path.join(VAULTS, 'instructions-audran.json'), JSON.stringify(encryptJson(keyGlobal, {
  version: 1, deletedIds: [],
  dossiers: [{ id: 9, numeroInstruction: 'JI 26/09', enquetePreliminaireNumero: P, misEnExamen: [{ nom: 'BENALI Yanis' }], suspects: [] }],
})))

const { writeDocBlob, docServerKey, attacheTj } = await import(`${REPO}/scripts/attache/store.mjs`)
const verse = (numero, rel, texte) => writeDocBlob(attacheTj(), docServerKey(numero), rel, encryptDocBlob(keyGlobal, Buffer.from(texte, 'utf8')), { savedBy: 'test' })

// A : une pièce légitime, puis un LOT de trois retranscriptions de la ligne de B
verse(A, 'Ecoutes/2026-03/R1_0611.txt', 'Retranscription ligne 06 11 11 11 11 : DURAND Kévin parle de la livraison.')
verse(A, 'PV/D5_synthese.txt', 'Synthèse : DURAND Kévin, 06 11 11 11 11. Le réseau d\'Abbeville (MARTIN Paul) est évoqué.')
verse(A, 'Ecoutes/2026-04/R7_0622.txt', 'Retranscription ligne 06 22 22 22 22 : MARTIN Paul appelle LEROY Sami.')
verse(A, 'Ecoutes/2026-04/R8_0622.txt', 'Retranscription ligne 06 22 22 22 22 : LEROY Sami rappelle MARTIN Paul.')
verse(A, 'Ecoutes/2026-04/R9_0622.txt', 'Retranscription ligne 06 22 22 22 22 : MARTIN Paul, rendez-vous.')
// B : sa propre retranscription
verse(B, 'Ecoutes/R1_0622.txt', 'Retranscription ligne 06 22 22 22 22 : MARTIN Paul et LEROY Sami.')
// préliminaire P et instruction JI 26/09 : même affaire
verse(P, 'PV/D1_audition.txt', 'Audition : BENALI Yanis reconnaît les faits.')
// un OPJ commun à beaucoup de dossiers : ne doit rien situer
for (const n of [A, B, P, 'JI 26/09']) verse(n, 'PV/D99_pv_opj.txt', 'PV rédigé par le brigadier ROUSSEAU Marc.')

const { ingestPass } = await import(`${REPO}/scripts/attache/ingest.mjs`)
for (let i = 0; i < 10; i++) { const r = await ingestPass(keys); if (!r.dossiers) break }
const { readRegistre, writeRegistre, recouperRegistres } = await import(`${REPO}/scripts/attache/registre.mjs`)
// mini-fiches (le registre IA) : les personnes de chaque pièce
const ficher = (numero, personnes) => {
  const reg = readRegistre(keys, docServerKey(numero))
  for (const [rel, noms] of Object.entries(personnes)) {
    if (!reg.pieces[rel]) throw new Error(`pièce absente du registre : ${numero} ${rel}`)
    reg.pieces[rel].fiche = { type: 'PV', personnes: noms.map(([nom, role]) => ({ nom, ...(role ? { role } : {}) })), resume: '', integrale: true }
  }
  writeRegistre(keys, docServerKey(numero), reg)
}
const OPJ = [['ROUSSEAU Marc', 'enquêteur']]
ficher(A, {
  'Ecoutes/2026-03/R1_0611.txt': [['DURAND Kévin']],
  'PV/D5_synthese.txt': [['DURAND Kévin'], ['MARTIN Paul']],
  'Ecoutes/2026-04/R7_0622.txt': [['MARTIN Paul'], ['LEROY Sami']],
  'Ecoutes/2026-04/R8_0622.txt': [['LEROY Sami'], ['MARTIN Paul']],
  'Ecoutes/2026-04/R9_0622.txt': [['MARTIN Paul']],
  'PV/D99_pv_opj.txt': OPJ,
})
ficher(B, { 'Ecoutes/R1_0622.txt': [['MARTIN Paul'], ['LEROY Sami']], 'PV/D99_pv_opj.txt': OPJ })
ficher(P, { 'PV/D1_audition.txt': [['BENALI Yanis']], 'PV/D99_pv_opj.txt': OPJ })

const { detecterPiecesMalClassees } = await import(`${REPO}/scripts/attache/classement.mjs`)
const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

const s = detecterPiecesMalClassees(keys)
const vus = s.map((x) => `${x.dossier}|${x.piece}`).sort()
attendu('le lot d\'interceptions de B versé dans A est signalé, pièce par pièce', JSON.stringify(vus) === JSON.stringify([
  `${A}|Ecoutes/2026-04/R7_0622.txt`, `${A}|Ecoutes/2026-04/R8_0622.txt`, `${A}|Ecoutes/2026-04/R9_0622.txt`,
]), JSON.stringify(vus))
attendu('dossier probable : B', s.every((x) => x.dossierProbable === B), JSON.stringify(s.map((x) => x.dossierProbable)))
attendu('certitude forte quand B l\'emporte de loin (une simple mention dans A ne suffit pas à l\'y rattacher)', s.find((x) => x.piece.includes('R7'))?.certitude === 'forte', JSON.stringify(s.map((x) => [x.piece, x.certitude, x.poidsActuel, x.poidsProbable])))
attendu('motif : la ligne interceptée de B, déclarée', s[0]?.marques.some((m) => m.nature === 'ligne' && m.valeur === '0622222222' && m.dansProbable === 'déclarée'), JSON.stringify(s[0]?.marques))
attendu('la synthèse de A qui cite l\'autre réseau reste à sa place', !vus.some((v) => v.includes('D5_synthese')))
attendu('la préliminaire n\'appartient pas à l\'instruction qui en est issue', !vus.some((v) => v.startsWith(P)))
attendu('l\'OPJ commun ne situe rien', !vus.some((v) => v.includes('D99')))
attendu('filtre par dossier', detecterPiecesMalClassees(keys, { numero: 'ABBEVILLE' }).length === 3 && detecterPiecesMalClassees(keys, { numero: 'PRELIM' }).length === 0)

// registre_recouper : le faux pont A↔B est signalé comme reposant sur ces pièces
const rec = recouperRegistres(keys, { entite: '06 22 22 22 22' }).recoupements.find((r) => r.entite === 'tel:0622222222')
const coteA = rec?.dossiers.find((d) => d.dossier === A)
attendu('recoupement : le côté A repose sur des pièces peut-être mal classées', Boolean(coteA?.pieceSuspecte) && coteA.pieceSuspecte.dossierProbable === B, JSON.stringify(coteA))
attendu('recoupement : le côté B est sain', !rec?.dossiers.find((d) => d.dossier === B)?.pieceSuspecte)

// ── la VEILLE hebdomadaire : le faux pont est marqué, les pièces listées
const { passeRecoupements, lireSignaux } = await import(`${REPO}/scripts/attache/recoupements.mjs`)
const veille = await passeRecoupements(keys)
attendu('veille : pièces suspectes au résultat, avec les clés de dossier de l\'app',
  veille.piecesSuspectes?.length === 3 && veille.piecesSuspectes.every((x) => x.dossierKey === 'enq:crimorg#1' && x.dossierProbableKey === 'enq:crimorg#2'),
  JSON.stringify(veille.piecesSuspectes?.map((x) => [x.piece, x.dossierKey, x.dossierProbableKey])))
const ligne = veille.signaux.find((x) => x.kind === 'telephone' && x.canon.includes('622222222'))
attendu('veille : le faux pont de la ligne est marqué', ligne?.pieceSuspecte?.dossierProbable === B && ligne.pieceSuspecte.pieces.length === 3, JSON.stringify(ligne?.pieceSuspecte))
const martin = veille.signaux.find((x) => x.kind === 'personne' && /martin/i.test(x.valeur))
attendu('veille : la personne citée AUSSI dans une pièce bien classée n\'est pas marquée', martin && !martin.pieceSuspecte, JSON.stringify(martin?.pieceSuspecte || null))
const lus = lireSignaux(keys, { nature: 'telephone' })
attendu('recoupements_lire transmet le marquage', lus.signaux.some((x) => x.pieceSuspecte), JSON.stringify(lus.signaux.map((x) => x.pieceSuspecte || null)))

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) {
  console.log(`\n${echecs.length} échec(s).`)
  process.exit(1)
}
console.log('\nTous les contrôles passent.')
