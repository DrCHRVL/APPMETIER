/**
 * SIRAL — pont entre l'endpoint MCP public (`/api/mcp`, connecteur Claude
 * web) et le service attaché, seul détenteur des clés et des outils.
 *
 * Rôle de ce module : traduire un échec du relais en réponse que Claude sait
 * AFFICHER. Un 5xx HTTP sur le transport « streamable HTTP » est compris par
 * les clients MCP comme « ce n'est pas un serveur MCP valide » — le magistrat
 * voyait « Impossible de se connecter au serveur. Vérifiez que l'URL pointe
 * vers un serveur MCP valide » là où le vrai problème était côté serveur
 * (conteneur « attache » arrêté, image plus ancienne que l'app, secret de
 * pont divergent). On répond donc 200 + erreur JSON-RPC motivée, et on offre
 * la même sonde au panneau d'administration.
 */
import { attacheFetch } from './attache'

/**
 * Poignée de main et listes : Claude abandonne vite sur ces appels. Mieux
 * vaut rendre une erreur lisible au bout de 25 s qu'un abandon muet ; les
 * outils, eux, peuvent légitimement durer (lecture de pièces, graphiques).
 */
const HANDSHAKE = new Set([
  'initialize', 'ping',
  'tools/list', 'resources/list', 'resources/templates/list', 'prompts/list',
])

export const RELAY_TIMEOUT_HANDSHAKE_MS = 25_000
export const RELAY_TIMEOUT_TOOL_MS = 180_000

interface JsonRpcMessage { jsonrpc?: string, id?: unknown, method?: unknown }

const asList = (message: unknown): JsonRpcMessage[] =>
  (Array.isArray(message) ? message : [message]).filter((m): m is JsonRpcMessage => Boolean(m) && typeof m === 'object')

/** Le lot ne contient-il QUE des méthodes de poignée de main ? */
export function isHandshake(message: unknown): boolean {
  const list = asList(message)
  return list.length > 0 && list.every((m) => HANDSHAKE.has(String(m.method || '')))
}

/** Un message sans `id` est une notification : le transport MCP répond 202, sans corps. */
export function expectsAnswer(message: unknown): boolean {
  return asList(message).some((m) => m.id !== undefined)
}

/** `id` à reprendre dans une erreur JSON-RPC (null pour un lot ou un corps illisible). */
export function messageId(message: unknown): unknown {
  if (Array.isArray(message) || !message || typeof message !== 'object') return null
  const id = (message as JsonRpcMessage).id
  return id === undefined ? null : id
}

/**
 * Échec du relais → phrase actionnable pour le magistrat. Les statuts
 * viennent soit du service attaché lui-même, soit d'`attacheFetch` (503
 * synthétique quand le service est injoignable ou n'a pas répondu à temps).
 */
export async function describeRelayFailure(res: Response): Promise<string> {
  const detail = await res.json().catch(() => null) as { error?: string } | null
  const raison = detail?.error ? String(detail.error).slice(0, 200) : `HTTP ${res.status}`
  if (res.status === 404) {
    return `Le service attaché répond mais ne connaît pas le point d'entrée MCP (${raison}) : son image est plus ancienne que celle de l'application. Relancez la mise à jour (Paramètres → Mise à jour) — elle reconstruit l'application ET l'attaché.`
  }
  if (res.status === 401 || res.status === 403) {
    return `Le service attaché refuse le secret de pont (${raison}) : SIRAL_SECRET (ou SIRAL_ATTACHE_BRIDGE_SECRET) diffère entre l'application et le conteneur « attache ».`
  }
  if (res.status === 503) {
    return `Service attaché injoignable ou trop lent (${raison}) : le conteneur « attache » est arrêté ou redémarre en boucle (SIRAL_ATTACHE_MASTER_KEY absente ou invalide ?), ou SIRAL_ATTACHE_URL ne pointe pas dessus.`
  }
  return `Service attaché indisponible (${raison}) — réessayez dans un instant.`
}

// ── Sonde de diagnostic (panneau d'administration) ──

export interface RelayProbe {
  ok: boolean
  /** Phrase à afficher telle quelle, succès comme échec. */
  detail: string
  serveur?: string
  protocole?: string
  outils?: number
}

/**
 * Rejoue EXACTEMENT ce que fait Claude web une fois autorisé — `initialize`
 * puis `tools/list` à travers le relais — pour distinguer en une seconde un
 * problème d'OAuth d'un problème de service attaché. Lectures seules : aucun
 * outil n'est appelé, rien n'est audité.
 */
export async function probeConnectorRelay(): Promise<RelayProbe> {
  const init = await attacheFetch('/mcp', {
    method: 'POST',
    timeoutMs: RELAY_TIMEOUT_HANDSHAKE_MS,
    body: {
      jsonrpc: '2.0', id: 'diag-init', method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'siral-diagnostic', version: '1.0.0' },
      },
    },
  })
  if (!init.ok) return { ok: false, detail: await describeRelayFailure(init) }

  const hello = await init.json().catch(() => null) as {
    result?: { protocolVersion?: string, serverInfo?: { name?: string, version?: string } },
    error?: { message?: string },
  } | null
  if (!hello || !hello.result) {
    return { ok: false, detail: `Le service attaché a refusé la poignée de main MCP : ${hello?.error?.message || 'réponse illisible'}.` }
  }

  const listed = await attacheFetch('/mcp', {
    method: 'POST',
    timeoutMs: RELAY_TIMEOUT_HANDSHAKE_MS,
    body: { jsonrpc: '2.0', id: 'diag-tools', method: 'tools/list' },
  })
  if (!listed.ok) return { ok: false, detail: await describeRelayFailure(listed) }
  const tools = await listed.json().catch(() => null) as {
    result?: { tools?: unknown[] }, error?: { message?: string },
  } | null
  if (!tools || !tools.result || !Array.isArray(tools.result.tools)) {
    return { ok: false, detail: `Le service attaché n'a pas listé ses outils : ${tools?.error?.message || 'réponse illisible'}.` }
  }

  const serveur = hello.result.serverInfo?.name || 'siral'
  const protocole = hello.result.protocolVersion || '—'
  return {
    ok: true,
    serveur,
    protocole,
    outils: tools.result.tools.length,
    detail: `Service attaché prêt : ${tools.result.tools.length} outils exposés (serveur « ${serveur} », protocole ${protocole}). Si Claude échoue malgré tout, révoquez la connexion ici puis supprimez et recréez le connecteur côté claude.ai.`,
  }
}
