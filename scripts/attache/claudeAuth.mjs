/**
 * SIRAL — Attaché de justice · authentification du CLI Claude Code.
 *
 * Le « cerveau » de l'attaché est le CLI `claude` connecté à l'ABONNEMENT du
 * magistrat. Cette connexion vit dans le volume `claude-auth`
 * (~/.claude/.credentials.json) et EXPIRE : le jour où elle tombe, chaque run
 * remontait dans le panneau une réponse d'assistant énigmatique
 * (« Not logged in · Please run /login ») — le magistrat ne pouvait ni
 * comprendre ni corriger depuis l'app, `/login` n'existant pas en mode
 * headless.
 *
 * Ce module donne trois choses :
 *  1. un ÉTAT lisible de la connexion (jeton in-app, variable d'environnement,
 *     session du CLI, dernier refus constaté à l'exécution) ;
 *  2. une VOIE DE RETOUR sans docker exec : le magistrat lance
 *     `claude setup-token` sur une machine de confiance et colle le jeton dans
 *     Paramètres → Attaché IA. Il est chiffré au repos par la clé-maître
 *     (comme les mots de passe mail) et injecté dans l'environnement du CLI ;
 *  3. la DÉTECTION des refus d'authentification dans la sortie d'un run, pour
 *     les transformer en erreur explicite au lieu d'une fausse réponse.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { attacheDir, ensureDir, atomicWrite, readJson, readState, writeState } from './store.mjs'
import { loadMasterKey, wrapWithMaster, unwrapWithMaster } from './crypto.mjs'

const TOKEN_FILE = () => attacheDir('claude-token.enc.json')

/** Répertoire de configuration du CLI (volume claude-auth en production). */
export function claudeConfigDir(env = process.env) {
  if (env.CLAUDE_CONFIG_DIR) return env.CLAUDE_CONFIG_DIR
  const home = env.HOME || os.homedir() || ''
  return home ? path.join(home, '.claude') : ''
}

// ── Jeton d'abonnement saisi DANS L'APP (chiffré par la clé-maître) ──

export function readTokenOverride() {
  const master = loadMasterKey()
  if (!master) return null
  const stored = readJson(TOKEN_FILE(), null)
  if (!stored?.envelope) return null
  try { return unwrapWithMaster(master, stored.envelope) } catch { return null }
}

export function tokenOverrideActive() {
  return Boolean(readJson(TOKEN_FILE(), null)?.envelope)
}

/**
 * Enregistre le jeton d'abonnement (sortie de `claude setup-token`).
 * Refuse ce qui ne ressemble pas à un jeton : mieux vaut un message clair
 * tout de suite qu'un run qui échoue trois minutes plus tard.
 */
export function writeClaudeToken(token, by = 'admin') {
  const master = loadMasterKey()
  if (!master) throw new Error('Clé-maître absente (SIRAL_ATTACHE_MASTER_KEY)')
  const value = String(token || '').trim()
  if (!value) throw new Error('Jeton vide')
  if (/\s/.test(value)) throw new Error('Jeton invalide (espaces) — collez la seule ligne rendue par « claude setup-token »')
  if (!/^sk-ant-[A-Za-z0-9_-]{20,400}$/.test(value)) {
    throw new Error('Jeton invalide — attendu : la ligne « sk-ant-… » rendue par « claude setup-token »')
  }
  const payload = { token: value, updatedAt: new Date().toISOString(), updatedBy: by }
  ensureDir(attacheDir())
  atomicWrite(TOKEN_FILE(), JSON.stringify({
    updatedAt: payload.updatedAt, updatedBy: by, envelope: wrapWithMaster(master, payload),
  }, null, 2))
  return true
}

/** Efface le jeton in-app : retour à la session du CLI / aux variables d'env. */
export function clearClaudeToken() {
  const p = TOKEN_FILE()
  if (fs.existsSync(p)) { fs.unlinkSync(p); return true }
  return false
}

/** Jeton effectif pour lancer le CLI (in-app d'abord, sinon variable d'env). */
export function claudeToken(env = process.env) {
  const stored = readTokenOverride()
  if (stored?.token) return stored.token
  return env.CLAUDE_CODE_OAUTH_TOKEN || ''
}

/** Variables à injecter dans l'environnement d'un run du CLI. */
export function claudeAuthEnv(env = process.env) {
  const token = claudeToken(env)
  return token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}
}

// ── Lecture de la session du CLI (~/.claude/.credentials.json) ──

function readCliCredentials(env = process.env) {
  const dir = claudeConfigDir(env)
  if (!dir) return null
  const raw = readJson(path.join(dir, '.credentials.json'), null)
  const oauth = raw?.claudeAiOauth || raw?.claudeAiOAuth || null
  if (!oauth || typeof oauth !== 'object') return null
  const expiresAt = Number(oauth.expiresAt) || 0
  return {
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    expired: Boolean(expiresAt && expiresAt < Date.now()),
    refreshable: Boolean(oauth.refreshToken),
    abonnement: oauth.subscriptionType || null,
  }
}

/** Un helper de clé (settings.json) suffit aussi à authentifier le CLI. */
function hasApiKeyHelper(env = process.env) {
  const dir = claudeConfigDir(env)
  if (!dir) return false
  return Boolean(readJson(path.join(dir, 'settings.json'), null)?.apiKeyHelper)
}

// ── Refus constaté à l'exécution (la preuve la plus sûre) ──

const AUTH_PATTERNS = [
  /not logged in/i,
  /please run \/login/i,
  /\/login isn'?t available/i,
  /invalid api key/i,
  /authentication[_ ]error/i,
  /oauth token (has )?(expired|been revoked)/i,
  /credit balance is too low/i,
  /unauthorized/i,
]

/**
 * La sortie d'un run trahit-elle un refus d'authentification ?
 * On n'inspecte que des sorties COURTES : le CLI non connecté ne rend qu'une
 * ligne, tandis qu'une vraie réponse de l'attaché citant « unauthorized »
 * (une nullité de garde à vue, par exemple) est longue — elle ne doit jamais
 * être requalifiée en panne de connexion.
 */
export function looksLikeAuthFailure(text) {
  const s = String(text || '').trim()
  if (!s || s.length > 400) return false
  return AUTH_PATTERNS.some((re) => re.test(s))
}

export const AUTH_FAILURE_MESSAGE =
  'Claude Code n\'est plus connecté sur le serveur : la session de l\'abonnement a expiré. '
  + 'Rendez-vous dans Paramètres → Attaché IA → « Connexion Claude Code » et collez un nouveau jeton '
  + '(obtenu par « claude setup-token » sur une machine de confiance). Aucune conversation n\'est perdue.'

/** Mémorise le dernier refus constaté (affiché dans l'état, effacé au premier run réussi). */
export async function noteAuthFailure(detail = '') {
  try {
    await writeState({ claudeAuthEchec: { at: new Date().toISOString(), detail: String(detail).slice(0, 300) } })
  } catch { /* état non écrit : le diagnostic reste heuristique */ }
}

export async function clearAuthFailure() {
  try {
    if (readState().claudeAuthEchec) await writeState({ claudeAuthEchec: null })
  } catch { /* sans conséquence */ }
}

/**
 * État de la connexion du CLI, du plus sûr au plus heuristique :
 * un refus constaté à l'exécution prime sur tout le reste.
 */
export function claudeAuthStatus(env = process.env) {
  const stored = readTokenOverride()
  const source = stored?.token ? 'jeton-app'
    : env.CLAUDE_CODE_OAUTH_TOKEN ? 'variable-env'
    : (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) ? 'cle-api'
    : (env.CLAUDE_CODE_USE_BEDROCK === '1' || env.CLAUDE_CODE_USE_VERTEX === '1') ? 'passerelle'
    : hasApiKeyHelper(env) ? 'helper'
    : null
  const cli = readCliCredentials(env)
  const echec = readState().claudeAuthEchec || null

  let connecte = Boolean(source)
  let raison = null
  if (!connecte) {
    if (!cli) {
      connecte = false
      raison = 'aucune session Claude Code sur le serveur (ni jeton enregistré dans l\'app)'
    } else if (cli.expired && !cli.refreshable) {
      connecte = false
      raison = 'la session Claude Code du serveur a expiré'
    } else {
      connecte = true
      raison = null
    }
  }
  // Un run refusé pour authentification depuis la dernière réussite : c'est un
  // fait, pas une supposition — il l'emporte sur la présence d'un jeton.
  if (echec?.at) {
    connecte = false
    raison = `dernier échange refusé pour défaut d'authentification (${new Date(echec.at).toLocaleString('fr-FR')})`
  }

  return {
    connecte,
    source,
    jetonApp: Boolean(stored?.token),
    jetonAppLe: stored?.updatedAt || null,
    session: cli,
    dernierEchec: echec,
    raison,
    remede: connecte ? null : AUTH_FAILURE_MESSAGE,
  }
}
