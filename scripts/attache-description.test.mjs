/**
 * SIRAL — test de la DESCRIPTION À LA DEMANDE (données jointes, sans modèle).
 *
 * Vérifie :
 *   - les données jointes au prompt couvrent TOUT le dossier : description
 *     actuelle (ou « vide »), TOUS les CR en texte brut, les actes, le
 *     sommaire du registre de chaque pièce fichée, et la liste des pièces
 *     encore sans fiche ;
 *   - le prompt « description » exige l'écriture (plus de sortie silencieuse) ;
 *   - une première description écrite sur un dossier VIDE laisse une entrée
 *     d'historique (sans elle, la fusion du navigateur l'ignorait).
 *
 *   node scripts/attache-description.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-desc-test-'))
const DATA_DIR = path.join(SCRATCH, 'siral-test-data')
fs.mkdirSync(path.join(DATA_DIR, 'vaults'), { recursive: true })

process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { encryptJson, encryptDocBlob } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)

const keyGlobal = crypto.randomBytes(32)
const keyCtx = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': keyCtx.toString('base64') }, 'Audran CHEVALIER')
const keys = loadKeyring()

const NUM = '348/1545/2026 - DESCTEST'
const syncData = {
  enquetes: [{
    id: 1, numero: NUM, dateDebut: '2026-02-01', statut: 'en_cours', description: '',
    tags: [], actes: [], geolocalisations: [],
    ecoutes: [{ id: 5, numero: '06.11.22.33.44', dateDebut: '2026-03-01', dateFin: '2026-04-01', statut: 'en_cours' }],
    comptesRendus: [
      { id: 2, date: '2026-03-10', enqueteur: 'OPJ B', description: '<p>Rixe <b>quartier Nord</b> entre bandes rivales.</p>' },
      { id: 3, date: '2026-02-05', enqueteur: 'OPJ A', description: 'Premier CR : point de deal rue des Lilas.' },
    ],
    misEnCause: [{ id: 1, nom: 'KARIM Ali', role: 'gérant du point', statut: 'actif' }],
    infractionNatinfCodes: ['7101'],
  }],
  audienceResultats: {}, customTags: [], alertRules: [], version: 1,
}
fs.writeFileSync(
  path.join(DATA_DIR, 'vaults', 'ctx-crimorg.json'),
  JSON.stringify(encryptJson(keyCtx, { data: syncData, metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 1 } }))
)

const { writeDocBlob, docServerKey, attacheTj } = await import(`${REPO}/scripts/attache/store.mjs`)
const { readRegistre, writeRegistre } = await import(`${REPO}/scripts/attache/registre.mjs`)
const { loadContentieux, actualiserDescription } = await import(`${REPO}/scripts/attache/dossier.mjs`)
const { donneesDescription, couverturePieces, avancement, estimerTotalMs, estimerRedactionMs, observerRedaction } = await import(`${REPO}/scripts/attache/description.mjs`)
const { appendDossierMemory } = await import(`${REPO}/scripts/attache/dossierMemory.mjs`)
const { SOCLES } = await import(`${REPO}/scripts/attache/consignes.mjs`)

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

const KEY = docServerKey(NUM)
for (const rel of ['PV/audition_KARIM.pdf', 'PV/surveillance.pdf', 'MD/audition_KARIM.md']) {
  writeDocBlob(attacheTj(), KEY, rel, encryptDocBlob(keyGlobal, Buffer.from('x', 'utf8')), { savedBy: 'greffe' })
}
const reg = readRegistre(keys, KEY)
reg.pieces['PV/audition_KARIM.pdf'] = {
  fiche: { type: 'PV audition', datePiece: '2026-03-12', personnes: [{ nom: 'KARIM Ali', alias: 'Kiki', role: 'mis en cause' }], resume: 'KARIM reconnaît tenir le point de deal.' },
  entites: { telephones: ['0611223344'] },
}
writeRegistre(keys, KEY, reg)

const cov = couverturePieces(keys, NUM)
attendu('couverture : 2 pièces serveur (jumeau MD/ exclu), 1 fichée, 1 sans fiche',
  cov.total === 2 && cov.fichees.length === 1 && cov.sansFiche[0] === 'PV/surveillance.pdf', JSON.stringify({ total: cov.total, sansFiche: cov.sansFiche }))

const txt = donneesDescription(keys, NUM).join('\n')
attendu('description vide signalée', txt.includes('(vide — à rédiger entièrement)'))
attendu('tous les CR joints, du plus ancien au plus récent, HTML retiré',
  txt.indexOf('Premier CR') > -1 && txt.indexOf('Premier CR') < txt.indexOf('Rixe quartier Nord') && !txt.includes('<b>'))
attendu('actes joints', txt.includes('06.11.22.33.44'))
attendu('fiche du registre jointe (résumé, personnes, entités)',
  txt.includes('KARIM reconnaît tenir le point de deal.') && txt.includes('KARIM Ali dit Kiki [mis en cause]') && txt.includes('0611223344'))
attendu('pièce sans fiche listée', txt.includes('- PV/surveillance.pdf'))
attendu('mis en cause enregistrés joints', txt.includes('KARIM Ali (gérant du point) [actif]'))

attendu('sections de contexte jointes (mémoire, MEC ailleurs, liens carto, entités partagées)',
  ['MÉMOIRE DU DOSSIER', 'MIS EN CAUSE CONNUS AILLEURS', 'LIENS DÉJÀ TRACÉS SUR LA CARTE', 'ENTITÉS PARTAGÉES'].every((t) => txt.includes(t)))
attendu('aucune marque ★ avant toute actualisation', !txt.includes('★'))
attendu('le prompt couvre rôles courts, suspects, liens et mémoire',
  ['modifier_mec', 'proposer_mec', 'proposer_lien', 'memoire_dossier_noter', '2 à 6 mots'].every((t) => SOCLES.description.includes(t)))

attendu('le prompt exige l\'écriture', SOCLES.description.includes('TOUJOURS') && !SOCLES.description.includes('termine sans appeler actualiser_description'))

await actualiserDescription(keys, { numero: NUM, description: 'SYNTHÈSE\nRixe.\nMIS EN CAUSE\nKARIM Ali — gérant.' })
const e = loadContentieux(keys).data.enquetes.find((x) => x.numero === NUM)
attendu('première description écrite', e.description.startsWith('SYNTHÈSE'))
attendu('entrée d\'historique même depuis une description vide',
  Array.isArray(e.descriptionHistory) && e.descriptionHistory.length === 1 && e.descriptionHistory[0].description === '')

// Après actualisation : un CR créé ensuite est marqué ★, l'acquis non.
await new Promise((ok) => setTimeout(ok, 5))
const payload = loadContentieux(keys)
payload.data.enquetes[0].comptesRendus.push({ id: Date.now() + 1000, date: '2026-10-01', description: 'Interpellation de KARIM.' })
fs.writeFileSync(
  path.join(DATA_DIR, 'vaults', 'ctx-crimorg.json'),
  JSON.stringify(encryptJson(keyCtx, { data: payload.data, metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 2 } }))
)
await appendDossierMemory(keys, NUM, 'KARIM dit Kiki — ligne 0611223344.')
const txt2 = donneesDescription(keys, NUM).join('\n')
attendu('nouveau CR marqué ★, ancien non', txt2.includes('[★ CR 2026-10-01') && !txt2.includes('★ CR 2026-03-10'))
attendu('mémoire du dossier jointe', txt2.includes('KARIM dit Kiki — ligne 0611223344.'))

// Avancement : borné à 97 % tant que non fini, 100 % une fois fini.
const total = estimerTotalMs({ lotsFiches: 1, chars: 50_000 })
const a1 = avancement({ numero: NUM, debut: 0, finEstimeeAt: total, phase: 'redaction', etapes: [] }, total / 2)
const a2 = avancement({ numero: NUM, debut: 0, finEstimeeAt: total, phase: 'redaction', etapes: [] }, total * 3)
const a3 = avancement({ numero: NUM, debut: 0, finEstimeeAt: total, phase: 'fin', etapes: [], fini: true }, 10)
attendu('avancement à mi-course ≈ 50 %', a1.pourcent === 50 && a1.restantMs === total / 2, JSON.stringify(a1))
attendu('dépassement plafonné à 97 %, 0 restant', a2.pourcent === 97 && a2.restantMs === 0)
attendu('fini → 100 %', a3.pourcent === 100)
const avant = estimerRedactionMs(100_000)
observerRedaction(avant * 2, avant)
attendu('un run plus lent que prévu allonge l\'estimation suivante', estimerRedactionMs(100_000) > avant)

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) { console.log(`\n${echecs.length} échec(s).`); process.exit(1) }
console.log('\nTous les tests passent.')
