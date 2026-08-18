/**
 * Connexion du CLI Claude Code à l'abonnement du magistrat, saisie dans
 * l'app. Simple relais vers le service attaché (seul détenteur de la
 * clé-maître, qui chiffre le jeton au repos) ; réservé à l'administrateur du
 * TJ confié.
 *
 * PUT    : enregistre le jeton rendu par « claude setup-token ».
 * DELETE : l'efface — retour à la session du serveur (volume claude-auth).
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function PUT(req: Request) {
  return handle(async () => {
    const session = requireAttacheAdmin(req)
    const body = await req.json().catch(() => null)
    const token = body && typeof body.token === 'string' ? body.token.trim() : ''
    if (!token) return jsonResponse({ error: 'Jeton requis' }, { status: 400 })
    const res = await attacheFetch('/claude-token', { method: 'PUT', body: { token, par: session.u } })
    return jsonResponse(await res.json().catch(() => ({ ok: false, error: 'Réponse illisible' })), { status: res.status })
  })
}

export async function DELETE(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/claude-token', { method: 'DELETE' })
    return jsonResponse(await res.json().catch(() => ({ ok: false, error: 'Réponse illisible' })), { status: res.status })
  })
}
