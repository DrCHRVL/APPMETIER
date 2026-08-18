/**
 * SIRAL — test de la CONNEXION du CLI Claude Code (scripts/attache/claudeAuth.mjs).
 *
 * Panne à couvrir : la session d'abonnement du serveur expire, le CLI répond
 * « Not logged in · Please run /login », et cette ligne arrivait dans le fil
 * de l'attaché comme une RÉPONSE. On vérifie ici la requalification (refus,
 * pas réponse), le rangement du jeton saisi dans l'app (chiffré par la
 * clé-maître, jamais en clair sur le disque) et l'état rendu au panneau.
 *
 *   node scripts/attache-auth.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-auth-test-'))
process.env.SIRAL_DATA_DIR = path.join(SCRATCH, 'data')
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')
process.env.HOME = path.join(SCRATCH, 'home')       // pas de session CLI ici
process.env.CLAUDE_CONFIG_DIR = path.join(SCRATCH, 'home', '.claude')
delete process.env.CLAUDE_CODE_OAUTH_TOKEN
delete process.env.ANTHROPIC_API_KEY
delete process.env.ANTHROPIC_AUTH_TOKEN
fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })

const {
  looksLikeAuthFailure, writeClaudeToken, clearClaudeToken, readTokenOverride,
  claudeToken, claudeAuthEnv, claudeAuthStatus, noteAuthFailure, clearAuthFailure,
} = await import('./attache/claudeAuth.mjs')

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

// ── Requalification d'un refus d'authentification ──
attendu('« Not logged in » est un refus', looksLikeAuthFailure('Not logged in · Please run /login'))
attendu('« /login isn\'t available » est un refus', looksLikeAuthFailure("/login isn't available in this environment."))
attendu('jeton expiré est un refus', looksLikeAuthFailure('Error: OAuth token has expired'))
attendu('clé invalide est un refus', looksLikeAuthFailure('Invalid API key · Please run /login'))
attendu('sortie vide : pas un refus', !looksLikeAuthFailure(''))
// Une vraie réponse de l'attaché peut citer ces mots : elle est longue, on ne
// la requalifie jamais en panne de connexion.
const vraieReponse = 'La garde à vue est irrégulière : l\'avocat n\'a pas été avisé. '.repeat(12)
  + 'Le PV mentionne un accès « unauthorized » au fichier.'
attendu('longue réponse citant « unauthorized » : pas un refus', !looksLikeAuthFailure(vraieReponse), `${vraieReponse.length} car.`)

// ── État sans aucune connexion ──
let st = claudeAuthStatus()
attendu('sans session ni jeton : non connecté', st.connecte === false && Boolean(st.raison), st.raison)
attendu('un remède est proposé', /setup-token/.test(st.remede || ''))

// ── Jeton saisi dans l'app ──
let refus = null
try { writeClaudeToken('bonjour') } catch (e) { refus = e.message }
attendu('jeton mal formé refusé', /invalide/i.test(refus || ''), refus)
refus = null
try { writeClaudeToken('sk-ant-oat01-avec espace') } catch (e) { refus = e.message }
attendu('jeton avec espace refusé', /invalide/i.test(refus || ''), refus)

const JETON = 'sk-ant-oat01-' + 'a'.repeat(60)
writeClaudeToken(JETON, 'magistrat')
attendu('jeton relu', readTokenOverride()?.token === JETON)
attendu('jeton injecté dans l\'environnement du CLI', claudeAuthEnv().CLAUDE_CODE_OAUTH_TOKEN === JETON)
attendu('jeton effectif', claudeToken() === JETON)
const surDisque = fs.readFileSync(path.join(process.env.SIRAL_DATA_DIR, 'attache', 'claude-token.enc.json'), 'utf8')
attendu('jeton chiffré au repos (absent en clair du fichier)', !surDisque.includes(JETON) && /"encrypted":\s*true/.test(surDisque))

st = claudeAuthStatus()
attendu('avec jeton : connecté', st.connecte === true && st.source === 'jeton-app' && st.jetonApp === true)

// ── Un refus CONSTATÉ prime sur la présence d'un jeton ──
await noteAuthFailure('Not logged in · Please run /login')
st = claudeAuthStatus()
attendu('refus constaté : état non connecté', st.connecte === false && /refusé/.test(st.raison || ''), st.raison)
await clearAuthFailure()
attendu('après un run réussi : de nouveau connecté', claudeAuthStatus().connecte === true)

// ── Retour à la session du serveur ──
attendu('jeton effaçable', clearClaudeToken() === true && readTokenOverride() === null)
attendu('sans jeton : environnement du CLI vide', Object.keys(claudeAuthEnv()).length === 0)

// ── Session du CLI lue depuis le volume claude-auth ──
const creds = path.join(process.env.CLAUDE_CONFIG_DIR, '.credentials.json')
fs.writeFileSync(creds, JSON.stringify({ claudeAiOauth: { accessToken: 'x', refreshToken: 'r', expiresAt: Date.now() + 86_400_000 } }))
attendu('session valide : connecté', claudeAuthStatus().connecte === true)
fs.writeFileSync(creds, JSON.stringify({ claudeAiOauth: { accessToken: 'x', expiresAt: Date.now() - 86_400_000 } }))
st = claudeAuthStatus()
attendu('session expirée sans rafraîchissement : non connecté', st.connecte === false, st.raison)

fs.rmSync(SCRATCH, { recursive: true, force: true })
console.log(echecs.length ? `\n❌ ${echecs.length} échec(s) : ${echecs.join(' · ')}` : '\n✅ TOUS LES TESTS PASSENT')
process.exit(echecs.length ? 1 : 0)
