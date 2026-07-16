/**
 * Consommation de tokens de l'attaché — administrateur du TJ confié uniquement.
 * Relais vers le service attaché (qui agrège les runs) : le bilan ne contient
 * que des nombres et des horodatages, aucune donnée d'enquête.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/usage')
    return jsonResponse(await res.json().catch(() => ({ usage: null })), { status: res.status })
  })
}
