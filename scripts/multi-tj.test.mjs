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
 *  5. l'étanchéité : aucun accès croisé entre TJ, un membre = un TJ.
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
const [register, tjsApi, vault, accounts, accountsTjs, state, me, switchTj, escrowApi, versionFile] = await Promise.all([
  route('auth/password-register'), route('tjs'), route('vaults/[name]'), route('accounts'),
  route('accounts/tjs'), route('e2ee/state'), route('me'), route('auth/switch-tj'), route('escrow'),
  route('vaults/[name]/versions/[file]'),
])
const { encryptJson, decryptJson } = await imp('lib/web/crypto.ts')
const keyring = await imp('lib/web/keyring.ts')
const escrow = await imp('lib/web/escrow.ts')
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
    const mod = chemin === '/api/escrow' ? escrowApi : null
    if (!mod) throw new Error('route non simulée ' + p)
    const res = await mod.GET(requete(chemin + (qs ? `?${qs}` : ''), 'GET', undefined, c))
    return { status: res.status, json: await json(res) }
  },
  putJson: async (p, body) => {
    if (p === '/api/escrow') return (await escrowApi.PUT(requete(p, 'PUT', body, c))).status
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
verifier('paire non recréée ensuite',
  await escrow.maintenirSequestre(clesAmiens.keys, { username: 'audran', role: 'admin' }, PHRASE_ADMIN, e, 'default', http(sa.cookie)) === 'rien')
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
verifier('l’admin général ne peut pas initialiser Lille à sa place', e.canInitialize === false && !e.escrow)
verifier('… le serveur le refuse aussi', (await deposerTrousseau('audran', keyring.freshKeyringPayload(), PHRASE_ADMIN, sw0)).status === 403)
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
verifier('à Amiens, aucun séquestre n’est nécessaire (l’admin général y a ses clés)', !e.escrow)
app = await ouvrirApp(sa.cookie)
verifier('retour à Amiens : sa papeterie d’origine', PAPETERIE.ville === 'Amiens')
r = await tjsApi.POST(requete('/api/tjs', 'POST', { name: 'TJ Douai' }, sa.cookie))
const tjDouai = (await json(r)).tj
const swD = cookieDe(await switchTj.POST(requete('/api/auth/switch-tj', 'POST', { tj: tjDouai.id }, sa.cookie)))
verifier('TJ vierge : l’admin général ne crée pas ses clés', (await deposerTrousseau('audran', keyring.freshKeyringPayload(), PHRASE_ADMIN, swD)).status === 403)

console.log(`\n${ok} vérifications réussies, ${ko} en échec`)
fs.rmSync(SCRATCH, { recursive: true, force: true })
process.exit(ko ? 1 : 0)
