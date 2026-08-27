/**
 * SIRAL — test du SCORING DE LA CARTOGRAPHIE (contamination latente).
 *
 * Scénario : un dossier ex nihilo « Réseau Amiens » (trafic de stupéfiants,
 * lourdement pondéré) réunit BOUCHER Kevin et LEROY Sonia. Autour d'eux, trois
 * personnes ne sont dans AUCUN dossier :
 *   - MARCHAND Yanis, relié à BOUCHER par un lien de renseignement ;
 *   - PETIT Dylan, relié à MARCHAND (donc à deux sauts du dossier) ;
 *   - VASSEUR Alain, relié à personne.
 *
 * Le second scénario reprend le cas qui a motivé la route « par dossier » : un
 * chef rattaché à ses procédures par de simples liens, ses lieutenants mis en
 * cause dedans, et un lieutenant relié au chef à la main faute d'avoir pu
 * l'impliquer.
 *
 * Avant la contamination latente, ces trois-là pesaient exactement pareil :
 * zéro. Le test vérifie que MARCHAND > PETIT > VASSEUR = 0, que la
 * décroissance est bien coef^distance, que la diffusion ne remonte pas sur les
 * personnes qui portent déjà le dossier (pas d'auto-amplification) et que
 * couper le coefficient rend le comportement d'avant.
 *
 *   node scripts/carto-scoring.test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-carto-'))

// Transpilation à la volée : le moteur est du TypeScript pur (aucune
// dépendance navigateur). Seul `@/types/cartographieTypes` porte des VALEURS
// (les pondérations par défaut) : on le compile aussi et on réécrit l'import.
function compile(rel) {
  const nom = path.basename(rel).replace(/\.ts$/, '')
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  })
  const js = outputText
    // Modules PARTAGÉS app ↔ attaché (lib/**/*.mjs) : déjà du JavaScript, on
    // les importe tels quels par leur chemin réel — rien à transpiler.
    .replace(/from\s*['"]@\/(lib\/[^'"]+\.mjs)['"]/g, (_, m) => `from '${path.join(REPO, m)}'`)
    .replace(/from\s*['"]@\/types\/cartographieTypes['"]/g, "from './cartographieTypes.mjs'")
    // Les autres imports de TYPES n'ont pas d'équivalent runtime.
    .replace(/^\s*import\s[^;]*?from\s*['"]@\/types\/[^'"]+['"];?\s*$/gm, '')
  fs.writeFileSync(path.join(TMP, `${nom}.mjs`), js)
  return nom
}

compile('types/cartographieTypes.ts')
compile('utils/mindmapGraph.ts')

const { buildMindmapGraph } = await import(path.join(TMP, 'mindmapGraph.mjs'))

const ANNEE = new Date().getFullYear()

const OVERLAY = {
  mecsExNihilo: [
    { id: 'boucher kevin', displayName: 'BOUCHER Kevin' },
    { id: 'leroy sonia', displayName: 'LEROY Sonia' },
    { id: 'marchand yanis', displayName: 'MARCHAND Yanis' },
    { id: 'petit dylan', displayName: 'PETIT Dylan' },
    { id: 'vasseur alain', displayName: 'VASSEUR Alain' },
  ],
  dossiersExNihilo: [
    {
      id: 'dexn_reseau_amiens',
      label: 'Réseau Amiens',
      dateApprox: String(ANNEE),
      mecIds: ['BOUCHER Kevin', 'LEROY Sonia'],
      natinfCodes: ['STUP1'],
    },
  ],
  liensRenseignement: [
    { id: 'l1', source: 'boucher kevin', target: 'marchand yanis' },
    { id: 'l2', source: 'marchand yanis', target: 'petit dylan' },
  ],
}

// Pondérations du test : volontairement rondes pour que les attendus se
// vérifient à la main. Pas de points « par lien », pour isoler l'effet mesuré.
function config(overrides = {}) {
  return {
    weights: {
      dossier: 2,
      contentieux: 3,
      chefDefault: 0.3,
      lienRenseignement: 0,
      lienRenseignementInfractionCoef: 0.8,
      lienMecPropagationCoef: 0.3,
      lienMecPropagationHops: 2,
      dossierPropagationCoef: 0.2,
      ...overrides,
    },
    temporal: {
      enabled: false,
      freshYears: 2,
      staleYears: 10,
      dormantMultiplier: 0.5,
      continuityBonus: 0.3,
      continuityYears: 4,
    },
    natinfWeights: { STUP1: 10 },
  }
}

let echecs = 0
function verifie(libelle, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${libelle}`)
  } else {
    echecs++
    console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`)
  }
}
const proche = (a, b) => Math.abs(a - b) < 1e-9

// ──────────────────────────────────────────────
console.log('\nContamination latente activée (coef 0.3, 2 sauts)')
// ──────────────────────────────────────────────
const g = buildMindmapGraph([], OVERLAY, config({ dossierPropagationCoef: 0 }))
const score = id => g.mecById.get(id).rawScore
const propage = id => g.mecById.get(id).propagatedWeight

// BOUCHER : 1 dossier (×2) + 1 chef (le NATINF du dossier, ×0.3) + bonus
// infraction 10 = 12.3. Un dossier ex nihilo ne porte pas de contentieux,
// d'où l'absence du ×3.
verifie('MEC du dossier : poids direct inchangé', proche(score('boucher kevin'), 12.3),
  `attendu 12.3, obtenu ${score('boucher kevin')}`)
verifie('MEC du dossier : rien reçu de son entourage sans dossier',
  proche(propage('boucher kevin'), 0), `obtenu ${propage('boucher kevin')}`)

// MARCHAND : voisin direct de BOUCHER (12.3 × 0.3) ; PETIT n'émet rien.
verifie('Voisin direct d\'un MEC lourd : 30 % de son poids',
  proche(propage('marchand yanis'), 3.69), `attendu 3.69, obtenu ${propage('marchand yanis')}`)

// PETIT : deux sauts du dossier (12.3 × 0.3²).
verifie('Voisin à deux sauts : 9 % du poids (coef²)',
  proche(propage('petit dylan'), 1.107), `attendu 1.107, obtenu ${propage('petit dylan')}`)

verifie('L\'entourage se hiérarchise (1 saut > 2 sauts > isolé)',
  score('marchand yanis') > score('petit dylan') && score('petit dylan') > 0)
verifie('Personne sans lien ni dossier : toujours zéro',
  score('vasseur alain') === 0, `obtenu ${score('vasseur alain')}`)
verifie('Le voisin reste sous le MEC réel du dossier',
  score('marchand yanis') < score('boucher kevin'))
verifie('Nombre de voisins exposé pour l\'affichage',
  g.mecById.get('marchand yanis').nbMecVoisins === 2,
  `obtenu ${g.mecById.get('marchand yanis').nbMecVoisins}`)

// ──────────────────────────────────────────────
console.log('\nPortée limitée à 1 saut')
// ──────────────────────────────────────────────
const g1 = buildMindmapGraph([], OVERLAY, config({ lienMecPropagationHops: 1, dossierPropagationCoef: 0 }))
verifie('Voisin direct : toujours contaminé',
  proche(g1.mecById.get('marchand yanis').propagatedWeight, 3.69))
verifie('Deuxième saut : coupé',
  g1.mecById.get('petit dylan').propagatedWeight === 0)

// ──────────────────────────────────────────────
console.log('\nContamination désactivée (coef 0) — comportement d\'avant')
// ──────────────────────────────────────────────
const g0 = buildMindmapGraph([], OVERLAY, config({ lienMecPropagationCoef: 0, dossierPropagationCoef: 0 }))
verifie('Les liens personne ↔ personne ne rapportent rien',
  g0.mecById.get('marchand yanis').rawScore === 0
  && g0.mecById.get('petit dylan').rawScore === 0)
verifie('Les MEC du dossier ne bougent pas',
  proche(g0.mecById.get('boucher kevin').rawScore, 12.3))

// ──────────────────────────────────────────────
console.log('\nBoucle fermée (A ↔ B ↔ C ↔ A) — pas d\'emballement')
// ──────────────────────────────────────────────
const boucle = buildMindmapGraph([], {
  ...OVERLAY,
  liensRenseignement: [
    { id: 'l1', source: 'boucher kevin', target: 'marchand yanis' },
    { id: 'l2', source: 'marchand yanis', target: 'petit dylan' },
    { id: 'l3', source: 'petit dylan', target: 'boucher kevin' },
  ],
}, config({ dossierPropagationCoef: 0 }))
// PETIT est désormais à UN saut de BOUCHER : 12.3 × 0.3, et pas davantage —
// le chemin long (via MARCHAND) ne se cumule pas au chemin court.
verifie('Un même voisin n\'est compté qu\'une fois, au chemin le plus court',
  proche(boucle.mecById.get('petit dylan').propagatedWeight, 3.69),
  `attendu 3.69, obtenu ${boucle.mecById.get('petit dylan').propagatedWeight}`)
verifie('Le MEC porteur du dossier ne se contamine pas lui-même',
  proche(boucle.mecById.get('boucher kevin').propagatedWeight, 0),
  `obtenu ${boucle.mecById.get('boucher kevin').propagatedWeight}`)

// ──────────────────────────────────────────────
console.log('\nPondération temporelle : un entourage dormant contamine moins')
// ──────────────────────────────────────────────
const vieux = buildMindmapGraph([], {
  ...OVERLAY,
  dossiersExNihilo: [{ ...OVERLAY.dossiersExNihilo[0], dateApprox: String(ANNEE - 20) }],
}, {
  ...config({ dossierPropagationCoef: 0 }),
  temporal: {
    enabled: true, freshYears: 2, staleYears: 10,
    dormantMultiplier: 0.5, continuityBonus: 0.3, continuityYears: 4,
  },
})
// BOUCHER est dormant (×0.5) : il n'émet plus que 6.15, dont 30 % = 1.845.
verifie('Le poids émis est celui du voisin, ancienneté comprise',
  proche(vieux.mecById.get('marchand yanis').propagatedWeight, 1.845),
  `attendu 1.845, obtenu ${vieux.mecById.get('marchand yanis').propagatedWeight}`)

// ──────────────────────────────────────────────
console.log('\nLe chef, ses lieutenants, et celui qu\'on n\'a pas pu impliquer')
// ──────────────────────────────────────────────
// Cas réel : un « gros bonnet » rattaché par LIEN à cinq dossiers lourds ; sur
// chacun, un lieutenant est mis en cause. Un sixième lieutenant, qu'on n'a pas
// réussi à impliquer dans une procédure, est relié au chef par un simple lien
// personne ↔ personne. Sans contamination via le dossier, ce dernier passait
// DEVANT ses pairs — l'inverse de ce que dit la procédure.
const RESEAU = {
  mecsExNihilo: [
    { id: 'chef', displayName: 'Le chef' },
    { id: 'lieutenant lie', displayName: 'Lieutenant relié à la main' },
    ...[1, 2, 3, 4, 5].map(i => ({ id: `lieutenant ${i}`, displayName: `Lieutenant ${i}` })),
  ],
  dossiersExNihilo: [1, 2, 3, 4, 5].map(i => ({
    id: `dexn_${i}`,
    label: `Dossier ${i}`,
    dateApprox: String(ANNEE),
    mecIds: [`Lieutenant ${i}`],
    natinfCodes: ['STUP2'],
  })),
  liensRenseignement: [
    ...[1, 2, 3, 4, 5].map(i => ({ id: `ld${i}`, source: 'chef', target: `dexn_${i}` })),
    { id: 'lm', source: 'chef', target: 'lieutenant lie' },
  ],
}
const RESEAU_CONF = { ...config(), natinfWeights: { STUP2: 20 } }

const avant = buildMindmapGraph([], RESEAU, {
  ...RESEAU_CONF,
  weights: { ...RESEAU_CONF.weights, dossierPropagationCoef: 0 },
})
verifie('Sans la route dossier : le lieutenant relié à la main double ses pairs',
  avant.mecById.get('lieutenant lie').rawScore > avant.mecById.get('lieutenant 1').rawScore,
  `relié ${avant.mecById.get('lieutenant lie').rawScore.toFixed(1)} vs mis en cause `
  + avant.mecById.get('lieutenant 1').rawScore.toFixed(1))

const apres = buildMindmapGraph([], RESEAU, RESEAU_CONF)
const lieutenants = [1, 2, 3, 4, 5].map(i => apres.mecById.get(`lieutenant ${i}`).rawScore)
verifie('Avec la route dossier : le mis en cause repasse devant',
  apres.mecById.get('lieutenant 1').rawScore > apres.mecById.get('lieutenant lie').rawScore,
  `mis en cause ${apres.mecById.get('lieutenant 1').rawScore.toFixed(1)} vs relié `
  + apres.mecById.get('lieutenant lie').rawScore.toFixed(1))
verifie('Les lieutenants de même importance restent à égalité',
  Math.max(...lieutenants) - Math.min(...lieutenants) < 1e-9)
verifie('Le chef reste au-dessus de tout le monde',
  apres.mecById.get('chef').rawScore > Math.max(...lieutenants))
// Le chef pèse 5 × (0.8 × 20) d'infractions reprises de ses dossiers + 5 chefs
// à 0.3 = 81.5. Son dossier en relaie 20 % à chaque lieutenant, soit 16.3 ; le
// reste de ce que touche le lieutenant vient du second saut (les autres
// lieutenants, atteints à travers le chef).
verifie('Le dossier relaie le poids de son membre le plus lourd',
  proche(apres.mecById.get('lieutenant 1').propagationTop[0].points, 16.3),
  `obtenu ${apres.mecById.get('lieutenant 1').propagationTop[0].points.toFixed(2)}`)
const unSaut = buildMindmapGraph([], RESEAU, {
  ...RESEAU_CONF,
  weights: { ...RESEAU_CONF.weights, lienMecPropagationHops: 1 },
})
verifie('À un saut, le lieutenant ne reçoit QUE le relais de son dossier',
  proche(unSaut.mecById.get('lieutenant 1').propagatedWeight, 16.3),
  `obtenu ${unSaut.mecById.get('lieutenant 1').propagatedWeight.toFixed(2)}`)
verifie('L\'origine du poids reçu est traçable',
  apres.mecById.get('lieutenant 1').propagationTop?.[0]?.via === 'dossier'
  && apres.mecById.get('lieutenant 1').propagationTop?.[0]?.mecId === 'chef')

// ──────────────────────────────────────────────
console.log('\nChefs cumulés : les infractions du dossier suivent le lien')
// ──────────────────────────────────────────────
const chef = apres.mecById.get('chef')
verifie('Un lien vers un dossier crédite ses infractions en chefs',
  chef.nbChefs === 5 && chef.nbChefsViaLien === 5,
  `nbChefs=${chef.nbChefs}, dont via lien ${chef.nbChefsViaLien}`)
verifie('Le mis en cause compte le chef du dossier, sans mention « via lien »',
  apres.mecById.get('lieutenant 1').nbChefs === 1
  && apres.mecById.get('lieutenant 1').nbChefsViaLien === 0)
verifie('Une personne sans dossier ni lien vers un dossier n\'a aucun chef',
  apres.mecById.get('lieutenant lie').nbChefs === 0)

fs.rmSync(TMP, { recursive: true, force: true })
console.log(echecs === 0 ? '\nTous les tests passent.\n' : `\n${echecs} test(s) en échec.\n`)
process.exit(echecs === 0 ? 0 : 1)
