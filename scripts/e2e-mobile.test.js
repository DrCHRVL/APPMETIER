/**
 * SIRAL — vérification mobile (iPhone) : la porte d'entrée et l'app se
 * chargent au format téléphone, la PWA est installable.
 * NODE_PATH=/tmp/node_modules node scripts/e2e-mobile.test.js
 */
const { chromium } = require('playwright-core')
const sparticuz = require('@sparticuz/chromium').default
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const DATA_DIR = '/tmp/siral-e2e-data' // réutilise les données du test e2e
const PORT = 3412
const BASE = `http://localhost:${PORT}`
const SHOTS = '/tmp/siral-e2e'

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try { if (await fn()) return true } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Timeout : ' + label)
}

async function main() {
  const server = spawn('node', ['.next/standalone/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), HOSTNAME: '127.0.0.1', NODE_ENV: 'production',
      SIRAL_DATA_DIR: DATA_DIR, SIRAL_SETUP_CODE: 'CODE-TEST-2026',
      SIRAL_SECRET: 'secret-de-test', SIRAL_INSECURE_HTTP: '1',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  await waitFor(async () => (await fetch(BASE + '/api/health')).ok, 30000, 'serveur')

  const browser = await chromium.launch({ executablePath: await sparticuz.executablePath(), args: sparticuz.args, headless: true })
  try {
    // iPhone 14/15 : 390x844, tactile, écran retina
    const context = await browser.newContext({
      baseURL: BASE,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await cdp.send('WebAuthn.enable')
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    })

    await page.goto('/')
    await page.waitForSelector('.siral-card', { timeout: 20000 })
    await page.screenshot({ path: SHOTS + '/m1-login.png' })
    console.log('✅ Mobile : écran de connexion adapté au format iPhone')

    // Enrôlement + déverrouillage
    await page.click('text=Enrôler une passkey')
    await page.fill('input[placeholder*="Identifiant"]', 'mobile.user')
    await page.fill('input[placeholder*="enrôlement"]', 'CODE-TEST-2026')
    await page.click('text=Créer ma passkey')
    await page.waitForSelector('text=Déverrouillage du coffre chiffré', { timeout: 20000 })
    await page.fill('input[placeholder="Phrase secrète"]', 'cheval correct pile batterie agrafe')
    await page.screenshot({ path: SHOTS + '/m2-unlock.png' })
    await page.click('text=Déverrouiller')
    await page.waitForSelector('.siral-card', { state: 'detached', timeout: 40000 })
    await page.waitForTimeout(6000)
    await page.screenshot({ path: SHOTS + '/m3-app.png' })
    console.log('✅ Mobile : app chargée après déverrouillage')

    const pulled = await page.evaluate(async () => {
      const r = await window.electronAPI.dataSync_pullContentieux('crimorg')
      return r && r.data && r.data.enquetes && r.data.enquetes[0].numero
    })
    console.log(pulled === '26/999' ? '✅ Mobile : données du service déchiffrées sur iPhone' : '❌ Mobile : pull KO ' + pulled)

    // Manifest PWA exploitable
    const manifest = await (await fetch(BASE + '/manifest.webmanifest')).json()
    const okManifest = manifest.display === 'standalone' && manifest.icons.length >= 3
    console.log(okManifest ? '✅ Mobile : manifest PWA installable (standalone + icônes)' : '❌ manifest')

    await context.close()
  } finally {
    await browser.close()
    server.kill()
  }
}

main().catch((e) => { console.error('ERREUR :', e.message); process.exit(1) })
