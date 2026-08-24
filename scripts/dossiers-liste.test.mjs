/**
 * SIRAL — test de la LISTE DES DOSSIERS servie à l'attaché (lister_dossiers)
 * et des outils de CHANTIER exposés au modèle.
 *
 * Motif : sur un stock réel (une soixantaine d'enquêtes en cours, autant
 * d'archivées), `lister_dossiers(archives:true)` rendait une réponse de
 * ~86 000 caractères — au-delà du plafond de sortie du CLI, qui la déverse
 * dans un fichier que l'attaché ne peut pas rouvrir : la réponse était
 * PERDUE et le stock archivé, de fait, inaccessible (« la liste n'a pas pu
 * être extraite »). Le correctif : rendu compact, filtre, pagination, mode
 * ARCHIVES SEULES, et une page bornée en caractères quoi qu'on demande.
 *
 * Couvre aussi la sortie de secours quand un travail ne tient pas dans une
 * conversation : les outils `chantier_proposer` / `chantier_piloter`, qui
 * déposent un DEVIS dans la bande « Analyses profondes ».
 *
 *   node scripts/dossiers-liste.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-dossiers-test-'))
const DATA_DIR = path.join(SCRATCH, 'data')
fs.mkdirSync(path.join(DATA_DIR, 'vaults'), { recursive: true })

process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { encryptJson, encryptDocBlob } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)

const keyGlobal = crypto.randomBytes(32)
const keyCtx = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': keyCtx.toString('base64') }, 'Admin TEST')

// ── Un stock réaliste : 60 dossiers en cours, 40 archivés, descriptions
// longues et comptes rendus nombreux (c'est ce volume qui faisait déborder).
const LOREM = 'Trafic de stupéfiants en bande organisée — héroïne et cocaïne, secteur Beauvillé, base opérationnelle au 5 rue Vulfran Mollet, interceptions et surveillances en cours. '.repeat(4)
const enquetes = []
for (let i = 1; i <= 100; i++) {
  const archive = i > 60
  enquetes.push({
    id: i,
    numero: `2026/${String(9000 + i)} - ${archive ? 'ARCHIVE' : 'RESEAU'} ${i}`,
    dateCreation: '2026-01-05', dateDebut: '2026-01-05', dateMiseAJour: '2026-06-01T09:00:00.000Z',
    statut: archive ? 'archive' : 'en_cours',
    services: ['BR Amiens', 'SLPJ Amiens'],
    description: `${LOREM} Dossier n°${i}.`,
    infractionNatinfCodes: ['7995'],
    misEnCause: [{ id: 1, nom: i === 12 ? 'MOKRANI Mickael' : `DUPONT ${i}`, role: 'fournisseur', statut: 'actif' }],
    actes: [], todos: [], notes: '',
    comptesRendus: Array.from({ length: 8 }, (_, k) => ({ id: `${i}-${k}`, date: '2026-05-0' + ((k % 9) + 1), contenu: LOREM })),
    ecoutes: [], geolocalisations: [], documents: [],
  })
}
const syncData = { enquetes, audienceResultats: {}, customTags: [], alertRules: [], version: 3 }
fs.writeFileSync(
  path.join(DATA_DIR, 'vaults', 'ctx-crimorg.json'),
  JSON.stringify(encryptJson(keyCtx, { data: syncData, metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 3 } })),
)

const { loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)
const keys = loadKeyring()
const { listEnquetes } = await import(`${REPO}/scripts/attache/dossier.mjs`)
const { dispatchMcp } = await import(`${REPO}/scripts/attache-mcp.mjs`)

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

// ── Portées ────────────────────────────────────────────────────────────
const enCours = listEnquetes(keys)
attendu('défaut = dossiers en cours seuls', enCours.total === 60 && enCours.portee === 'en_cours', `total ${enCours.total}`)
attendu('total des archives annoncé', enCours.totalArchives === 40, `${enCours.totalArchives}`)

const archivesSeules = listEnquetes(keys, { portee: 'archives' })
attendu('portee "archives" = les archivés SEULS',
  archivesSeules.total === 40 && archivesSeules.dossiers.every((d) => d.statut === 'archive'),
  `total ${archivesSeules.total}`)

const toutes = listEnquetes(keys, { portee: 'toutes' })
attendu('portee "toutes" = tout le stock', toutes.total === 100, `total ${toutes.total}`)
attendu('archives:true reste compris comme "toutes"', listEnquetes(keys, { includeArchived: true }).total === 100)

// ── Filtre ─────────────────────────────────────────────────────────────
const parNom = listEnquetes(keys, { portee: 'toutes', filtre: 'mokrani' })
attendu('filtre sur un mis en cause (casse indifférente)', parNom.total === 1 && parNom.dossiers[0].numero.includes('RESEAU 12'), JSON.stringify(parNom.dossiers[0]?.numero))
const parObjet = listEnquetes(keys, { portee: 'archives', filtre: 'vulfran mollet' })
attendu('filtre sur l\'objet, dans les archives seules', parObjet.total === 40 && parObjet.dossiers.length > 0)
attendu('filtre sans résultat rend une liste vide, pas une erreur', listEnquetes(keys, { filtre: 'zzzz-inexistant' }).total === 0)

// ── Pagination ─────────────────────────────────────────────────────────
const p1 = listEnquetes(keys, { portee: 'toutes', limit: 10 })
attendu('page bornée à limit', p1.affiches === 10 && p1.offsetSuivant === 10 && p1.restants === 90, `${p1.affiches}/${p1.restants}`)
const p2 = listEnquetes(keys, { portee: 'toutes', limit: 10, offset: p1.offsetSuivant })
attendu('la page suivante enchaîne sans doublon', p2.dossiers[0].numero !== p1.dossiers[0].numero && p2.offset === 10)
let vus = 0
for (let offset = 0, garde = 0; garde < 50; garde++) {
  const page = listEnquetes(keys, { portee: 'toutes', limit: 25, offset })
  vus += page.affiches
  if (!page.offsetSuivant) break
  offset = page.offsetSuivant
}
attendu('le déroulé des pages couvre TOUT le stock', vus === 100, `${vus} dossiers parcourus`)

// ── Le garde-fou de taille : jamais de réponse perdue ───────────────────
const grosse = listEnquetes(keys, { portee: 'toutes', limit: 300, detail: 'complet' })
const taille = JSON.stringify(grosse).length
attendu('une page reste sous le plafond de sortie du CLI', taille < 60_000, `${taille} caractères`)
attendu('ce qui n\'a pas tenu est annoncé avec son offset',
  grosse.affiches < 100 ? Boolean(grosse.offsetSuivant) && grosse.restants > 0 : true,
  `${grosse.affiches} affichés, reste ${grosse.restants}`)
attendu('l\'ancienne réponse, elle, débordait',
  JSON.stringify(enquetes.map((e) => ({ ...e }))).length > 200_000)

// ── Le même service, vu par le modèle (MCP) ────────────────────────────
async function outil(name, args = {}) {
  const res = await dispatchMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  const texte = res?.result?.content?.[0]?.text || ''
  try { return { texte, json: JSON.parse(texte) } } catch { return { texte, json: null } }
}

const liste = await dispatchMcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
const noms = (liste?.result?.tools || []).map((t) => t.name)
attendu('outils de chantier exposés au modèle',
  ['chantiers_etat', 'chantier_proposer', 'chantier_piloter'].every((n) => noms.includes(n)),
  noms.filter((n) => n.startsWith('chantier')).join(', '))

const schema = (liste?.result?.tools || []).find((t) => t.name === 'lister_dossiers')?.inputSchema
attendu('lister_dossiers annonce portee/filtre/offset/limit',
  ['portee', 'filtre', 'offset', 'limit', 'detail'].every((k) => schema?.properties?.[k]),
  Object.keys(schema?.properties || {}).join(', '))

const viaMcp = await outil('lister_dossiers', { portee: 'archives', limit: 5 })
attendu('lister_dossiers(portee:"archives") passe par le MCP',
  viaMcp.json?.total === 40 && viaMcp.json?.affiches === 5 && viaMcp.json?.offsetSuivant === 5,
  viaMcp.texte.slice(0, 120))
attendu('la sortie MCP tient sous le plafond', viaMcp.texte.length < 220_000, `${viaMcp.texte.length} caractères`)

// Aucun document n'est déposé dans ce bac à sable : le devis doit refuser
// PROPREMENT, avec le remède — pas planter le run.
const devis = await outil('chantier_proposer', { type: 'dossier', numero: '2026/9001 - RESEAU 1', consigne: '5 rue Vulfran Mollet' })
attendu('chantier_proposer refuse proprement un dossier sans pièces',
  String(devis.json?.erreur || '').includes('Aucune pièce déposée'), devis.texte.slice(0, 160))
const liens = await outil('chantier_proposer', { type: 'liens', numeros: ['2026/9001 - RESEAU 1'] })
attendu('chantier "liens" exige au moins deux dossiers',
  String(liens.json?.erreur || '').toLowerCase().includes('deux dossiers'), liens.texte.slice(0, 160))
const piloter = await outil('chantier_piloter', { id: 'inexistant', action: 'lancer' })
attendu('chantier_piloter refuse un identifiant inconnu', Boolean(piloter.json?.erreur), piloter.texte.slice(0, 120))

// ── Le devis, bout en bout : des pièces versées → un chantier dans la bande
// « Analyses profondes », en attente de validation du magistrat.
const { writeDocBlob, docServerKey, attacheTj } = await import(`${REPO}/scripts/attache/store.mjs`)
const { listChantiers } = await import(`${REPO}/scripts/attache/chantier.mjs`)
const CIBLE = '2026/9002 - RESEAU 2'
for (let i = 1; i <= 30; i++) {
  writeDocBlob(attacheTj(), docServerKey(CIBLE), `PV/Proc1/D${i}_audition.txt`,
    encryptDocBlob(keyGlobal, Buffer.from(`Audition n°${i} — 5 rue Vulfran Mollet, appartement 4.`, 'utf8')), { savedBy: 'test' })
}
const propose = await outil('chantier_proposer', { type: 'dossier', numero: CIBLE, consigne: 'Relever toute mention du 5 rue Vulfran Mollet' })
const devisRendu = propose.json?.chantiers?.[0]
attendu('chantier_proposer dépose un DEVIS (rien n\'est lancé)', devisRendu?.etat === 'devis', propose.texte.slice(0, 200))
attendu('le devis est chiffré : pièces, lots, jetons, heures, nuits',
  devisRendu?.estimation?.pieces === 30 && devisRendu.estimation.lots >= 3
  && devisRendu.estimation.heures > 0 && devisRendu.estimation.nuits >= 1,
  JSON.stringify(devisRendu?.estimation))
attendu('le cumul du devis est rendu au modèle', propose.json?.devis?.pieces === 30)

const dansLaBande = listChantiers(keys).find((c) => c.id === devisRendu?.id)
attendu('le chantier apparaît dans la bande « Analyses profondes »', Boolean(dansLaBande), `${listChantiers(keys).length} chantier(s)`)
attendu('la bande le montre comme déposé par l\'attaché', dansLaBande?.origine === 'attache', dansLaBande?.origine)
attendu('son angle reprend la demande du magistrat', String(dansLaBande?.consigne || '').includes('Vulfran Mollet'))
attendu('le journal dit d\'où il vient',
  (dansLaBande?.journal || []).some((j) => j.evenement.includes('proposé par l\'attaché')),
  (dansLaBande?.journal || [])[0]?.evenement?.slice(0, 90))

const lance = await outil('chantier_piloter', { id: devisRendu.id, action: 'lancer' })
attendu('chantier_piloter lance le chantier validé', lance.json?.etat === 'en_cours', lance.texte.slice(0, 160))
const enPause = await outil('chantier_piloter', { id: devisRendu.id, action: 'pause' })
attendu('… et sait le mettre en pause sans perte', enPause.json?.etat === 'pause', enPause.texte.slice(0, 160))

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) {
  console.error(`\n❌ ${echecs.length} échec(s) : ${echecs.join(' · ')}`)
  process.exit(1)
}
console.log('\n✅ TOUS LES TESTS PASSENT')
