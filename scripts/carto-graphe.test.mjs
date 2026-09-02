/**
 * SIRAL — test du GRAPHE CÔTÉ SERVEUR (exposition du calcul à l'IA).
 *
 * Trois volets :
 *  1. lib/carto/grapheCore.mjs — les algorithmes purs : l'intermédiarité
 *     désigne bien le pont d'un haltère, Louvain sépare bien deux cliques,
 *     les plus courts chemins sont trouvés (et l'absence de chemin est dite).
 *  2. Bout en bout sur de VRAIS coffres chiffrés : construireGraphe /
 *     analyseAvancee / cheminEntre / lireSignaux, avec configuration
 *     partagée, overlay carto (lien, rôle, bonus) et coffre de veille.
 *  3. FIDÉLITÉ : sur les mêmes entrées, le score serveur est EXACTEMENT
 *     celui du moteur TypeScript de l'app (utils/mindmapGraph.ts, transpilé
 *     à la volée comme dans carto-scoring.test.mjs). C'est la garantie que
 *     l'IA raisonne sur les poids de l'écran, pas sur une copie qui dérive.
 *
 *   node scripts/carto-graphe.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-carto-graphe-'))
const DATA_DIR = path.join(SCRATCH, 'data')
fs.mkdirSync(path.join(DATA_DIR, 'vaults'), { recursive: true })

process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')
delete process.env.SIRAL_ATTACHE_TJ
delete process.env.SIRAL_ATTACHE_CONTENTIEUX

let echecs = 0
function verifie(libelle, condition, detail = '') {
  if (condition) console.log(`  ✓ ${libelle}`)
  else { echecs++; console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`) }
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Algorithmes purs (lib/carto/grapheCore.mjs)')
const { centraliteIntermediaire, communautesLouvain, plusCourtsChemins } =
  await import(`${REPO}/lib/carto/grapheCore.mjs`)

{
  // Haltère : deux triangles {a,b,c} et {d,e,f} reliés par le pont c—d.
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'z'] // z : isolé
  const aretes = [
    { a: 'a', b: 'b' }, { a: 'a', b: 'c' }, { a: 'b', b: 'c' },
    { a: 'c', b: 'd' },
    { a: 'd', b: 'e' }, { a: 'd', b: 'f' }, { a: 'e', b: 'f' },
  ]
  const cb = centraliteIntermediaire(ids, aretes)
  verifie('intermédiarité : le pont (c) domine le triangle (a)', cb.get('c') > cb.get('a'))
  verifie('intermédiarité : symétrie c = d', Math.abs(cb.get('c') - cb.get('d')) < 1e-9)
  verifie('intermédiarité : l\'isolé vaut 0', cb.get('z') === 0)

  const commu = communautesLouvain(ids, aretes)
  verifie('Louvain : le triangle abc est une communauté',
    commu.get('a') === commu.get('b') && commu.get('b') === commu.get('c'))
  verifie('Louvain : le triangle def est une communauté',
    commu.get('d') === commu.get('e') && commu.get('e') === commu.get('f'))
  verifie('Louvain : les deux triangles sont séparés', commu.get('a') !== commu.get('d'))

  const chemins = plusCourtsChemins(ids, aretes, 'a', 'f')
  verifie('chemin a → f : longueur 3 via le pont', chemins.length >= 1
    && chemins[0].length === 4 && chemins[0][0] === 'a' && chemins[0][3] === 'f'
    && chemins.every((c) => c.includes('c') && c.includes('d')),
  JSON.stringify(chemins))
  verifie('chemin vers l\'isolé : aucun', plusCourtsChemins(ids, aretes, 'a', 'z').length === 0)
  verifie('chemin vers soi-même : trivial', plusCourtsChemins(ids, aretes, 'a', 'a').length === 1)
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Fixture chiffrée (coffres réels)')
const { encryptJson } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)

const keyGlobal = crypto.randomBytes(32)
const keyCtx = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': keyCtx.toString('base64') }, 'Test')
const keys = loadKeyring()

const enquetes = [
  {
    id: 1, numero: '2026/000001 - RESEAU NORD', statut: 'en_cours',
    dateCreation: '2026-01-10', dateDebut: '2026-01-10',
    description: '', infractionNatinfCodes: ['7995'],
    misEnCause: [{ nom: 'DUPONT Karim' }, { nom: 'MARTIN Leo' }],
    actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [],
  },
  {
    id: 2, numero: '2026/000002 - STUP SUD', statut: 'en_cours',
    dateCreation: '2026-03-01', dateDebut: '2026-03-01',
    description: '', infractionNatinfCodes: ['7995', '20654'],
    misEnCause: [{ nom: 'DUPONT Karim' }, { nom: 'BERNARD Sam' }],
    actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [],
  },
  {
    id: 3, numero: '2026/000003 - BLANCHIMENT', statut: 'en_cours',
    dateCreation: '2026-04-01', dateDebut: '2026-04-01',
    description: '', infractionNatinfCodes: [],
    misEnCause: [{ nom: 'BERNARD Sam' }, { nom: 'PETIT Ana' }],
    actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [],
  },
]
fs.writeFileSync(path.join(DATA_DIR, 'vaults', 'ctx-crimorg.json'), JSON.stringify(
  encryptJson(keyCtx, { data: { enquetes, version: 1 }, metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 1 } }),
))

const OVERLAY = {
  mecsExNihilo: [{ id: 'zampa franck', displayName: 'ZAMPA Franck' }],
  dossiersExNihilo: [],
  liensRenseignement: [{ id: 'l1', source: 'zampa franck', target: 'DUPONT Karim', label: 'fournisseur présumé' }],
  mecScoreBoosts: [{ mecId: 'dupont karim', bonus: 5, reason: 'cible prioritaire', role: 'chef_reseau', updatedAt: 1 }],
  mecCamps: [],
}
fs.writeFileSync(path.join(DATA_DIR, 'vaults', 'cartographie.json'), JSON.stringify(
  encryptJson(keyGlobal, OVERLAY),
))

const CONFIG = {
  weights: {
    dossier: 2, contentieux: 3, chefDefault: 0.3, lienRenseignement: 0,
    lienRenseignementInfractionCoef: 0.8, lienMecPropagationCoef: 0.3,
    lienMecPropagationHops: 2, dossierPropagationCoef: 0.2,
  },
  temporal: { enabled: false, freshYears: 2, staleYears: 10, dormantMultiplier: 0.5, continuityBonus: 0.3, continuityYears: 4 },
  natinfWeights: { 7995: 10 },
  categoryWeights: {},
  updatedAt: '2026-08-01T00:00:00Z',
}
fs.writeFileSync(path.join(DATA_DIR, 'vaults', 'cartographie-config.json'), JSON.stringify(
  encryptJson(keyGlobal, CONFIG),
))

const { construireGraphe, analyseAvancee, cheminEntre } =
  await import(`${REPO}/scripts/attache/cartoGraphe.mjs`)

{
  const analyse = analyseAvancee(keys, {})
  verifie('paramètres : la configuration partagée est lue',
    analyse.calculs.parametres.includes('configuration partagée'), analyse.calculs.parametres)
  verifie('importance : DUPONT en tête', analyse.importance[0]?.nom === 'DUPONT Karim',
    JSON.stringify(analyse.importance.map((i) => i.nom)))
  const dupont = analyse.importance[0]
  verifie('importance décomposée : 2 dossiers, 3 chefs, gravité 20, rôle chef',
    dupont.composantes.dossiers === 2 && dupont.composantes.chefs === 3
    && dupont.composantes.poidsInfractions === 20 && dupont.composantes.role === 'chef_reseau',
  JSON.stringify(dupont.composantes))
  verifie('importance : ZAMPA (lien seul) pèse par l\'entourage',
    analyse.importance.some((i) => i.nom === 'ZAMPA Franck' && i.composantes.recuDeLEntourage > 0))
  const inter = analyse.intermediaires.map((i) => i.nom)
  verifie('intermédiaires : DUPONT et BERNARD (la chaîne passe par eux)',
    inter[0] === 'DUPONT Karim' || inter[0] === 'BERNARD Sam', JSON.stringify(inter))
  verifie('communautés : au moins une cellule de 3+ membres', analyse.communautes.length >= 1,
    JSON.stringify(analyse.communautes))
}

{
  const r = cheminEntre(keys, { de: 'MARTIN Leo', vers: 'PETIT Ana' })
  verifie('chemin MARTIN → PETIT : relié à distance 3', r.relies === true && r.distance === 3,
    JSON.stringify(r))
  const sauts = r.chemins[0]
  verifie('chaque saut cite un dossier',
    sauts.every((s) => s.via.some((v) => v.startsWith('dossier '))), JSON.stringify(sauts))

  const r2 = cheminEntre(keys, { de: 'zampa franck', vers: 'BERNARD Sam' })
  verifie('chemin ZAMPA → BERNARD : passe par le lien tracé',
    r2.relies === true && r2.chemins[0].some((s) => s.via.some((v) => v.includes('fournisseur présumé'))),
    JSON.stringify(r2))

  const r3 = cheminEntre(keys, { de: 'Léo Martin', vers: 'PETIT Ana' })
  verifie('résolution tolérante (ordre des mots, accents)', r3.relies === true)

  const r4 = cheminEntre(keys, { de: 'INCONNU Jean', vers: 'PETIT Ana' })
  verifie('personne inconnue : erreur explicite', Boolean(r4.erreur), JSON.stringify(r4))
}

// ── Veille des recoupements exposée à l'IA
{
  const dossierRef = (key, numero, label) => ({ key, numero, label, nature: 'enquete', contentieuxId: 'crimorg' })
  const resultat = {
    v: 1, calculeAt: '2026-08-30T02:00:00Z', dureeMs: 1000,
    perimetre: { contentieux: ['crimorg'], dossiers: 3, pieces: 12, piecesLues: 12 },
    signaux: [
      {
        id: 'telephone:0612345678', kind: 'telephone', valeur: '06 12 34 56 78', canon: '0612345678',
        score: 0.95, stateKey: 'e1|e3', dossierKeys: ['e1', 'e3'], pontInedit: true,
        occurrences: [
          { dossier: dossierRef('e1', '2026/000001 - RESEAU NORD'), origine: 'document', detail: 'PV/aud1.pdf', valeurBrute: '06 12 34 56 78', extrait: 'joignable au 06 12 34 56 78 selon' },
          { dossier: dossierRef('e1', '2026/000001 - RESEAU NORD'), origine: 'document', detail: 'PV/aud2.pdf', valeurBrute: '0612345678' },
          { dossier: dossierRef('e1', '2026/000001 - RESEAU NORD'), origine: 'cr', detail: 'CR du 3 mars', valeurBrute: '06.12.34.56.78' },
          { dossier: dossierRef('e3', '2026/000003 - BLANCHIMENT'), origine: 'ecoute', detail: 'ligne 12', valeurBrute: '0612345678', declaree: true },
        ],
      },
      {
        id: 'personne:dupont karim', kind: 'personne', valeur: 'DUPONT Karim', canon: 'dupont karim',
        score: 0.9, stateKey: 'e1|e2', dossierKeys: ['e1', 'e2'], pontInedit: false,
        occurrences: [
          { dossier: dossierRef('e1', '2026/000001 - RESEAU NORD'), origine: 'mec', valeurBrute: 'DUPONT Karim', declaree: true },
          { dossier: dossierRef('e2', '2026/000002 - STUP SUD'), origine: 'mec', valeurBrute: 'DUPONT Karim', declaree: true },
        ],
      },
    ],
  }
  fs.writeFileSync(path.join(DATA_DIR, 'vaults', 'recoupements.json'), JSON.stringify(
    encryptJson(keyGlobal, resultat),
  ))
  const { lireSignaux } = await import(`${REPO}/scripts/attache/recoupements.mjs`)

  const tout = lireSignaux(keys, {})
  verifie('veille : les deux signaux sont servis', tout.total === 2 && tout.signaux.length === 2)
  verifie('veille : nature lisible + valeur', tout.signaux[0].nature === 'Même ligne'
    && tout.signaux[0].valeur === '06 12 34 56 78', JSON.stringify(tout.signaux[0]))
  const occE1 = tout.signaux[0].occurrences.filter((o) => o.dossier.includes('000001'))
  verifie('veille : au plus 2 occurrences par dossier', occE1.length === 2, JSON.stringify(occE1))

  verifie('veille : filtre inedits', lireSignaux(keys, { inedits: true }).total === 1)
  verifie('veille : filtre nature', lireSignaux(keys, { nature: 'personne' }).total === 1)
  verifie('veille : filtre numero', lireSignaux(keys, { numero: 'BLANCHIMENT' }).total === 1)
  verifie('veille : pagination', lireSignaux(keys, { limite: 1, offset: 1 }).signaux.length === 1)
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Fidélité au moteur TypeScript de l\'app')
// Transpilation à la volée, comme carto-scoring.test.mjs : le moteur est du
// TypeScript pur, seuls les modules lib/**/*.mjs (déjà JS) sont importés tels
// quels et les imports de types sont effacés.
function compile(rel) {
  const nom = path.basename(rel).replace(/\.ts$/, '')
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  })
  const js = outputText
    .replace(/from\s*['"]@\/(lib\/[^'"]+\.mjs)['"]/g, (_, m) => `from '${path.join(REPO, m)}'`)
    .replace(/from\s*['"]@\/types\/cartographieTypes['"]/g, "from './cartographieTypes.mjs'")
    .replace(/^\s*import\s[^;]*?from\s*['"]@\/types\/[^'"]+['"];?\s*$/gm, '')
  fs.writeFileSync(path.join(SCRATCH, `${nom}.mjs`), js)
  return nom
}
compile('types/cartographieTypes.ts')
compile('utils/mindmapGraph.ts')
const { buildMindmapGraph } = await import(path.join(SCRATCH, 'mindmapGraph.mjs'))

{
  const sources = enquetes.map((e) => ({ enquete: e, contentieuxId: 'crimorg' }))
  const graphTs = buildMindmapGraph(sources, OVERLAY, {
    weights: CONFIG.weights,
    temporal: CONFIG.temporal,
    natinfWeights: CONFIG.natinfWeights,
  })
  const serveur = construireGraphe(keys, {})

  // L'app identifie ses nœuds par le nom normalisé EN ORDRE DE RENCONTRE
  // (« martin leo ») ; le serveur par la clé TRIÉE (« leo martin »). Même
  // identité, deux étiquettes : on aligne sur la clé triée pour comparer.
  const cleTriee = (id) => id.split(' ').sort().join(' ')
  const tsParCleTriee = new Map()
  for (const node of graphTs.mecById.values()) tsParCleTriee.set(cleTriee(node.id), node)

  let compares = 0
  let identiques = true
  for (const [canon, p] of serveur.personnes) {
    const nodeTs = tsParCleTriee.get(canon)
    if (!nodeTs) { identiques = false; console.log(`    manquant côté app : ${canon}`); continue }
    compares++
    if (Math.abs(nodeTs.rawScore - p.rawScore) > 1e-9) {
      identiques = false
      console.log(`    écart sur ${canon} : app=${nodeTs.rawScore} serveur=${p.rawScore}`)
    }
  }
  verifie(`scores IDENTIQUES app ↔ serveur (${compares} personnes comparées)`,
    identiques && compares === serveur.personnes.size && compares >= 5)
}

console.log('')
if (echecs > 0) { console.error(`${echecs} échec(s)`); process.exit(1) }
console.log('Tous les tests passent.')
