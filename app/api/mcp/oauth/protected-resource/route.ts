/**
 * Métadonnées de la ressource protégée (RFC 9728) : indique à Claude web où
 * se trouve le serveur d'autorisation du connecteur. Servie sous
 * /.well-known/oauth-protected-resource via les rewrites de next.config.mjs.
 */
import { handle, jsonResponse, rpFromRequest } from '@/lib/server/auth'
import { connectorActive } from '@/lib/server/mcpConnector'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    if (!connectorActive()) return jsonResponse({ error: 'Introuvable' }, { status: 404 })
    const { origin } = rpFromRequest(req)
    return jsonResponse({
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
      resource_name: 'SIRAL — connecteur Claude',
      scopes_supported: ['siral'],
    })
  })
}
