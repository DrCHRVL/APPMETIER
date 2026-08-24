/**
 * SIRAL — test de l'IMPORTANCE MANUELLE d'un MEC (cartographie).
 *
 * Le panneau latéral permet de forcer à la main le poids d'une personne
 * (« Importance manuelle », de -10 à +20). Deux régressions ont fait que la
 * valeur saisie revenait à la précédente une à deux secondes après le clic sur
 * « Enregistrer » :
 *
 *   1. la remise à zéro supprimait l'entrée SANS tombstone : le serveur avait
 *      encore l'ancien bonus et le pull suivant le ressuscitait ;
 *   2. la sync lisait l'état local AVANT le pull serveur, puis appliquait le
 *      résultat du merge au store : toute saisie faite pendant le pull était
 *      écrasée par la valeur serveur — et jamais poussée.
 *
 * Le test rejoue ces scénarios sur le vrai store et le vrai service de sync,
 * avec un serveur commun simulé en mémoire.
 *
 *   node scripts/carto-importance-manuelle.test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-importance-'))

// Transpilation à la volée : le store et le service de sync sont du TypeScript
// pur. On réécrit leurs imports vers des doublures locales (shim zustand sans
// React, persistance disque en mémoire).
function compile(rel) {
  const nom = path.basename(rel).replace(/\.ts$/, '')
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  })
  const js = outputText
    .replace(/from\s*['"]@\/lib\/zustand['"]/g, "from './zustand-shim.mjs'")
    .replace(/from\s*['"]@\/utils\/siralBridge['"]/g, "from './siral-stub.mjs'")
    .replace(/from\s*['"]@\/utils\/mindmapGraph['"]/g, "from './mindmapGraph.mjs'")
    .replace(/from\s*['"]@\/types\/cartographieTypes['"]/g, "from './cartographieTypes.mjs'")
    .replace(/from\s*['"]@\/stores\/useCartographieOverlayStore['"]/g, "from './useCartographieOverlayStore.mjs'")
    .replace(/from\s*['"]\.\/globalSyncCommon['"]/g, "from './globalSyncCommon.mjs'")
    // Les autres imports de TYPES n'ont pas d'équivalent runtime.
    .replace(/^\s*import\s[^;]*?from\s*['"]@\/types\/[^'"]+['"];?\s*$/gm, '')
  fs.writeFileSync(path.join(TMP, `${nom}.mjs`), js)
  return nom
}

fs.writeFileSync(path.join(TMP, 'zustand-shim.mjs'), `
export function create(initializer) {
  let state
  const listeners = new Set()
  const setState = (partial) => {
    const next = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...next }
    listeners.forEach(l => l())
  }
  const getState = () => state
  const api = { getState, setState, subscribe: l => { listeners.add(l); return () => listeners.delete(l) } }
  state = initializer(setState, getState, api)
  const hook = (sel) => sel ? sel(state) : state
  Object.assign(hook, api)
  return hook
}
export default create
`)

fs.writeFileSync(path.join(TMP, 'siral-stub.mjs'), `
export const DISK = new Map()
export const SiralBridge = {
  async getData(key, def) { return DISK.has(key) ? DISK.get(key) : def },
  async setData(key, value) { DISK.set(key, JSON.parse(JSON.stringify(value))); return true },
}
`)

compile('types/cartographieTypes.ts')
compile('utils/mindmapGraph.ts')
compile('stores/useCartographieOverlayStore.ts')
compile('utils/dataSync/globalSyncCommon.ts')
compile('utils/dataSync/CartographieOverlaySyncService.ts')

// ── Serveur commun simulé (coffre « cartographie ») ──────────────────────────
let VAULT = null
let PULL_DELAY = 0
globalThis.window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
  siralBridge: {
    getCurrentUser: async () => ({ displayName: 'test', computerName: 'test' }),
    globalSync_pullCartographie: async () => {
      if (PULL_DELAY) await new Promise(r => setTimeout(r, PULL_DELAY))
      return VAULT ? JSON.parse(JSON.stringify(VAULT)) : null
    },
    globalSync_pushCartographie: async (payload) => {
      VAULT = JSON.parse(JSON.stringify(payload))
      return true
    },
  },
}

const { useCartographieOverlayStore } = await import(path.join(TMP, 'useCartographieOverlayStore.mjs'))
const { CartographieOverlaySyncService } = await import(path.join(TMP, 'CartographieOverlaySyncService.mjs'))
const { buildMindmapGraph } = await import(path.join(TMP, 'mindmapGraph.mjs'))

const sleep = ms => new Promise(r => setTimeout(r, ms))
const boosts = () => useCartographieOverlayStore.getState().mecScoreBoosts
const boostOf = id => (boosts().find(b => b.mecId === id) || {}).bonus
const dump = () => JSON.stringify(boosts())
// Le panneau écrit via setMecScoreBoost, exactement comme le bouton Enregistrer.
const enregistrer = (id, bonus, raison) =>
  useCartographieOverlayStore.getState().setMecScoreBoost(id, bonus, raison)

let echecs = 0
const verifie = (libelle, ok, detail = '') => {
  if (ok) console.log(`  ✓ ${libelle}`)
  else { echecs++; console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`) }
}

const vaultDepart = () => ({
  version: 3,
  updatedAt: new Date(Date.now() - 3600e3).toISOString(),
  updatedBy: 'collegue',
  computerName: 'poste',
  pinnedMecIds: [],
  mecsExNihilo: [],
  dossiersExNihilo: [],
  liensRenseignement: [],
  clusterAnnotations: [],
  mecScoreBoosts: [{ mecId: 'debus clement', bonus: -2, updatedAt: Date.now() - 3600e3 }],
  tagZones: [],
})

VAULT = vaultDepart()
const svc = CartographieOverlaySyncService.getInstance()
await useCartographieOverlayStore.getState().load()
svc.start()
await sleep(50)

// ──────────────────────────────────────────────
console.log('\n1) Modifier le bonus et cliquer Enregistrer')
// ──────────────────────────────────────────────
enregistrer('debus clement', -5)
await sleep(2500)
verifie('la valeur saisie tient après la sync', boostOf('debus clement') === -5, dump())
verifie('la valeur est poussée au serveur commun', VAULT.mecScoreBoosts[0]?.bonus === -5)

// ──────────────────────────────────────────────
console.log('\n2) Modifier PENDANT une sync en vol (pull lent)')
// ──────────────────────────────────────────────
// Le collègue a poussé une annotation entre-temps : le merge modifiera donc
// l'état local, ce qui déclenche applyServerSnapshot — le cas où la saisie
// concurrente était écrasée.
VAULT.clusterAnnotations = [
  { id: 'cluster_x', label: 'Réseau X', nodeIds: ['a'], createdAt: Date.now(), updatedAt: Date.now() },
]
PULL_DELAY = 400
svc.sync()
await sleep(50)
enregistrer('debus clement', -9)
await sleep(3000)
PULL_DELAY = 0
verifie('la saisie concurrente n\'est pas écrasée par le merge', boostOf('debus clement') === -9, dump())
verifie('la saisie concurrente finit poussée au serveur', VAULT.mecScoreBoosts[0]?.bonus === -9)
verifie('l\'annotation du collègue est bien récupérée', VAULT.clusterAnnotations.length === 1)

// ──────────────────────────────────────────────
console.log('\n3) Réinitialiser')
// ──────────────────────────────────────────────
enregistrer('debus clement', 0)
verifie('l\'entrée est retirée immédiatement', boosts().length === 0, dump())
await sleep(2500)
verifie('la remise à zéro n\'est pas ressuscitée par le serveur', boosts().length === 0, dump())
verifie('le serveur ne porte plus de bonus', (VAULT.mecScoreBoosts || []).length === 0)

// ──────────────────────────────────────────────
console.log('\n4) Re-saisir un bonus après une remise à zéro')
// ──────────────────────────────────────────────
enregistrer('debus clement', 4, 'chef de réseau')
await sleep(2500)
verifie('le nouveau bonus survit au tombstone de la remise à zéro',
  boostOf('debus clement') === 4, dump())
verifie('la justification est conservée',
  boosts()[0]?.reason === 'chef de réseau', dump())

// ──────────────────────────────────────────────
console.log('\n5) Lecture du bonus par le graphe (ordre nom/prénom indifférent)')
// ──────────────────────────────────────────────
// Le canonical d'un MEC dépend de la première orthographe rencontrée : un
// bonus enregistré sous « clement debus » doit s'appliquer au nœud
// « debus clement », et la valeur la plus récente doit l'emporter.
const overlay = {
  mecsExNihilo: [{ id: 'debus clement', displayName: 'DEBUS Clément' }],
  dossiersExNihilo: [],
  liensRenseignement: [],
  mecScoreBoosts: [
    { mecId: 'debus clement', bonus: 4, updatedAt: 2000 },
    { mecId: 'clement debus', bonus: -2, updatedAt: 1000 },
  ],
}
const config = {
  weights: {
    dossier: 2, contentieux: 3, miseEnExamen: 1, chefDefault: 0.3,
    lienRenseignement: 0, lienRenseignementInfractionCoef: 0.8,
    lienMecPropagationCoef: 0, lienMecPropagationHops: 2,
  },
  temporal: {
    enabled: false, freshYears: 2, staleYears: 10,
    dormantMultiplier: 0.5, continuityBonus: 0.3, continuityYears: 4,
  },
  natinfWeights: {},
}
const g1 = buildMindmapGraph([], overlay, config)
verifie('le bonus le plus récent gagne', g1.mecById.get('debus clement')?.manualBonus === 4,
  String(g1.mecById.get('debus clement')?.manualBonus))
const g2 = buildMindmapGraph([], {
  ...overlay,
  mecScoreBoosts: [...overlay.mecScoreBoosts].reverse(),
}, config)
verifie('le résultat ne dépend pas de l\'ordre de la liste',
  g2.mecById.get('debus clement')?.manualBonus === 4,
  String(g2.mecById.get('debus clement')?.manualBonus))

console.log(echecs === 0 ? '\nTous les tests passent.\n' : `\n${echecs} test(s) en échec.\n`)
process.exit(echecs === 0 ? 0 : 1)
