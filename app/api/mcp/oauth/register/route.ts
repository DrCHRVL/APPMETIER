/**
 * Enregistrement dynamique de client OAuth (RFC 7591) pour le connecteur
 * Claude web. Public quand le connecteur est activé (comme chez tous les
 * serveurs MCP distants), mais borné : redirect_uri limités aux domaines
 * Claude (+ SIRAL_MCP_REDIRECT_HOSTS), nombre de clients plafonné, et un
 * client n'obtient JAMAIS de jeton sans l'autorisation de l'administrateur
 * (session admin + consentement + PKCE).
 */
import { handle, jsonResponse, rateLimit, clientIp } from '@/lib/server/auth'
import { connectorActive, registerClient } from '@/lib/server/mcpConnector'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    if (!connectorActive()) return jsonResponse({ error: 'Introuvable' }, { status: 404 })
    rateLimit('mcp-register:' + clientIp(req), 10, 3600 * 1000)
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return jsonResponse({ error: 'invalid_client_metadata', error_description: 'Corps JSON requis' }, { status: 400 })
    }
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : []
    try {
      const { client, secret } = await registerClient({
        name: typeof body.client_name === 'string' ? body.client_name : undefined,
        redirectUris,
        authMethod: typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : undefined,
      })
      return jsonResponse({
        client_id: client.id,
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
        client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: client.authMethod,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'siral',
      }, { status: 201 })
    } catch (e) {
      return jsonResponse({
        error: 'invalid_redirect_uri',
        error_description: e instanceof Error ? e.message : 'Enregistrement refusé',
      }, { status: 400 })
    }
  })
}
