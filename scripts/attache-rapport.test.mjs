/**
 * SIRAL — test des RAPPORTS DE DOSSIER et de l'interrogation au niveau
 * « rapports » (puis approfondissement pièce par pièce).
 *
 * Vérifie :
 *   - pas de rapport tant que le registre est incomplet : assurerRapport
 *     pousse les mini-fiches, puis rédige depuis le registre agrégé ;
 *   - signature stable → aucune réécriture ; registre qui bouge → réécriture ;
 *   - gros dossier à plusieurs pochettes : un rapport par pochette, puis le
 *     rapport du dossier depuis ceux-ci ; une pochette inchangée n'est pas
 *     réécrite ;
 *   - rapport_lire : texte, fraîcheur, couverture ;
 *   - entretien de nuit borné ;
 *   - interrogation « rapports » sur tout le fonds : rapports préparés, un
 *     verdict par dossier, synthèse, puis interrogation « pieces » ENCHAÎNÉE
 *     sur les seuls dossiers retenus.
 *
 *   node scripts/attache-rapport.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-rapport-test-'))
const DATA_DIR = path.join(SCRATCH, 'data')
const VAULTS = path.join(DATA_DIR, 'vaults')
fs.mkdirSync(VAULTS, { recursive: true })
process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')
process.env.SIRAL_ATTACHE_RAPPORT_POCHETTE_SEUIL = '2' // > 2 pièces et ≥ 2 pochettes = hiérarchique

const { encryptJson, decryptJson, encryptDocBlob } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)
const keyGlobal = crypto.randomBytes(32)
const keyCtx = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': keyCtx.toString('base64') }, 'Audran CHEVALIER')
const keys = loadKeyring()

const NUM_A = '800/1/2026 - ALPHA' // petit : un seul rapport
const NUM_B = '800/2/2026 - BRAVO' // gros (seuil abaissé) : deux pochettes
fs.writeFileSync(path.join(VAULTS, 'ctx-crimorg.json'), JSON.stringify(encryptJson(keyCtx, {
  data: {
    enquetes: [
      { id: 1, numero: NUM_A, statut: 'en_cours', tags: [], actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [], misEnCause: [{ nom: 'DURAND Kévin' }] },
      { id: 2, numero: NUM_B, statut: 'archive', tags: [], actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [], misEnCause: [] },
    ],
    version: 1,
  },
  metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 1 },
})))

const { writeDocBlob, docServerKey, attacheTj } = await import(`${REPO}/scripts/attache/store.mjs`)
const KEY_A = docServerKey(NUM_A)
const KEY_B = docServerKey(NUM_B)
const PIECES = {
  [KEY_A]: { 'PV/D1.txt': 'DURAND loue un local au nom de la SASU ECRAN.', 'PV/D2.txt': 'Surveillance : rien.' },
  [KEY_B]: { 'PV/D1.txt': 'LEROY ne sait rien.', 'PV/D2.txt': 'LEROY encore.', 'Expertises/E1.txt': 'Rapport de pesée : 2 kg.' },
}
for (const [key, pieces] of Object.entries(PIECES)) for (const [rel, t] of Object.entries(pieces)) writeDocBlob(attacheTj(), key, rel, encryptDocBlob(keyGlobal, Buffer.from(t, 'utf8')), { savedBy: 'test' })
const { ingestPass } = await import(`${REPO}/scripts/attache/ingest.mjs`)
for (let i = 0; i < 5; i++) { const r = await ingestPass(keys); if (!r.dossiers) break }

const { readRegistre, writeRegistre } = await import(`${REPO}/scripts/attache/registre.mjs`)
const ficher = (key, rels, extra = {}) => {
  const reg = readRegistre(keys, key)
  for (const rel of rels) reg.pieces[rel].fiche = { type: 'PV', resume: rel.includes('D1') && key === KEY_A ? 'DURAND loue un local au nom de la SASU ECRAN.' : `Résumé de ${rel}`, personnes: [{ nom: rel.includes('D1') && key === KEY_A ? 'DURAND Kévin' : 'LEROY Sami', role: 'mis en cause' }], integrale: true, majLe: new Date().toISOString(), ...extra }
  writeRegistre(keys, key, reg)
}

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

const R = await import(`${REPO}/scripts/attache/rapport.mjs`)
const I = await import(`${REPO}/scripts/attache/interrogation.mjs`)
const runs = []
let pousses = 0
const fauxModele = async ({ prompt, json, label }) => {
  runs.push({ prompt, json, label })
  if (json) {
    const ids = [...prompt.matchAll(/═══ PIÈCE (.+?) ═══\n([\s\S]*?)(?=\n\n═══ PIÈCE |$)/g)]
    return { ok: true, data: ids.map(([, id, texte]) => { const p = /ECRAN/.test(texte); return { chemin: id, pertinent: p, score: p ? 0.9 : 0.1, justification: p ? 'Société écran.' : '', extraits: p ? ['SASU ECRAN'] : [] } }), envelope: {} }
  }
  const m = prompt.match(/RAPPORT (?:DU DOSSIER|DE LA POCHETTE) « ([^»]+) »/)
  return { ok: true, texte: `## Objet du dossier\nRapport de « ${m?.[1]} » : ${/ECRAN/.test(prompt) ? 'local loué au nom de la SASU ECRAN [PV/D1.txt]. ' : 'rien de notable. '}`.padEnd(260, '.'), envelope: {} }
}
R.configurerRapport({
  runUnTour: fauxModele,
  registreFichesStep: async (_k, { docKey }) => {
    const reg = readRegistre(keys, docKey)
    const rel = Object.keys(reg.pieces).find((r) => !reg.pieces[r].fiche)
    if (!rel) return null
    pousses++
    ficher(docKey, [rel])
    return { restantes: Object.values(readRegistre(keys, docKey).pieces).filter((e) => !e.fiche).length }
  },
})
I.configurerInterrogation({ runModele: fauxModele })

// ── Petit dossier : fiches poussées, puis rapport
let r = await R.assurerRapport(keys, NUM_A, { onHold: async () => true })
attendu('forfait saturé : différé, rien ne tourne', !r.pret && /différé/.test(r.raison) && runs.length === 0, JSON.stringify(r))
r = await R.assurerRapport(keys, NUM_A)
attendu('fiches manquantes poussées (2), puis rapport rédigé', r.pret && pousses === 2 && runs.length === 1 && /SASU ECRAN/.test(r.rapport.texte), JSON.stringify({ pret: r.pret, pousses, runs: runs.length }))
attendu('prompt du rapport : consigne « rapport_dossier » + registre agrégé (personnes, cotes)', /## Protagonistes/.test(runs[0].prompt) && /## Pièces clés/.test(runs[0].prompt) && /REGISTRE DU DOSSIER : 2 pièces/.test(runs[0].prompt) && /DURAND Kévin \[MIS EN CAUSE DÉCLARÉ\]/.test(runs[0].prompt))
r = await R.assurerRapport(keys, NUM_A)
attendu('signature stable : aucune réécriture', r.pret && runs.length === 1)
ficher(KEY_A, ['PV/D2.txt'], { resume: 'Résumé modifié' })
r = await R.assurerRapport(keys, NUM_A)
attendu('registre qui bouge : rapport réécrit', r.pret && runs.length === 2)

// ── Gros dossier : un rapport par pochette, puis le dossier
ficher(KEY_B, Object.keys(PIECES[KEY_B]))
runs.length = 0
r = await R.construireRapport(keys, NUM_B)
attendu('hiérarchique : 2 rapports de pochette + 1 rapport de dossier', r.ok && runs.length === 3 && Object.keys(r.rapport.pochettes).sort().join(',') === 'Expertises,PV', JSON.stringify({ ok: r.ok, runs: runs.length, pochettes: Object.keys(r.rapport?.pochettes || {}) }))
attendu('le rapport du dossier est rédigé depuis les rapports de pochette', /RAPPORTS DE POCHETTE sont joints/.test(runs[2].prompt) && /═══ POCHETTE « PV » \(2 pièces\) ═══/.test(runs[2].prompt))
ficher(KEY_B, ['Expertises/E1.txt'], { resume: 'Pesée corrigée' })
runs.length = 0
r = await R.construireRapport(keys, NUM_B)
attendu('une seule pochette a bougé : elle seule est réécrite (+ le dossier)', r.ok && runs.length === 2 && /POCHETTE « Expertises »/.test(runs[0].prompt), `${runs.length} run(s)`)

const lecture = R.detailRapport(keys, NUM_B)
attendu('rapport_lire : texte, à jour, couverture, pochettes', lecture.aJour === true && lecture.couverture.fichees === 3 && lecture.pochettes.length === 2 && /Rapport de/.test(lecture.texte), JSON.stringify({ aJour: lecture.aJour, couverture: lecture.couverture }))

// ── Entretien de nuit
ficher(KEY_A, ['PV/D2.txt'], { resume: 'Encore modifié' })
runs.length = 0
let b = await R.entretenirRapports(keys, { maxDossiers: 1 })
attendu('entretien : 1 dossier périmé réécrit, borné', b.ecrits === 1 && runs.length === 1 && b.examines === 2, JSON.stringify(b))

// ── Interrogation niveau « rapports » sur tout le fonds, puis approfondissement
runs.length = 0
const it = I.creerInterrogation(keys, { question: 'Quels dossiers montrent une société écran ?', niveau: 'rapports' })
attendu('dépôt : niveau rapports, approfondir par défaut, 2 dossiers', it.niveau === 'rapports' && it.approfondir === true && it.plan.length === 2)
ficher(KEY_A, ['PV/D2.txt'], { resume: 'Bouge pour que le rapport soit à refaire' })
r = await I.interrogationsStep(keys)
let lu = I.lireInterrogation(keys, it.id)
attendu('passage : rapport périmé réécrit, puis un verdict par dossier, synthèse, fait', r.etape === 'fait' && runs.filter((x) => x.label === 'rapport').length === 1 && lu.pertinentes.length === 1 && lu.pertinentes[0].dossier === NUM_A && lu.pertinentes[0].chemin === '§ rapport du dossier', JSON.stringify({ r, labels: runs.map((x) => x.label) }))
const verdict = runs.find((x) => x.json)
attendu('verdicts : les rapports sont jugés (entête « rapports de dossier », 2 éléments)', verdict && /2 rapports de dossier à juger/.test(verdict.prompt) && verdict.prompt.includes(`═══ PIÈCE ${NUM_B} :: § rapport du dossier ═══`))
attendu('approfondissement enchaîné : interrogation « pieces » sur le seul dossier retenu', lu.suiteId && I.lireInterrogation(keys, lu.suiteId).niveau === 'pieces' && I.lireInterrogation(keys, lu.suiteId).plan.length === 1 && I.lireInterrogation(keys, lu.suiteId).numero === NUM_A && I.lireInterrogation(keys, lu.suiteId).suiteDe === it.id, JSON.stringify({ suiteId: lu.suiteId }))
const { readProduction } = await import(`${REPO}/scripts/attache/productions.mjs`)
const prod = readProduction(keys, '_hors-dossier', lu.prodId)
attendu('livrable hors dossier : annonce l\'approfondissement', prod && prod.contenu.includes(`Approfondissement lancé : les 1 dossier(s)`) && prod.contenu.includes(lu.suiteId))
r = await I.interrogationsStep(keys)
const suite = I.lireInterrogation(keys, lu.suiteId)
attendu('la suite tourne : pièces du dossier retenu lues, livrable au dossier', r.etape === 'fait' && suite.etat === 'fait' && suite.pertinentes.some((p) => p.chemin === 'PV/D1.txt'), JSON.stringify(r))

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) {
  console.log(`\n${echecs.length} échec(s).`)
  process.exit(1)
}
console.log('\nTous les contrôles passent.')
