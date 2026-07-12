/**
 * Trousseau de l'attaché — remise et révocation des clés.
 *
 * PUT : l'administrateur, DÉVERROUILLÉ dans son navigateur, transmet les clés
 * brutes des seuls périmètres confiés (global + un contentieux). L'app les
 * RELAIE au service attaché sans jamais les persister ; le service les
 * enveloppe aussitôt avec sa clé-maître.
 * DELETE : révocation immédiate — l'attaché redevient aveugle.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function PUT(req: Request) {
  return handle(async () => {
    const session = requireAttacheAdmin(req)
    const body = await req.json().catch(() => null) as { keys?: Record<string, string> } | null
    if (!body?.keys || typeof body.keys !== 'object') {
      return jsonResponse({ error: 'Clés requises' }, { status: 400 })
    }
    const res = await attacheFetch('/keyring', { method: 'POST', body: { keys: body.keys, grantedBy: session.u } })
    return jsonResponse(await res.json().catch(() => ({ error: 'Réponse illisible' })), { status: res.status })
  })
}

export async function DELETE(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/keyring', { method: 'DELETE' })
    return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
  })
}
