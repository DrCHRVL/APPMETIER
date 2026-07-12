/**
 * Statut de l'attaché de justice — administrateur du TJ confié uniquement.
 * Si la fonctionnalité n'est pas activée (SIRAL_ATTACHE_URL absent) : 404,
 * indistinguable d'une route inexistante.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/status')
    const data = await res.json().catch(() => ({ error: 'Réponse illisible' }))
    return jsonResponse(data, { status: res.status })
  })
}
