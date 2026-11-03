/**
 * SIRAL — test de l'INTERROGATION DU FONDS (question large, lecture
 * exhaustive pilotée par la question).
 *
 * Vérifie :
 *   - le dépôt fige un plan (un dossier, ou tout le fonds) sans jeton ;
 *   - les verdicts : le prompt porte la question et les pièces entières, une
 *     pièce longue est lue en tranches et son verdict fusionné ;
 *   - un lot en échec ne saute aucune pièce (curseur remis), trois échecs
 *     consécutifs mettent l'interrogation en échec ;
 *   - forfait saturé : différé, rien ne tourne ;
 *   - fin de plan : contrôle d'élusion (pièces écartées relues, pièce
 *     retrouvée comptée), synthèse, livrable rangé et carte au fil ;
 *   - niveau « fiches » : pièces sans fiche nommées non lues ;
 *   - interrogation_arreter : plus rien ne tourne.
 *
 *   node scripts/attache-interrogation.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-interrogation-test-'))
const DATA_DIR = path.join(SCRATCH, 'data')
const VAULTS = path.join(DATA_DIR, 'vaults')
fs.mkdirSync(VAULTS, { recursive: true })
process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { encryptJson, decryptJson, encryptDocBlob } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)
const keyGlobal = crypto.randomBytes(32)
const keyCtx = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': keyCtx.toString('base64') }, 'Audran CHEVALIER')
const keys = loadKeyring()

const NUM_A = '700/1/2026 - ALPHA'
const NUM_B = '700/2/2026 - BRAVO'
fs.writeFileSync(path.join(VAULTS, 'ctx-crimorg.json'), JSON.stringify(encryptJson(keyCtx, {
  data: {
    enquetes: [
      { id: 1, numero: NUM_A, statut: 'en_cours', tags: [], actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [], misEnCause: [] },
      { id: 2, numero: NUM_B, statut: 'archive', tags: [], actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [], misEnCause: [] },
    ],
    version: 1,
  },
  metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 1 },
})))

const { writeDocBlob, docServerKey, attacheTj } = await import(`${REPO}/scripts/attache/store.mjs`)
const KEY_A = docServerKey(NUM_A)
const KEY_B = docServerKey(NUM_B)
const PIECES_A = {
  'PV/D1_audition.txt': 'Audition de DURAND : il reconnaît avoir loué un local au nom de la SASU ECRAN pour stocker la marchandise.',
  'PV/D2_surveillance.txt': 'Surveillance du hall : rien à signaler.',
  'PV/D3_longue.txt': 'Transcription. '.repeat(6_000) + ' Le transporteur TRANSNORD a livré les colis au local de la SASU ECRAN.', // ~90 000 caractères : 10 tranches, deux lots
}
const PIECES_B = {
  'PV/D1_audition_LEROY.txt': 'LEROY déclare ne rien savoir des sociétés.',
}
for (const [rel, t] of Object.entries(PIECES_A)) writeDocBlob(attacheTj(), KEY_A, rel, encryptDocBlob(keyGlobal, Buffer.from(t, 'utf8')), { savedBy: 'test' })
for (const [rel, t] of Object.entries(PIECES_B)) writeDocBlob(attacheTj(), KEY_B, rel, encryptDocBlob(keyGlobal, Buffer.from(t, 'utf8')), { savedBy: 'test' })
const { ingestPass } = await import(`${REPO}/scripts/attache/ingest.mjs`)
for (let i = 0; i < 5; i++) { const r = await ingestPass(keys); if (!r.dossiers) break }

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

const I = await import(`${REPO}/scripts/attache/interrogation.mjs`)
const runs = []
// Le faux modèle : pertinent dès que « ECRAN » (la société écran) figure dans la tranche ;
// au contrôle d'élusion, la surveillance « rien à signaler » est soudain jugée pertinente.
let panne = 0
let controleTrouve = false
I.configurerInterrogation({
  runModele: async ({ prompt, json }) => {
    runs.push({ prompt, json })
    if (panne > 0) { panne--; return { ok: false, error: 'délai dépassé' } }
    if (!json) return { ok: true, texte: '## Ce que les pièces établissent\nDURAND a loué un local au nom de la SASU ECRAN [700/1/2026 - ALPHA] PV/D1_audition.txt. '.repeat(3), envelope: {} }
    const ids = [...prompt.matchAll(/═══ PIÈCE (.+?) ═══\n([\s\S]*?)(?=\n\n═══ PIÈCE |$)/g)]
    const data = ids.map(([, id, texte]) => {
      const pert = /ECRAN/.test(texte) || (controleTrouve && /rien à signaler/.test(texte))
      return { chemin: id, pertinent: pert, score: pert ? 0.9 : 0.1, justification: pert ? 'Société écran nommée.' : '', extraits: pert ? ['SASU ECRAN'] : [] }
    })
    return { ok: true, data, envelope: {} }
  },
})

// ── Dépôt
let err = null
try { I.creerInterrogation(keys, { question: 'court' }) } catch (e) { err = e }
attendu('question trop courte refusée', Boolean(err))
const unDossier = I.creerInterrogation(keys, { question: 'Quelles pièces évoquent une société écran ?', numero: '700/1/2026' })
attendu('dépôt sur UN dossier : numéro canonique, 3 pièces, aucun run', unDossier.numero === NUM_A && unDossier.total === 3 && unDossier.plan.length === 1 && runs.length === 0, JSON.stringify({ numero: unDossier.numero, total: unDossier.total }))
const fonds = I.creerInterrogation(keys, { question: 'Quelles pièces évoquent une société écran ou un transporteur ?' })
attendu('dépôt sur tout le fonds : 2 dossiers (archivé compris), 4 pièces', fonds.plan.length === 2 && fonds.total === 4, JSON.stringify(fonds.plan.map((p) => [p.dossier, p.rels.length])))
attendu('sommaire : la plus récente d\'abord, en attente', I.sommaireInterrogations(keys)[0].id === fonds.id && I.sommaireInterrogations(keys).every((x) => x.etat === 'attente'))
I.arreterInterrogation(keys, fonds.id)
attendu('arrêt : état arretee', I.lireInterrogation(keys, fonds.id).etat === 'arretee')

// ── Forfait saturé
let r = await I.interrogationsStep(keys, { onHold: async () => true })
attendu('forfait saturé : différé, aucun run', r.etape === 'differe' && runs.length === 0, JSON.stringify(r))

// ── Un lot en échec ne saute rien
panne = 1
r = await I.interrogationsStep(keys, { maxLots: 1 })
let it = I.lireInterrogation(keys, unDossier.id)
attendu('lot en échec : curseur remis, 1 échec compté, en cours', r.etape === 'lot_echoue' && it.curseur.source === 0 && it.curseur.piece === 0 && it.echecs === 1 && it.etat === 'en_cours', JSON.stringify({ r, curseur: it.curseur, echecs: it.echecs }))

// ── Les verdicts, lot par lot (1 lot par passage pour observer)
r = await I.interrogationsStep(keys, { maxLots: 1 })
it = I.lireInterrogation(keys, unDossier.id)
const p1 = runs.at(-1).prompt
attendu('prompt : la question et la consigne « verdict » y sont', p1.includes('société écran ?') && p1.includes('tableau JSON strict'))
attendu('prompt : les pièces entières, entêtées « dossier :: chemin »', p1.includes(`═══ PIÈCE ${NUM_A} :: PV/D1_audition.txt ═══`) && p1.includes('loué un local'))
attendu('pièce longue : lue en tranches, le lot plein avant sa fin (6 tranches sur 11)', /\[partie 1\/11\]/.test(p1) && /\[partie 6\/11\]/.test(p1) && !/\[partie 7\/11\]/.test(p1), (p1.match(/\[partie [^\]]+\]/g) || []).join(' '))
attendu('après le 1er lot : D1 retenue, D2 écartée, D3 en cours (6 tranches jugées, pas encore soldée)', it.pertinentes.length === 1 && it.pertinentes[0].chemin === 'PV/D1_audition.txt' && it.ecartees.length === 1 && it.enCours?.chemin === 'PV/D3_longue.txt' && it.enCours.faites === 6 && r.etape === 'lots', JSON.stringify({ r, enCours: it.enCours && { chemin: it.enCours.chemin, faites: it.enCours.faites, parties: it.enCours.parties } }))

// ── Fin de plan : contrôle d'élusion + synthèse + livrable
controleTrouve = true
r = await I.interrogationsStep(keys, { maxLots: 1 })
it = I.lireInterrogation(keys, unDossier.id)
attendu('pièce longue soldée : pertinente par sa dernière tranche, verdict fusionné', it.pertinentes.some((p) => p.chemin === 'PV/D3_longue.txt' && p.score >= 0.9 && p.extraits.includes('SASU ECRAN')), JSON.stringify(it.pertinentes.map((p) => p.chemin)))
attendu('interrogation faite', r.etape === 'fait' && it.etat === 'fait' && Boolean(it.prodId), JSON.stringify(r))
attendu('contrôle d\'élusion : la pièce écartée relue et retrouvée, taux 100 %, écartées vidées', it.elusion?.echantillon === 1 && it.elusion.trouvees === 1 && it.elusion.taux === 1 && it.ecartees.length === 0 && it.pertinentes.some((p) => p.chemin === 'PV/D2_surveillance.txt' && p.controle), JSON.stringify(it.elusion))
const synth = runs.find((x) => !x.json)
attendu('synthèse : prompt avec la couverture, l\'élusion et les pièces retenues (extraits)', synth && synth.prompt.includes('Contrôle d\'élusion : 1 pièce(s)') && synth.prompt.includes('« SASU ECRAN »') && synth.prompt.includes('[700/1/2026 - ALPHA] PV/D1_audition.txt'))
const { readProduction } = await import(`${REPO}/scripts/attache/productions.mjs`)
const prod = readProduction(keys, NUM_A, it.prodId)
attendu('livrable rangé au dossier : synthèse + pièces retenues + couverture', prod?.type === 'livrable' && prod.contenu.includes('## Ce que les pièces établissent') && prod.contenu.includes('PIÈCES RETENUES (3)') && prod.contenu.includes('rappel estimé 100 %'), String(prod?.contenu || '').slice(0, 200))
const { readFeed } = await import(`${REPO}/scripts/attache/journal.mjs`)
const carte = readFeed(10).map((l) => { try { return decryptJson(keyGlobal, { iv: l.iv, ct: l.ct }) } catch { return null } }).find((c) => c?.type === 'livrable')
attendu('carte « livrable » au fil, reliée à la production', carte && carte.prodId === it.prodId && carte.numero === NUM_A)
const detail = I.detailInterrogation(keys, unDossier.id, { limite: 2 })
attendu('interrogation_lire : synthèse, pièces paginées (les mieux notées d\'abord), avancement complet', detail.synthese && detail.piecesRetenues.length === 2 && detail.offsetSuivant === 2 && detail.avancement.lues === 3 && detail.avancement.restantes === 0, JSON.stringify(detail.avancement))
attendu('plus rien à faire (l\'arrêtée ne tourne pas)', await I.interrogationsStep(keys) === null)

// ── Trois échecs consécutifs : échec
const casse = I.creerInterrogation(keys, { question: 'Une question qui ne marchera pas cette fois.', numero: NUM_B })
panne = 3
for (let i = 0; i < 3; i++) await I.interrogationsStep(keys, { maxLots: 1 })
attendu('trois échecs consécutifs : interrogation en échec, rien ne boucle', I.lireInterrogation(keys, casse.id).etat === 'echec' && await I.interrogationsStep(keys) === null)

// ── Niveau fiches : sans fiche au registre → non lue
const fiches = I.creerInterrogation(keys, { question: 'Quelles fiches parlent de LEROY ?', numero: NUM_B, niveau: 'fiches' })
r = await I.interrogationsStep(keys)
it = I.lireInterrogation(keys, fiches.id)
attendu('niveau fiches, pièce sans fiche : nommée non lue, aucun verdict demandé', it.nonLues.length === 1 && it.nonLues[0].raison === 'sans fiche au registre' && it.pertinentes.length === 0, JSON.stringify({ r, nonLues: it.nonLues }))

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) {
  console.log(`\n${echecs.length} échec(s).`)
  process.exit(1)
}
console.log('\nTous les contrôles passent.')
