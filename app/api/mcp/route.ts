/**
 * SIRAL — endpoint MCP public du connecteur Claude web (transport
 * « streamable HTTP », mode sans état : réponses JSON directes).
 *
 * L'app ne fait qu'authentifier (Bearer OAuth, admin revérifié à chaque
 * appel) puis relayer le JSON-RPC au service attaché (POST /mcp, réseau
 * interne, secret de pont) — seul détenteur des clés, qui exécute les
 * outils et journalise les écritures sous le contexte « connecteur ».
 *
 * Connecteur désactivé ou attaché absent → 404, indistinguable d'une route
 * inexistante.
 */
import { handle, jsonResponse, rpFromRequest, rateLimit, clientIp } from '@/lib/server/auth'
import { attacheFetch } from '@/lib/server/attache'
import { connectorActive, validateAccessToken } from '@/lib/server/mcpConnector'

export const dynamic = 'force-dynamic'

function unauthorized(req: Request, hadToken: boolean): Response {
  const { origin } = rpFromRequest(req)
  const challenge = [
    'Bearer realm="SIRAL"',
    ...(hadToken ? ['error="invalid_token"'] : []),
    `resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
  ].join(', ')
  return jsonResponse({ error: 'Non autorisé' }, {
    status: 401,
    headers: { 'www-authenticate': challenge },
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    if (!connectorActive()) return jsonResponse({ error: 'Introuvable' }, { status: 404 })
    rateLimit('mcp-appels:' + clientIp(req), 600, 5 * 60 * 1000)

    const auth = req.headers.get('authorization') || ''
    const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null
    const principal = validateAccessToken(bearer)
    if (!principal) return unauthorized(req, Boolean(bearer))

    const message = await req.json().catch(() => null)
    if (message === null || typeof message !== 'object') {
      return jsonResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalide' } }, { status: 400 })
    }

    // Les outils peuvent être longs (lecture de pièces, graphiques PNG…).
    const res = await attacheFetch('/mcp', { method: 'POST', body: message, timeoutMs: 180_000 })
    if (res.status === 202) return new Response(null, { status: 202 })
    if (!res.ok) {
      const id = Array.isArray(message) ? null : (message as { id?: unknown }).id ?? null
      return jsonResponse({
        jsonrpc: '2.0', id,
        error: { code: -32603, message: 'Service attaché indisponible — réessayez dans un instant' },
      }, { status: 500 })
    }
    const out = await res.json().catch(() => null)
    if (out === null) return new Response(null, { status: 202 })
    return jsonResponse(out)
  })
}

/** Pas de flux serveur→client : le transport « streamable HTTP » autorise un 405 ici. */
export async function GET() {
  return handle(async () => {
    if (!connectorActive()) return jsonResponse({ error: 'Introuvable' }, { status: 404 })
    return jsonResponse({ error: 'Méthode non autorisée' }, { status: 405, headers: { allow: 'POST' } })
  })
}

/** Mode sans état : aucune session MCP à clore côté serveur. */
export async function DELETE() {
  return handle(async () => {
    if (!connectorActive()) return jsonResponse({ error: 'Introuvable' }, { status: 404 })
    return jsonResponse({ error: 'Méthode non autorisée' }, { status: 405, headers: { allow: 'POST' } })
  })
}
