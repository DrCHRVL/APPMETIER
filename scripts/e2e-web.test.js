/**
 * SIRAL — test de bout en bout de l'édition web.
 * Lance le serveur standalone, simule une passkey (authenticator virtuel CDP),
 * déroule : enrôlement → création du coffre → app chargée → écriture de
 * données → vérification du chiffrement côté serveur → rechargement.
 *
 * NODE_PATH=/tmp/node_modules node scripts/e2e-web.test.js
 */
const { chromium } = require('playwright-core')
const sparticuz = require('@sparticuz/chromium').default
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const DATA_DIR = '/tmp/siral-e2e-data'
const PORT = 3411
const BASE = `http://localhost:${PORT}`
const SHOTS = '/tmp/siral-e2e'

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try { if (await fn()) return true } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Timeout : ' + label)
}

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
  fs.rmSync(SHOTS, { recursive: true, force: true })
  fs.mkdirSync(SHOTS, { recursive: true })

  // ── Démarrage du serveur standalone ──
  const server = spawn('node', ['.next/standalone/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      SIRAL_DATA_DIR: DATA_DIR,
      SIRAL_SETUP_CODE: 'CODE-TEST-2026',
      SIRAL_SECRET: 'secret-de-test',
      SIRAL_INSECURE_HTTP: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (d) => process.stdout.write('[srv] ' + d))
  server.stderr.on('data', (d) => process.stdout.write('[srv!] ' + d))

  await waitFor(async () => {
    const res = await fetch(BASE + '/api/health')
    return res.ok
  }, 30000, 'démarrage serveur')
  check('Serveur standalone démarré', true)

  const browser = await chromium.launch({
    executablePath: await sparticuz.executablePath(),
    args: sparticuz.args,
    headless: true,
  })

  try {
    const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('[page error]', e.message) })

    // Authenticator virtuel (passkey simulée)
    const cdp = await context.newCDPSession(page)
    await cdp.send('WebAuthn.enable')
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2', transport: 'internal',
        hasResidentKey: true, hasUserVerification: true,
        isUserVerified: true, automaticPresenceSimulation: true,
      },
    })

    // ── 1. Écran de connexion ──
    await page.goto('/')
    await page.waitForSelector('.siral-card', { timeout: 20000 })
    check('Écran de connexion SIRAL affiché', true)
    await page.screenshot({ path: SHOTS + '/01-login.png' })

    // ── 2. Enrôlement ──
    await page.click('text=Premier accès')
    await page.fill('input[placeholder*="Identifiant"]', 'a.chevalier')
    await page.fill('input[placeholder*="Nom affiché"]', 'A. Chevalier')
    await page.fill('input[placeholder*="Tribunal"]', 'TJ Test')
    await page.fill('input[placeholder*="enrôlement"]', 'CODE-TEST-2026')
    await page.screenshot({ path: SHOTS + '/02-register.png' })
    await page.click('text=Créer ma passkey')
    await page.waitForSelector('text=Initialisation du chiffrement', { timeout: 20000 })
    check('Enrôlement passkey réussi (compte admin créé)', true)

    // ── 3. Création du trousseau individuel (premier utilisateur, clés neuves) ──
    await page.fill('input[placeholder*="phrase personnelle (nouvelle)"]', 'cheval correct pile batterie agrafe')
    await page.fill('input[placeholder*="Confirmez votre phrase"]', 'cheval correct pile batterie agrafe')
    await page.screenshot({ path: SHOTS + '/03-passphrase.png' })
    await page.click('text=Créer mon trousseau')
    await page.waitForSelector('text=Imprimer le kit de récupération', { timeout: 60000 })
    check('Kit de récupération proposé après création du trousseau', true)
    await page.click('text=Continuer vers l\'application')
    // l'app doit se charger derrière la porte
    await page.waitForSelector('.siral-card', { state: 'detached', timeout: 60000 })
    check('Trousseau créé, porte franchie, app en cours de chargement', true)
    await page.waitForTimeout(6000)
    await page.screenshot({ path: SHOTS + '/04-app.png', fullPage: false })

    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 3000))
    check('Surface electronAPI complète exposée', await page.evaluate(() => {
      const api = window.electronAPI
      return api && Object.keys(api).length >= 105
    }), 'window.electronAPI')
    check('Pont web actif (bridge installé)', await page.evaluate(() => !!window.__SIRAL_BRIDGE__))
    console.log('--- contenu page (extrait) ---\n' + bodyText.split('\n').slice(0, 15).join('\n') + '\n---')

    // ── 4. Écriture de données via le pont (comme l'app le ferait) ──
    const writeOk = await page.evaluate(async () => {
      await window.electronAPI.setData('e2e_test_key', { version: 1, data: { hello: 'monde', dossier: 'OP TEST 26/999' } })
      const back = await window.electronAPI.getData('e2e_test_key', null)
      const pushed = await window.electronAPI.dataSync_pushContentieux('crimorg',
        { enquetes: [{ id: 1, numero: '26/999', nom: 'OP TEST' }] },
        { savedAt: new Date().toISOString(), savedBy: 'a.chevalier', version: 1 })
      const pulled = await window.electronAPI.dataSync_pullContentieux('crimorg')
      return {
        local: back && back.data && back.data.hello === 'monde',
        push: pushed === true,
        pull: pulled && pulled.data && pulled.data.enquetes[0].numero === '26/999',
      }
    })
    check('Stockage local (IndexedDB) : écriture + relecture', writeOk.local)
    check('Synchro serveur : push contentieux', writeOk.push)
    check('Synchro serveur : pull contentieux (déchiffré)', writeOk.pull)

    // ── 5. Vérification E2EE côté serveur ──
    const vaultPath = path.join(DATA_DIR, 'vaults', 'ctx-crimorg.json')
    const raw = fs.readFileSync(vaultPath, 'utf8')
    const env2 = JSON.parse(raw)
    check('Coffre serveur : enveloppe chiffrée uniquement',
      env2.encrypted === true && !!env2.ct && !raw.includes('OP TEST') && !raw.includes('26/999'),
      'aucune donnée en clair dans ' + vaultPath)
    const versionsDir = path.join(DATA_DIR, 'vaults', '.versions', 'ctx-crimorg')
    const hadVersioning = await page.evaluate(async () => {
      await window.electronAPI.dataSync_pushContentieux('crimorg',
        { enquetes: [{ id: 1, numero: '26/999', nom: 'OP TEST', maj: 2 }] },
        { savedAt: new Date().toISOString(), savedBy: 'a.chevalier', version: 2 })
      return true
    }) && fs.existsSync(versionsDir) && fs.readdirSync(versionsDir).length >= 1
    check('Versionnage immuable : ancienne version archivée au 2e push', hadVersioning)
    const backups = await page.evaluate(() => window.electronAPI.dataSync_listContentieuxBackups('crimorg'))
    check('Liste des sauvegardes serveur visible depuis l\'app', Array.isArray(backups) && backups.length >= 1, backups[0])

    // ── 5 bis. Import depuis l'app bureau (Paramètres → Sauvegardes) ──
    const desktopImportOk = await page.evaluate(async () => {
      // poussée d'un fichier du partage tel que l'import le ferait
      const tagsOk = await window.electronAPI.desktopImport_pushVault('tags',
        { tags: { 'OP-IMPORT': { couleur: '#123456' } } }, { savedBy: 'import-bureau' })
      const back = await window.electronAPI.globalSync_pullTags()
      // dépôt d'un document en CONSERVANT son chemin relatif (liens d'enquête)
      const bytes = new TextEncoder().encode('PV IMPORT BUREAU')
      await window.electronAPI.desktopImport_uploadDocument('26-998', 'Actes/PV import buréau n°2.pdf', bytes.buffer, 'Actes', 'PV import buréau n°2.pdf')
      const docExists = await window.electronAPI.documentExists('26-998', 'Actes/PV import buréau n°2.pdf')
      // les coffres d'accès et noms arbitraires sont refusés
      let keyringRefused = false
      try { await window.electronAPI.desktopImport_pushVault('keyring-a.chevalier', {}) } catch { keyringRefused = true }
      let arbitraryRefused = false
      try { await window.electronAPI.desktopImport_pushVault('e2ee-check', {}) } catch { arbitraryRefused = true }
      return { tagsOk: tagsOk === true && !!back && !!back.tags, docExists, keyringRefused, arbitraryRefused }
    })
    check('Import bureau : coffre partagé poussé et relisible', desktopImportOk.tagsOk)
    check('Import bureau : document déposé avec chemin relatif préservé', desktopImportOk.docExists)
    check('Import bureau : coffres d\'accès refusés', desktopImportOk.keyringRefused && desktopImportOk.arbitraryRefused)
    const importVaultRaw = fs.readFileSync(path.join(DATA_DIR, 'vaults', 'tags.json'), 'utf8')
    check('Import bureau : coffre chiffré côté serveur', !importVaultRaw.includes('OP-IMPORT'))

    // ── 6. Documents chiffrés ──
    const docOk = await page.evaluate(async () => {
      const bytes = new TextEncoder().encode('CONTENU PDF FICTIF — réquisitoire OP TEST')
      const saved = await window.electronAPI.saveDocuments('26-999', [{ name: 'requisitoire.pdf', arrayBuffer: bytes.buffer }], 'Actes')
      const exists = await window.electronAPI.documentExists('26-999', saved[0].cheminRelatif)
      return { saved: saved.length === 1 && saved[0].nomOriginal === 'requisitoire.pdf', exists }
    })
    check('Document : dépôt chiffré', docOk.saved)
    check('Document : existence vérifiée', docOk.exists)
    const docFiles = fs.readdirSync(path.join(DATA_DIR, 'docs', '26-999', 'Actes'))
    const docRaw = fs.readFileSync(path.join(DATA_DIR, 'docs', '26-999', 'Actes', docFiles[0]))
    check('Document : chiffré sur le serveur', docRaw.subarray(0, 4).toString() === 'SIR1' && !docRaw.includes('FICTIF'))

    // ── 7. Présence, événements, audit ──
    const misc = await page.evaluate(async () => {
      const hb = await window.electronAPI.writeHeartbeat('a.chevalier', { contentieux: 'crimorg', at: Date.now() })
      const all = await window.electronAPI.readAllHeartbeats()
      const ev = await window.electronAPI.writeSharedEvent({ type: 'enquete.update', numero: '26/999' })
      const recent = await window.electronAPI.readRecentSharedEvents(3600000)
      const audit = await window.electronAPI.appendAuditLog({ action: 'test', user: 'a.chevalier' }, 100)
      const auditRead = await window.electronAPI.readAuditLog()
      const net = await window.electronAPI.probeNetwork()
      return {
        hb: hb && all.length === 1 && all[0].username === 'a.chevalier' && all[0].contentieux === 'crimorg',
        ev: ev && recent.events.some((e) => e.numero === '26/999'),
        audit: audit && auditRead.some((e) => e.action === 'test'),
        net: net.state === 'healthy',
      }
    })
    check('Présence (heartbeat chiffré) écrite et relue', misc.hb)
    check('Événements partagés chiffrés écrits et relus', misc.ev)
    check('Journal d\'audit chiffré écrit et relu', misc.audit)
    check('Sonde réseau opérationnelle', misc.net, 'état healthy')

    // ── 8. Rechargement : clé mémorisée, pas de nouvelle saisie ──
    await page.reload()
    await page.waitForFunction(() => !!window.__SIRAL_BRIDGE__, null, { timeout: 30000 })
    const persisted = await page.evaluate(async () => {
      const back = await window.electronAPI.getData('e2e_test_key', null)
      return back && back.data && back.data.hello === 'monde'
    })
    check('Rechargement : déverrouillage automatique (clé mémorisée) + données locales intactes', persisted)
    await page.screenshot({ path: SHOTS + '/05-after-reload.png' })
    check('Aucune erreur JavaScript (hydratation propre)', pageErrors.length === 0, pageErrors[0])

    // ── 8b. Mise en page mobile (iPhone) : tiroir de navigation ──
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForSelector('button[aria-label="Ouvrir le menu"]', { timeout: 20000 })
    await page.waitForTimeout(400)
    const mobileState = await page.evaluate(() => {
      const burger = document.querySelector('button[aria-label="Ouvrir le menu"]')
      const visible = !!burger && burger.offsetWidth > 0
      // le premier conteneur .no-print (sidebar bureau) ne doit occuper aucune largeur à 390 px
      const sidebarWrapper = document.querySelector('.flex.h-screen > .no-print')
      const sidebarHidden = !!sidebarWrapper && sidebarWrapper.offsetWidth === 0
      const noHorizontalScroll = document.documentElement.scrollWidth <= 400
      return { visible, sidebarHidden, noHorizontalScroll, burgerW: burger ? burger.offsetWidth : -1, sideW: sidebarWrapper ? sidebarWrapper.offsetWidth : -1 }
    })
    check('Mobile : sidebar masquée + bouton menu visible', mobileState.visible && mobileState.sidebarHidden, JSON.stringify(mobileState))
    check('Mobile : pas de débordement horizontal', mobileState.noHorizontalScroll)
    await page.click('button[aria-label="Ouvrir le menu"]')
    await page.waitForTimeout(600)
    const drawerOpen = await page.evaluate(() => !!document.querySelector('.fixed.inset-0.z-50'))
    check('Mobile : tiroir de navigation ouvert au tap', drawerOpen)
    await page.screenshot({ path: SHOTS + '/05b-mobile-drawer.png' })
    await page.setViewportSize({ width: 1440, height: 900 })

    // ── 8c. Invitation d'un collègue (périmètre restreint à CRIM ORG) ──
    const inviteRes = await page.evaluate(async () => {
      const accounts = await window.electronAPI.e2ee_listAccounts()
      const inv = await window.electronAPI.e2ee_invite('j.martin', ['ctx-crimorg'])
      return { accounts, code: inv.code, scopes: inv.scopes }
    })
    check('Admin : liste des comptes avec état des trousseaux',
      inviteRes.accounts.some((a) => a.username === 'a.chevalier' && a.hasKeyring && a.tribunal === 'TJ Test'))
    check('Invitation générée (code à usage unique, périmètre CRIM ORG)',
      /^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/.test(inviteRes.code) && inviteRes.scopes.includes('global') && inviteRes.scopes.includes('ctx-crimorg') && !inviteRes.scopes.includes('ctx-ecofi'))

    // ── 9. Second utilisateur : enrôlement + invitation (nouveau navigateur = nouvel appareil) ──
    await context.close()
    const browser2 = await chromium.launch({ executablePath: await sparticuz.executablePath(), args: sparticuz.args, headless: true })
    const ctx2 = await browser2.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })
    const page2 = await ctx2.newPage()
    const cdp2 = await ctx2.newCDPSession(page2)
    await cdp2.send('WebAuthn.enable')
    await cdp2.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    })
    await page2.goto('/')
    await page2.waitForSelector('.siral-card')
    await page2.click('text=Premier accès')
    await page2.fill('input[placeholder*="Identifiant"]', 'j.martin')
    await page2.fill('input[placeholder*="Tribunal"]', 'TJ Test')
    await page2.fill('input[placeholder*="enrôlement"]', 'CODE-TEST-2026')
    await page2.click('text=Créer ma passkey')
    await page2.waitForSelector('text=Activer votre invitation', { timeout: 20000 })
    check('Second utilisateur : invitation détectée à l\'enrôlement', true)
    // mauvais code d'invitation refusé
    const wrongCode = inviteRes.code.slice(0, -5) + (inviteRes.code.endsWith('AAAAA') ? 'BBBBB' : 'AAAAA')
    await page2.fill('input[placeholder*="invitation"]', wrongCode)
    await page2.fill('input[placeholder*="phrase personnelle (nouvelle)"]', 'tulipe rouge marteau silence hiver')
    await page2.fill('input[placeholder*="Confirmez votre phrase"]', 'tulipe rouge marteau silence hiver')
    await page2.click('text=Activer mon accès')
    await page2.waitForSelector('text=Code d\'invitation incorrect', { timeout: 15000 })
    check('Mauvais code d\'invitation : refusé', true)
    // bon code → trousseau personnel créé, accès aux données
    await page2.fill('input[placeholder*="invitation"]', inviteRes.code)
    await page2.click('text=Activer mon accès')
    await page2.waitForSelector('text=Imprimer le kit de récupération', { timeout: 30000 })
    await page2.click('text=Continuer vers l\'application')
    await page2.waitForSelector('.siral-card', { state: 'detached', timeout: 30000 })
    const sharedRead = await page2.evaluate(async () => {
      const pulled = await window.electronAPI.dataSync_pullContentieux('crimorg')
      return pulled && pulled.data && pulled.data.enquetes[0].numero === '26/999'
    })
    check('Second utilisateur : accès aux données partagées via son trousseau', sharedRead)

    // ── 9b. Cloisonnement : périmètre non accordé refusé ──
    const cloisonne = await page2.evaluate(async () => {
      try {
        await window.electronAPI.dataSync_pushContentieux('ecofi',
          { enquetes: [] }, { savedAt: new Date().toISOString(), savedBy: 'j.martin' })
        return false
      } catch (e) {
        return String(e && e.message || e).includes('non autorisé')
      }
    })
    check('Cloisonnement : écriture ECOFI refusée (clé absente du trousseau)', cloisonne)

    // ── 9c. Mauvaise phrase personnelle refusée au déverrouillage ──
    await page2.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('siral-local')
      req.onsuccess = () => {
        const db = req.result
        const t = db.transaction('kv', 'readwrite')
        t.objectStore('kv').delete('__siral_keyring__')
        t.oncomplete = () => resolve(true)
      }
    }))
    await page2.reload()
    await page2.waitForSelector('text=Déverrouillage de votre trousseau', { timeout: 30000 })
    await page2.fill('input[placeholder="Phrase personnelle"]', 'mauvaise phrase totalement fausse')
    await page2.click('text=Déverrouiller')
    await page2.waitForSelector('text=Phrase personnelle incorrecte', { timeout: 15000 })
    check('Mauvaise phrase personnelle : refusée', true)
    await page2.fill('input[placeholder="Phrase personnelle"]', 'tulipe rouge marteau silence hiver')
    await page2.click('text=Déverrouiller')
    await page2.waitForSelector('.siral-card', { state: 'detached', timeout: 30000 })
    check('Bonne phrase personnelle : trousseau déverrouillé', true)

    // ── 9d. Sécurité : un membre ne peut pas écraser le trousseau/l'invitation d'autrui ──
    const putForbidden = await page2.evaluate(async () => {
      const fake = JSON.stringify({ v: 1, encrypted: true, iv: 'AAAA', ct: 'AAAA' })
      const r1 = await fetch('/api/vaults/keyring-a.chevalier', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: fake, credentials: 'same-origin' })
      const r2 = await fetch('/api/vaults/grant-a.chevalier', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: fake, credentials: 'same-origin' })
      return r1.status === 403 && r2.status === 403
    })
    check('Sécurité : écrasement du trousseau/invitation d\'autrui refusé (403)', putForbidden)

    // ── 9e. Sécurité : ré-enrôlement d'un compte existant refusé sans session du titulaire ──
    const takeover = await fetch(BASE + '/api/auth/register-options', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'a.chevalier', displayName: 'X', setupCode: 'CODE-TEST-2026' }),
    })
    check('Sécurité : capture de compte existant via code d\'enrôlement refusée', takeover.status === 400)

    // ── 10. Code d'enrôlement faux refusé ──
    const badCode = await page2.evaluate(async () => {
      const res = await fetch('/api/auth/register-options', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'intrus', displayName: 'X', setupCode: 'FAUX' }),
      })
      return res.status === 400
    })
    check('Code d\'enrôlement incorrect : enrôlement refusé', badCode)

    // ── 11. API sans session refusée ──
    const noAuth = await fetch(BASE + '/api/vaults/ctx-crimorg')
    check('API sans session : 401', noAuth.status === 401)

    // ── 11b. Rappels push : clé VAPID + calendrier d'horodatages (E2EE-friendly) ──
    const pushOk = await page2.evaluate(async () => {
      const key = await fetch('/api/push', { credentials: 'same-origin' }).then(r => r.json())
      const sched = await fetch('/api/push', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ times: [Date.now() + 3600_000, Date.now() + 7200_000] }),
        credentials: 'same-origin',
      }).then(r => r.json())
      return typeof key.publicKey === 'string' && key.publicKey.length > 30 && sched.ok === true && sched.kept === 2
    })
    check('Rappels push : clé VAPID servie + calendrier accepté (horodatages seuls)', pushOk)
    const schedRaw = fs.readFileSync(path.join(DATA_DIR, 'push-schedule.json'), 'utf8')
    check('Rappels push : le serveur ne stocke que des horodatages', !schedRaw.includes('OP TEST') && /^[\s{}\[\]"a-zA-Z0-9.,:_-]+$/.test(schedRaw))

    // ── 12. PWA : manifest + service worker + icônes ──
    const manifest = await fetch(BASE + '/manifest.webmanifest')
    const sw = await fetch(BASE + '/sw.js')
    const icon = await fetch(BASE + '/icons/icon-192.png')
    check('PWA : manifest, service worker, icônes servis', manifest.ok && sw.ok && icon.ok)

    await ctx2.close()
    await browser2.close()
  } finally {
    await browser.close()
    server.kill()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n══ RÉSULTAT : ${results.length - failed.length}/${results.length} vérifications réussies ══`)
  if (failed.length) { console.log('Échecs :', failed.map((f) => f.name).join(' · ')); process.exit(1) }
}

main().catch((e) => { console.error('ERREUR E2E :', e); process.exit(1) })
