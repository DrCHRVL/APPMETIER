/**
 * SIRAL — test de bout en bout du VERSEMENT des anciennes données.
 * 1. Fabrique un partage réseau Electron fictif (app-data, contentieux,
 *    tags, instructions, documents).
 * 2. Le verse avec scripts/siral-import.js (phrase de service).
 * 3. Démarre le serveur dessus, enrôle le premier utilisateur : l'écran de
 *    migration doit apparaître ; phrase du service + phrase personnelle.
 * 4. Vérifie : données lisibles, clés de contentieux RÉGÉNÉRÉES (rotation),
 *    documents accessibles, ancienne enveloppe archivée.
 *
 * NODE_PATH=/tmp/node_modules node scripts/e2e-migration.test.js
 */
const { chromium } = require('playwright-core')
const sparticuz = require('@sparticuz/chromium').default
const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC = '/tmp/siral-mig-source'
const DOCS_SRC = '/tmp/siral-mig-docs'
const DATA_DIR = '/tmp/siral-mig-data'
const PORT = 3412
const BASE = `http://localhost:${PORT}`
const SERVICE_PHRASE = 'ancienne phrase du service partagee'

const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  for (const d of [SRC, DOCS_SRC, DATA_DIR]) fs.rmSync(d, { recursive: true, force: true })

  // ── 1. Partage réseau Electron fictif ──
  fs.mkdirSync(path.join(SRC, 'crimorg'), { recursive: true })
  fs.writeFileSync(path.join(SRC, 'tag-data.json'), JSON.stringify({ services: ['OFAST', 'PJ'], infractions: ['Trafic'], duree: [], suivi: [] }))
  fs.writeFileSync(path.join(SRC, 'audience-data.json'), JSON.stringify({ audiences: [{ id: 'a1', nom: 'Audience legacy' }] }))
  fs.writeFileSync(path.join(SRC, 'crimorg', 'app-data.json'), JSON.stringify({
    data: { enquetes: [{ id: 7, numero: '25/123', nom: 'OP LEGACY' }] },
    metadata: { savedAt: '2026-01-15T10:00:00.000Z', savedBy: 'ancien.poste' },
  }))
  fs.writeFileSync(path.join(SRC, 'a.chevalier-instructions.json'), JSON.stringify({ dossiers: [{ id: 1, numeroParquet: 'P24-001' }] }))
  fs.mkdirSync(path.join(DOCS_SRC, '25-123', 'Actes'), { recursive: true })
  fs.writeFileSync(path.join(DOCS_SRC, '25-123', 'Actes', 'pv-legacy.pdf'), 'PDF LEGACY CONTENU SENSIBLE')

  // ── 2. Versement (import E2EE) ──
  const out = execFileSync('node', ['scripts/siral-import.js', '--source', SRC, '--docs', DOCS_SRC, '--out', DATA_DIR, '--passphrase', SERVICE_PHRASE], { cwd: ROOT, encoding: 'utf8' })
  check('Import : terminé complet (rapport vert)', out.includes('✅ Import complet'))
  const report = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'import-report.json'), 'utf8'))
  check('Import : rapport de complétude écrit', report.docs.source === 1 && report.docs.written === 1 && report.errors.length === 0)
  const rawVault = fs.readFileSync(path.join(DATA_DIR, 'vaults', 'ctx-crimorg.json'), 'utf8')
  check('Import : coffre contentieux chiffré (aucune donnée en clair)', !rawVault.includes('OP LEGACY') && JSON.parse(rawVault).encrypted === true)
  const ctBefore = JSON.parse(rawVault).ct

  // ── 3. Serveur + premier utilisateur → écran de migration ──
  const server = spawn('node', ['.next/standalone/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), HOSTNAME: '127.0.0.1', NODE_ENV: 'production',
      SIRAL_DATA_DIR: DATA_DIR, SIRAL_SETUP_CODE: 'CODE-MIG-2026', SIRAL_SECRET: 'secret-mig', SIRAL_INSECURE_HTTP: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stderr.on('data', (d) => process.stdout.write('[srv!] ' + d))
  const t0 = Date.now()
  while (Date.now() - t0 < 30000) {
    try { if ((await fetch(BASE + '/api/health')).ok) break } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }

  const browser = await chromium.launch({ executablePath: await sparticuz.executablePath(), args: sparticuz.args, headless: true })
  try {
    const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await cdp.send('WebAuthn.enable')
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    })

    await page.goto('/')
    await page.waitForSelector('.siral-card', { timeout: 20000 })
    await page.click('text=Enrôler une passkey')
    await page.fill('input[placeholder*="Identifiant"]', 'a.chevalier')
    await page.fill('input[placeholder*="enrôlement"]', 'CODE-MIG-2026')
    await page.click('text=Créer ma passkey')
    await page.waitForSelector('text=Passage aux clés individuelles', { timeout: 20000 })
    check('Serveur importé : écran de migration proposé au premier utilisateur', true)

    // mauvaise phrase de service refusée
    await page.fill('input[placeholder*="Phrase du service"]', 'phrase fausse vraiment fausse oui')
    await page.fill('input[placeholder*="phrase personnelle (nouvelle)"]', 'soleil cabane mardi prairie verte')
    await page.fill('input[placeholder*="Confirmez votre phrase"]', 'soleil cabane mardi prairie verte')
    await page.click('text=Migrer vers mon trousseau')
    await page.waitForSelector('text=Phrase du service incorrecte', { timeout: 15000 })
    check('Migration : mauvaise phrase de service refusée', true)

    // bonne phrase → migration + rotation
    await page.fill('input[placeholder*="Phrase du service"]', SERVICE_PHRASE)
    await page.click('text=Migrer vers mon trousseau')
    await page.waitForSelector('text=Imprimer le kit de récupération', { timeout: 60000 })
    check('Kit de récupération proposé après migration', true)
    await page.click('text=Continuer vers l\'application')
    await page.waitForSelector('.siral-card', { state: 'detached', timeout: 60000 })
    check('Migration réussie : porte franchie avec le nouveau trousseau', true)
    await page.waitForFunction(() => !!window.__SIRAL_BRIDGE__, null, { timeout: 30000 })

    const readBack = await page.evaluate(async () => {
      const ctx = await window.electronAPI.dataSync_pullContentieux('crimorg')
      const tags = await window.electronAPI.globalSync_pullTags()
      const instr = await window.electronAPI.instructionSync_pull('', 'a.chevalier')
      const docs = await window.electronAPI.documentExists('25-123', 'Actes/pv-legacy.pdf')
      return {
        ctx: ctx && ctx.data && ctx.data.enquetes[0].nom === 'OP LEGACY',
        meta: ctx && ctx.metadata && ctx.metadata.savedBy === 'ancien.poste',
        tags: tags && tags.services && tags.services.includes('OFAST'),
        instr: instr && instr.dossiers && instr.dossiers[0].numeroParquet === 'P24-001',
        docs,
      }
    })
    check('Données versées : enquête contentieux lisible (OP LEGACY)', readBack.ctx)
    check('Données versées : métadonnées d\'origine préservées', readBack.meta)
    check('Données versées : tags lisibles', readBack.tags)
    check('Données versées : instructions par utilisateur lisibles', readBack.instr)
    check('Données versées : document chiffré présent et indexé', readBack.docs)

    // rotation : l'enveloppe ctx-crimorg a changé et l'ancienne est archivée
    const after = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'vaults', 'ctx-crimorg.json'), 'utf8'))
    const versions = path.join(DATA_DIR, 'vaults', '.versions', 'ctx-crimorg')
    check('Rotation : coffre contentieux re-chiffré avec une clé neuve', after.ct !== ctBefore)
    check('Rotation : ancienne enveloppe archivée (rien n\'est perdu)', fs.existsSync(versions) && fs.readdirSync(versions).length >= 1)
    check('Trousseau individuel déposé', fs.existsSync(path.join(DATA_DIR, 'vaults', 'keyring-a.chevalier.json')))

    await context.close()
  } finally {
    await browser.close()
    server.kill()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n══ RÉSULTAT MIGRATION : ${results.length - failed.length}/${results.length} vérifications réussies ══`)
  if (failed.length) { console.log('Échecs :', failed.map((f) => f.name).join(' · ')); process.exit(1) }
}

main().catch((e) => { console.error('ERREUR E2E MIGRATION :', e); process.exit(1) })
