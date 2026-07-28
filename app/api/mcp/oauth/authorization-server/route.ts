/**
 * Métadonnées du serveur d'autorisation OAuth (RFC 8414) du connecteur
 * Claude web. Servie sous /.well-known/oauth-authorization-server via les
 * rewrites de next.config.mjs. 404 si le connecteur n'est pas activé.
 */
import { handle, jsonResponse, rpFromRequest } from '@/lib/server/auth'
import { connectorActive } from '@/lib/server/mcpConnector'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    if (!connectorActive()) return jsonResponse({ error: 'Introuvable' }, { status: 404 })
    const { origin } = rpFromRequest(req)
    return jsonResponse({
      issuer: origin,
      authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
      token_endpoint: `${origin}/api/mcp/oauth/token`,
      registration_endpoint: `${origin}/api/mcp/oauth/register`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: ['siral'],
    })
  })
}
