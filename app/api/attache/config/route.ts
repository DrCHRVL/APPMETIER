/**
 * Configuration du cerveau de l'attaché — modèle, niveau d'effort, accès web.
 * Simple relais vers le service attaché (qui valide et persiste) ; réservé à
 * l'administrateur du TJ confié, comme toutes les routes /api/attache/*.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/config')
    return jsonResponse(await res.json().catch(() => ({ config: {} })), { status: res.status })
  })
}

export async function PUT(req: Request) {
  return handle(async () => {
    const session = requireAttacheAdmin(req)
    const body = await req.json().catch(() => null) as { model?: string, effort?: string, webAccess?: boolean, signatureCR?: string } | null
    if (!body || typeof body !== 'object') return jsonResponse({ error: 'Corps requis' }, { status: 400 })
    const res = await attacheFetch('/config', { method: 'PUT', body: { ...body, par: session.u } })
    return jsonResponse(await res.json().catch(() => ({ error: 'Réponse illisible' })), { status: res.status })
  })
}
