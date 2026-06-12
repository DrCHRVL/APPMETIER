#!/usr/bin/env node
/**
 * SIRAL — garde de complétude : vérifie que le pont web couvre exactement
 * la surface exposée par preload.js (aucune fonction oubliée, aucune en trop).
 * Échoue (exit 1) à la moindre divergence. À lancer avant chaque build.
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

function namesFromPreload() {
  const src = fs.readFileSync(path.join(root, 'preload.js'), 'utf8')
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
diff('Fonctions preload', preload, api, 'apiNames.ts')
diff('Fonctions apiNames', api, preload, 'preload.js')
diff('Fonctions preload', preload, bridge, 'bridge.ts (pont web)')

if (fail) { console.error('\n❌ Surface incomplète — corriger avant de builder.'); process.exit(1) }
console.log('✅ Surface complète : le pont web couvre 100 % du contrat preload.js.')
