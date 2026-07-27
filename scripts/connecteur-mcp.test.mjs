/**
 * SIRAL — test de bout en bout du CONNECTEUR Claude web, côté service :
 * POST /mcp de attache-service.mjs (JSON-RPC MCP sur HTTP, secret de pont).
 *
 * Fabrique un SIRAL_DATA_DIR réel (clé-maître, trousseau remis, coffre
 * ctx-crimorg chiffré), démarre attache-service.mjs sur un port local, puis
 * déroule le protocole exactement comme le relais /api/mcp de l'app :
 * authentification, initialize, tools/list (périmètre connecteur),
 * tools/call en lecture et en écriture (+ audit), notification (202),
 * lot JSON-RPC, et révocation du trousseau (effet immédiat).
 *
 *   node scripts/connecteur-mcp.test.mjs
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-connecteur-test-'))
const DATA_DIR = path.join(SCRATCH, 'siral-test-data')
fs.mkdirSync(path.join(DATA_DIR, 'vaults'), { recursive: true })

const SECRET = 'secret-de-test'
const PORT = 18700 + Math.floor(Math.random() * 200)

process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { encryptJson } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)

// ── Clés : global + ctx-crimorg, remises comme depuis le navigateur admin
const keyGlobal = crypto.randomBytes(32)
const keyCtx = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': keyCtx.toString('base64') }, 'Admin TEST')

// ── Un dossier réaliste dans le coffre du contentieux
const enquetes = [{
  id: 1, numero: '2026/000123 - RESEAU TEST', dateCreation: '2026-05-01', dateDebut: '2026-05-01',
  statut: 'en_cours', services: [], description: 'Trafic de stupéfiants — dossier de test connecteur',
  tags: [{ id: 't1', value: 'BR Amiens', category: 'services' }],
  infractionNatinfCodes: ['7995'],
  misEnCause: [{ id: 1, nom: 'DUPONT Jean', role: 'fournisseur', statut: 'actif' }],
  actes: [], comptesRendus: [], notes: '', todos: [],
  ecoutes: [], geolocalisations: [],
}]
const syncData = { enquetes, audienceResultats: {}, customTags: [], alertRules: [], version: 3 }
const envelope = encryptJson(keyCtx, { data: syncData, metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 3 } })
fs.writeFileSync(path.join(DATA_DIR, 'vaults', 'ctx-crimorg.json'), JSON.stringify(envelope))

// ── Démarrage du service (comme le sidecar docker)
const child = spawn('node', [path.join(REPO, 'scripts/attache-service.mjs')], {
  env: {
    ...process.env,
    SIRAL_SECRET: SECRET,
    SIRAL_ATTACHE_PORT: String(PORT),
    SIRAL_ATTACHE_POLL_MIN: '60',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serviceLog = ''
child.stdout.on('data', (c) => { serviceLog += c.toString() })
child.stderr.on('data', (c) => { serviceLog += c.toString() })

// même dérivation que l'app (lib/server/attache.ts) et le service
const BRIDGE = crypto.createHash('sha256').update('attache-bridge:' + SECRET).digest('hex')

async function attendrePret() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/status`, { headers: { 'x-attache-secret': BRIDGE } })
      if (res.ok) return
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  console.error(serviceLog)
  throw new Error('service attaché injoignable')
}

async function mcp(message, { secret = BRIDGE } = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-attache-secret': secret } : {}) },
    body: JSON.stringify(message),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

try {
  await attendrePret()

  // ── Authentification interne : sans secret de pont, rien ne passe
  const refus = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { secret: null })
  attendu('sans secret de pont → 401', refus.status === 401, `obtenu ${refus.status}`)

  // ── initialize : identité connecteur + consignes embarquées
  const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } })
  attendu('initialize 200', init.status === 200 && init.body?.result, JSON.stringify(init.body).slice(0, 200))
  attendu('protocole écho', init.body.result.protocolVersion === '2025-06-18')
  attendu('serverInfo « siral »', init.body.result.serverInfo?.name === 'siral')
  attendu('instructions présentes', typeof init.body.result.instructions === 'string' && init.body.result.instructions.includes('SIRAL'))

  // ── notification : 202 sans corps
  const notif = await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' })
  attendu('notification → 202', notif.status === 202 && notif.body === null, `obtenu ${notif.status}`)

  // ── tools/list : périmètre du connecteur
  const list = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  const noms = (list.body?.result?.tools || []).map((t) => t.name)
  attendu('outils présents (lecture/écriture/stats)', ['lister_dossiers', 'lire_dossier', 'stats_synthese', 'produire_document', 'ajouter_todo'].every((n) => noms.includes(n)), noms.slice(0, 8).join(', '))
  attendu('sous_agents exclu', !noms.includes('sous_agents'))
  attendu('poser_question exclu', !noms.includes('poser_question'))
  attendu('remettre_livrable présent', noms.includes('remettre_livrable'))

  // ── lecture : le dossier seedé est visible
  const dossiers = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'lister_dossiers', arguments: {} } })
  const texteDossiers = dossiers.body?.result?.content?.[0]?.text || ''
  attendu('lister_dossiers voit le dossier', texteDossiers.includes('RESEAU TEST'), texteDossiers.slice(0, 120))

  // ── écriture : ajouter_todo — versionnée, auditée sous contexte « connecteur »
  const todo = await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ajouter_todo', arguments: { numero: '2026/000123 - RESEAU TEST', texte: 'Vérifier la ligne du connecteur' } } })
  attendu('ajouter_todo sans erreur', todo.status === 200 && !todo.body?.result?.isError, JSON.stringify(todo.body).slice(0, 200))
  const relu = await mcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'lire_dossier', arguments: { numero: '2026/000123 - RESEAU TEST' } } })
  attendu('à-faire visible à la relecture', (relu.body?.result?.content?.[0]?.text || '').includes('Vérifier la ligne du connecteur'))
  const auditPath = path.join(DATA_DIR, 'attache', 'audit.jsonl')
  attendu('écriture auditée (audit.jsonl)', fs.existsSync(auditPath) && fs.readFileSync(auditPath, 'utf8').trim().length > 0)

  // ── outil inconnu : erreur JSON-RPC propre
  const inconnu = await mcp({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'sous_agents', arguments: { taches: [] } } })
  attendu('outil exclu inappelable', inconnu.body?.error?.code === -32602, JSON.stringify(inconnu.body).slice(0, 120))

  // ── lot JSON-RPC : réponses dans l'ordre, notifications filtrées
  const lot = await mcp([
    { jsonrpc: '2.0', id: 7, method: 'ping' },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 8, method: 'tools/list', params: {} },
  ])
  attendu('lot : 2 réponses', Array.isArray(lot.body) && lot.body.length === 2 && lot.body[0].id === 7 && lot.body[1].id === 8)

  // ── révocation du trousseau : effet immédiat sur le connecteur
  fs.unlinkSync(path.join(DATA_DIR, 'attache', 'keyring.enc.json'))
  const aveugle = await mcp({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'lister_dossiers', arguments: {} } })
  attendu('trousseau révoqué → refus immédiat', (aveugle.body?.result?.content?.[0]?.text || '').includes('Trousseau non remis'), JSON.stringify(aveugle.body).slice(0, 160))
} catch (e) {
  echecs.push('exception')
  console.error('❌ exception :', e)
  console.error(serviceLog.slice(-2000))
} finally {
  child.kill('SIGTERM')
  fs.rmSync(SCRATCH, { recursive: true, force: true })
}

if (echecs.length) {
  console.error(`\n❌ ${echecs.length} échec(s) : ${echecs.join(' · ')}`)
  process.exit(1)
}
console.log('\n✅ TOUS LES TESTS PASSENT')
