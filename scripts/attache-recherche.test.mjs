/**
 * SIRAL — test de la RECHERCHE PLEIN TEXTE (pieces_chercher).
 *
 * Vérifie :
 *   - la syntaxe : ET (mots juxtaposés), OU (alternatives), "expression
 *     exacte" (mots consécutifs, ponctuation et retours à la ligne
 *     indifférents), dérivés (« stock » → stockage), casse et accents ;
 *   - UN dossier : classement, pagination (offset), doublons exacts sautés ;
 *   - TOUT LE FONDS : enquêtes en cours et archivées, instructions, documents
 *     des dossiers de la carte — et la reprise exacte au curseur ;
 *   - un dossier de la carte se fouille aussi par son libellé.
 *
 *   node scripts/attache-recherche.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-recherche-test-'))
const DATA_DIR = path.join(SCRATCH, 'siral-test-data')
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

const EN_COURS = '500/100/2026 - STUP'
const ARCHIVE = '400/50/2024 - ARMES'
const INSTRU = 'JIRS AC 26/01'
const enquete = (id, numero, statut) => ({
  id, numero, dateDebut: '2026-01-01', statut, tags: [], actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [], misEnCause: [],
})
fs.writeFileSync(path.join(VAULTS, 'ctx-crimorg.json'), JSON.stringify(encryptJson(keyCtx, {
  data: { enquetes: [enquete(1, EN_COURS, 'en_cours'), enquete(2, ARCHIVE, 'archive')], audienceResultats: {}, customTags: [], alertRules: [], version: 1 },
  metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 1 },
})))
fs.writeFileSync(path.join(VAULTS, 'instructions-audran.json'), JSON.stringify(encryptJson(keyGlobal, {
  version: 1, deletedIds: [],
  dossiers: [{ id: 42, numeroInstruction: INSTRU, numeroParquet: '85103/843/2026', misEnExamen: [], saisine: [] }],
})))
fs.writeFileSync(path.join(VAULTS, 'cartographie.json'), JSON.stringify(encryptJson(keyGlobal, {
  dossiersExNihilo: [{
    label: 'Réseau des Coquelicots', documents: [{ nom: 'synthese.txt', texte: 'Synthèse : Mme LEROY servait de NOURRICE, la résine était stockée dans sa cave.' }],
  }],
})))

const { writeDocBlob, docServerKey, attacheTj } = await import(`${REPO}/scripts/attache/store.mjs`)
const verse = (numero, rel, texte) =>
  writeDocBlob(attacheTj(), docServerKey(numero), rel, encryptDocBlob(keyGlobal, Buffer.from(texte, 'utf8')), { savedBy: 'test' })

verse(EN_COURS, 'PV/D10_audition_LEROY.txt', 'Audition de Mme Léa LEROY : « on m\'a demandé de garder la marchandise chez ma mère », dans la cave.')
verse(EN_COURS, 'PV/D11_audition_DURAND.txt', 'Audition de DURAND : il conteste. Il ne connaît pas Mme LEROY.')
verse(EN_COURS, 'PV/D12_perquisition.txt', 'Perquisition : stockage de 3 kg de résine découvert dans le box. Stockage confirmé. Stockage.')
verse(EN_COURS, 'PV/D13_copie_perquisition.txt', 'Perquisition : stockage de 3 kg de résine découvert dans le box. Stockage confirmé. Stockage.') // copie exacte
verse(ARCHIVE, 'PV/D3_audition.txt', 'Le fusil était caché chez une nourrice, rue des Lilas.')
verse(INSTRU, 'Dossier/D500_RD.txt', 'RÉQUISITOIRE\nDÉFINITIF\nLe procureur de la République requiert le renvoi.')
verse(INSTRU, 'Dossier/D600_ORTC.txt', 'Ordonnance de renvoi devant le tribunal correctionnel. Vu le réquisitoire définitif du parquet.')
verse(INSTRU, 'Dossier/D700_avis.txt', 'Avis de fin d\'information : le réquisitoire sera définitif sous un mois.')

const { chercherDansPieces, analyserRequete } = await import(`${REPO}/scripts/attache/recherche.mjs`)
const { ensureDocShas } = await import(`${REPO}/scripts/attache/dossier.mjs`)
await ensureDocShas(keys, docServerKey(EN_COURS))

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}
const chemins = (r) => (r.pieces || []).map((p) => p.chemin).sort()

// ── syntaxe
attendu('requête vide refusée', (await chercherDansPieces(keys, EN_COURS, { requete: ' a ' })).ok === false)
attendu('OU découpe les alternatives', analyserRequete('nourrice OU stockage | cave').length === 3)
attendu('"ou" minuscule reste un mot', analyserRequete('nourrice ou stockage').length === 1)

// ── UN dossier
const r1 = await chercherDansPieces(keys, EN_COURS, { requete: 'leroy cave' })
attendu('ET : les deux mots dans la même pièce', JSON.stringify(chemins(r1)) === JSON.stringify(['PV/D10_audition_LEROY.txt']), JSON.stringify(chemins(r1)))
const r2 = await chercherDansPieces(keys, EN_COURS, { requete: '"garder la marchandise" OU stock' })
attendu('OU + expression + dérivé', JSON.stringify(chemins(r2)) === JSON.stringify(['PV/D10_audition_LEROY.txt', 'PV/D12_perquisition.txt']), JSON.stringify(chemins(r2)))
attendu('doublon exact sauté', r2.couverture.doublonsExactsSautes === 1, JSON.stringify(r2.couverture))
attendu('termes trouvés nommés', r2.pieces.find((p) => p.chemin === 'PV/D10_audition_LEROY.txt')?.termes.includes('garder la marchandise'))
attendu('classement par occurrences', r2.pieces[0].chemin === 'PV/D12_perquisition.txt', JSON.stringify(r2.pieces.map((p) => [p.chemin, p.occurrences])))
attendu('extrait fidèle (accents d\'origine)', r1.pieces[0].extraits[0].includes('Léa LEROY'), JSON.stringify(r1.pieces[0].extraits))
const r3 = await chercherDansPieces(keys, EN_COURS, { requete: 'audition', limite: 1 })
attendu('pagination : offsetSuivant', r3.pieces.length === 1 && r3.offsetSuivant === 1 && r3.totalResultats === 2, JSON.stringify(r3))
const r4 = await chercherDansPieces(keys, EN_COURS, { requete: 'audition', limite: 1, offset: 1 })
attendu('pagination : page suivante', r4.pieces.length === 1 && r4.pieces[0].chemin !== r3.pieces[0].chemin && r4.offsetSuivant === undefined)

// ── expression exacte : la présence des mots ne suffit pas
const r5 = await chercherDansPieces(keys, INSTRU, { requete: '"réquisitoire définitif"' })
attendu('expression : retours à la ligne et casse indifférents', chemins(r5).includes('Dossier/D500_RD.txt'), JSON.stringify(chemins(r5)))
attendu('expression : mots non consécutifs exclus', !chemins(r5).includes('Dossier/D700_avis.txt'), JSON.stringify(chemins(r5)))
const r6 = await chercherDansPieces(keys, INSTRU, { requete: 'réquisitoire définitif' })
attendu('mots libres : les trois pièces', chemins(r6).length === 3, JSON.stringify(chemins(r6)))

// ── dossier de la carte par son libellé
const r7 = await chercherDansPieces(keys, 'réseau des coquelicots', { requete: 'nourrice' })
attendu('dossier de la carte fouillé', JSON.stringify(chemins(r7)) === JSON.stringify(['synthese.txt']), JSON.stringify(r7))

// ── TOUT LE FONDS
const f1 = await chercherDansPieces(keys, '', { requete: 'nourrice OU "garder la marchandise"' })
const vus = f1.pieces.map((p) => `${p.nature}|${p.dossier}|${p.chemin}`).sort()
attendu('fonds : en cours, archivé et carte', JSON.stringify(vus) === JSON.stringify([
  `carte|Réseau des Coquelicots|synthese.txt`,
  `enquête archivée|${ARCHIVE}|PV/D3_audition.txt`,
  `enquête|${EN_COURS}|PV/D10_audition_LEROY.txt`,
].sort()), JSON.stringify(vus))
attendu('fonds : fin signalée', f1.fin === true && !f1.curseurSuivant, JSON.stringify(f1.page))
attendu('fonds : répartition par dossier', f1.parDossier[ARCHIVE] === 1, JSON.stringify(f1.parDossier))
const f2 = await chercherDansPieces(keys, '', { requete: '"vu le réquisitoire définitif"' })
attendu('fonds : instructions fouillées', f2.pieces.length === 1 && f2.pieces[0].nature === 'instruction', JSON.stringify(f2.pieces))

// curseur : une page d'un résultat, puis reprise exacte jusqu'à la fin
const tous = []
let curseur
let tours = 0
for (;;) {
  const p = await chercherDansPieces(keys, '', { requete: 'audition OU perquisition OU nourrice', limite: 1, curseur })
  tous.push(...p.pieces.map((x) => `${x.dossier}|${x.chemin}`))
  if (p.fin) break
  curseur = p.curseurSuivant
  if (++tours > 20) break
}
const attendus = [
  `${EN_COURS}|PV/D10_audition_LEROY.txt`, `${EN_COURS}|PV/D11_audition_DURAND.txt`, `${EN_COURS}|PV/D12_perquisition.txt`,
  `${ARCHIVE}|PV/D3_audition.txt`, 'Réseau des Coquelicots|synthese.txt',
]
attendu('curseur : tout vu, une seule fois, rien sauté', JSON.stringify([...tous].sort()) === JSON.stringify([...attendus].sort()), JSON.stringify(tous))

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) {
  console.log(`\n${echecs.length} échec(s).`)
  process.exit(1)
}
console.log('\nTous les contrôles passent.')
