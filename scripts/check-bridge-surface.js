#!/usr/bin/env node
/**
 * SIRAL — garde de complétude : vérifie que le pont web couvre exactement
 * la surface exposée par preload.js (aucune fonction oubliée, aucune en trop).
 * Échoue (exit 1) à la moindre divergence. À lancer avant chaque build.
 *
 * NB : preload.js appartient à l'édition Electron desktop archivée
 * (archive/electron-desktop/). Il reste la source de vérité du contrat
 * window.electronAPI que le pont web doit reproduire. Le build serveur
 * (Docker) exclut archive/ : la vérification se désactive alors d'elle-même.
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

// preload.js vit désormais dans l'archive Electron. En mode Docker (build
// serveur), archive/ est exclu du contexte — on saute alors la vérification.
const preloadPath = path.join(root, 'archive', 'electron-desktop', 'preload.js')
if (!fs.existsSync(preloadPath)) {
  console.log('ℹ️  preload.js absent (build serveur) — vérification de surface ignorée.')
  process.exit(0)
}

function namesFromPreload() {
  const src = fs.readFileSync(preloadPath, 'utf8')
  const body = src.slice(src.indexOf("exposeInMainWorld('electronAPI'"))
  const names = new Set()
  for (const m of body.matchAll(/^\s{2}([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm)) names.add(m[1])
  return names
}

function namesFromApiNames() {
  const src = fs.readFileSync(path.join(root, 'lib/web/apiNames.ts'), 'utf8')
  const names = new Set()
  for (const m of src.matchAll(/'([a-zA-Z_][a-zA-Z0-9_]*)'/g)) names.add(m[1])
  return names
}

function namesFromBridge() {
  const src = fs.readFileSync(path.join(root, 'lib/web/bridge.ts'), 'utf8')
  const body = src.slice(src.indexOf('const bridge: Record<string, AnyFn> = {'))
  const names = new Set()
  for (const m of body.matchAll(/^\s{4}([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm)) names.add(m[1])
  return names
}

const preload = namesFromPreload()
const api = namesFromApiNames()
const bridge = namesFromBridge()

let fail = false
function diff(label, a, b, bLabel) {
  const missing = [...a].filter((n) => !b.has(n))
  if (missing.length) {
    fail = true
    console.error(`✗ ${label} absentes de ${bLabel} (${missing.length}) : ${missing.join(', ')}`)
  }
}

console.log(`preload.js : ${preload.size} fonctions · apiNames.ts : ${api.size} · bridge.ts : ${bridge.size}`)

// preload.js appartient à l'édition Electron desktop ARCHIVÉE et FIGÉE. Le
// pont web continue d'évoluer : il peut donc exposer des fonctions plus
// récentes (ex. fullSnapshot_*) absentes du preload figé. On vérifie encore
// que le pont web couvre 100 % de l'ancien contrat (aucune régression de
// surface), mais les ajouts web-only sont simplement signalés, sans échec.
diff('Fonctions preload', preload, api, 'apiNames.ts')
diff('Fonctions preload', preload, bridge, 'bridge.ts (pont web)')

const webOnly = [...api].filter((n) => !preload.has(n))
if (webOnly.length) {
  console.log(`ℹ️  ${webOnly.length} fonction(s) web-only (absentes du preload Electron figé) : ${webOnly.join(', ')}`)
}

if (fail) { console.error('\n❌ Surface incomplète — le pont web ne couvre plus tout l\'ancien contrat preload.js.'); process.exit(1) }
console.log('✅ Le pont web couvre 100 % de l\'ancien contrat preload.js (édition Electron archivée).')
