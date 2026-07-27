/**
 * Gestion du connecteur Claude web — réservée à l'administrateur du TJ
 * confié (mêmes gardes 404 que toutes les routes /api/attache/*).
 *
 *  GET    : état (activé, clients connectés, journal) + URL à coller dans claude.ai
 *  PUT    : { enabled } — activer/désactiver (désactiver révoque tous les jetons)
 *  DELETE : ?client=<id> révoque une connexion · ?all=1 révoque tout
 */
import { handle, jsonResponse, rpFromRequest } from '@/lib/server/auth'
import { requireAttacheAdmin } from '@/lib/server/attache'
import { connectorSummary, setConnectorEnabled, revokeClient, revokeAll } from '@/lib/server/mcpConnector'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const { origin } = rpFromRequest(req)
    return jsonResponse({ ...connectorSummary(), url: `${origin}/api/mcp` })
  })
}

export async function PUT(req: Request) {
  return handle(async () => {
    const session = requireAttacheAdmin(req)
    const body = await req.json().catch(() => null) as { enabled?: boolean } | null
    if (!body || typeof body.enabled !== 'boolean') {
      return jsonResponse({ error: 'Champ enabled (booléen) requis' }, { status: 400 })
    }
    await setConnectorEnabled(body.enabled, session.u)
    return jsonResponse({ ok: true, ...connectorSummary() })
  })
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const session = requireAttacheAdmin(req)
    const url = new URL(req.url)
    if (url.searchParams.get('all') === '1') {
      await revokeAll(session.u)
      return jsonResponse({ ok: true, ...connectorSummary() })
    }
    const clientId = url.searchParams.get('client') || ''
    if (!clientId) return jsonResponse({ error: 'Paramètre client ou all=1 requis' }, { status: 400 })
    const ok = await revokeClient(clientId, session.u)
    return jsonResponse({ ok, ...connectorSummary() })
  })
}
