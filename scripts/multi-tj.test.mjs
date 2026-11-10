/**
 * SIRAL — test de bout en bout du MULTI-TRIBUNAUX.
 *
 * Joue, contre les vraies routes serveur (appelées en process sur un
 * SIRAL_DATA_DIR jetable) et la vraie cryptographie client (WebCrypto) :
 *  1. l'administrateur général : premier compte, clés du TJ d'origine, paire
 *     de séquestre, création d'un TJ ;
 *  2. l'administrateur LOCAL d'un nouveau TJ : premier inscrit avec le code,
 *     création des clés, papeterie, dépôt du séquestre ;
 *  3. un magistrat « lambda » : inscription (demande d'accès), attente,
 *     habilitations (contentieux, modules) réglées par l'admin local seul,
 *     invitation, activation, lecture de ses données ;
 *  4. la supervision par l'administrateur général : tableau des TJ, bascule,
 *     ouverture du séquestre, lecture des données, journal, désignation ;
 *  5. l'étanchéité : aucun accès croisé entre TJ, un membre = un TJ ;
 *  6. la gestion des TJ par l'administrateur général : création directe de
 *     comptes, connexion par mot de passe provisoire, changement de mot de
 *     passe, statuts (admin local, membre, suspendu), déplacement,
 *     indicateurs scellés lus par lui seul ;
 *  7. ses pouvoirs à distance : déblocage d'un compte (invitation aux
 *     périmètres de ses habilitations, phrase perdue), cartographie inter-TJ.
 *
 *   node scripts/multi-tj.test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// Les routes et modules sont en TypeScript (alias « @/ ») : on se relance
// sous le chargeur tsx, depuis la racine du dépôt (tsconfig).
if (!process.env.SIRAL_TEST_TSX) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url)], {
    cwd: REPO, stdio: 'inherit', env: { ...process.env, SIRAL_TEST_TSX: '1' },
  })
  process.exit(r.status ?? 1)
}
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-multitj-'))
process.env.SIRAL_DATA_DIR = path.join(SCRATCH, 'data')
process.env.SIRAL_SETUP_CODE = 'CODE-ENROLEMENT-TEST'
process.env.SIRAL_SECRET = 'secret-de-test'
fs.mkdirSync(process.env.SIRAL_DATA_DIR, { recursive: true })

// ── navigateur simulé (identité de session, TJ actif, pont SIRAL) ──
globalThis.window = globalThis
window.addEventListener = () => {}
window.removeEventListener = () => {}
globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, hidden: false }
const serveurUsersConfig = new Map() // tj → users-config (le coffre, déchiffré)
window.siralBridge = {
  getData: async () => null,
  setData: async () => true,
  clearData: async () => true,
  getCurrentUser: async () => ({ displayName: window.__SIRAL_ME__.username, computerName: 'test' }),
  dataSync_pullUsersConfig: async () => {
    const c = serveurUsersConfig.get(window.__SIRAL_TJ__.active.id)
    return c ? { status: 'ok', config: structuredClone(c) } : { status: 'missing' }
  },
  dataSync_pushUsersConfig: async (config) => { serveurUsersConfig.set(window.__SIRAL_TJ__.active.id, structuredClone(config)); return true },
}

const imp = (rel) => import(pathToFileURL(path.join(REPO, rel)).href)
const route = (p) => imp(`app/api/${p}/route.ts`)
const [register, tjsApi, vault, accounts, accountsTjs, state, me, switchTj, escrowApi, versionFile, comptes, pwLogin, pwChange] = await Promise.all([
  route('auth/password-register'), route('tjs'), route('vaults/[name]'), route('accounts'),
  route('accounts/tjs'), route('e2ee/state'), route('me'), route('auth/switch-tj'), route('escrow'),
  route('vaults/[name]/versions/[file]'), route('tjs/comptes'), route('auth/password-login'), route('auth/password-change'),
])
const donnees = await route('tjs/donnees')
const epinglesApi = await route('escrow/epingles')
const { encryptJson, decryptJson } = await imp('lib/web/crypto.ts')
const keyring = await imp('lib/web/keyring.ts')
const escrow = await imp('lib/web/escrow.ts')
const indic = await imp('lib/web/indicateurs.ts')
const adminGen = await imp('lib/web/adminGeneral.ts')
const { UserManager } = await imp('utils/userManager.ts')
const { PAPETERIE } = await imp('lib/web/papeterie.ts')

// ── outillage ──
let ok = 0, ko = 0
const verifier = (nom, cond) => { if (cond) ok++; else ko++; console.log(`${cond ? '  ✓' : '  ✗'} ${nom}`) }
const titre = (t) => console.log(`\n${t}`)

const requete = (url, method = 'GET', body, cookie) => new Request(`http://siral.test${url}`, {
  method,
  headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}`, ...(cookie ? { cookie } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
})
const cookieDe = (res) => (res.headers.get('set-cookie') || '').split(';')[0]
const json = async (res) => res.json().catch(() => ({}))

async function inscrire(username, code, displayName = username) {
  const res = await register.POST(requete('/api/auth/password-register', 'POST', { username, displayName, password: 'motdepasse-12', setupCode: code }))
  return { res, cookie: cookieDe(res) }
}
const coffreGet = (name, c) => vault.GET(requete(`/api/vaults/${name}`, 'GET', undefined, c), { params: { name } })
const coffrePut = (name, env, c) => vault.PUT(requete(`/api/vaults/${name}`, 'PUT', env, c), { params: { name } })
const coffreDel = (name, c) => vault.DELETE(requete(`/api/vaults/${name}`, 'DELETE', undefined, c), { params: { name } })
const etat = async (c) => json(await state.GET(requete('/api/e2ee/state', 'GET', undefined, c)))
const moi = async (c) => json(await me.GET(requete('/api/me', 'GET', undefined, c)))
const http = (c) => ({
  getJson: async (p) => {
    const [chemin, qs] = p.split('?')
    if (chemin.startsWith('/api/vaults/')) {
      const res = await coffreGet(chemin.replace('/api/vaults/', ''), c)
      return { status: res.status, json: await json(res) }
    }
    if (chemin === '/api/escrow/epingles') {
      const res = await epinglesApi.GET(requete(chemin, 'GET', undefined, c))
      return { status: res.status, json: await json(res) }
    }
    if (chemin !== '/api/escrow') throw new Error('route non simulée ' + p)
    const res = await escrowApi.GET(requete(chemin + (qs ? `?${qs}` : ''), 'GET', undefined, c))
    return { status: res.status, json: await json(res) }
  },
  putJson: async (p, body) => {
    if (p === '/api/escrow') return (await escrowApi.PUT(requete(p, 'PUT', body, c))).status
    if (p === '/api/escrow/epingles') return (await epinglesApi.PUT(requete(p, 'PUT', body, c))).status
    const name = p.replace('/api/vaults/', '')
    return (await coffrePut(name, body, c)).status
  },
})

/** Dépose mon trousseau (comme WebGate.pushKeyring). */
async function deposerTrousseau(username, payload, phrase, c) {
  const kdf = keyring.newKdfParams()
  const cle = await keyring.importAesKey(await keyring.deriveRawKey(phrase, kdf.salt, kdf.iterations))
  const env = await encryptJson(cle, payload, { savedBy: username })
  return coffrePut(`keyring-${username}`, { ...env, kdfSalt: kdf.salt, kdfIterations: kdf.iterations }, c)
}
/** Rouvre mon trousseau avec ma phrase (comme WebGate.doUnlock). */
async function ouvrirTrousseau(username, phrase, c) {
  const { envelope } = await json(await coffreGet(`keyring-${username}`, c))
  const cle = await keyring.importAesKey(await keyring.deriveRawKey(phrase, envelope.kdfSalt, envelope.kdfIterations))
  return decryptJson(cle, envelope)
}
/** Écrit / lit un coffre de données chiffré par une clé de périmètre. */
async function ecrireDonnees(name, keysRaw, scope, data, c) {
  const cle = await keyring.importAesKey(new Uint8Array(Buffer.from(keysRaw[scope], 'base64')))
  return coffrePut(name, await encryptJson(cle, data, { savedBy: 'test' }), c)
}
async function lireDonnees(name, keysRaw, scope, c) {
  const res = await coffreGet(name, c)
  if (res.status !== 200) return { status: res.status }
  const { envelope } = await json(res)
  const cle = await keyring.importAesKey(new Uint8Array(Buffer.from(keysRaw[scope], 'base64')))
  try { return { status: 200, data: await decryptJson(cle, envelope) } } catch { return { status: 200, illisible: true } }
}
/** Invitation (comme bridge.e2ee_invite). */
async function inviter(destinataire, keysRaw, scopes, c) {
  const subset = Object.fromEntries(['global', ...scopes].map((s) => [s, keysRaw[s]]))
  const code = keyring.generateInvitationCode()
  const kdf = keyring.newKdfParams()
  const cle = await keyring.importAesKey(await keyring.deriveRawKey(code, kdf.salt, kdf.iterations))
  const env = await encryptJson(cle, { v: 1, keys: subset, grantedBy: 'admin', grantedAt: new Date().toISOString() })
  const res = await coffrePut(`grant-${destinataire}`, { ...env, kdfSalt: kdf.salt, kdfIterations: kdf.iterations }, c)
  return { status: res.status, code }
}
/** Session navigateur simulée : identité + TJ actif, UserManager neuf. */
async function ouvrirApp(c) {
  const m = await moi(c)
  window.__SIRAL_ME__ = { username: m.username, displayName: m.displayName, role: m.role, tjAdmin: m.tjAdmin }
  window.__SIRAL_TJ__ = { active: m.tj, tjs: m.tjs }
  UserManager.instance = undefined
  const um = UserManager.getInstance()
  const perms = await um.initialize()
  return { um, perms, me: m }
}

const PHRASE_ADMIN = 'phrase de l administrateur general'
const PHRASE_LILLE = 'phrase de l admin local de lille'
const PHRASE_MAG = 'phrase du magistrat lambda'

// ════════════════════════════════════════════════════════════
titre('1. Administrateur général')
const sa = await inscrire('audran', process.env.SIRAL_SETUP_CODE, 'A. Chevalier')
verifier('premier compte = administrateur général', sa.res.status === 200 && (await json(sa.res)).role === 'admin')
let e = await etat(sa.cookie)
verifier('il peut initialiser le TJ d’origine', e.canInitialize === true && e.anyKeyrings === false)
const clesAmiens = keyring.freshKeyringPayload()
verifier('clés d’Amiens créées', (await deposerTrousseau('audran', clesAmiens, PHRASE_ADMIN, sa.cookie)).status === 200)
verifier('paire de séquestre créée au déverrouillage',
  await escrow.maintenirSequestre(clesAmiens.keys, { username: 'audran', role: 'admin' }, PHRASE_ADMIN, e, 'default', http(sa.cookie)) === 'paire-creee')
e = await etat(sa.cookie)
verifier('il dépose aussi le séquestre d’Amiens', !!e.escrow)
verifier('paire non recréée, séquestre à jour',
  await escrow.maintenirSequestre(clesAmiens.keys, { username: 'audran', role: 'admin' }, PHRASE_ADMIN, e, 'default', http(sa.cookie)) === 'a-jour')
verifier('données d’Amiens écrites', (await ecrireDonnees('ctx-crimorg', clesAmiens.keys, 'ctx-crimorg', { dossiers: ['AMIENS-1'] }, sa.cookie)).status === 200)
let r = await tjsApi.POST(requete('/api/tjs', 'POST', { name: 'TJ Lille' }, sa.cookie))
const { code: codeLille, tj: tjLille } = await json(r)
verifier('TJ Lille créé, code d’accès rendu une fois', r.status === 200 && /^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(codeLille))
const amiensColl = await inscrire('collegue.amiens', process.env.SIRAL_SETUP_CODE)
verifier('Amiens : un nouvel inscrit n’est pas administrateur', (await etat(amiensColl.cookie)).canInitialize === false)

// ════════════════════════════════════════════════════════════
titre('2. Administrateur local de Lille')
const la = await inscrire('lille.admin', codeLille, 'L. Admin')
let m = await moi(la.cookie)
verifier('premier inscrit avec le code = administrateur local', m.tjAdmin === true && m.role === 'member')
verifier('il ne voit que Lille', m.tjs.length === 1 && m.tjs[0].id === tjLille.id)
const sw0 = cookieDe(await switchTj.POST(requete('/api/auth/switch-tj', 'POST', { tj: tjLille.id }, sa.cookie)))
e = await etat(sw0)
verifier('l’admin général pourrait initialiser Lille (au choix), il laisse faire l’admin local', e.canInitialize === true && !e.escrow)
e = await etat(la.cookie)
verifier('l’admin local peut initialiser', e.canInitialize === true && e.isTjAdmin === true)
const clesLille = keyring.freshKeyringPayload()
verifier('clés de Lille créées par l’admin local', (await deposerTrousseau('lille.admin', clesLille, PHRASE_LILLE, la.cookie)).status === 200)
e = await etat(la.cookie)
verifier('séquestre déposé pour l’admin général',
  await escrow.maintenirSequestre(clesLille.keys, { username: 'lille.admin', role: 'member' }, PHRASE_LILLE, e, tjLille.id, http(la.cookie)) === 'depose')
e = await etat(la.cookie)
verifier('séquestre à jour : pas de nouveau dépôt',
  await escrow.maintenirSequestre(clesLille.keys, { username: 'lille.admin', role: 'member' }, PHRASE_LILLE, e, tjLille.id, http(la.cookie)) === 'a-jour')
verifier('données de Lille écrites', (await ecrireDonnees('ctx-crimorg', clesLille.keys, 'ctx-crimorg', { dossiers: ['LILLE-1'] }, la.cookie)).status === 200)

let app = await ouvrirApp(la.cookie)
verifier('habilitations de Lille créées : il en est administrateur', app.um.getCurrentUser()?.globalRole === 'admin')
await app.um.updatePapeterieTj({ juridiction: "Cour d'appel de Douai — Tribunal judiciaire de Lille", standard: '03 20 00 00 00' })
verifier('papeterie de Lille appliquée', PAPETERIE.juridiction.includes('Lille') && PAPETERIE.ville === 'Lille')

// ════════════════════════════════════════════════════════════
titre('3. Magistrat lambda de Lille')
const mag = await inscrire('lille.magistrat', codeLille, 'M. Lambda')
m = await moi(mag.cookie)
verifier('inscription = demande d’accès : compte créé, non administrateur', mag.res.status === 200 && m.tjAdmin === false)
e = await etat(mag.cookie)
verifier('accès en attente (ni trousseau ni invitation)', !e.hasKeyring && !e.hasGrant && e.anyKeyrings && !e.canInitialize)
verifier('il ne peut pas se créer de clés', (await deposerTrousseau('lille.magistrat', keyring.freshKeyringPayload(), PHRASE_MAG, mag.cookie)).status === 403)
verifier('il ne peut pas s’inviter', (await inviter('lille.magistrat', clesLille.keys, [], mag.cookie)).status === 403)
verifier('il ne voit pas la liste des comptes', (await accounts.GET(requete('/api/accounts', 'GET', undefined, mag.cookie))).status === 403)
verifier('il ne peut pas basculer de TJ', (await switchTj.POST(requete('/api/auth/switch-tj', 'POST', { tj: 'default' }, mag.cookie))).status === 403)
verifier('il ne peut pas créer de TJ', (await tjsApi.POST(requete('/api/tjs', 'POST', { name: 'TJ Pirate' }, mag.cookie))).status === 403)
verifier('il ne lit pas le séquestre', (await coffreGet('escrow-keys', mag.cookie)).status === 403)
verifier('… ni son historique', (await versionFile.GET(requete('/api/vaults/escrow-keys/versions/x.json', 'GET', undefined, mag.cookie), { params: { name: 'escrow-keys', file: 'x.json' } })).status === 403)
verifier('il ne lit pas la clé privée d’administration', (await escrowApi.GET(requete('/api/escrow?prive=1', 'GET', undefined, mag.cookie))).status === 403)
verifier('il ne dépose pas de séquestre', (await coffrePut('escrow-keys', { encrypted: true, ct: 'x', iv: 'y' }, mag.cookie)).status === 403)

r = await accounts.GET(requete('/api/accounts', 'GET', undefined, la.cookie))
const liste = (await json(r)).accounts || []
verifier('l’admin local voit la demande du magistrat', r.status === 200 && liste.some((a) => a.username === 'lille.magistrat' && !a.hasKeyring && !a.hasGrant))
verifier('… et aucun compte d’Amiens', !liste.some((a) => a.username === 'collegue.amiens'))
verifier('… ni l’administrateur général', !liste.some((a) => a.username === 'audran'))

app = await ouvrirApp(la.cookie)
await app.um.reconcileWithAccounts(liste.map((a) => ({ username: a.username, displayName: a.displayName, role: a.role, tjAdmin: a.tjAdmin })))
await app.um.assignContentieux('lille.magistrat', 'crimorg', 'magistrat')
await app.um.toggleModule('lille.magistrat', 'instructions', true)
const profil = serveurUsersConfig.get(tjLille.id).users.find((u) => u.windowsUsername === 'lille.magistrat')
verifier('l’admin local attribue contentieux et module, sans l’admin général',
  profil?.contentieux.some((c) => c.contentieuxId === 'crimorg') && profil.modules.includes('instructions') && profil.globalRole === null)
verifier('aucune habilitation de Lille dans la config d’Amiens', !(serveurUsersConfig.get('default')?.users || []).some((u) => u.windowsUsername === 'lille.magistrat'))

const inv = await inviter('lille.magistrat', clesLille.keys, ['ctx-crimorg'], la.cookie)
verifier('l’admin local invite le magistrat', inv.status === 200)
e = await etat(mag.cookie)
verifier('le magistrat voit son invitation', e.hasGrant === true)
const { envelope: grantEnv } = await json(await coffreGet('grant-lille.magistrat', mag.cookie))
const cleCode = await keyring.importAesKey(await keyring.deriveRawKey(keyring.normalizeInvitationCode(inv.code), grantEnv.kdfSalt, grantEnv.kdfIterations))
const grant = await decryptJson(cleCode, grantEnv)
const payloadMag = { v: 1, keys: grant.keys, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
verifier('il active son invitation (trousseau créé)', (await deposerTrousseau('lille.magistrat', payloadMag, PHRASE_MAG, mag.cookie)).status === 200)
verifier('… et la supprime', (await coffreDel('grant-lille.magistrat', mag.cookie)).status === 200)
const relu = await ouvrirTrousseau('lille.magistrat', PHRASE_MAG, mag.cookie)
let lu = await lireDonnees('ctx-crimorg', relu.keys, 'ctx-crimorg', mag.cookie)
verifier('il lit les dossiers de Lille de son contentieux', lu.data?.dossiers?.[0] === 'LILLE-1')
verifier('il n’a pas la clé d’un contentieux non attribué', !relu.keys['ctx-ecofi'])

app = await ouvrirApp(mag.cookie)
verifier('ses permissions : CRIM ORG, module instruction, pas admin',
  app.perms.accessibleContentieux.includes('crimorg') && !app.perms.accessibleContentieux.includes('ecofi')
  && app.um.getCurrentUser().modules.includes('instructions') && app.um.getCurrentUser().globalRole !== 'admin')
// tentative d'auto-promotion dans la config d'habilitations
const cfg = serveurUsersConfig.get(tjLille.id)
cfg.users.find((u) => u.windowsUsername === 'lille.magistrat').globalRole = 'admin'
app = await ouvrirApp(mag.cookie)
verifier('une auto-promotion dans la config reste sans effet (le serveur fait foi)', app.um.getCurrentUser().globalRole !== 'admin')
verifier('la papeterie suit le TJ (Lille)', PAPETERIE.ville === 'Lille')

// ════════════════════════════════════════════════════════════
titre('4. Supervision par l’administrateur général')
r = await tjsApi.GET(requete('/api/tjs', 'GET', undefined, sa.cookie))
const sup = (await json(r)).tjs.find((t) => t.id === tjLille.id)
verifier('tableau : admin local, clés créées, aucun en attente, accès général prêt',
  sup.admins.includes('L. Admin') && sup.initialized && sup.pending === 0 && !!sup.escrow && !sup.myAccess && sup.members === 2)
verifier('l’admin local n’a pas accès à la supervision', (await tjsApi.GET(requete('/api/tjs', 'GET', undefined, la.cookie))).status === 403)
const sw = cookieDe(await switchTj.POST(requete('/api/auth/switch-tj', 'POST', { tj: tjLille.id }, sa.cookie)))
m = await moi(sw)
verifier('bascule sur Lille', m.tj.id === tjLille.id && m.tjs.length === 2)
e = await etat(sw)
verifier('parcours « accès administrateur général » proposé', !e.hasKeyring && !e.hasGrant && !!e.escrow)
verifier('l’admin local ne peut pas lire le séquestre', (await coffreGet('escrow-keys', la.cookie)).status === 403)
const privRes = await json(await escrowApi.GET(requete('/api/escrow?prive=1', 'GET', undefined, sw)))
let mauvaise = false
try { await escrow.openPrivateKey(privRes.privateEnvelope, 'mauvaise phrase') } catch { mauvaise = true }
verifier('mauvaise phrase : clé d’administration refusée', mauvaise)
const pk = await escrow.openPrivateKey(privRes.privateEnvelope, PHRASE_ADMIN)
const { envelope: sqEnv } = await json(await coffreGet('escrow-keys', sw))
const clesOuvertes = await escrow.openEscrow(pk, sqEnv)
verifier('séquestre ouvert : clés de Lille retrouvées', clesOuvertes['ctx-crimorg'] === clesLille.keys['ctx-crimorg'])
const payloadSa = { v: 1, keys: clesOuvertes, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
verifier('son trousseau de Lille est créé', (await deposerTrousseau('audran', payloadSa, PHRASE_ADMIN, sw)).status === 200)
lu = await lireDonnees('ctx-crimorg', (await ouvrirTrousseau('audran', PHRASE_ADMIN, sw)).keys, 'ctx-crimorg', sw)
verifier('il lit les données de Lille', lu.data?.dossiers?.[0] === 'LILLE-1')
verifier('l’admin local ne peut pas révoquer l’accès de l’admin général', (await coffreDel('keyring-audran', la.cookie)).status === 403
  && (await coffreGet('keyring-audran', sw)).status === 200)
const audit = fs.readFileSync(path.join(process.env.SIRAL_DATA_DIR, 'audit.jsonl'), 'utf8')
verifier('l’ouverture du séquestre est journalisée', audit.includes('"escrow.read"') && audit.includes(tjLille.id))
r = await accountsTjs.POST(requete('/api/accounts/tjs', 'POST', { username: 'lille.magistrat', tjs: [tjLille.id], tjAdmins: [tjLille.id] }, sa.cookie))
verifier('il désigne un second administrateur local', r.status === 200 && (await moi(mag.cookie)).tjAdmin === true)
await accountsTjs.POST(requete('/api/accounts/tjs', 'POST', { username: 'lille.magistrat', tjs: [tjLille.id], tjAdmins: [] }, sa.cookie))
verifier('… et le retire', (await moi(mag.cookie)).tjAdmin === false)
verifier('l’admin local ne peut pas désigner', (await accountsTjs.POST(requete('/api/accounts/tjs', 'POST', { username: 'lille.magistrat', tjs: [tjLille.id], tjAdmins: [tjLille.id] }, la.cookie))).status === 403)

// ════════════════════════════════════════════════════════════
titre('5. Étanchéité entre tribunaux')
lu = await lireDonnees('ctx-crimorg', clesLille.keys, 'ctx-crimorg', la.cookie)
verifier('un même nom de coffre désigne deux espaces distincts', lu.data?.dossiers?.[0] === 'LILLE-1')
lu = await lireDonnees('ctx-crimorg', clesLille.keys, 'ctx-crimorg', sa.cookie)
verifier('les clés de Lille n’ouvrent pas les données d’Amiens', lu.illisible === true)
verifier('un membre ne peut relever de deux TJ',
  (await accountsTjs.POST(requete('/api/accounts/tjs', 'POST', { username: 'lille.magistrat', tjs: [tjLille.id, 'default'] }, sa.cookie))).status === 400)
r = await accountsTjs.POST(requete('/api/accounts/tjs', 'POST', { username: 'lille.magistrat', tjs: ['default'] }, sa.cookie))
verifier('déplacé à Amiens : son accès à Lille est coupé immédiatement', r.status === 200 && (await coffreGet('ctx-crimorg', mag.cookie)).status === 403)
e = await etat(amiensColl.cookie)
app = await ouvrirApp(sa.cookie)
verifier('retour à Amiens : sa papeterie d’origine', PAPETERIE.ville === 'Amiens')
r = await tjsApi.POST(requete('/api/tjs', 'POST', { name: 'TJ Douai' }, sa.cookie))
const tjDouai = (await json(r)).tj
const swD = cookieDe(await switchTj.POST(requete('/api/auth/switch-tj', 'POST', { tj: tjDouai.id }, sa.cookie)))
const loginMdp = (username, password) => pwLogin.POST(requete('/api/auth/password-login', 'POST', { username, password }))
r = await accountsTjs.POST(requete('/api/accounts/tjs', 'POST', { username: 'collegue.amiens', tjs: [tjDouai.id] }, sa.cookie))
verifier('déplacé vers Douai : son ancienne session d’Amiens est coupée', r.status === 200 && (await coffreGet('ctx-crimorg', amiensColl.cookie)).status === 403)
const collDouai = cookieDe(await loginMdp('collegue.amiens', 'motdepasse-12'))
verifier('un membre lambda ne peut pas initialiser un TJ vierge',
  (await etat(collDouai)).canInitialize === false
  && (await deposerTrousseau('collegue.amiens', keyring.freshKeyringPayload(), 'phrase du collegue', collDouai)).status === 403)

// ════════════════════════════════════════════════════════════
titre('6. Gestion des TJ par l’administrateur général')
r = await comptes.POST(requete('/api/tjs/comptes', 'POST', { username: 'douai.admin', displayName: 'D. Admin', tj: tjDouai.id, tjAdmin: true }, sa.cookie))
const mdpDouai = (await json(r)).motDePasse
verifier('création directe d’un administrateur local dans Douai (mot de passe provisoire)', r.status === 200 && typeof mdpDouai === 'string' && mdpDouai.length >= 15)
verifier('l’admin local ne peut pas créer de compte par cette voie',
  (await comptes.POST(requete('/api/tjs/comptes', 'POST', { username: 'x.y', tj: tjLille.id }, la.cookie))).status === 403)
verifier('identifiant déjà pris : refusé',
  (await comptes.POST(requete('/api/tjs/comptes', 'POST', { username: 'douai.admin', tj: tjDouai.id }, sa.cookie))).status === 409)
r = await loginMdp('douai.admin', mdpDouai)
const da = cookieDe(r)
m = await moi(da)
verifier('il se connecte avec le mot de passe provisoire, administrateur de Douai', r.status === 200 && m.tjAdmin === true && m.tj.id === tjDouai.id)
verifier('il change son mot de passe', (await pwChange.POST(requete('/api/auth/password-change', 'POST', { ancien: mdpDouai, nouveau: 'mon-nouveau-mdp' }, da))).status === 200
  && (await loginMdp('douai.admin', mdpDouai)).status === 401 && (await loginMdp('douai.admin', 'mon-nouveau-mdp')).status === 200)
const clesDouai = keyring.freshKeyringPayload()
verifier('TJ vierge : il en crée les clés', (await etat(da)).canInitialize === true
  && (await deposerTrousseau('douai.admin', clesDouai, 'phrase admin douai', da)).status === 200)
r = await comptes.POST(requete('/api/tjs/comptes', 'POST', { username: 'douai.magistrat', displayName: 'D. Magistrat', tj: tjDouai.id }, sa.cookie))
const mdpMag = (await json(r)).motDePasse
const dm = cookieDe(await loginMdp('douai.magistrat', mdpMag))
let sup2 = await json(await tjsApi.GET(requete('/api/tjs', 'GET', undefined, sa.cookie)))
let compte = (u) => sup2.accounts.find((a) => a.username === u)
verifier('supervision : magistrat créé, membre, en attente d’invitation', compte('douai.magistrat')?.acces === 'en-attente'
  && !(compte('douai.magistrat').tjAdmins || []).length && sup2.tjs.find((t) => t.id === tjDouai.id).pending === 2)
verifier('supervision : l’admin local de Douai a un accès actif', compte('douai.admin')?.acces === 'actif')
const patchCompte = (body) => comptes.PATCH(requete('/api/tjs/comptes', 'PATCH', body, sa.cookie))
verifier('statut → administrateur local', (await patchCompte({ username: 'douai.magistrat', action: 'admin-local', valeur: true })).status === 200 && (await moi(dm)).tjAdmin === true)
verifier('statut → membre', (await patchCompte({ username: 'douai.magistrat', action: 'admin-local', valeur: false })).status === 200 && (await moi(dm)).tjAdmin === false)
verifier('statut → suspendu : plus de connexion ni d’accès aux données',
  (await patchCompte({ username: 'douai.magistrat', action: 'suspendre' })).status === 200
  && (await loginMdp('douai.magistrat', mdpMag)).status === 403 && (await coffreGet('ctx-crimorg', dm)).status === 403)
verifier('réactivé : connexion rétablie', (await patchCompte({ username: 'douai.magistrat', action: 'reactiver' })).status === 200
  && (await loginMdp('douai.magistrat', mdpMag)).status === 200)
r = await patchCompte({ username: 'douai.magistrat', action: 'mot-de-passe' })
const mdp2 = (await json(r)).motDePasse
verifier('nouveau mot de passe provisoire : l’ancien ne fonctionne plus', (await loginMdp('douai.magistrat', mdpMag)).status === 401 && (await loginMdp('douai.magistrat', mdp2)).status === 200)
verifier('le compte de l’admin général ne se modifie pas par cette voie', (await patchCompte({ username: 'audran', action: 'suspendre' })).status === 400)
verifier('déplacement par la gestion des TJ', (await patchCompte({ username: 'douai.magistrat', action: 'tribunal', tj: tjLille.id })).status === 200
  && (await moi(cookieDe(await loginMdp('douai.magistrat', mdp2)))).tj.id === tjLille.id)

// indicateurs : comptés et scellés par un poste du TJ, lus par l'admin général seul
const enquetesLille = [
  { statut: 'en_cours', misEnCause: [{ nom: 'A' }, { nom: 'B' }, { nom: 'V', isVictime: true }] },
  { statut: 'en_cours', misEnCause: [{ nom: 'C' }] },
  { statut: 'archive', misEnCause: [{ nom: 'D' }] },
  { statut: 'instruction', misEnCause: [] },
]
const entrees = [
  { coffre: 'indicateurs-ctx-crimorg', valeur: indic.calculerIndicateursContentieux('crimorg', enquetesLille) },
  { coffre: 'indicateurs-user-lille.admin', valeur: indic.calculerIndicateursUtilisateur(
    [{ archived: false, misEnExamen: [1, 2] }, { archived: true, misEnExamen: [3] }], [{}, { dateCloture: '2026-01-01' }]) },
]
verifier('un poste de Lille publie ses indicateurs (scellés)', await indic.publierIndicateurs(entrees, 'lille.admin', http(la.cookie)) === 2)
verifier('… sans republier l’identique', await indic.publierIndicateurs(entrees, 'lille.admin', http(la.cookie)) === 0)
verifier('un membre ne lit pas les indicateurs', (await coffreGet('indicateurs-ctx-crimorg', la.cookie)).status === 403)
const brut = fs.readFileSync(path.join(process.env.SIRAL_DATA_DIR, 'tj', tjLille.id, 'vaults', 'indicateurs-ctx-crimorg.json'), 'utf8')
verifier('le serveur ne voit pas les nombres (contenu chiffré)', !brut.includes('misEnCause') && !brut.includes('enCours'))
sup2 = await json(await tjsApi.GET(requete('/api/tjs', 'GET', undefined, sa.cookie)))
const ouverts = []
for (const env of sup2.tjs.find((t) => t.id === tjLille.id).indicateurs) ouverts.push(await escrow.ouvrirPourAdmin(pk, env))
const tot = indic.totaliser(ouverts)
verifier('l’admin général lit les indicateurs de Lille', tot.enCours === 2 && tot.misEnCause === 3 && tot.archives === 1
  && tot.enInstruction === 1 && tot.instructionsEnCours === 1 && tot.misEnExamen === 2 && tot.mesuresAirActives === 1)
verifier('sa clé d’administration est chargée en mémoire au déverrouillage', escrow.getClePriveeAdmin() !== null)

// ════════════════════════════════════════════════════════════
titre('7. Admin général tout-puissant : débloquer, cartographie inter-TJ')
const httpAdmin = (c) => {
  const q = (p) => requete(p, 'GET', undefined, c)
  return {
    get: async (p) => { const res = await donnees.GET(q(p)); return { status: res.status, json: await json(res) } },
    put: async (p, body) => (await donnees.PUT(requete(p, 'PUT', body, c))).status,
    del: async (p) => (await donnees.DELETE(requete(p, 'DELETE', undefined, c))).status,
  }
}
verifier('un admin local n’a pas accès aux autres TJ par cette voie',
  (await donnees.GET(requete(`/api/tjs/donnees?tj=default&coffre=ctx-crimorg`, 'GET', undefined, la.cookie))).status === 403)
verifier('coffres hors liste refusés même à l’admin général',
  (await donnees.GET(requete(`/api/tjs/donnees?tj=${tjLille.id}&coffre=keyring-lille.admin`, 'GET', undefined, sa.cookie))).status === 403)
verifier('pas d’invitation pour un compte étranger au TJ',
  (await donnees.PUT(requete(`/api/tjs/donnees?tj=${tjLille.id}&coffre=grant-collegue.amiens`, 'PUT', { encrypted: true, ct: 'x', iv: 'y' }, sa.cookie))).status === 403)

// Douai : son admin local dépose le séquestre
e = await etat(da)
verifier('séquestre de Douai déposé par son admin local',
  await escrow.maintenirSequestre(clesDouai.keys, { username: 'douai.admin', role: 'member' }, 'phrase admin douai', e, tjDouai.id, http(da)) === 'depose')

// habilitations réelles de Lille (coffre chiffré) : douai.magistrat, déplacé à Lille, a CRIM ORG
await ecrireDonnees('users-config', clesLille.keys, 'global',
  { users: [{ windowsUsername: 'douai.magistrat', contentieux: [{ contentieuxId: 'crimorg', role: 'magistrat' }] }] }, la.cookie)
const deb = await adminGen.debloquerCompte(tjLille.id, 'douai.magistrat', pk, httpAdmin(sa.cookie), 'audran')
verifier('déblocage : invitation aux périmètres de ses habilitations', deb.scopes.join(',') === 'global,ctx-crimorg')
const dm2 = cookieDe(await loginMdp('douai.magistrat', mdp2))
e = await etat(dm2)
verifier('… il voit son invitation', e.hasGrant === true && !e.hasKeyring)
const { envelope: gEnv } = await json(await coffreGet('grant-douai.magistrat', dm2))
const gKey = await keyring.importAesKey(await keyring.deriveRawKey(keyring.normalizeInvitationCode(deb.code), gEnv.kdfSalt, gEnv.kdfIterations))
const g = await decryptJson(gKey, gEnv)
verifier('… l’active et lit les données CRIM ORG de Lille',
  (await deposerTrousseau('douai.magistrat', { v: 1, keys: g.keys, createdAt: '', updatedAt: '' }, 'phrase du magistrat', dm2)).status === 200
  && (await lireDonnees('ctx-crimorg', g.keys, 'ctx-crimorg', dm2)).status === 200 && !g.keys['ctx-ecofi'])
await adminGen.debloquerCompte(tjLille.id, 'lille.admin', pk, httpAdmin(sa.cookie), 'audran')
e = await etat(la.cookie)
verifier('phrase perdue : son trousseau est remplacé par une invitation', e.hasGrant === true && e.hasKeyring === false)

// cartographie inter-TJ
const enq = (numero, noms) => ({ numero, statut: 'en_cours', misEnCause: noms.map((n) => (typeof n === 'string' ? { nom: n } : n)) })
await ecrireDonnees('ctx-crimorg', clesAmiens.keys, 'ctx-crimorg',
  { data: { enquetes: [enq('AM-1', ['DUPONT Jean', 'MARTIN Paul', { nom: 'VICTOR Hugo', isVictime: true }, 'Toto'])] } }, sa.cookie)
await ecrireDonnees('ctx-crimorg', clesLille.keys, 'ctx-crimorg',
  { data: { enquetes: [enq('LI-1', ['Jean Dupont', { nom: 'Hugo Victor', isVictime: true }, 'Toto'])] } }, dm2)
await ecrireDonnees('ctx-ecofi', clesDouai.keys, 'ctx-ecofi',
  { data: { enquetes: [enq('DO-1', ['DUPONT JEAN', 'Martin Paul'])] } }, da)
const carto = await adminGen.cartographieInterTj(
  [{ id: 'default', name: 'TJ Amiens' }, { id: tjLille.id, name: 'TJ Lille' }, { id: tjDouai.id, name: 'TJ Douai' }], pk, httpAdmin(sa.cookie))
const parNom = Object.fromEntries(carto.personnes.map((p) => [p.nom.toLowerCase(), p.tjs.map((t) => t.tj).sort()]))
verifier('cartographie : les trois TJ sont lus', carto.couverture.every((c) => c.lu))
verifier('DUPONT Jean relie Amiens, Lille et Douai (ordre et casse ignorés)', (parNom['dupont jean'] || []).length === 3)
verifier('MARTIN Paul relie Amiens et Douai', (parNom['martin paul'] || []).join(',') === ['default', tjDouai.id].sort().join(','))
verifier('les victimes et les noms d’un seul mot sont écartés', !carto.personnes.some((p) => /victor|toto/i.test(p.nom)))
verifier('les dossiers sont cités par TJ', carto.personnes.find((p) => /dupont/i.test(p.nom)).tjs.find((t) => t.tj === tjDouai.id).dossiers[0].numero === 'DO-1')
const audit2 = fs.readFileSync(path.join(process.env.SIRAL_DATA_DIR, 'audit.jsonl'), 'utf8')
verifier('lectures et déblocages journalisés', audit2.includes('"tj.donnees.lecture"') && audit2.includes('"tj.donnees.invitation"') && audit2.includes('"tj.donnees.reinitialisation"'))

// ════════════════════════════════════════════════════════════
titre('8. Robustesse (relectures)')
verifier('la clé d’administration ne peut pas être remplacée par l’application',
  (await escrowApi.PUT(requete('/api/escrow', 'PUT', { publicSpki: 'x', publicId: 'y', remplacer: true,
    privateEnvelope: { encrypted: true, ct: 'a', iv: 'b', kdfSalt: 'c', kdfIterations: 1 } }, sa.cookie))).status === 409)
// substitution de la paire côté serveur (compromission simulée) : les postes refusent de re-sceller
const fichierPaire = path.join(process.env.SIRAL_DATA_DIR, 'escrow-keypair.json')
const paireOrigine = fs.readFileSync(fichierPaire, 'utf8')
const intrus = await escrow.generateEscrowKeypair('phrase de l intrus')
fs.writeFileSync(fichierPaire, JSON.stringify({ ...intrus, createdAt: '', createdBy: 'intrus' }))
const sqAvant = fs.readFileSync(path.join(process.env.SIRAL_DATA_DIR, 'tj', tjDouai.id, 'vaults', 'escrow-keys.json'), 'utf8')
e = await etat(da)
verifier('clé substituée côté serveur : l’admin local refuse de re-sceller',
  await escrow.maintenirSequestre(clesDouai.keys, { username: 'douai.admin', role: 'member' }, 'x', e, tjDouai.id, http(da)) === 'cle-changee'
  && fs.readFileSync(path.join(process.env.SIRAL_DATA_DIR, 'tj', tjDouai.id, 'vaults', 'escrow-keys.json'), 'utf8') === sqAvant)
fs.writeFileSync(fichierPaire, paireOrigine)
verifier('un membre ne peut pas déposer les indicateurs d’un autre',
  (await coffrePut('indicateurs-user-lille.admin', { encrypted: true, ct: 'x', iv: 'y' }, dm2)).status === 403)
verifier('… ni épingler la clé d’administration', (await coffrePut('escrow-pin', { encrypted: true, ct: 'x', iv: 'y' }, dm2)).status === 403)
// suspension effective partout, y compris hors données
await patchCompte({ username: 'douai.magistrat', action: 'suspendre' })
verifier('compte suspendu : /api/me et changement de mot de passe refusés',
  (await me.GET(requete('/api/me', 'GET', undefined, dm2))).status !== 200
  && (await pwChange.POST(requete('/api/auth/password-change', 'POST', { ancien: mdp2, nouveau: 'xxxxxxxxxxxx' }, dm2))).status === 403)
await patchCompte({ username: 'douai.magistrat', action: 'reactiver' })
verifier('déplacement : l’ancien accès est retiré du TJ quitté',
  !fs.existsSync(path.join(process.env.SIRAL_DATA_DIR, 'tj', tjLille.id, 'vaults', 'keyring-lille.magistrat.json')))
// inscriptions simultanées dans un TJ neuf : un seul administrateur local
r = await tjsApi.POST(requete('/api/tjs', 'POST', { name: 'TJ Arras' }, sa.cookie))
const { code: codeArras, tj: tjArras } = await json(r)
const [i1, i2, i3] = await Promise.all([inscrire('arras.a', codeArras), inscrire('arras.b', codeArras), inscrire('arras.c', codeArras)])
const adminsArras = (await Promise.all([i1, i2, i3].map((i) => moi(i.cookie)))).filter((x) => x.tjAdmin).length
verifier('inscriptions simultanées : un seul administrateur local', adminsArras === 1)
// initialisations simultanées d'un TJ vierge : un seul jeu de clés
const adminArras = [i1, i2, i3][(await Promise.all([i1, i2, i3].map((i) => moi(i.cookie)))).findIndex((x) => x.tjAdmin)]
const nomAdminArras = (await moi(adminArras.cookie)).username
const swA = cookieDe(await switchTj.POST(requete('/api/auth/switch-tj', 'POST', { tj: tjArras.id }, sa.cookie)))
const [k1, k2] = await Promise.all([
  deposerTrousseau(nomAdminArras, keyring.freshKeyringPayload(), 'phrase arras', adminArras.cookie),
  deposerTrousseau('audran', keyring.freshKeyringPayload(), PHRASE_ADMIN, swA),
])
verifier('initialisations simultanées : un seul jeu de clés créé', [k1.status, k2.status].filter((x) => x === 200).length === 1)
// habilitations protégées
verifier('un membre ne peut pas écrire les habilitations de son TJ', (await coffrePut('users-config', { encrypted: true, ct: 'x', iv: 'y' }, dm2)).status === 403)
verifier('l’admin local le peut', (await ecrireDonnees('users-config', clesLille.keys, 'global',
  { users: [{ windowsUsername: 'douai.magistrat', contentieux: [{ contentieuxId: 'crimorg', role: 'magistrat' }] }] }, la.cookie)).status === 200)
// les administrateurs locaux sont informés de l'accès de l'administrateur général
const infoLocale = await json(await accounts.GET(requete('/api/accounts', 'GET', undefined, la.cookie)))
verifier('l’admin local voit l’accès de l’admin général à son TJ et ses actions',
  infoLocale.adminGeneral?.acces === 'ouvert' && infoLocale.adminGeneral.journal.some((x) => x.action === 'a lu à distance')
  && infoLocale.adminGeneral.journal.some((x) => x.action === 'a suspendu un compte'))
const infoDouai = await json(await accounts.GET(requete('/api/accounts', 'GET', undefined, da)))
verifier('… et l’admin de Douai ne voit pas ce qui concerne Lille',
  !!infoDouai.adminGeneral && !infoDouai.adminGeneral.journal.some((x) => x.action === 'a déposé une invitation'))
// protection contre un séquestre contrefait par le serveur
const pairePub = JSON.parse(fs.readFileSync(fichierPaire, 'utf8'))
const fichierSqLille = path.join(process.env.SIRAL_DATA_DIR, 'tj', tjLille.id, 'vaults', 'escrow-keys.json')
const sqLilleAvant = fs.readFileSync(fichierSqLille, 'utf8')
const faux = keyring.freshKeyringPayload()
fs.writeFileSync(fichierSqLille, JSON.stringify(await escrow.sealForEscrow(pairePub.publicSpki, faux.keys, 'serveur-pirate')))
let refuse = ''
try { await adminGen.clesDuTj(tjLille.id, pk, httpAdmin(sa.cookie)) } catch (err) { refuse = err.message }
verifier('séquestre contrefait (clés différentes de celles connues) : refusé', /Sécurité/.test(refuse))
fs.writeFileSync(fichierSqLille, sqLilleAvant)
verifier('… le vrai séquestre s’ouvre à nouveau', (await adminGen.clesDuTj(tjLille.id, pk, httpAdmin(sa.cookie)))['ctx-crimorg'] === clesLille.keys['ctx-crimorg'])
const vraiTemoin = await encryptJson(await keyring.importAesKey(new Uint8Array(Buffer.from(clesLille.keys.global, 'base64'))), { check: 'siral' })
refuse = ''
try { await escrow.controlerClesTj('tj-jamais-ouvert', faux.keys, vraiTemoin) } catch (err) { refuse = err.message }
verifier('clés qui n’ouvrent pas le témoin du TJ : refusées dès la première ouverture', /témoin/.test(refuse))
let accepte = true
try { await escrow.controlerClesTj('tj-jamais-ouvert-2', clesLille.keys, vraiTemoin) } catch { accepte = false }
verifier('… les vraies clés passent', accepte)
verifier('les empreintes retenues sont illisibles pour le serveur',
  !fs.readFileSync(path.join(process.env.SIRAL_DATA_DIR, 'escrow-epingles.json'), 'utf8').includes(tjLille.id))
verifier('connexion par passkey supprimée', !fs.existsSync(path.join(REPO, 'app/api/auth/login-verify')) && !fs.existsSync(path.join(REPO, 'lib/server/webauthn.ts')))
verifier('un deuxième compte « premier du serveur » est impossible : un seul administrateur général',
  JSON.parse(fs.readFileSync(path.join(process.env.SIRAL_DATA_DIR, 'accounts.json'), 'utf8')).filter((a) => a.role === 'admin').length === 1)

console.log(`\n${ok} vérifications réussies, ${ko} en échec`)
fs.rmSync(SCRATCH, { recursive: true, force: true })
process.exit(ko ? 1 : 0)
