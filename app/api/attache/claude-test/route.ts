/**
 * Diagnostic de la connexion Claude Code : un tour minuscule chez Claude,
 * sans outils, pour dire si l'abonnement répond vraiment. Réservé à
 * l'administrateur du TJ confié.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/claude-test', { method: 'POST', timeoutMs: 90_000 })
    return jsonResponse(await res.json().catch(() => ({ ok: false, error: 'Réponse illisible' })), { status: res.status })
  })
}
