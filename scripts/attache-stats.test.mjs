/**
 * SIRAL — test de bout en bout des outils STATISTIQUES de l'attaché
 * (stats_synthese, stats_graphique).
 *
 * Fabrique un SIRAL_DATA_DIR réel (clé-maître, trousseau remis, coffre
 * ctx-crimorg chiffré avec un SyncData réaliste — enquêtes, résultats
 * d'audience, défèrements, saisies), lance scripts/attache-mcp.mjs en stdio
 * JSON-RPC EXACTEMENT comme le CLI Claude Code, puis appelle les outils et
 * vérifie les chiffres attendus (miroir des règles de la page Statistiques)
 * et la présence des images PNG dans les réponses.
 *
 *   node scripts/attache-stats.test.mjs
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-stats-test-'))
const DATA_DIR = path.join(SCRATCH, 'siral-test-data')
fs.rmSync(DATA_DIR, { recursive: true, force: true })
fs.mkdirSync(path.join(DATA_DIR, 'vaults'), { recursive: true })

process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { encryptJson } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)

// ── Clés : global + ctx-crimorg
const keyGlobal = crypto.randomBytes(32)
const keyCtx = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': keyCtx.toString('base64') }, 'Audran CHEVALIER')

// ── Données réalistes : 6 enquêtes, résultats d'audience S1 2026
const enquetes = [
  {
    id: 1, numero: '85103/843/2026 - FRETCARGO', dateCreation: '2025-11-03', dateDebut: '2025-11-03',
    statut: 'archive', services: [], description: 'Vols de fret en bande organisée sur aires A1/A29',
    tags: [{ id: 't1', value: 'OFAST', category: 'services' }, { id: 't2', value: 'JIRS', category: 'suivi' }],
    infractionNatinfCodes: ['7151'], misEnCause: [], actes: [], comptesRendus: [], notes: '',
    ecoutes: [{ id: 11, dateDebut: '2026-01-10', dateFin: '2026-03-10', duree: '30', statut: 'termine', prolongationsHistory: [{ date: '2026-02-09', dureeAjoutee: '30', dureeInitiale: '30' }] }],
    geolocalisations: [{ id: 12, dateDebut: '2026-01-15', dateFin: '2026-02-15', duree: '15', statut: 'termine' }],
  },
  {
    id: 2, numero: '85104/210/2026 - MA STUP', dateCreation: '2026-02-12', dateDebut: '2026-02-12',
    statut: 'archive', description: 'Trafic de stupéfiants depuis la maison d\'arrêt',
    tags: [{ id: 't3', value: 'BR Amiens', category: 'services' }],
    infractionNatinfCodes: ['7995'], misEnCause: [], actes: [], comptesRendus: [], notes: '',
    ecoutes: [{ id: 21, dateDebut: '2026-03-02', dateFin: '2026-04-01', duree: '30', statut: 'termine' }],
    geolocalisations: [],
  },
  {
    id: 3, numero: '85105/300/2026 - RESEAU NORD', dateCreation: '2026-03-05', dateDebut: '2026-03-05',
    statut: 'en_cours', description: 'Réseau d\'importation — enquête en cours',
    tags: [{ id: 't4', value: 'OFAST', category: 'services' }, { id: 't5', value: 'PG', category: 'suivi' }],
    infractionNatinfCodes: ['7995', '20654'], misEnCause: [], actes: [], comptesRendus: [], notes: '',
    ecoutes: [], geolocalisations: [{ id: 31, dateDebut: '2026-05-02', dateFin: '2026-05-17', duree: '15', statut: 'en_cours' }],
  },
  {
    id: 4, numero: '85106/415/2026 - BLANCHIPRO', dateCreation: '2026-04-15', dateDebut: '2026-04-15',
    statut: 'archive', description: 'Blanchiment — société écran',
    tags: [{ id: 't6', value: 'PJ Lille', category: 'services' }],
    infractionNatinfCodes: ['20654'], misEnCause: [], actes: [], comptesRendus: [], notes: '',
    ecoutes: [], geolocalisations: [],
  },
  {
    id: 5, numero: '85107/501/2026 - GRIVESNES', dateCreation: '2026-05-20', dateDebut: '2026-05-20',
    statut: 'en_cours', description: 'Vols avec arme',
    tags: [{ id: 't7', value: 'BR Amiens', category: 'services' }],
    infractionNatinfCodes: ['7151'], misEnCause: [], actes: [], comptesRendus: [], notes: '',
    ecoutes: [], geolocalisations: [],
  },
  {
    id: 6, numero: '85108/600/2025 - VIEUX', dateCreation: '2025-06-01', dateDebut: '2025-06-01',
    statut: 'archive', description: 'Dossier 2025 jugé en 2025 (hors période)',
    tags: [], infractionNatinfCodes: ['7995'], misEnCause: [], actes: [], comptesRendus: [], notes: '',
    ecoutes: [], geolocalisations: [],
  },
]

const audienceResultats = {
  'crimorg__1': {
    enqueteId: 1, contentieuxId: 'crimorg', dateAudience: '2026-02-20', modifiedAt: '2026-02-20T10:00:00Z',
    condamnations: [
      { nom: 'A', peinePrison: 24, sursisProbatoire: 0, sursisSimple: 0, peineAmende: 5000, interdictionParaitre: true, interdictionGerer: false, typeAudience: 'CI', defere: true, dateDefere: '2026-01-18' },
      { nom: 'B', peinePrison: 12, sursisProbatoire: 6, sursisSimple: 0, peineAmende: 0, interdictionParaitre: false, interdictionGerer: false, typeAudience: 'CI', defere: true, dateDefere: '2026-01-18' },
    ],
    confiscations: { vehicules: [{ type: 'utilitaire' }], immeubles: [], numeraire: 12000, saisiesBancaires: [{ montant: 30000 }], cryptomonnaies: [], objetsMobiliers: [] },
    saisies: { vehicules: [{ type: 'utilitaire' }, { type: 'voiture' }], immeubles: [], numeraire: 15000, saisiesBancaires: [{ montant: 30000 }], cryptomonnaies: [], objetsMobiliers: [{ categorie: 'luxe', quantite: 3 }] },
    infractionNatinfCodes: ['7151'], typeInfraction: 'Vol en bande organisée', service: 'OFAST',
  },
  'crimorg__2': {
    enqueteId: 2, contentieuxId: 'crimorg', dateAudience: '2026-05-12', modifiedAt: '2026-05-12T10:00:00Z',
    condamnations: [
      { nom: 'C', peinePrison: 30, sursisProbatoire: 0, sursisSimple: 0, peineAmende: 10000, interdictionParaitre: false, interdictionGerer: false, typeAudience: 'CRPC-Def', defere: true, dateDefere: '2026-05-12' },
      // Relaxe : déférée et jugée, mais NI condamnée NI comptée comme CRPC.
      { nom: 'R', peinePrison: 0, sursisProbatoire: 0, sursisSimple: 0, peineAmende: 0, interdictionParaitre: false, interdictionGerer: false, typeAudience: 'CRPC-Def', defere: true, dateDefere: '2026-05-12', isRelaxe: true },
    ],
    confiscations: { vehicules: [], immeubles: [], numeraire: 4000, saisiesBancaires: [], cryptomonnaies: [{ montantEur: 8000 }], objetsMobiliers: [] },
    infractionNatinfCodes: ['7995'], typeInfraction: 'Trafic de stupéfiants', service: 'BR Amiens',
  },
  'crimorg__4': {
    enqueteId: 4, contentieuxId: 'crimorg', dateAudience: '2026-06-25', modifiedAt: '2026-06-25T10:00:00Z',
    condamnations: [], isOI: true,
    confiscations: { vehicules: [], immeubles: [], numeraire: 0, saisiesBancaires: [], cryptomonnaies: [], objetsMobiliers: [] },
    infractionNatinfCodes: ['20654'],
  },
  'crimorg__6': {
    enqueteId: 6, contentieuxId: 'crimorg', dateAudience: '2025-03-10', modifiedAt: '2025-03-10T10:00:00Z',
    condamnations: [{ nom: 'Z', peinePrison: 10, sursisProbatoire: 0, sursisSimple: 0, peineAmende: 0, interdictionParaitre: false, interdictionGerer: false, typeAudience: 'CI', defere: true }],
    confiscations: { vehicules: [], immeubles: [], numeraire: 2000, saisiesBancaires: [], cryptomonnaies: [], objetsMobiliers: [] },
    infractionNatinfCodes: ['7995'],
  },
  // procédure directe (permanence) jugée dans la période
  'crimorg__direct-1': {
    enqueteId: 9001, contentieuxId: 'crimorg', isDirectResult: true, dateAudience: '2026-03-18', modifiedAt: '2026-03-18T10:00:00Z',
    condamnations: [{ nom: 'D', peinePrison: 8, sursisProbatoire: 0, sursisSimple: 4, peineAmende: 800, interdictionParaitre: false, interdictionGerer: false, typeAudience: 'CI', defere: true, dateDefere: '2026-03-16' }],
    confiscations: { vehicules: [], immeubles: [], numeraire: 0, saisiesBancaires: [], cryptomonnaies: [], objetsMobiliers: [] },
    typeInfraction: 'Trafic de stupéfiants', service: 'CSP Amiens',
  },
}

const syncData = { enquetes, audienceResultats, customTags: [], alertRules: [], version: 3 }
const envelope = encryptJson(keyCtx, { data: syncData, metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 3 } })
fs.writeFileSync(path.join(DATA_DIR, 'vaults', 'ctx-crimorg.json'), JSON.stringify(envelope))

// ── Coffre instruction (module instruction : onglet « Statistiques instruction »)
const dossiersInstruction = [
  {
    id: 1, numeroInstruction: '1/26/8', numeroParquet: '85103/843/2026', cabinetId: 'cab-1',
    dateOuverture: '2026-01-20', dateMiseAJour: '2026-06-01', cotesTomes: 12, etatReglement: '175_recu',
    evenements: [{ type: '175_rendu', date: '2026-06-01' }],
    misEnExamen: [
      { nom: 'A', mesureSurete: { type: 'detenu', depuis: '2026-01-20', periodes: [{ dateFin: '2026-07-20' }] }, dmls: [{ statut: 'en_attente', dateDepot: '2026-06-10' }] },
      { nom: 'B', mesureSurete: { type: 'cj', depuis: '2026-02-01' }, dmls: [] },
      { nom: 'C', dmls: [] },
    ],
    debatsJLD: [],
  },
  {
    id: 2, numeroInstruction: '2/26/8', numeroParquet: '85109/700/2026', cabinetId: 'cab-2',
    dateOuverture: '2025-09-01', dateMiseAJour: '2026-05-01', cotesTomes: 4,
    misEnExamen: [{ nom: 'D', mesureSurete: { type: 'arse', depuis: '2025-10-01' }, dmls: [] }],
    debatsJLD: [],
  },
]
const envInstruction = encryptJson(keyGlobal, { dossiers: dossiersInstruction })
fs.writeFileSync(path.join(DATA_DIR, 'vaults', 'instructions-audran.json'), JSON.stringify(envInstruction))

// ── Lancement du serveur MCP en stdio, comme le CLI
const child = spawn('node', [path.join(REPO, 'scripts/attache-mcp.mjs')], {
  env: { ...process.env, SIRAL_ATTACHE_RUN: 'chat' },
  stdio: ['pipe', 'pipe', 'inherit'],
})

let buffer = ''
const pending = new Map()
child.stdout.on('data', (c) => {
  buffer += c.toString()
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
})

let nextId = 1
function rpc(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)) } }, 30000)
  })
}

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} })
const tools = await rpc('tools/list', {})
const noms = tools.result.tools.map((t) => t.name)
attendu('outils stats présents', noms.includes('stats_synthese') && noms.includes('stats_graphique'), noms.filter((n) => n.startsWith('stats')).join(', '))

// ── stats_synthese S1 2026
const syn = await rpc('tools/call', { name: 'stats_synthese', arguments: { du: '2026-01-01', au: '2026-06-30' } })
const bilan = JSON.parse(syn.result.content[0].text)
attendu('pas d\'erreur synthese', !syn.result.isError, syn.result.isError ? syn.result.content[0].text.slice(0, 300) : '')

// terminées : enquêtes 1 (20/02) + 2 (12/05) + directe (18/03) = 3 hors classements/OI ; l'OI (dossier 4) est listée mais hors total
attendu('terminées total = 3', bilan.proceduresTerminees.total === 3, `obtenu ${bilan.proceduresTerminees.total}`)
attendu('liste terminées = 4 (avec OI)', bilan.proceduresTerminees.liste.length === 4, `obtenu ${bilan.proceduresTerminees.liste.length}`)
attendu('OI listée et marquée', bilan.proceduresTerminees.liste.some((t) => t.orientation === "ouverture d'information" && t.classementOuOI === true))
attendu('dossier 2025 exclu', !bilan.proceduresTerminees.liste.some((t) => String(t.numero || '').includes('VIEUX')))
attendu('terminées par mois : févr=1 mai=1 mars=1', bilan.proceduresTerminees.parMois['2026-02'] === 1 && bilan.proceduresTerminees.parMois['2026-05'] === 1 && bilan.proceduresTerminees.parMois['2026-03'] === 1, JSON.stringify(bilan.proceduresTerminees.parMois))

// défèrements : 2 (janv, dossier 1) + 2 (mai, dossier 2 — dont la relaxée) + 1 (mars, directe) = 5 ;
// celui de 2025 exclu. Une relaxe reste un défèrement : la personne a bien été déférée.
attendu('défèrements total = 5', bilan.deferements.total === 5, `obtenu ${bilan.deferements.total}`)
attendu('défèrements mai = 2 (dont la relaxée)', bilan.deferements.parMois['2026-05'] === 2, JSON.stringify(bilan.deferements.parMois))
attendu('défèrements janvier = 2', bilan.deferements.parMois['2026-01'] === 2, JSON.stringify(bilan.deferements.parMois))
attendu('défèrements liste datée avec numéros', bilan.deferements.liste.every((d) => d.date && d.numero))

// ouvertures 2026 S1 : enquêtes 2, 3, 4, 5 = 4
attendu('ouvertures = 4', bilan.ouvertures.total === 4, `obtenu ${bilan.ouvertures.total}`)

// audience : condamnations = 2 + 1 + 1 = 4 (la relaxée du dossier 2 est hors comptage) ;
// CRPC=1 (la relaxe n'en est pas une) ; CI par dossier : dossiers 1 et directe → 2 ; OI=1
attendu('condamnations = 4 (relaxe exclue)', bilan.audience.nombreCondamnations === 4, `obtenu ${bilan.audience.nombreCondamnations}`)
attendu('relaxes = 1', bilan.audience.nombreRelaxes === 1, `obtenu ${bilan.audience.nombreRelaxes}`)
attendu('CRPC = 1 / CI = 2 / OI = 1', bilan.audience.orientations.crpc === 1 && bilan.audience.orientations.ci === 2 && bilan.audience.orientations.oi === 1, JSON.stringify(bilan.audience.orientations))
// prison ferme : 24 + (12 mixte) + 30 + (8 mixte) = 74 mois
attendu('prison ferme = 74 mois', bilan.audience.peines.totalPrisonFermeMois === 74, `obtenu ${bilan.audience.peines.totalPrisonFermeMois}`)
attendu('amendes = 15 800', bilan.audience.peines.montantTotalAmendes === 15800, `obtenu ${bilan.audience.peines.montantTotalAmendes}`)
// avoirs confisqués : 12000 + 30000 + 4000 + 8000 = 54 000 ; saisies enquête : 15000+30000 = 45 000
attendu('confiscations avoirs = 54 000', bilan.audience.confiscationsAudience.total === 54000, `obtenu ${bilan.audience.confiscationsAudience.total}`)
attendu('saisies enquête = 45 000', bilan.audience.saisiesEnquete.total === 45000, `obtenu ${bilan.audience.saisiesEnquete.total}`)

// catégories NATINF : 7995 → ?, 141 → stups, 20792 → blanchiment (à voir), tendance présente
const catsT = Object.fromEntries(bilan.infractions.terminees.map((x) => [x.categorie, x.count]))
attendu('catégories : Stups=2 (dossier + directe fusionnés) et Vol=1', catsT['Trafic de stupéfiants (ILS)'] === 2 && catsT['Vol'] === 1, JSON.stringify(catsT))
attendu('tendance par mois présente', Object.keys(bilan.infractions.tendanceParMois).length === 6)

// actes TSE : écoutes début 2026 : dossier1 (10/01) + dossier2 (02/03) = 2 ; prolongation écoute 09/02 = 1 ; géoloc : 15/01 + 02/05 = 2
attendu('TSE écoutes=2 prol=1 géoloc=2', bilan.actesTse.ecoutes === 2 && bilan.actesTse.prolongationsEcoutes === 1 && bilan.actesTse.geolocalisations === 2, JSON.stringify(bilan.actesTse))

// suivi JIRS/PG : dossier 1 (JIRS, archive jugée dans période) + dossier 3 (PG, en cours)
attendu('suivi JIRS=1 PG=1', bilan.suiviParquetExterieur.jirs === 1 && bilan.suiviParquetExterieur.pg === 1, JSON.stringify(bilan.suiviParquetExterieur))

// comparatif : période précédente = S1 2025 → dossier 6 jugé 10/03/2025 : 1 terminée, 1 défèrement
attendu('comparatif N-1 : 1 terminée avant, 3 maintenant', bilan.comparatifPeriodePrecedente.proceduresTerminees.periodePrecedente === 1 && bilan.comparatifPeriodePrecedente.proceduresTerminees.periode === 3, JSON.stringify(bilan.comparatifPeriodePrecedente.proceduresTerminees))

// services : OFAST (dossier 1), BR Amiens (dossier 2), CSP Amiens (directe)
attendu('répartition services = 4 (OI comprise, comme l\'app)', bilan.repartitionServices.length === 4, JSON.stringify(bilan.repartitionServices))

// ── stats_ecran : LA PAGE STATISTIQUES DU MAGISTRAT, carte par carte (année 2026)
const ecr = await rpc('tools/call', { name: 'stats_ecran', arguments: { annee: 2026 } })
attendu('pas d\'erreur stats_ecran', !ecr.result.isError, ecr.result.isError ? ecr.result.content[0].text.slice(0, 300) : '')
const page = JSON.parse(ecr.result.content[0].text)
const sections = Object.fromEntries(page.sections.map((sec) => [sec.section, Object.fromEntries(sec.cartes.map((c) => [c.carte, c]))]))
const generales = sections['Statistiques générales']
const audienceCartes = sections['Résultats d\'audience']
const infraCartes = sections['Types d\'infractions']
const instruCartes = sections['Statistiques instruction']

attendu('les 4 sections de la page', page.sections.length === 4, page.sections.map((x) => x.section).join(' · '))
attendu('chaque carte porte sa règle', page.sections.every((sec) => sec.cartes.every((c) => typeof c.regle === 'string' && c.regle.length > 20)))

// Mêmes chiffres que l'écran : 3 procédures terminées en 2026 (dont 1 OI listée à part)
attendu('carte « Total des procédures terminées » = 3', generales['Total des procédures terminées'].valeur === 3, JSON.stringify(generales['Total des procédures terminées'].valeur))
attendu('dont 1 OI et 0 classement', generales['Total des procédures terminées'].detail.dontOuverturesInformation === 1
  && generales['Total des procédures terminées'].detail.dontClassementsSansSuite === 0, JSON.stringify(generales['Total des procédures terminées'].detail))
// 5 défèrements, dont celui de la personne relaxée : être relaxé n'annule pas
// le défèrement, c'est le travail de permanence qui est compté ici.
attendu('carte « Évolution des déférements » = 5 (date réelle)', generales['Évolution des déférements'].valeur === 5, String(generales['Évolution des déférements'].valeur))
attendu('déférements des dossiers jugés distingués', generales['Évolution des déférements'].detail.deferementsDansLesDossiersJuges === 5,
  String(generales['Évolution des déférements'].detail.deferementsDansLesDossiersJuges))
attendu('carte « Nombre d\'enquêtes en cours » = 2', generales['Nombre d\'enquêtes en cours'].valeur === 2, String(generales['Nombre d\'enquêtes en cours'].valeur))
attendu('carte « Actes d\'enquête » = 5 avec charge estimée', generales['Actes d\'enquête en préliminaire'].valeur === 5
  && generales['Actes d\'enquête en préliminaire'].detail.estimationCharge.minutesParActe === 35, JSON.stringify(generales['Actes d\'enquête en préliminaire'].valeur))
attendu('comparatif N-1 présent', generales['Comparatif 2025 / 2026'].detail.proceduresTerminees.anneePrecedente === 1
  && generales['Comparatif 2025 / 2026'].detail.proceduresTerminees.annee === 3, JSON.stringify(generales['Comparatif 2025 / 2026'].detail.proceduresTerminees))
attendu('répartition globale par service ≠ terminées', generales['Répartition globale par service (2026)'].detail.length >= generales['Répartition par service des enquêtes terminées (2026)'].detail.length)

// Résultats d'audience : les cartes qui manquaient au connecteur
attendu('carte « Condamnations » = 4', audienceCartes.Condamnations.valeur === 4, String(audienceCartes.Condamnations.valeur))
attendu('carte « Relaxes » = 1, sur 5 personnes jugées', audienceCartes.Relaxes.valeur === 1
  && audienceCartes.Relaxes.detail.personnesJugees === 5
  && audienceCartes.Relaxes.detail.condamnees === 4
  && audienceCartes.Relaxes.detail.personnes[0].nom === 'R', JSON.stringify(audienceCartes.Relaxes.detail))
attendu('carte « Total des peines de prison » = 74 mois', audienceCartes['Total des peines de prison'].detail.mois === 74, String(audienceCartes['Total des peines de prison'].detail.mois))
attendu('carte « Amendes » : moyenne par condamnation', audienceCartes.Amendes.detail.montantTotal === 15800 && audienceCartes.Amendes.detail.moyenneParCondamnation === 3950,
  JSON.stringify(audienceCartes.Amendes.detail.moyenneParCondamnation))
attendu('carte « Delta saisies vs confiscations » = -9 000 €', audienceCartes['Delta saisies vs confiscations'].detail.totalAvoirs.delta === -9000,
  JSON.stringify(audienceCartes['Delta saisies vs confiscations'].detail.totalAvoirs))
attendu('carte « Peines moyennes par type d\'audience » : CI et CRPC-Def', audienceCartes['Peines moyennes par type d\'audience'].detail.map((x) => x.type).sort().join(',') === 'CI,CRPC-Def',
  JSON.stringify(audienceCartes['Peines moyennes par type d\'audience'].detail.map((x) => x.type)))
attendu('carte « Ouvertures d\'information » = 1 avec âge moyen', audienceCartes['Ouvertures d\'information'].valeur === 1
  && audienceCartes['Ouvertures d\'information'].detail.ageMoyenJours > 0, JSON.stringify(audienceCartes['Ouvertures d\'information'].detail))
attendu('carte « Classements sans suite » = 0', audienceCartes['Classements sans suite'].valeur === 0, String(audienceCartes['Classements sans suite'].valeur))
attendu('carte « Interdictions » : 1 interdiction de paraître détaillée', audienceCartes.Interdictions.detail.interdictionsDeParaitre.nombre === 1
  && audienceCartes.Interdictions.detail.interdictionsDeParaitre.detailParInfraction.length === 1, JSON.stringify(audienceCartes.Interdictions.detail.interdictionsDeParaitre))

// Types d'infractions : hiérarchie par grand titre
attendu('grands titres d\'infraction rendus', infraCartes["Répartition des enquêtes terminées par catégorie d'infraction (2026)"].detail.grandsTitres.length > 0,
  JSON.stringify(infraCartes["Répartition des enquêtes terminées par catégorie d'infraction (2026)"].detail.grandsTitres.map((g) => `${g.grandTitre}:${g.total}`)))

// Instruction : mêmes agrégats que l'onglet de l'app
attendu('instruction : 2 dossiers, 4 MEX (1 détenu, 1 CJ, 1 ARSE, 1 libre)',
  instruCartes['Dossiers d\'instruction'].valeur === 2 && instruCartes['Mis en examen'].valeur === 4
  && instruCartes['Mis en examen'].detail.detenus === 1 && instruCartes['Mis en examen'].detail.controleJudiciaire === 1
  && instruCartes['Mis en examen'].detail.arse === 1 && instruCartes['Mis en examen'].detail.libres === 1,
  JSON.stringify(instruCartes['Mis en examen']?.detail))
attendu('instruction : 1 dossier à régler avec détenu (art. 175)', instruCartes['Dossiers à régler (art. 175 CPP)'].valeur === 1
  && instruCartes['Dossiers à régler (art. 175 CPP)'].detail.avecDetenu === 1, JSON.stringify(instruCartes['Dossiers à régler (art. 175 CPP)']?.detail))
attendu('instruction : 1 DML en attente', instruCartes['Demandes de mise en liberté'].detail.enAttente === 1, JSON.stringify(instruCartes['Demandes de mise en liberté']?.detail))

// Année sans donnée : la page reste lisible et le dit
const vide = await rpc('tools/call', { name: 'stats_ecran', arguments: { annee: 2024 } })
attendu('année sans donnée : réponse propre', !vide.result.isError && JSON.parse(vide.result.content[0].text).annee === 2024)

// Sélecteur d'années
const ans = await rpc('tools/call', { name: 'stats_annees', arguments: {} })
attendu('stats_annees liste 2025 et 2026', JSON.parse(ans.result.content[0].text).annees.includes(2026)
  && JSON.parse(ans.result.content[0].text).annees.includes(2025), ans.result.content[0].text)

// ── Le bilan par période porte lui aussi les cartes détaillées
attendu('bilan : delta saisies/confiscations', bilan.audience.deltaSaisiesConfiscations?.totalAvoirs?.delta === -9000, JSON.stringify(bilan.audience.deltaSaisiesConfiscations?.totalAvoirs))
attendu('bilan : peines par type d\'audience', Array.isArray(bilan.peinesParTypeAudience) && bilan.peinesParTypeAudience.length === 2, JSON.stringify(bilan.peinesParTypeAudience?.map((x) => x.type)))
attendu('bilan : détail des OI (âge moyen)', bilan.orientationsDetail.ouverturesInformation.nombre === 1 && bilan.orientationsDetail.ouverturesInformation.ageMoyenJours > 0, JSON.stringify(bilan.orientationsDetail.ouverturesInformation))
attendu('bilan : grands titres d\'infraction', bilan.infractions.grandsTitres.terminees.length > 0, JSON.stringify(bilan.infractions.grandsTitres.terminees.map((g) => g.grandTitre)))
attendu('bilan : instruction complète', bilan.instruction?.misEnExamen === 4 && bilan.instruction?.detenus === 1, JSON.stringify(bilan.instruction))
attendu('bilan : taux et moyenne d\'amende', bilan.audience.peines.moyenneAmendeParCondamnation === 3950 && typeof bilan.audience.peines.tauxSursisPct === 'number', JSON.stringify(bilan.audience.peines.moyenneAmendeParCondamnation))

// ── stats_graphique : tous les graphiques du catalogue
const { GRAPHIQUES } = await import(`${REPO}/scripts/attache/statsGraphiques.mjs`)
for (const g of Object.keys(GRAPHIQUES)) {
  const res = await rpc('tools/call', { name: 'stats_graphique', arguments: { graphique: g, du: '2026-01-01', au: '2026-06-30' } })
  const blocs = res.result.content
  const image = blocs.find((b) => b.type === 'image')
  const texte = blocs.find((b) => b.type === 'text')
  const ok = !res.result.isError && image && image.mimeType === 'image/png' && image.data.length > 1000 && texte
  attendu(`graphique ${g}`, ok, ok ? `${Math.round(image.data.length / 1024)} Ko b64` : JSON.stringify(blocs?.[0])?.slice(0, 200))
  if (image) fs.writeFileSync(path.join(SCRATCH, `mcp-${g}.png`), Buffer.from(image.data, 'base64'))
}

// planche de plusieurs graphiques d'un coup, en mode ANNÉE (sélecteur de la page)
const planche = await rpc('tools/call', { name: 'stats_graphique', arguments: { graphiques: ['orientation', 'deferements_par_mois', 'saisies_vs_confiscations'], annee: 2026 } })
const images = (planche.result.content || []).filter((b) => b.type === 'image')
attendu('planche : 3 graphiques rendus en une fois', !planche.result.isError && images.length === 3, `${images.length} image(s)`)

// période par défaut (sans arguments) : ne doit pas planter
const def = await rpc('tools/call', { name: 'stats_synthese', arguments: {} })
attendu('période par défaut ok', !def.result.isError && JSON.parse(def.result.content[0].text).periode.du.endsWith('-01-01'))

// erreur propre sur graphique inconnu
const err = await rpc('tools/call', { name: 'stats_graphique', arguments: { graphique: 'nimporte' } })
attendu('graphique inconnu → erreur propre', err.result.isError === true && err.result.content[0].text.includes('Graphique inconnu'))

// ── Marqueurs [GRAPHIQUE : …] (syntaxe partagée app ↔ attaché) ──
const { parseMarqueur, formatMarqueur, trouverMarqueurs } = await import(`${REPO}/lib/stats/graphiqueMarqueur.mjs`)
const marqueur = formatMarqueur({ graphique: 'deferements_par_mois', du: '2026-01-01', au: '2026-06-30' })
attendu('marqueur : format canonique', marqueur === '[GRAPHIQUE : deferements_par_mois | du=2026-01-01 | au=2026-06-30]', marqueur)
const parsed = parseMarqueur('  [graphique : Deferements_Par_Mois | du=2026-01-01 | au=2026-06-30]  ')
attendu('marqueur : analyse tolérante (casse, espaces)', parsed?.graphique === 'deferements_par_mois' && parsed?.du === '2026-01-01' && parsed?.au === '2026-06-30')
attendu('marqueur : sans période', parseMarqueur('[GRAPHIQUE : orientation]')?.graphique === 'orientation')
attendu('marqueur : une phrase normale n\'en est pas un', parseMarqueur('Le graphique montre une hausse.') === null && parseMarqueur('[À CONFIRMER]') === null)
const doc = `Bilan.\n\n${marqueur}\n\nTexte.\n[GRAPHIQUE : orientation | du=2026-01-01 | au=2026-06-30]\n${marqueur}\n`
attendu('marqueurs : trouvés et dédoublonnés dans un document', trouverMarqueurs(doc).length === 2)

child.kill()
console.log(echecs.length ? `\n❌ ${echecs.length} échec(s) : ${echecs.join(' · ')}` : '\n✅ TOUS LES TESTS PASSENT')
process.exit(echecs.length ? 1 : 0)
